import type {
  PublishingProvider, PublishInput, PublishResult, PublishCheck, PublishMedia, AnalyticsResult, ModerateAction,
} from './provider';
import { BudgetExhausted, CallBudget, fixedLengthBody, mapMetrics, youtubeTitle } from './socialapi';
import { platformNames } from '../platformLabels';

/* ═══ Ayrshare ═══

   مزوّدٌ كاملٌ يُختار من الإعدادات كما يُختار SocialAPI. والحساب على خطة
   Launch، والحسابات كلها مربوطةٌ بالملف الرئيسي (Primary Profile) — فلا
   `Profile-Key` في أيّ طلب. والتوثيق: https://www.ayrshare.com/docs

   وما بُني عليه هنا مأخوذٌ من صفحات التوثيق نفسها لا من الذاكرة:
   - الأساس `https://api.ayrshare.com/api` والمفتاح `Authorization: Bearer`.
   - منذ ٣١ مارس ٢٠٢٦ يشترط إكس مفتاحَي تطبيق المطوّر لدى صاحب الحساب في
     كل طلبٍ يمسّه: `X-Twitter-OAuth1-Api-Key` و`X-Twitter-OAuth1-Api-Secret`.
     وبدونهما يُرفض الطلب برمز 419.
   - معرّف المنشور لدى Ayrshare (`id` في أعلى الردّ) هو ما يُحذف به ويُسأل
     به عن حاله وتحليلاته وتعليقاته — لا معرّف المنصة. */

const BASE = 'https://api.ayrshare.com/api';

/** مفتاحا تطبيق إكس لدى صاحب الحساب — يُرسلان مع كل طلب إن ضُبطا. */
export type AyrshareXKeys = { key?: string; secret?: string };

/**
 * اسم المنصة لدى Ayrshare. إكس عنده `twitter`، والملف التجاري `gmb`.
 * ولينكدإن واحدٌ في الملف الرئيسي — شخصيٌّ أو صفحة — فالمفتاحان عندنا إليه.
 */
export function ayrsharePlatform(platform: string): string {
  if (platform === 'x') return 'twitter';
  if (platform === 'google') return 'gmb';
  if (platform === 'linkedin_page') return 'linkedin';
  return platform;
}

export class AyrshareError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
    this.name = 'AyrshareError';
  }
}

/** رسائل الأخطاء من الردّ — مصفوفة `errors` أو `message` في أعلاه، ومعها الرمز. */
export function ayrshareErrors(data: any): string {
  const list: any[] = Array.isArray(data?.errors) ? data.errors : [];
  const parts = list
    .map((e) => {
      const msg = String(e?.message || '').trim();
      if (!msg) return '';
      return e?.platform ? `${e.platform}: ${msg}` : msg;
    })
    .filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return String(data?.message || '').trim();
}

/** رموز الأخطاء في الردّ — بها يُفرَّق بين الأسباب، لا بنصّ الرسالة. */
export function errorCodes(data: any): number[] {
  const codes = [data?.code, ...(Array.isArray(data?.errors) ? data.errors.map((e: any) => e?.code) : [])];
  return codes.map(Number).filter((n) => Number.isFinite(n));
}

/**
 * الردّ مع ملفّ مستخدم يُغلَّف في `posts: [...]` — والملف الرئيسي يردّه مكشوفاً.
 * يُقرأ الشكلان فلا يتوقّف النشر لو ربطت الحسابات بملفّ مستخدم لاحقاً.
 */
export function unwrapAyrsharePost(data: any): any {
  if (Array.isArray(data?.posts) && data.posts.length && typeof data.posts[0] === 'object') return data.posts[0];
  return data;
}

/**
 * حالُ المنشور من ردّ النشر أو من `GET /post/:id`.
 *
 * - `errors` غير فارغة أو `status: "error"` ← رُفض، وسببه من الأخطاء.
 * - وجهةٌ معرّفها `"pending"` (تيك توك يعالج المقطع) أو حالُ المنشور
 *   `pending` / `awaiting approval` ← ينتظر.
 * - `success` و`scheduled` ← قُبل. والمجدول لدى Ayrshare قبولٌ تامّ: هو من
 *   ينشره في موعده.
 * `null` = الردّ لا يُعلن حالاً يُقرأ.
 */
export function ayrshareOutcome(raw: any): PublishCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = unwrapAyrsharePost(raw);
  const status = String(data?.status || '').trim().toLowerCase();
  const targets: any[] = Array.isArray(data?.postIds) ? data.postIds : [];
  const errors = ayrshareErrors(data);

  const failedTarget = targets.some((t) => String(t?.status || '').toLowerCase() === 'error' || t?.id === 'failed');
  if (status === 'error' || status === 'deleted' || failedTarget || (Array.isArray(data?.errors) && data.errors.length)) {
    return { state: 'failed', error: errors || (status === 'deleted' ? 'حُذف المنشور' : undefined) };
  }
  if (status === 'pending' || status === 'awaiting approval' || targets.some((t) => t?.id === 'pending')) {
    return { state: 'pending' };
  }
  if (status === 'success' || status === 'scheduled') return { state: 'published' };
  return null;
}

/** امتداد الملف ونوعه كما يقبلهما `GET /media/uploadUrl`. */
function uploadType(m: PublishMedia): { fileName: string; contentType?: string } {
  const KNOWN: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
  };
  const OTHER: Record<string, string> = { 'image/gif': 'gif', 'image/webp': 'webp', 'video/webm': 'webm' };
  const mime = (m.mimeType || '').toLowerCase();
  const ext = KNOWN[mime] || OTHER[mime] || '';
  let fileName = (m.filename || 'media').replace(/[^\w.\-]+/g, '_');
  // اسمٌ بلا امتداد يُرفض حين لا يُرسل النوع — فيُلحق الامتداد من النوع
  if (ext && !/\.[a-z0-9]{2,5}$/i.test(fileName)) fileName = `${fileName}.${ext}`;
  return KNOWN[mime] ? { fileName, contentType: KNOWN[mime] } : { fileName };
}

/** ما يُصادَق به كل طلب: مفتاح الحساب، ومفتاحا تطبيق إكس إن ضُبطا. */
export type AyrshareAuth = { key: string; x?: AyrshareXKeys };

function ayrHeaders(auth: AyrshareAuth, json: boolean): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${auth.key}` };
  if (json) h['content-type'] = 'application/json';
  if (auth.x?.key && auth.x.secret) {
    h['X-Twitter-OAuth1-Api-Key'] = auth.x.key;
    h['X-Twitter-OAuth1-Api-Secret'] = auth.x.secret;
  }
  return h;
}

/** نداءٌ واحد للواجهة — يردّ الجسم، ويرمي `AyrshareError` بسببٍ يُقرأ. */
export async function ayrshareCall<T = any>(
  auth: AyrshareAuth,
  method: string,
  path: string,
  body?: unknown,
  budget?: CallBudget,
): Promise<T> {
  // نداءات المزامنة بحصّة الاستدعاء — انظر `services/limits.ts`
  budget?.spend();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: ayrHeaders(auth, body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // حدُّ طلبات الاستدعاء في كلاودفلير — يقف السحب ولا يُعدّ خطأ مزوّد
    if (budget && /too many subrequests/i.test(String((err as Error)?.message || err))) {
      budget.stop('platform_cap');
      throw new BudgetExhausted();
    }
    throw err;
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
  if (res.ok) return data as T;

  const codes = errorCodes(data);
  if (codes.includes(419)) {
    throw new AyrshareError(
      'إكس يشترط مفتاحَي تطبيق المطوّر لدى Ayrshare. اضبط AYRSHARE_X_API_KEY وAYRSHARE_X_API_SECRET ثم أعد النشر',
      res.status, data,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new AyrshareError(
      `رفض Ayrshare المفتاح (${res.status}). تحقّق من AYRSHARE_API_KEY في أسرار كلاودفلير: ${ayrshareErrors(data) || 'بلا تفصيل'}`,
      res.status, data,
    );
  }
  if (res.status === 429) {
    // المزوّد طلب التمهّل: يقف السحب هنا ويُستأنف في دورته التالية
    if (budget) {
      budget.stop('rate_limit');
      throw new BudgetExhausted();
    }
    throw new AyrshareError('تجاوزت المنصة حدّ طلبات Ayrshare (٣٠٠ طلب كل خمس دقائق). أعد المحاولة بعد دقائق', res.status, data);
  }
  throw new AyrshareError(ayrshareErrors(data) || `خطأ من Ayrshare (${res.status})`, res.status, data);
}

/* ═══ الحسابات المربوطة ═══

   `GET /user` يردّ `displayNames` بحسابٍ لكل منصة مربوطة في الملف الرئيسي.
   والاسم يختلف موضعه: يوتيوب `channelTitle` (و`displayName` فيه اسم صاحب
   حساب جوجل لا القناة)، ولينكدإن `type` يفرّق الصفحة من الحساب الشخصي. */

export type AyrshareAccount = {
  id: string;
  platform: string;
  name: string;
  messaging: boolean;
  /** معرّفات الحساب وأسماؤه بحروفٍ صغيرة — بها يُعرف ردٌّ كتبه حسابُنا. */
  ownerKeys: string[];
};

/** مفتاحٌ موحَّد للمقارنة: بحروفٍ صغيرة وبلا «@». */
export function ownerKey(v: unknown): string {
  return String(v ?? '').trim().replace(/^@/, '').toLowerCase();
}

/** مفتاح المنصة عندنا من حسابٍ في `displayNames`. */
export function ayrshareAccountPlatform(entry: any): string {
  const p = String(entry?.platform || '').toLowerCase();
  if (p === 'twitter') return 'x';
  if (p === 'gmb') return 'google';
  if (p === 'linkedin') return String(entry?.type || '').toLowerCase() === 'corporate' ? 'linkedin_page' : 'linkedin';
  return p;
}

export function mapAyrshareAccounts(user: any): AyrshareAccount[] {
  const list: any[] = Array.isArray(user?.displayNames) ? user.displayNames : [];
  return list
    .filter((e) => e && e.platform)
    .map((e) => ({
      id: String(e.id ?? e.channelId ?? e.platform),
      platform: ayrshareAccountPlatform(e),
      name: String(e.channelTitle || e.pageName || e.displayName || e.username || ''),
      messaging: e.messagingActive === true,
      ownerKeys: [e.id, e.userId, e.username, e.displayName, e.pageName, e.channelTitle, e.channelId, e.handle]
        .map(ownerKey)
        .filter(Boolean),
    }));
}

export async function ayrshareUser(
  auth: AyrshareAuth,
  budget?: CallBudget,
): Promise<{ accounts: AyrshareAccount[]; messagingEnabled: boolean }> {
  const user = await ayrshareCall<any>(auth, 'GET', '/user', undefined, budget);
  return { accounts: mapAyrshareAccounts(user), messagingEnabled: user?.messagingEnabled === true };
}

/**
 * الويب هوك المسجّلة — `GET /hook/webhook` يردّها كائناً: لكل حدثٍ رابطه
 * (`social`, `scheduled`, `comments`…) ووقت تحديثه بجانبه.
 */
export async function listAyrshareWebhooks(auth: AyrshareAuth): Promise<{ event: string; url: string }[]> {
  const data = await ayrshareCall<any>(auth, 'GET', '/hook/webhook');
  return Object.entries(data || {})
    .filter(([k, v]) => typeof v === 'string' && /^https:\/\//.test(v) && !k.endsWith('Updated'))
    .map(([event, url]) => ({ event, url: url as string }));
}

export class AyrshareProvider implements PublishingProvider {
  private key: string;

  // `labels` الأسماء المخصّصة من الإعدادات — لرسائل الخطأ وحدها
  constructor(apiKey: string, private x: AyrshareXKeys = {}, private labels: Record<string, string> = {}) {
    this.key = (apiKey || '').trim();
  }

  private call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    return ayrshareCall<T>({ key: this.key, x: this.x }, method, path, body);
  }

  /* ═══ رفعُ الوسيط ═══

     الوسيط خلف مصادقة المنصة، فلا يجلبه Ayrshare برابط. يُطلب رابطٌ موقَّع
     (`GET /media/uploadUrl`) ثم يُرفع إليه الملف تدفّقاً (PUT)، ويُنشر بالرابط
     العامّ `accessUrl`. والرابط الموقَّع يقبل حتى ٥ غيغابايت فيكفي الصورة
     والمقطع معاً، بخلاف `/media/upload` الذي يقف عند ٣٠ ميغابايت ويُحمَّل
     كاملاً في الذاكرة. والرابط يُستعمل مرّةً واحدة ويبقى ثلاثين دقيقة. */
  private async uploadMedia(m: PublishMedia): Promise<string> {
    if (m.url && /^https:\/\//.test(m.url)) return m.url;
    if (!m.data && !m.open) throw new Error(`تعذّر قراءة الوسيط «${m.filename}» للرفع`);
    const size = m.data ? m.data.byteLength : m.size ?? 0;
    const { fileName, contentType } = uploadType(m);

    const q = new URLSearchParams({ fileName });
    if (contentType) q.set('contentType', contentType);
    let info: any;
    try {
      info = await this.call('GET', `/media/uploadUrl?${q}`);
    } catch (err) {
      throw new Error(`تعذّر طلب رابط رفع الوسيط «${m.filename}»: ${String((err as Error)?.message || err)}`);
    }
    const uploadUrl = String(info?.uploadUrl || '');
    const accessUrl = String(info?.accessUrl || '');
    if (!/^https:\/\//.test(uploadUrl) || !/^https:\/\//.test(accessUrl)) {
      throw new Error(`لم يُعِد Ayrshare رابط رفعٍ لـ «${m.filename}»`);
    }

    const body = await fixedLengthBody(m, size);
    if (!body) throw new Error('وسيطٌ في المحتوى لم يعد موجوداً في المكتبة. احذفه من المحتوى أو أعد رفعه ثم أعد النشر');
    // الرابط موقَّعٌ بنفسه: لا مفتاح معه، ونوعُ المحتوى ما أعاده Ayrshare بعينه
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': String(info?.contentType || m.mimeType || 'application/octet-stream') },
      body,
      // جسمٌ تدفّقي — يطلبه fetch في Node، ويتجاهله عامل كلاودفلير
      ...({ duplex: 'half' } as object),
    });
    if (!put.ok) {
      const text = await put.text().catch(() => '');
      throw new Error(`فشل رفع الوسيط «${m.filename}» إلى Ayrshare (${put.status}): ${text.replace(/<[^>]+>/g, ' ').trim().slice(0, 140)}`);
    }
    return accessUrl;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const platforms = [...new Set(input.platforms.map(ayrsharePlatform))];
    if (platforms.includes('twitter') && !(this.x.key && this.x.secret)) {
      throw new Error(
        `النشر على ${platformNames(['x'], this.labels)} عبر Ayrshare يشترط مفتاحَي تطبيق المطوّر. اضبط AYRSHARE_X_API_KEY وAYRSHARE_X_API_SECRET ثم أعد النشر`,
      );
    }

    const body: Record<string, unknown> = { post: input.text || '', platforms };
    const media = input.media || [];
    if (media.length) {
      const urls: string[] = [];
      for (const m of media) urls.push(await this.uploadMedia(m));
      body.mediaUrls = urls;
      if (media.some((m) => m.mimeType.startsWith('video/'))) body.isVideo = true;
    }
    if (input.firstComment?.trim()) body.firstComment = { comment: input.firstComment.trim() };
    /* يوتيوب يشترط العنوان، ويرفع المقطع «خاصّاً» إن لم يُقل غيره. وتيك توك
       كذلك يُضبط عامّاً: منشورات حساب الشركة للجمهور، والتعليق الأول لا
       يُنشر على مقطعٍ غير عامّ. */
    if (platforms.includes('youtube')) {
      body.youTubeOptions = { title: youtubeTitle(input.title, input.text), visibility: 'public' };
    }
    if (platforms.includes('tiktok')) body.tikTokOptions = { visibility: 'public' };
    if (input.scheduleAt) body.scheduleDate = input.scheduleAt;

    /* الرفض يأتي ٤٠٠ ومعه `errors` بسبب كل منصة — فيُقرأ السبب منها لا من
       رمز الحالة. */
    let data: any;
    try {
      data = await this.call('POST', '/post', body);
    } catch (err) {
      // 419 سببُه مفهومٌ مسبقاً بنصٍّ يقول ما يُضبط — لا يُستبدل برسالة الواجهة
      const known = err instanceof AyrshareError && errorCodes(err.body).includes(419);
      const outcome = err instanceof AyrshareError && !known ? ayrshareOutcome(err.body) : null;
      if (outcome?.state === 'failed' && outcome.error) throw new Error(`فشل النشر عبر Ayrshare: ${outcome.error}`);
      throw err;
    }
    const post = unwrapAyrsharePost(data);
    const outcome = ayrshareOutcome(data);
    if (outcome?.state === 'failed') {
      throw new Error(`فشل النشر عبر Ayrshare: ${outcome.error || 'رفضت المنصة المنشور'}`);
    }
    const id = String(post?.id || '');
    // بلا معرّفٍ لا يُسأل عن حاله لاحقاً — فيُعدّ منشوراً كما كان
    const state = id && outcome ? outcome.state : 'published';
    return { providerPostId: id, status: String(post?.status || 'success'), state };
  }

  async getPublishStatus(providerPostId: string): Promise<PublishCheck | null> {
    try {
      return ayrshareOutcome(await this.call('GET', `/post/${encodeURIComponent(providerPostId)}`));
    } catch (err) {
      // ٢٢١ «History not found» — المنشور لا يُعرف لدى Ayrshare
      if (err instanceof AyrshareError && errorCodes(err.body).includes(221)) return null;
      throw err;
    }
  }

  async deletePost(providerPostId: string): Promise<void> {
    // إنستغرام وتيك توك لا يحذفان المنشور عبر الواجهة — والحذف غير حرِج
    try { await this.call('DELETE', '/post', { id: providerPostId }); } catch { /* لا يُعطّل */ }
  }

  /* ═══ الردّ والإشراف ═══

     بمعرّفات المنصة لا بمعرّفات Ayrshare: التعليق كُتب على المنصة لا عبره.
     وما لا تتيحه المنصة بمعرّفها يُقال بسببه قبل أيّ طلب. */

  private unsupported(what: string, platform: string): never {
    throw new Error(`${what} على ${platformNames([ayrshareAccountPlatform({ platform })], this.labels)} غير متاح عبر Ayrshare. افعله من تطبيق المنصة`);
  }

  async replyComment(_providerPostId: string, commentId: string, text: string): Promise<string> {
    const d = decodeAyrshareId(commentId);
    if (!d) throw new Error('عنصرٌ لا يُعرف مصدره في Ayrshare — حدّث الصندوق ثم أعد المحاولة');

    if (d.type === 'review') {
      const res = await this.call<any>('POST', '/reviews', { platform: d.platform, reviewId: d.reviewId, reply: text });
      return String(res?.[d.platform]?.id ?? '');
    }
    if (d.type === 'dm') {
      if (!d.participantId) throw new Error('لا يُعرف المُراسِل في هذه المحادثة — حدّث الصندوق ثم أعد المحاولة');
      const res = await this.call<any>('POST', `/messages/${d.platform}`, { recipientId: d.participantId, message: text });
      return String(res?.messageId ?? '');
    }
    if (!REPLY_BY_SOCIAL_ID.has(d.platform)) this.unsupported('الردّ على التعليقات', d.platform);
    const body: Record<string, unknown> = { platforms: [d.platform], comment: text, searchPlatformId: true };
    if (d.platform === 'linkedin') body.commentUrn = d.urn || d.commentId;
    if (d.platform === 'tiktok') body.videoId = d.postId;
    const res = await this.call<any>('POST', `/comments/reply/${encodeURIComponent(d.commentId)}`, body);
    // معرّف الردّ الجديد على المنصة — به يُعدَّل ويُحذف لاحقاً
    return String(res?.[d.platform]?.commentId ?? '');
  }

  /** حذف تعليقٍ بمعرّفه على المنصة — ردُّنا أو تعليق عميل. */
  private async deleteSocialComment(platform: string, socialCommentId: string): Promise<void> {
    if (!DELETE_BY_SOCIAL_ID.has(platform)) this.unsupported('حذف التعليق', platform);
    await this.call('DELETE', `/comments/${encodeURIComponent(socialCommentId)}`, { searchPlatformId: true, platform });
  }

  async editReply(commentId: string, replyProviderId: string | null, text: string): Promise<string> {
    const d = decodeAyrshareId(commentId);
    if (!d) throw new Error('عنصرٌ لا يُعرف مصدره في Ayrshare — حدّث الصندوق ثم أعد المحاولة');
    // ردُّ الملف التجاري يُستبدل بإرسال ردٍّ جديد على المراجعة نفسها
    if (d.type === 'review') {
      if (d.platform !== 'gmb') this.unsupported('تعديل الردّ على المراجعة', d.platform);
      return this.replyComment('', commentId, text);
    }
    if (d.type === 'dm') throw new Error('الرسالة الخاصة لا تُعدَّل بعد إرسالها. أرسل رسالةً جديدة');
    /* المنصات لا تتيح تعديل التعليق: يُكتب الجديد ثم يُحذف القديم — بهذا
       الترتيب، فلا يبقى التعليق بلا ردٍّ إن تعذّر الحذف. */
    if (replyProviderId && !DELETE_BY_SOCIAL_ID.has(d.platform)) this.unsupported('تعديل الردّ', d.platform);
    const fresh = await this.replyComment('', commentId, text);
    if (replyProviderId) await this.deleteSocialComment(d.platform, replyProviderId);
    return fresh;
  }

  async deleteReply(commentId: string, replyProviderId: string | null): Promise<void> {
    const d = decodeAyrshareId(commentId);
    if (!d) throw new Error('عنصرٌ لا يُعرف مصدره في Ayrshare — حدّث الصندوق ثم أعد المحاولة');
    if (d.type === 'review') {
      if (d.platform !== 'gmb') this.unsupported('حذف الردّ على المراجعة', d.platform);
      await this.call('DELETE', '/reviews', { platform: 'gmb', reviewId: d.reviewId });
      return;
    }
    if (d.type === 'dm') throw new Error('الرسالة الخاصة لا تُحذف عبر Ayrshare');
    if (!replyProviderId) throw new Error('لا يُعرف معرّف الردّ على المنصة — احذفه من تطبيق المنصة');
    await this.deleteSocialComment(d.platform, replyProviderId);
  }

  async moderateComment(commentId: string, action: ModerateAction): Promise<void> {
    const d = decodeAyrshareId(commentId);
    if (!d || d.type !== 'comment') throw new Error('الإشراف للتعليقات وحدها');
    if (action === 'delete') return this.deleteSocialComment(d.platform, d.commentId);
    // تيك توك وحده يُخفى عبر Ayrshare، ولا يُظهَر بعدها إلا من TikTok Studio
    if (action === 'hide' && d.platform === 'tiktok') {
      await this.call('DELETE', `/comments/${encodeURIComponent(d.commentId)}`, {
        searchPlatformId: true, platform: 'tiktok', hide: true, videoId: d.postId,
      });
      return;
    }
    this.unsupported(action === 'hide' ? 'إخفاء التعليق' : action === 'unhide' ? 'إظهار التعليق' : 'الإعجاب بالتعليق', d.platform);
  }

  /* ═══ أرقام منشورٍ واحد ═══
     تشترطها الواجهة، ولا يناديها السحب: Ayrshare يُسحب كلُّه في
     `pullAllAyrshare` بمعرّفات المنصات مئةً في الطلب. */

  async getAnalytics(providerPostId: string): Promise<AnalyticsResult> {
    const data = await this.call<any>('POST', '/analytics/post', { id: providerPostId });
    let reach = 0;
    let impressions = 0;
    let engagement = 0;
    for (const key of Object.keys(data || {})) {
      const m = data[key]?.analytics || data[key];
      if (!m || typeof m !== 'object') continue;
      reach += Number(m.reach || m.reachCount || 0);
      impressions += Number(m.impressions || m.impressionCount || 0);
      engagement += Number(m.engagement || m.likeCount || 0) + Number(m.commentCount || 0);
    }
    return { reach, impressions, engagement };
  }
}

/* ═══ الأرقام: من أسماء Ayrshare إلى أسمائنا ═══

   كل منصةٍ بأسمائها: إنستغرام `reachCount` و`savedCount`، وإكس تحت
   `publicMetrics`، ويوتيوب `estimatedMinutesWatched`. فيُخرَّط كلٌّ إلى
   الأنواع التي تقرؤها الحسابات في `services/metrics.ts` — `reach`
   و`impressions` و`views` و`likes` أو `reactions` و`comments` و`shares`
   و`saves` و`clicks`، والمدّة `totaltimewatched` بالدقائق، والإكمال
   `completionrate` نسبةً مئوية — ثم يمرّ على `mapMetrics` كغيره.

   والأسماء من صفحات التوثيق نفسها (Analytics on a Post، وGet post history for
   a social platform). وقاعدتان:
   - الغائب لا يُكتب: لا يُخترع صفرٌ لما لم تُعلنه المنصة.
   - الإعجاب لا يُعدّ مرّتين: فيسبوك يعلن `reactions.total` وفيها الإعجاب،
     فإن وُجدت أُخذت وحدها.

   وفيسبوك ترك `impressions*` في ١٥ يونيو ٢٠٢٦: الظهور `mediaView` والوصول
   `totalMediaViewUnique`. */

type Metric = { type: string; name: string; value: number; unit: 'count' | 'percentage' | 'minutes' };

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** أوّل قيمةٍ رقمية من مسارات — `a.b.c`. */
function at(o: any, ...paths: string[]): number | null {
  for (const p of paths) {
    const v = num(p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o));
    if (v !== null) return v;
  }
  return null;
}

/**
 * أرقام منشورٍ واحد بأسمائنا. `platform` باسم Ayrshare، و`o` كائن `analytics`
 * من `/analytics/post` أو المنشور نفسه من `/history/:platform` — الأسماء
 * واحدة فيهما.
 */
export function ayrshareMetrics(platform: string, o: any): Metric[] {
  const out: Metric[] = [];
  const put = (type: string, name: string, value: number | null, unit: Metric['unit'] = 'count') => {
    if (value !== null) out.push({ type, name, value, unit });
  };
  if (!o || typeof o !== 'object') return out;

  switch (platform) {
    case 'facebook': {
      put('impressions', 'mediaView', at(o, 'mediaView'));
      put('reach', 'totalMediaViewUnique', at(o, 'totalMediaViewUnique'));
      put('views', 'videoViews', at(o, 'videoViews', 'totalVideoViews'));
      const reactions = at(o, 'reactions.total');
      if (reactions !== null) put('reactions', 'reactions.total', reactions);
      else put('likes', 'likeCount', at(o, 'likeCount'));
      put('comments', 'commentsCount', at(o, 'commentsCount'));
      put('shares', 'sharesCount', at(o, 'sharesCount'));
      const ms = at(o, 'totalVideoViewTotalTime');
      put('totaltimewatched', 'totalVideoViewTotalTime', ms === null ? null : ms / 60_000, 'minutes');
      break;
    }
    case 'instagram':
      put('reach', 'reachCount', at(o, 'reachCount'));
      put('views', 'viewsCount', at(o, 'viewsCount', 'playsCount'));
      put('likes', 'likeCount', at(o, 'likeCount'));
      put('comments', 'commentsCount', at(o, 'commentsCount'));
      put('shares', 'sharesCount', at(o, 'sharesCount'));
      put('saves', 'savedCount', at(o, 'savedCount'));
      break;
    case 'linkedin': {
      put('impressions', 'impressionCount', at(o, 'impressionCount'));
      put('reach', 'uniqueImpressionsCount', at(o, 'uniqueImpressionsCount'));
      put('views', 'videoViews', at(o, 'videoViews'));
      put('likes', 'likeCount', at(o, 'likeCount'));
      put('comments', 'commentCount', at(o, 'commentCount'));
      put('shares', 'shareCount', at(o, 'shareCount'));
      put('clicks', 'clickCount', at(o, 'clickCount'));
      const ms = at(o, 'videoWatchTimeMs');
      put('totaltimewatched', 'videoWatchTimeMs', ms === null ? null : ms / 60_000, 'minutes');
      break;
    }
    case 'tiktok': {
      put('reach', 'reach', at(o, 'reach'));
      put('views', 'videoViews', at(o, 'videoViews'));
      put('likes', 'likeCount', at(o, 'likeCount'));
      put('comments', 'commentsCount', at(o, 'commentsCount'));
      put('shares', 'shareCount', at(o, 'shareCount'));
      const sec = at(o, 'totalTimeWatched');
      put('totaltimewatched', 'totalTimeWatched', sec === null ? null : sec / 60, 'minutes');
      const rate = at(o, 'fullVideoWatchedRate');
      put('completionrate', 'fullVideoWatchedRate', rate === null ? null : Math.round(rate * 10_000) / 100, 'percentage');
      break;
    }
    case 'twitter':
      put('impressions', 'impressionCount', at(o, 'publicMetrics.impressionCount', 'nonPublicMetrics.impressionCount', 'organicMetrics.impressionCount'));
      put('views', 'video.viewCount', at(o, 'organicMetrics.video.viewCount'));
      put('likes', 'likeCount', at(o, 'publicMetrics.likeCount', 'organicMetrics.likeCount'));
      put('comments', 'replyCount', at(o, 'publicMetrics.replyCount', 'organicMetrics.replyCount'));
      put('retweets', 'retweetCount', at(o, 'publicMetrics.retweetCount', 'organicMetrics.retweetCount'));
      put('quotes', 'quoteCount', at(o, 'publicMetrics.quoteCount'));
      put('bookmarks', 'bookmarkCount', at(o, 'publicMetrics.bookmarkCount'));
      break;
    case 'youtube':
      put('views', 'views', at(o, 'views'));
      put('likes', 'likes', at(o, 'likes'));
      put('comments', 'comments', at(o, 'comments'));
      put('shares', 'shares', at(o, 'shares'));
      put('totaltimewatched', 'estimatedMinutesWatched', at(o, 'estimatedMinutesWatched'), 'minutes');
      put('completionrate', 'averageViewPercentage', at(o, 'averageViewPercentage'), 'percentage');
      break;
    case 'threads':
      put('views', 'views', at(o, 'views'));
      put('likes', 'likes', at(o, 'likes', 'likeCount'));
      put('comments', 'replies', at(o, 'replies', 'replyCount'));
      put('reposts', 'reposts', at(o, 'reposts', 'repostCount'));
      put('quotes', 'quotes', at(o, 'quotes', 'quoteCount'));
      put('shares', 'shares', at(o, 'shares'));
      break;
    case 'snapchat': {
      // مصفوفةٌ بعنصرٍ لكل وسيط — تُجمع
      const items: any[] = Array.isArray(o) ? o : [o];
      const sum = (...paths: string[]) => {
        let total: number | null = null;
        for (const it of items) {
          const v = at(it, ...paths);
          if (v !== null) total = (total ?? 0) + v;
        }
        return total;
      };
      put('views', 'views', sum('views'));
      put('reach', 'viewers', sum('viewers'));
      put('comments', 'replies', sum('replies'));
      put('shares', 'shares', sum('shares'));
      const ms = sum('viewTime');
      put('totaltimewatched', 'viewTime', ms === null ? null : ms / 60_000, 'minutes');
      break;
    }
    default:
      break;
  }
  return out;
}

/** الأرقام بالشكل الذي تكتبه اللقطة — الوصول والظهور والتفاعل وخامُها. */
export function ayrshareMapped(platform: string, o: any): ReturnType<typeof mapMetrics> {
  return mapMetrics(ayrshareMetrics(platform, o));
}

/* ═══ السجلّ ═══ */

/** منشورٌ من سجلّ المنصة — بشكل `AccountPost` الذي تكتبه `ingestAccountPosts`. */
export type AyrshareHistoryPost = {
  id: string;
  platform: string;
  accountId: string;
  title: string;
  sentAt: string | null;
  externalUrl: string | null;
  metrics: ReturnType<typeof mapMetrics>;
};

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** المنصات التي لها `GET /history/:platform` — ومنها ما نُشر خارج Ayrshare. */
export const AYRSHARE_HISTORY_PLATFORMS = new Set([
  'bluesky', 'facebook', 'instagram', 'linkedin', 'pinterest', 'snapchat', 'threads', 'tiktok', 'twitter', 'youtube',
]);

/** المنصات التي تُطلب أرقامها بمعرّف المنصة (`searchPlatformId`). */
export const AYRSHARE_SOCIAL_ID_PLATFORMS = new Set(['facebook', 'instagram', 'linkedin', 'threads', 'tiktok', 'twitter', 'youtube']);

export type PlatformHistoryPage = {
  posts: AyrshareHistoryPost[];
  /** مؤشّر الصفحة التالية — `null` حين لا مزيد. */
  next: string | null;
  /** «partial»: بعض المنشورات لم تُقرأ — لا يُعدّ السجلّ مكتملاً بها. */
  partial: boolean;
};

/**
 * صفحةٌ من سجلّ منصة. `platform` باسم Ayrshare، و`internal` مفتاحها عندنا.
 * والمؤشّر `meta.pagination.next` لا يُعلنه التوثيق إلا لإكس وثريدز، فيُقرأ
 * حيث وُجد: منصةٌ بلا مؤشّر تُقرأ بصفحةٍ واحدة حدُّها ٥٠٠.
 */
export async function ayrsharePlatformHistory(
  auth: AyrshareAuth,
  platform: string,
  internal: string,
  opts: { limit: number; next?: string | null; budget?: CallBudget },
): Promise<PlatformHistoryPage> {
  const q = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.next) q.set('next', opts.next);
  // فيسبوك: ما نشرته الصفحة لا كلّ ما في خلاصتها من منشورات غيرها
  if (platform === 'facebook') q.set('pagePublished', 'true');
  const data = await ayrshareCall<any>(auth, 'GET', `/history/${platform}?${q}`, undefined, opts.budget);
  const list: any[] = Array.isArray(data?.posts) ? data.posts : [];
  const posts: AyrshareHistoryPost[] = [];
  for (const p of list) {
    const id = String(p?.id ?? '');
    // منشورٌ يحمل خطأه (code 187) بلا معرّف لا يُكتب
    if (!id || p?.status === 'error') continue;
    posts.push({
      id,
      platform: internal,
      accountId: '',
      title: String(p?.post ?? p?.title ?? '').slice(0, 140),
      sentAt: isoOrNull(p?.created ?? p?.publishedAt),
      externalUrl: typeof p?.postUrl === 'string' ? p.postUrl : null,
      metrics: ayrshareMapped(platform, p),
    });
  }
  const pg = data?.meta?.pagination;
  const next = pg?.hasMore && pg?.next ? String(pg.next) : null;
  return { posts, next, partial: String(data?.status || '') === 'partial' };
}

/** منشورٌ نُشر عبر Ayrshare ووجهاته — من `GET /history`. */
export type AyrshareSentPost = {
  ayrId: string;
  created: string | null;
  text: string;
  targets: { platform: string; id: string; postUrl: string | null }[];
};

/**
 * ما نُشر عبر Ayrshare — ومنه يُعرف معرّف كل وجهةٍ على منصتها، فيُربط
 * المنشور على المنصة بجدول النشر عندنا (الجدول يحفظ معرّف Ayrshare).
 * `lastDays: 0` = كلّه. ولا شيء فيه = رمز 221، لا خطأ.
 */
export async function ayrshareSentPosts(
  auth: AyrshareAuth,
  opts: { lastDays: number; limit: number; budget?: CallBudget },
): Promise<AyrshareSentPost[]> {
  const q = new URLSearchParams({ lastDays: String(opts.lastDays), limit: String(opts.limit) });
  let data: any;
  try {
    data = await ayrshareCall<any>(auth, 'GET', `/history?${q}`, undefined, opts.budget);
  } catch (err) {
    if (err instanceof AyrshareError && errorCodes(err.body).includes(221)) return [];
    throw err;
  }
  const list: any[] = Array.isArray(data?.history) ? data.history : [];
  return list
    .filter((h) => h?.id)
    .map((h) => ({
      ayrId: String(h.id),
      created: isoOrNull(h.created),
      text: String(h.post || ''),
      targets: (Array.isArray(h.postIds) ? h.postIds : [])
        .filter((t: any) => t?.id && t.id !== 'pending' && t.id !== 'failed' && String(t.status || 'success') !== 'error')
        .map((t: any) => ({ platform: String(t.platform || ''), id: String(t.id), postUrl: typeof t.postUrl === 'string' ? t.postUrl : null })),
    }));
}

/**
 * الأرقام الحيّة لمنشوراتٍ بمعرّفاتها على منصتها — مئةٌ في الطلب الواحد.
 * ويعمل لما نُشر من خارج Ayrshare أيضاً (يشترط خطة Launch فما فوق).
 * يردّ خريطةً: معرّف المنشور ← أرقامه. والغائب عنها لم تُعلَن أرقامه.
 */
export async function ayrshareAnalyticsBySocialId(
  auth: AyrshareAuth,
  platform: string,
  ids: string[],
  budget?: CallBudget,
): Promise<Map<string, ReturnType<typeof mapMetrics>>> {
  const out = new Map<string, ReturnType<typeof mapMetrics>>();
  if (!ids.length) return out;
  const data = await ayrshareCall<any>(
    auth, 'POST', '/analytics/post', { postIds: ids.slice(0, 100), platforms: [platform], searchPlatformId: true }, budget,
  );
  const block = data?.[platform];
  const list: any[] = Array.isArray(block) ? block : block && typeof block === 'object' ? [block] : [];
  for (const item of list) {
    const id = String(item?.id ?? '');
    if (!id || !item?.analytics) continue;
    out.set(id, ayrshareMapped(platform, item.analytics));
  }
  return out;
}

/* ═══ أرقام الحساب: المتابعون والمراجعات ═══ */

/** عدد المتابعين لكل منصةٍ مربوطة — من `POST /analytics/social`. */
export async function ayrshareAudience(
  auth: AyrshareAuth,
  accounts: AyrshareAccount[],
): Promise<{ platform: string; followers: number | null }[]> {
  // الملف التجاري لا متابعين له، ومراجعاته من `/reviews`
  const wanted = accounts.filter((a) => a.platform !== 'google');
  if (!wanted.length) return [];
  const platforms = [...new Set(wanted.map((a) => ayrsharePlatform(a.platform)))];
  const data = await ayrshareCall<any>(auth, 'POST', '/analytics/social', { platforms });
  return wanted.map((a) => {
    const p = ayrsharePlatform(a.platform);
    const an = data?.[p]?.analytics;
    const o = Array.isArray(an) ? an[0] : an;
    // تيك توك `followerCount` مفرداً، ويوتيوب `subscriberCount` نصّاً، وصفحة لينكدإن تحت `followers`
    const followers = at(o, 'followersCount', 'followerCount', 'followers.totalFollowerCount', 'subscriberCount', 'subscribers');
    return { platform: a.platform, followers };
  });
}

/** عدد مراجعات الملف التجاري ومتوسّطها — من `GET /reviews?platform=gmb`. `null` = لا مراجعات. */
export async function ayrshareReviewSummary(auth: AyrshareAuth): Promise<{ count: number; average: number | null } | null> {
  let data: any;
  try {
    data = await ayrshareCall<any>(auth, 'GET', '/reviews?platform=gmb');
  } catch (err) {
    // 350 «Reviews not found»
    if (err instanceof AyrshareError && errorCodes(err.body).includes(350)) return null;
    throw err;
  }
  const count = num(data?.totalReviewCount);
  if (!count) return null;
  return { count, average: num(data?.averageRating) };
}

/* ═══ الصندوق: التعليقات والرسائل والمراجعات ═══

   المعرّف المحفوظ لكل عنصر يحمل ما يلزم للردّ عليه لاحقاً، مفصولاً بـ «|»
   (لا يرد في معرّفات المنصات، ومعرّفات لينكدإن فيها «:» و«,»):
   - تعليق: `ayc|منصة|منشور|تعليق|urn` — لينكدإن يشترط `commentUrn` للردّ،
     وتيك توك يشترط معرّف المقطع وهو المنشور نفسه.
   - رسالة: `ayd|منصة|محادثة|مُراسِل` — الردّ يُرسل إلى المُراسِل.
   - مراجعة: `ayr|منصة|مراجعة`.

   وما تتيحه كل منصة بمعرّف المنصة (لا بمعرّف Ayrshare) من صفحات التوثيق:
   الردّ لفيسبوك وإنستغرام ولينكدإن وتيك توك وإكس، والحذف لما سوى لينكدإن،
   والإخفاء لتيك توك وحده. */

export const AYRSHARE_COMMENT_PLATFORMS = new Set(['facebook', 'instagram', 'linkedin', 'tiktok', 'twitter', 'youtube', 'threads']);
const REPLY_BY_SOCIAL_ID = new Set(['facebook', 'instagram', 'linkedin', 'tiktok', 'twitter']);
const DELETE_BY_SOCIAL_ID = new Set(['facebook', 'instagram', 'tiktok', 'twitter', 'youtube', 'threads']);
export const AYRSHARE_DM_PLATFORMS = new Set(['facebook', 'instagram', 'twitter']);
export const AYRSHARE_REVIEW_PLATFORMS = new Set(['gmb', 'facebook']);

type Decoded =
  | { type: 'comment'; platform: string; postId: string; commentId: string; urn: string }
  | { type: 'dm'; platform: string; conversationId: string; participantId: string }
  | { type: 'review'; platform: string; reviewId: string };

export function encodeAyrshareComment(platform: string, postId: string, commentId: string, urn = ''): string {
  return ['ayc', platform, postId, commentId, urn].join('|');
}

export function decodeAyrshareId(id: string): Decoded | null {
  const [tag, platform, a = '', b = '', c = ''] = String(id || '').split('|');
  if (tag === 'ayc' && platform && b) return { type: 'comment', platform, postId: a, commentId: b, urn: c };
  if (tag === 'ayd' && platform && a) return { type: 'dm', platform, conversationId: a, participantId: b };
  if (tag === 'ayr' && platform && a) return { type: 'review', platform, reviewId: a };
  return null;
}

/** عنصرٌ في الصندوق — بشكل `InboxItem` الذي تكتبه `writeItems`. */
export type AyrshareInboxItem = {
  id: string;
  platform: string;
  kind: 'comment' | 'dm' | 'review';
  authorName: string;
  body: string;
  createdAt: string;
  capabilities?: Record<string, boolean>;
  isHidden?: boolean;
  repliedBody?: string | null;
  repliedAt?: string | null;
  rating?: number | null;
};

function isoOr(v: unknown, fallback: string): string {
  return isoOrNull(v) ?? fallback;
}

/**
 * أكتبه حسابُنا؟ لا علامة واحدة عبر المنصات: ثريدز `isReplyOwnedByMe`،
 * وتيك توك `owner` (كاتبه صاحب المقطع)، وفيسبوك `company` (الصفحة نفسها).
 * وما سواها بمطابقة الكاتب على معرّفات الحساب وأسمائه.
 */
export function isOwnAyrshareComment(c: any, ownerKeys: string[]): boolean {
  if (c?.isReplyOwnedByMe === true || c?.owner === true || c?.company === true) return true;
  const keys = new Set(ownerKeys);
  const authors = [c?.from?.id, c?.from?.username, c?.from?.name, c?.user?.id, c?.userId, c?.userName, c?.username]
    .map(ownerKey)
    .filter(Boolean);
  return authors.some((a) => keys.has(a));
}

function authorOf(c: any): string {
  return String(c?.from?.name || c?.from?.username || c?.displayName || c?.name || c?.userName || c?.username || 'مستخدم');
}

/**
 * تعليقات منشورٍ من ردّ `GET /comments/:id` — ما كتبه عملاؤنا وحده، ومعه
 * ردُّنا إن وُجد (كُتب من تطبيق المنصة أو من هنا). وإكس لا يُعشّش الردود:
 * ردودُه مسطّحة، وردُّنا يُعرف بأنه من حسابنا ويُشير إلى التعليق.
 */
export function mapAyrshareComments(platform: string, postId: string, data: any, ownerKeys: string[]): AyrshareInboxItem[] {
  const list: any[] = Array.isArray(data?.[platform]) ? data[platform] : [];
  const now = new Date().toISOString();

  // إكس: ردودنا مسطّحة — تُفهرس بالتعليق الذي تردّ عليه
  const ownByParent = new Map<string, any>();
  for (const c of list) {
    if (!isOwnAyrshareComment(c, ownerKeys)) continue;
    const parents = [
      ...(Array.isArray(c?.referencedTweets) ? c.referencedTweets.filter((r: any) => r?.type === 'replied_to').map((r: any) => r.id) : []),
      c?.parentId,
    ].filter(Boolean).map(String);
    for (const p of parents) ownByParent.set(p, c);
  }

  const out: AyrshareInboxItem[] = [];
  for (const c of list) {
    const commentId = String(c?.commentId ?? c?.id ?? '');
    const body = String(c?.comment ?? c?.text ?? '').trim();
    if (!commentId || !body || isOwnAyrshareComment(c, ownerKeys)) continue;

    const replies: any[] = Array.isArray(c?.replies) ? c.replies : [];
    const own = replies.filter((r) => isOwnAyrshareComment(r, ownerKeys))
      .sort((a, b) => String(a?.created ?? a?.createTime ?? '').localeCompare(String(b?.created ?? b?.createTime ?? '')))
      .pop() ?? ownByParent.get(commentId);

    out.push({
      id: encodeAyrshareComment(platform, postId, commentId, typeof c?.commentUrn === 'string' ? c.commentUrn : ''),
      platform,
      kind: 'comment',
      authorName: authorOf(c),
      body,
      createdAt: isoOr(c?.created ?? c?.createTime, now),
      isHidden: c?.hidden === true,
      capabilities: {
        can_like: false,
        can_hide: platform === 'tiktok',
        can_delete: platform === 'facebook' || platform === 'instagram' || platform === 'youtube',
        can_private_reply: false,
      },
      repliedBody: own ? String(own.comment ?? own.text ?? '').trim() || null : null,
      repliedAt: own ? isoOrNull(own.created ?? own.createTime) : null,
    });
  }
  return out;
}

/** تعليقات منشورٍ بمعرّفه على منصته. */
export async function ayrshareComments(
  auth: AyrshareAuth,
  platform: string,
  postId: string,
  budget?: CallBudget,
): Promise<any> {
  const q = new URLSearchParams({ searchPlatformId: 'true', platform });
  return ayrshareCall<any>(auth, 'GET', `/comments/${encodeURIComponent(postId)}?${q}`, undefined, budget);
}

/** رسالةٌ خاصة كما يردّها `GET /messages/:platform` — `action` اتجاهها. */
export type AyrshareMessage = {
  conversationId: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  text: string;
  created: string | null;
  direction: 'in' | 'out';
};

/** رسائل منصةٍ — الأحدث أوّلاً، صفحاتٍ بمؤشّر `next`. */
export async function ayrshareMessages(
  auth: AyrshareAuth,
  platform: string,
  opts: { pages: number; budget?: CallBudget },
): Promise<AyrshareMessage[]> {
  const out: AyrshareMessage[] = [];
  let next: string | null = null;
  for (let page = 0; page < opts.pages; page++) {
    const q = new URLSearchParams();
    if (next) q.set('next', next);
    const qs = q.toString();
    const data: any = await ayrshareCall<any>(auth, 'GET', `/messages/${platform}${qs ? `?${qs}` : ''}`, undefined, opts.budget);
    for (const m of Array.isArray(data?.messages) ? data.messages : []) {
      if (!m?.conversationId) continue;
      const attachment = Array.isArray(m.attachments) && m.attachments.length ? `[${m.attachments[0]?.type || 'مرفق'}]` : '';
      out.push({
        conversationId: String(m.conversationId),
        senderId: String(m.senderId ?? ''),
        recipientId: String(m.recipientId ?? ''),
        senderName: String(m.senderDetails?.name || m.senderDetails?.username || ''),
        text: String(m.message ?? '').trim() || attachment,
        created: isoOrNull(m.created),
        direction: m.action === 'sent' ? 'out' : 'in',
      });
    }
    const pg = data?.meta?.pagination;
    next = pg?.hasMore && pg?.next ? String(pg.next) : null;
    if (!next) break;
  }
  return out;
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/**
 * المراجعات من `GET /reviews?platform=` — النصّ في `review`، والتقييم في
 * الملف التجاري «ONE»…«FIVE». وتوصيات فيسبوك «positive»/«negative» لا نجوم
 * فيها، فلا يُخترع لها رقم.
 */
export async function ayrshareReviews(auth: AyrshareAuth, platform: string, budget?: CallBudget): Promise<AyrshareInboxItem[]> {
  let data: any;
  try {
    data = await ayrshareCall<any>(auth, 'GET', `/reviews?platform=${platform}`, undefined, budget);
  } catch (err) {
    if (err instanceof AyrshareError && errorCodes(err.body).includes(350)) return [];
    throw err;
  }
  const list: any[] = Array.isArray(data?.[platform]) ? data[platform] : [];
  const now = new Date().toISOString();
  return list
    .filter((r) => r?.id)
    .map((r) => {
      const reply = r?.reviewReply && typeof r.reviewReply === 'object' ? r.reviewReply : {};
      return {
        id: `ayr|${platform}|${r.id}`,
        platform,
        kind: 'review' as const,
        authorName: String(r?.reviewer?.name || 'مستخدم'),
        body: String(r?.review ?? '').trim(),
        createdAt: isoOr(r?.created, now),
        rating: STARS[String(r?.rating || '').toUpperCase()] ?? null,
        repliedBody: typeof reply.reply === 'string' && reply.reply.trim() ? reply.reply.trim() : null,
        repliedAt: isoOrNull(reply.updated),
      };
    });
}

/* ═══ الويب هوك ═══

   التسجيل حدثاً حدثاً (`POST /hook/webhook` بـ `action` و`url` و`secret`)، وسرُّ
   التوقيع واحدٌ للملف كلّه يوقّع كل الأحداث. والتوقيع HMAC-SHA256 للجسم الخام
   بصيغة hex في `X-Authorization-Content-SHA256`، ومعه `-V2` يسرد `v1=<توقيع>`
   لكل سرٍّ صالح — سرّان خلال يومٍ بعد التدوير.

   وكان السرّ يُضبط أوّلاً بـ `POST /hook/webhook/secret` من صفحة «Rotate Signing
   Secret»، فردّ الحساب «This endpoint does not exist» وتوقّف التسجيل كلّه. والسرّ
   حقلٌ في طلب التسجيل نفسه كما في صفحة «Register Webhook» — فيُرسل معه. */

/** الأحداث التي تُسجَّل: التعليقات والرسائل للصندوق، والمجدول لحال تيك توك. */
export const AYRSHARE_WEBHOOK_ACTIONS = ['comments', 'messages', 'scheduled'] as const;

export async function registerAyrshareWebhook(auth: AyrshareAuth, action: string, url: string, secret: string): Promise<void> {
  await ayrshareCall(auth, 'POST', '/hook/webhook', { action, url, secret });
}

export async function deleteAyrshareWebhook(auth: AyrshareAuth, action: string): Promise<void> {
  await ayrshareCall(auth, 'DELETE', '/hook/webhook', { action });
}

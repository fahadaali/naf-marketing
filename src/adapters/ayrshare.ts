import {
  PublishUncertain, keepDescription,
  type PublishingProvider, type PublishInput, type PublishResult, type PublishCheck, type PublishMedia,
  type AnalyticsResult, type ModerateAction, type PublishStatusContext,
} from './provider';
import { BudgetExhausted, CallBudget } from './budget';
import { mapMetrics } from './metrics';
import { constraintIssues, fixedLengthBody, youtubeTitle } from './media';
import { platformNames } from '../platformLabels';
import { facebookReel, isDocument, youtubeShort } from '../services/mediaSpecs';
import { sortThread, threadAnswer, type ThreadEntry } from '../services/inboxThread';

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
  const nested = data?.history && !Array.isArray(data.history) && typeof data.history === 'object' ? data.history : null;
  return String(data?.message || nested?.message || '').trim();
}

/** رموز الأخطاء في الردّ — بها يُفرَّق بين الأسباب، لا بنصّ الرسالة. */
export function errorCodes(data: any): number[] {
  // السجلّ الفارغ يأتي بخطئه داخل `history`: {history: {code: 221, …}}
  const nested = data?.history && !Array.isArray(data.history) && typeof data.history === 'object' ? data.history : null;
  const codes = [data?.code, nested?.code, ...(Array.isArray(data?.errors) ? data.errors.map((e: any) => e?.code) : [])];
  return codes.map(Number).filter((n) => Number.isFinite(n));
}

/**
 * رفضٌ يخصّ ما طُلب بعينه — منشورٌ حُذف أو لا أرقام له — لا الحسابَ كلَّه.
 * فهو ٤xx سوى المفتاح (٤٠١ و٤٠٣)، ورصيد إكس (٤٠٢ برمز 416)، وتمهّل المنصة
 * (٤٢٩)، ومفتاحَي إكس (419)، وإعادة ربط لينكدإن (475). وما يخصّ الحساب لا
 * يُختم مقروءاً: يُعاد حين يزول سببه.
 */
export function postSpecificRejection(err: AyrshareError): boolean {
  if (err.status < 400 || err.status >= 500 || [401, 402, 403, 429].includes(err.status)) return false;
  return !errorCodes(err.body).some((c) => c === 416 || c === 419 || c === 475);
}

/** رمزا تمهّل المنصة نفسها لا Ayrshare — انظر `ayrshareCall`. */
const PLATFORM_THROTTLE = new Set([364, 444]);

/**
 * المنصة التي طلبت التمهّل باسمها لدى Ayrshare — أو فارغ. فيسبوك يحمل رمزه
 * داخل كتلته (`facebook.code: 444`)، وإكس في أعلى الردّ مع `platform`.
 */
export function platformThrottle(data: any): string {
  if (!data || typeof data !== 'object') return '';
  if (errorCodes(data).some((c) => PLATFORM_THROTTLE.has(c))) return String(data.platform || 'twitter');
  for (const [key, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && PLATFORM_THROTTLE.has(Number((v as any).code))) return key;
  }
  return '';
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
/** وجهةٌ وصلت منصتها: لها رابط، أو معرّفٌ حقيقي لا «pending» ولا «failed». */
function liveTarget(t: any): boolean {
  const status = String(t?.status || 'success').toLowerCase();
  if (status === 'error') return false;
  if (typeof t?.postUrl === 'string' && /^https?:\/\//.test(t.postUrl)) return true;
  const id = String(t?.id ?? '').trim();
  return !!id && id !== 'pending' && id !== 'failed';
}

/* «One or more of the social networks timed out with your request. Please re-try
   the post. You may use the /retry endpoint» — رآه الفريق على تيك توك. مهلةٌ
   انتهت قبل أن تردّ المنصة، لا رفضٌ للمحتوى. */
const TIMED_OUT = /timed out|re-?try the post|\/retry/i;

export function ayrshareOutcome(raw: any): PublishCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = unwrapAyrsharePost(raw);
  const status = String(data?.status || '').trim().toLowerCase();
  const targets: any[] = Array.isArray(data?.postIds) ? data.postIds : [];
  const errors = ayrshareErrors(data);

  const failedTarget = targets.some((t) => String(t?.status || '').toLowerCase() === 'error' || t?.id === 'failed');
  if (status === 'error' || status === 'deleted' || failedTarget || (Array.isArray(data?.errors) && data.errors.length)) {
    const retryable = status !== 'deleted' && (retryableFailure(raw) || TIMED_OUT.test(errors));
    return {
      state: 'failed',
      error: errors || (status === 'deleted' ? 'حُذف المنشور' : undefined),
      ...(retryable ? { retryable: true } : {}),
    };
  }
  /* وجهاتٌ حيّةٌ كلها ← نُشر، ولو بقي أعلى الردّ «pending». وكان يُقرأ قبلها
     فيبقى موعد لينكدإن «قيد النشر» ساعةً ثم «فاشلاً» وهو على الصفحة. */
  if (targets.length && targets.every(liveTarget)) return { state: 'published' };
  if (status === 'pending' || status === 'awaiting approval' || targets.some((t) => t?.id === 'pending')) {
    return { state: 'pending' };
  }
  if (status === 'success' || status === 'scheduled') return { state: 'published' };
  return null;
}

/* ═══ طول النص كما تعدّه المنصات ═══

   `POST /post/checkPostWeight` يردّ الطول الموزون لكل منصة وحدّها وصحّته
   («Check Post Length» في توثيقه): إكس يعدّ الرابط ٢٣ حرفاً والرمز التعبيري
   حرفين، فالعدّ بالحروف وحده يخطئ. والحقول بأسماء Ayrshare وبحالة أحرفها كما
   في المثال الموثّق — وما لم يرد فيه (ثريدز وسناب)، أو ورد طولُه بلا حكمٍ
   بصحّته (بلوسكاي)، لا يُقرأ له طول ولا يُحكم عليه بحدٍّ من عندنا. */
const WEIGHT_FIELD: Record<string, string> = {
  twitter: 'twitter', linkedin: 'linkedIn', facebook: 'facebook', instagram: 'instagram', tiktok: 'tikTok',
  youtube: 'youtube', gmb: 'gmb', pinterest: 'pinterest', bluesky: 'bluesky',
};

export type PostWeight = { length: number; max: number; valid: boolean };

/** طول النص وحدّه لكل منصةٍ لدى Ayrshare — باسمها عنده (`twitter`، `gmb`…). */
/* حسابُ إكس المشترك في Premium ينشر حتى ٢٥ ألف حرف، وAyrshare يقبل منه المنشور
   الطويل تلقائياً. وكان العدّاد والفحص عند الجدولة يقيسان بحدّ ٢٨٠ وحده، فيُنذَر
   كاتبُ حسابٍ مشترك بأن نصّه «أطول من حدّ إكس» وهو ليس كذلك. فإن كان الحساب
   مشتركاً قيس بالحدّ الطويل (`twitterLong`) وحكمه (`twitterLongValid`). */
export function mapPostWeight(data: any, opts: { xPremium?: boolean } = {}): Record<string, PostWeight> {
  const out: Record<string, PostWeight> = {};
  for (const [ayr, field] of Object.entries(WEIGHT_FIELD)) {
    const long = ayr === 'twitter' && opts.xPremium
      && Number.isFinite(Number(data?.maxCharLimits?.twitterLong)) && typeof data?.twitterLongValid === 'boolean';
    const length = Number(data?.[`${field}WeightedLength`]);
    const max = Number(data?.maxCharLimits?.[long ? 'twitterLong' : ayr]);
    const valid = data?.[long ? 'twitterLongValid' : `${field}Valid`];
    if (!Number.isFinite(length) || !Number.isFinite(max) || typeof valid !== 'boolean') continue;
    out[ayr] = { length, max, valid };
  }
  return out;
}

export async function ayrsharePostWeight(
  auth: AyrshareAuth, text: string, opts: { xPremium?: boolean } = {},
): Promise<Record<string, PostWeight>> {
  return mapPostWeight(await ayrshareCall<any>(auth, 'POST', '/post/checkPostWeight', { post: text }), opts);
}

/* ═══ وصفُ الوسائط لكل منصة: النص البديل ووسم الذكاء الاصطناعي ═══

   من صفحات المنصات في توثيقه:
   - النص البديل `altText` مصفوفةٌ تقابل الوسائط بترتيبها. لينكدإن وإنستغرام
     للصور وحدها (لا للمقطع ولا للريلز)، وإكس كذلك — ومقطعٌ معه نصٌّ بديل لا
     يُنشر أصلاً — وفيسبوك للصورة والمقطع. ويُرسل للوسائط بترتيبها حتى أوّل
     وسيطٍ بلا وصف: مدخلٌ فارغ في المصفوفة لا يُعرف كيف تقرؤه كل منصة.
   - الوسم `isAIGenerated` لإكس وإنستغرام وتيك توك (للمقطع وحده)، و
     `containsSyntheticMedia` ليوتيوب. ولينكدإن وفيسبوك لا يعلنانه. */
const OPTIONS_KEY: Record<string, string> = {
  twitter: 'twitterOptions', instagram: 'instagramOptions', facebook: 'faceBookOptions',
  linkedin: 'linkedInOptions', tiktok: 'tikTokOptions', youtube: 'youTubeOptions', gmb: 'gmbOptions',
};
const ALT_MAX = 1000;

export function describeMedia(ayrPlatform: string, media: PublishMedia[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const video = media.some((m) => m.mimeType.startsWith('video/'));
  const altFor = ayrPlatform === 'facebook' || (['linkedin', 'instagram', 'twitter'].includes(ayrPlatform) && !video);
  if (altFor) {
    const alts: string[] = [];
    for (const m of media) {
      const alt = (m.alt || '').trim();
      if (!alt) break;
      alts.push(alt.slice(0, ALT_MAX));
    }
    if (alts.length) out.altText = alts;
  }
  if (media.some((m) => m.aiGenerated)) {
    if (ayrPlatform === 'twitter' || ayrPlatform === 'instagram') out.isAIGenerated = true;
    if (ayrPlatform === 'tiktok' && video) out.isAIGenerated = true;
    if (ayrPlatform === 'youtube') out.containsSyntheticMedia = true;
  }
  return out;
}

/** يضمّ خياراتٍ إلى كائن المنصة في الطلب (`twitterOptions`…) فوق ما فيه. */
export function mergeOptions(body: Record<string, unknown>, ayrPlatform: string, extra: Record<string, unknown>): void {
  const key = OPTIONS_KEY[ayrPlatform];
  if (!key || !Object.keys(extra).length) return;
  body[key] = { ...((body[key] as Record<string, unknown>) || {}), ...extra };
}

/** منصاتٌ لا تحذف المنشور المنشور عبر الواجهة — يُحذف من تطبيقها («Delete Post»). */
export const MANUAL_DELETE = new Set(['instagram', 'tiktok']);

/* ═══ نشرٌ لا تُعرف نتيجته، ومفتاحٌ رُفض لأنه أُرسل ═══

   انقطاعُ الاتصال قبل الردّ، أو بوّابةٌ ترد ٥٠٢–٥٠٤ بلا رمز خطأ من Ayrshare:
   قد يكون المنشور وصله ونُشر. فيُرمى `PublishUncertain` ويبقى للموعد مفتاحُ
   محاولته (`idempotencyKey`)، فإن أُعيد النشر رفضه Ayrshare بدل أن يكرّره.

   ورفضُ المفتاح المكرّر لا رمز له في التوثيق — «an error will be returned,
   indicating that a duplicate key was found» — فيُعرف من نصّه. */
const GATEWAY_STATUS = new Set([502, 503, 504]);

export const UNCERTAIN_ERROR =
  'انقطع الاتصال بـ Ayrshare قبل أن يردّ، فقد يكون المنشور وصله. أعد النشر حين تشاء: إن كان وصله فلن يتكرّر';
export const ALREADY_RETRIED_ERROR =
  'أُعيدت محاولة هذا المنشور من قبل ولم يُنشر، وAyrshare لا يعيده مرّتين. تحقّق منه على المنصة، وإن لم تجده فأعد النشر ليُرسل من جديد';
export const DUPLICATE_KEY_ERROR =
  'وصل هذا المنشور إلى Ayrshare في محاولةٍ سابقة، فلم يُرسل ثانيةً. تحقّق منه على المنصة، وإن لم تجده فأعد النشر';

/** نتيجةٌ لا تُعرف من خطأ النداء: لا ردّ أصلاً، أو بوّابةٌ بلا رمزٍ من Ayrshare. */
export function uncertainOutcome(err: unknown): boolean {
  if (!(err instanceof AyrshareError)) return true;
  return GATEWAY_STATUS.has(err.status) && !errorCodes(err.body).length;
}

/** رفضُ Ayrshare مفتاحاً أُرسل من قبل — من نصّ الخطأ إذ لا رمز له. */
export function duplicateKeyRejection(data: any): boolean {
  const list: any[] = Array.isArray(data?.errors) ? data.errors : [];
  return [data?.message, ...list.map((e) => e?.message)].some((m) => /idempoten/i.test(String(m || '')));
}

/** أخطاءٌ كلها يقول Ayrshare إنها تُعاد (`retryAvailable`) — تعثّرٌ مؤقت لدى المنصة. */
export function retryableFailure(data: any): boolean {
  const list: any[] = Array.isArray(unwrapAyrsharePost(data)?.errors) ? unwrapAyrsharePost(data).errors : [];
  return list.length > 0 && list.every((e) => e?.retryAvailable === true);
}

/* ═══ «تعثّرٌ يُعاد» ونُشر ═══

   رآه الفريق على لينكدإن: يردّ Ayrshare بفشلٍ يقول إنه يُعاد (`retryAvailable`)
   والمنشور على الصفحة. فكان الموعد يُكتب فاشلاً والمحتوى «متأخراً»، وإعادتُه
   بمفتاحٍ جديد تكرّره. فما عاد بمعرّفٍ لدى Ayrshare لا يُكتب فاشلاً: يبقى
   «قيد النشر» ويُسأل سجلّ المنصة عنه (`getPublishStatus`)، فإن ظهر فيه نُشر،
   وإلا فشل بسببه بعد ربع ساعة. */
function unsureFailure(data: any): PublishResult | null {
  const id = String(unwrapAyrsharePost(data)?.id || '');
  if (!id || !retryableFailure(data)) return null;
  return { providerPostId: id, status: 'error', state: 'pending' };
}

/* ═══ حدُّ حجم الصورة لكل منصة ═══

   Ayrshare لا يُعلن حدود المنصات في واجهته كما يُعلنها SocialAPI، فتُكتب هنا
   من صفحات «Media Guidelines» في توثيقه (https://www.ayrshare.com/docs/media-guidelines).
   وكانت الصورة الكبيرة تُرفع وتُرسل ثم تُرفض بعد الموعد: إنستغرام بـ «Media file
   too large»، وإكس بـ «Error accessing the media» الذي لا يدلّ على السبب.
   والمقاطع لا حدّ لها هنا: أصغر حدودها فوق حدّ الرفع عندنا (١٠٠ ميغابايت). */
const MB = 1048576;
const AYRSHARE_IMAGE_MAX: Record<string, number> = {
  twitter: 5 * MB,
  linkedin: 5 * MB,
  instagram: 8 * MB,
  threads: 8 * MB,
  facebook: 10 * MB,
  tiktok: 20 * MB,
  snapchat: 20 * MB,
};

/** أصغر حدٍّ لحجم الصورة بين منصات المنشور — `null` إن لم يُعرف لأيٍّ منها حدّ. */
export function ayrshareImageLimit(platforms: string[]): number | null {
  const limits = platforms.map((p) => AYRSHARE_IMAGE_MAX[ayrsharePlatform(p)]).filter((n): n is number => !!n);
  return limits.length ? Math.min(...limits) : null;
}

/** صيغٌ يضغطها `IMAGES` إلى JPEG. والمتحرّكة (GIF) تفقد حركتها، فلا تُضغط. */
const COMPRESSIBLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/** ما سترفضه المنصة من حجم الصور — بنصّ الفحص المسبق نفسه في SocialAPI.
    ومع الضغط (`canCompress`) لا يُعدّ إلا ما لا يُضغط. */
export function ayrshareMediaIssues(input: PublishInput, canCompress = false): string[] {
  const max = ayrshareImageLimit(input.platforms);
  if (!max) return [];
  const media = (input.media || []).filter((m) => !(canCompress && COMPRESSIBLE.has(m.mimeType)));
  return constraintIssues({ media: { max_image_size_bytes: max } }, { ...input, text: '', media });
}

/* ═══ ضغطُ الصورة إلى حدّ المنصة ═══

   الصورة الأكبر من حدّ المنصة تُضغط عند النشر لا تُرفض — كما يفعل تطبيق إكس
   على الجهاز قبل الرفع. والأصل في المكتبة لا يُمسّ؛ تُصنع نسخةٌ تُرسل وحدها.

   والضغط لأجل التجاوز فقط، ولا ينزل عن الحدّ كثيراً: يُبحث عن أعلى جودة
   JPEG يقع حجمها تحت الحدّ (بحثاً ثنائياً بين ٧٥ و٩٥). فإن لم تكفِ ٧٥ صُغّرت
   الأبعاد بقدر ما يلزم ثم بُحث من جديد — والجودة أولى بالبقاء من البكسلات
   الزائدة، فالمنصات تصغّر الأبعاد عند العرض على كل حال. */
const QUALITY_MIN = 75;
const QUALITY_MAX = 95;

export async function fitImage(images: ImagesBinding, m: PublishMedia, max: number): Promise<PublishMedia> {
  const read = async (): Promise<ReadableStream<Uint8Array>> => {
    const s = m.data ? new Blob([m.data]).stream() : await m.open?.();
    if (!s) throw new Error('وسيطٌ في المحتوى لم يعد موجوداً في المكتبة. احذفه من المحتوى أو أعد رفعه ثم أعد النشر');
    return s;
  };
  const encode = async (quality: number, width?: number): Promise<ArrayBuffer> => {
    try {
      let t = images.input(await read());
      if (width) t = t.transform({ width, fit: 'scale-down' });
      // الشفافية في PNG تُسطَّح على أبيض — لونُ الصورة المُرسلة لا لونٌ في الواجهة
      const out = await t.output({ format: 'image/jpeg', quality, background: 'white' });
      return await new Response(out.image()).arrayBuffer();
    } catch (err) {
      throw new Error(`تعذّر ضغط الصورة «${m.filename}» إلى حدّ هذه المنصة: ${String((err as Error)?.message || err)}`);
    }
  };

  let width: number | undefined;
  for (let pass = 0; pass < 4; pass++) {
    let lo = QUALITY_MIN;
    let hi = QUALITY_MAX;
    let best: ArrayBuffer | null = null;
    let smallest = 0;
    while (lo <= hi) {
      const q = Math.ceil((lo + hi) / 2);
      const buf = await encode(q, width);
      if (buf.byteLength <= max) {
        best = buf;
        lo = q + 1;
      } else {
        smallest = smallest ? Math.min(smallest, buf.byteLength) : buf.byteLength;
        hi = q - 1;
      }
    }
    if (best) {
      return {
        data: best,
        size: best.byteLength,
        mimeType: 'image/jpeg',
        filename: `${(m.filename || 'media').replace(/\.[a-z0-9]{2,5}$/i, '')}.jpg`,
      };
    }
    // أدنى جودةٍ لم تكفِ: تُصغّر الأبعاد بنسبة الحجم الزائد (والمساحة تتبع مربّع العرض)
    if (!width) width = (await images.info(await read()) as { width?: number }).width;
    if (!width) break;
    width = Math.floor(width * Math.sqrt(max / smallest) * 0.97);
  }
  throw new Error(`تعذّر ضغط الصورة «${m.filename}» تحت حدّ هذه المنصة. صغّرها ثم ضعها مكان القديمة وأعد النشر`);
}

/** امتداد الملف ونوعه كما يقبلهما `GET /media/uploadUrl`. */
function uploadType(m: PublishMedia): { fileName: string; contentType?: string } {
  const KNOWN: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
  };
  /* والمستند يُعرف عند لينكدإن بامتداد رابطه وحده («LinkedIn Documents»): اسمٌ
     بلا امتداد — والأسماء العربية تُستبدل حروفها — يُنشر رابطاً لا مستنداً. */
  const OTHER: Record<string, string> = {
    'image/gif': 'gif', 'image/webp': 'webp', 'video/webm': 'webm',
    'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  };
  const mime = (m.mimeType || '').toLowerCase();
  const ext = KNOWN[mime] || OTHER[mime] || '';
  let fileName = (m.filename || 'media').replace(/[^\w.\-]+/g, '_');
  // اسمٌ بلا امتداد يُرفض حين لا يُرسل النوع — فيُلحق الامتداد من النوع
  if (ext && !/\.[a-z0-9]{2,5}$/i.test(fileName)) fileName = `${fileName}.${ext}`;
  return KNOWN[mime] ? { fileName, contentType: KNOWN[mime] } : { fileName };
}

/** ما يُصادَق به كل طلب: مفتاح الحساب، ومفتاحا تطبيق إكس إن ضُبطا. */
/* ═══ حدُّ طلبات الحساب: ⁨300⁩ كل خمس دقائق ═══

   الحدّ للحساب كلّه لا للنداء (صفحة «HTTP Errors» في توثيقه، 429): يشترك فيه
   السحبُ المجدول والنشرُ وما يطلبه المستخدم. وكان السحب يملؤه وحده — حصّةُ
   التحليلات عند ‎:02 وحصّةُ الصندوق عند ‎:04 مئةٌ وخمسون لكلٍّ منهما، معاً
   ثلاثمئة في دقيقتين — فيُرفض بعدهما «سحب الآن» والنشر حتى تنقضي النافذة.
   وألفُ رفضٍ في يومٍ يُعطّل الحساب كلَّه.

   فيُقرأ العدّاد من ترويسة كل ردّ (`x-ratelimit-count` و`x-ratelimit-max`)،
   والسحبُ — ما له حصّة — يقف حين يبقى ⁨100⁩: هي للنشر وللمستخدم. والرفضُ
   يُحفظ في الإعدادات خمس دقائق لا يُنادى فيها Ayrshare من أي استدعاء، فلا
   تتراكم الرفضات نحو التعطيل. */
export const AYRSHARE_RATE_KEY = 'ayrshare_rate_until';
export const AYRSHARE_SYNC_RESERVE = 100;
const RATE_WINDOW_MS = 5 * 60_000;
export const RATE_LIMIT_ERROR = 'بلغ حساب Ayrshare حدّ طلباته: ⁨300⁩ طلب كل خمس دقائق. أعد المحاولة بعد خمس دقائق';

/** أين يُحفظ وقتُ انقضاء الرفض بين الاستدعاءات — جدول الإعدادات (`adapters/index.ts`). */
export type RateStore = { read(): Promise<number>; write(until: number): Promise<void> };

/** عدّاد الحدّ لاستدعاءٍ واحد، ومعه ما حُفظ من رفضٍ سابق. */
export class AyrshareRate {
  private until: number | null = null;
  count = 0;
  max = 0;
  constructor(private store?: RateStore) {}

  /** لحظةٌ لا يُنادى قبلها — تُقرأ من المخزن مرّةً في الاستدعاء. */
  async blockedUntil(): Promise<number> {
    if (this.until === null) {
      try { this.until = this.store ? await this.store.read() : 0; } catch { this.until = 0; }
    }
    return this.until;
  }

  /** بلغ الحسابُ ما يُترك للنشر وللمستخدم. */
  get nearLimit(): boolean {
    return this.max > 0 && this.count >= this.max - AYRSHARE_SYNC_RESERVE;
  }

  note(res: Response): void {
    const max = Number(res.headers?.get('x-ratelimit-max'));
    const count = Number(res.headers?.get('x-ratelimit-count'));
    if (max > 0 && Number.isFinite(count)) {
      this.max = max;
      this.count = count;
    }
  }

  async trip(): Promise<void> {
    this.until = Date.now() + RATE_WINDOW_MS;
    try { await this.store?.write(this.until); } catch { /* يبقى في هذا الاستدعاء وحده */ }
  }
}

export type AyrshareAuth = { key: string; x?: AyrshareXKeys; rate?: AyrshareRate };

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
  // الحساب في نافذة رفض، أو السحبُ بلغ ما يُترك لغيره: لا يُنادى
  const rate = auth.rate;
  if (rate && ((await rate.blockedUntil()) > Date.now() || (budget && rate.nearLimit))) {
    if (budget) {
      budget.stop('rate_limit');
      throw new BudgetExhausted();
    }
    throw new AyrshareError(RATE_LIMIT_ERROR, 429, null);
  }
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
  rate?.note(res);
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
  /* ٤٧٥ يأتي ٤٠٣ وليس رفضاً للمفتاح: حسابُ لينكدإن الشخصي رُبط قبل صلاحيات
     الأرقام. وكان يُقرأ «رفض Ayrshare المفتاح» فيُبحث في السرّ وهو سليم. */
  if (codes.includes(475)) {
    throw new AyrshareError(
      'لينكدإن يحتاج إعادة ربط الحساب في Ayrshare لتُقرأ أرقامه: Social Accounts ثم أعد ربط لينكدإن. والنشر لا يتأثّر',
      res.status, data,
    );
  }
  /* الرسائل الخاصة: ٣٦١ يأتي ٤٠٣ — الإضافة غير مفعّلة في الحساب — فيُقرأ رفضاً
     للمفتاح وهو سليم. و٣٦٢ تفعّلت ولم يُعَد ربط فيسبوك أو إنستغرام بعدها
     (Messages API Overview). */
  if (codes.includes(361)) {
    throw new AyrshareError(
      'الرسائل الخاصة غير مفعّلة في حساب Ayrshare. فعّلها من صفحة Account في Ayrshare، ثم أعد ربط فيسبوك وإنستغرام',
      res.status, data,
    );
  }
  if (codes.includes(362)) {
    throw new AyrshareError(
      'أعد ربط فيسبوك وإنستغرام في Ayrshare لتعمل الرسائل الخاصة: Social Accounts ثم أعد الربط',
      res.status, data,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new AyrshareError(
      `رفض Ayrshare المفتاح (${res.status}). تحقّق من AYRSHARE_API_KEY في أسرار كلاودفلير: ${ayrshareErrors(data) || 'بلا تفصيل'}`,
      res.status, data,
    );
  }
  /* تمهّلُ منصةٍ بعينها ليس تمهّلَ Ayrshare: فيسبوك ٤٤٤ لكل صفحة، وإكس ٣٦٤ لكل
     تطبيق. وكان كلاهما يوقف السحب كلَّه فلا تُقرأ منصةٌ أخرى في تلك الدورة —
     فيُقال لمنصّته وحدها، وتمضي البقية، ويُعاد هو في السحب التالي. */
  const throttled = platformThrottle(data);
  if (res.status === 429 && throttled) {
    throw new AyrshareError(
      `${platformNames([ayrshareAccountPlatform({ platform: throttled })])}: طلبت المنصة التمهّل. يُستأنف في السحب التالي`,
      res.status, data,
    );
  }
  if (res.status === 429) {
    // المزوّد طلب التمهّل: لا يُنادى خمس دقائق، ويُستأنف السحب في دورته بعدها
    await rate?.trip();
    if (budget) {
      budget.stop('rate_limit');
      throw new BudgetExhausted();
    }
    throw new AyrshareError(RATE_LIMIT_ERROR, res.status, data);
  }
  /* سببٌ بلا رسالة يُذكر بمساره ورمزه — وكان «خطأ من Ayrshare (400)» وحده لا
     يقول أيُّ طلبٍ رُفض. والمسار بلا استعلامه: فيه مؤشّر الصفحة. */
  const where = `${method} ${path.split('?')[0]}`;
  throw new AyrshareError(
    ayrshareErrors(data) || `خطأ من Ayrshare (${res.status}) في ${where}${codes.length ? ` — رمز ${codes[0]}` : ''}`,
    res.status, data,
  );
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
  /** معرّف قناة يوتيوب بحروفه (`UC…`) — به تُقرأ قائمة مقاطعها العامة. */
  channelId?: string;
  /** حسابُ إكس مشتركٌ في Premium — ينشر المنشور الطويل. */
  premium?: boolean;
};

/* اشتراك إكس كما في توثيق «Get User»: `subscriptionType` (Premium أو PremiumPlus)،
   أو `verifiedType` (blue أو business — وكلاهما Premium عنده). والثاني لا يُحدَّث
   إلا بعد منشورٍ عبر Ayrshare، فيُقبل أيٌّ منهما. */
export function isXPremium(entry: any): boolean {
  if (String(entry?.platform || '').toLowerCase() !== 'twitter') return false;
  const sub = String(entry?.subscriptionType || '').toLowerCase();
  const ver = String(entry?.verifiedType || '').toLowerCase();
  return sub === 'premium' || sub === 'premiumplus' || ver === 'blue' || ver === 'business';
}

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
      /* يوتيوب: `displayName` و`username` اسمُ صاحب حساب جوجل لا القناة (كما في
         توثيق «Get User»)، والتعليق تكتبه القناة. فمعلّقٌ يوافق اسمُه اسمَ صاحب
         الحساب كان يُعدّ منّا فيُسقط تعليقه — فالقناة تُعرف بعنوانها ومعرّفها
         ومعرّفها المختصر وحدها. */
      ownerKeys: (String(e.platform).toLowerCase() === 'youtube'
        ? [e.id, e.channelTitle, e.channelId, e.handle]
        : [e.id, e.userId, e.username, e.displayName, e.pageName, e.channelTitle, e.channelId, e.handle])
        .map(ownerKey)
        .filter(Boolean),
      ...(typeof e.channelId === 'string' && e.channelId ? { channelId: e.channelId } : {}),
      ...(isXPremium(e) ? { premium: true } : {}),
    }));
}

export async function ayrshareUser(
  auth: AyrshareAuth,
  budget?: CallBudget,
): Promise<{ accounts: AyrshareAccount[]; messagingEnabled: boolean }> {
  const user = await ayrshareCall<any>(auth, 'GET', '/user', undefined, budget);
  return { accounts: mapAyrshareAccounts(user), messagingEnabled: user?.messagingEnabled === true };
}

/* اشتراك إكس يُسأل عنه مرةً في الساعة لكل عامل: العدّاد يطلب الطول كلما هدأت
   الكتابة، والاشتراك لا يتغيّر بينها. وتعذّرُ السؤال يُعدّ «غير مشترك» —
   الحدّ القصير إنذارٌ لا منع. */
let premiumCache: { key: string; value: boolean; exp: number } = { key: '', value: false, exp: 0 };
/** للاختبارات: يُنسى ما حُفظ من الاشتراك. */
export function forgetXPremium(): void {
  premiumCache = { key: '', value: false, exp: 0 };
}
export async function ayrshareXPremium(auth: AyrshareAuth): Promise<boolean> {
  if (premiumCache.key === auth.key && premiumCache.exp > Date.now()) return premiumCache.value;
  try {
    const { accounts } = await ayrshareUser(auth);
    const value = accounts.some((a) => a.platform === 'x' && a.premium);
    premiumCache = { key: auth.key, value, exp: Date.now() + 60 * 60_000 };
    return value;
  } catch {
    return false;
  }
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

/** مهلةٌ قبل سؤال سجلّ المنصة، وهامشُ فرق الساعة بيننا وبينها. */
const SEEN_AFTER_MS = 5 * 60_000;
const SEEN_CLOCK_SKEW_MS = 5 * 60_000;
/** مهلةُ «تعثّرٍ يُعاد» حتى يظهر المنشور في سجلّ منصته — انظر `send`. */
const RETRY_GRACE_MS = 15 * 60_000;

/** أوّل ستين حرفاً من النصّ للمطابقة — بلا محارف الاتجاه والوصل، والمسافاتُ واحدة. */
export function normalizeHead(text: string | undefined | null): string {
  return String(text || '')
    .replace(/[\u200b-\u200f\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export class AyrshareProvider implements PublishingProvider {
  private key: string;

  // `labels` الأسماء المخصّصة من الإعدادات — لرسائل الخطأ وحدها. و`images` ربط
  // Cloudflare Images لضغط الصورة الكبيرة؛ وبدونه تُرفض كما كانت. و`suspended`
  // نصُّ تعطيل حساب النشر إن كان قائماً (`services/ayrshareAlerts.ts`): به يُقال
  // رفضُ ٤٠٣ — وإلا قيل «رفض المفتاح» والمفتاح سليم.
  constructor(
    apiKey: string,
    private x: AyrshareXKeys = {},
    private labels: Record<string, string> = {},
    private images?: ImagesBinding,
    private suspended = '',
    private rate?: AyrshareRate,
  ) {
    this.key = (apiKey || '').trim();
  }

  private call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    return ayrshareCall<T>({ key: this.key, x: this.x, rate: this.rate }, method, path, body);
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

  /* ═══ الفحص عند الجدولة ═══

     حدّ الصور هنا، ثم ما يقوله Ayrshare نفسه بلا وسيط: طولُ النص كما تعدّه
     المنصة (`checkPostWeight`)، وأمربوطةٌ المنصة في الحساب أصلاً. و`/validate/post`
     لا يُسأل: يشترط روابط الوسائط كما في النشر، ووسائطنا خلف المصادقة فلا تصله
     إلا برفعها — وبلا وسيطٍ يردّ رفضاً لا أصل له لإنستغرام وتيك توك ويوتيوب.
     وتعذّرُ السؤال لا يُعدّ عيباً في المنشور: يُسكت عنه، والنشر يقول ما بقي. */
  async preflight(input: PublishInput): Promise<string[]> {
    const issues = ayrshareMediaIssues(input, !!this.images);
    const auth = { key: this.key, x: this.x };
    const targets = [...new Set(input.platforms)];
    if (input.text) {
      try {
        const xPremium = targets.includes('x') && (await ayrshareXPremium(auth));
        const weight = await ayrsharePostWeight(auth, input.text, { xPremium });
        // سلسلة إكس تقسم نصّها، والقصة لا نصّ لها — فلا يُعدّ طولها عيباً
        const exempt = (p: string) =>
          (p === 'x' && input.options?.thread) || ((p === 'instagram' || p === 'facebook') && input.options?.story);
        for (const p of targets) {
          const w = weight[ayrsharePlatform(p)];
          if (w && !w.valid && !exempt(p)) {
            issues.push(
              `النص أطول من حدّ ${platformNames([p], this.labels)} (⁨${w.length}⁩ من ⁨${w.max}⁩). اكتب له نصّاً أقصر في «نسخة كل منصة»`,
            );
          }
        }
      } catch { /* يُسكت عنه */ }
    }
    try {
      const { accounts } = await ayrshareUser(auth);
      const linked = new Set(accounts.map((a) => ayrsharePlatform(a.platform)));
      for (const p of targets) {
        if (!linked.has(ayrsharePlatform(p))) {
          issues.push(`${platformNames([p], this.labels)} غير مربوط في Ayrshare: اربطه من Social Accounts قبل الموعد، وإلا لم يُنشر`);
        }
      }
    } catch { /* يُسكت عنه */ }
    return issues;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const platforms = [...new Set(input.platforms.map(ayrsharePlatform))];
    if (platforms.includes('twitter') && !(this.x.key && this.x.secret)) {
      throw new Error(
        `النشر على ${platformNames(['x'], this.labels)} عبر Ayrshare يشترط مفتاحَي تطبيق المطوّر. اضبط AYRSHARE_X_API_KEY وAYRSHARE_X_API_SECRET ثم أعد النشر`,
      );
    }

    // قبل الرفع: ما لا يُضغط ويتجاوز حدّ المنصة يُرفض بعده بنصٍّ إنجليزي
    const tooLarge = ayrshareMediaIssues(input, !!this.images);
    if (tooLarge.length) throw new Error(tooLarge.join(' · '));

    const body: Record<string, unknown> = { post: input.text || '', platforms };
    const max = ayrshareImageLimit(input.platforms);
    const media: PublishMedia[] = [];
    for (const m of input.media || []) {
      const size = m.data ? m.data.byteLength : m.size ?? 0;
      const compress = this.images && max && COMPRESSIBLE.has(m.mimeType) && size > max;
      media.push(compress ? keepDescription(m, await fitImage(this.images!, m, max!)) : m);
    }
    if (media.length) {
      const urls: string[] = [];
      for (const m of media) urls.push(await this.uploadMedia(m));
      body.mediaUrls = urls;
      if (media.some((m) => m.mimeType.startsWith('video/'))) body.isVideo = true;
    }
    if (input.firstComment?.trim()) body.firstComment = { comment: input.firstComment.trim() };

    /* ═══ المقطع بارزاً ═══
       المقطع الواحد يُنشر بصيغة المنصة الكبيرة: ريلز إنستغرام في الخلاصة
       والريلز معاً، وريلز فيسبوك للطوليّ بين ٣ و٩٠ ثانية، وشورتس يوتيوب
       للطوليّ حتى ثلاث دقائق. وما لا يُعرف من أبعاده ومدّته يُنشر كما كان.
       والغلاف `thumbNail` حيث يُقبل — وشورتس لا يقبله. */
    const video = media.length === 1 && media[0].mimeType.startsWith('video/') ? media[0] : null;
    const short = !!video && platforms.includes('youtube') && youtubeShort(video);
    const thumb = video && input.cover ? await this.coverUrl(input.cover, platforms.includes('youtube') ? 2 * MB : 8 * MB) : '';
    const withThumb = (o: Record<string, unknown> = {}) => (thumb ? { ...o, thumbNail: thumb } : o);
    /* يوتيوب يشترط العنوان، ويرفع المقطع «خاصّاً» إن لم يُقل غيره. وتيك توك
       كذلك يُضبط عامّاً: منشورات حساب الشركة للجمهور، والتعليق الأول لا
       يُنشر على مقطعٍ غير عامّ. */
    if (platforms.includes('youtube')) {
      const yt = { title: youtubeTitle(input.title, input.text), visibility: 'public' };
      body.youTubeOptions = short ? { ...yt, shorts: true } : withThumb(yt);
    }
    if (platforms.includes('tiktok')) body.tikTokOptions = withThumb({ visibility: 'public' });
    if (video && platforms.includes('instagram')) body.instagramOptions = withThumb({ shareReelsFeed: true });
    if (video && platforms.includes('facebook') && facebookReel(video)) body.faceBookOptions = { reels: true };
    if (thumb && platforms.includes('linkedin')) body.linkedInOptions = { thumbNail: thumb };
    if (thumb && platforms.includes('twitter')) body.twitterOptions = { thumbNail: thumb };
    for (const p of platforms) mergeOptions(body, p, describeMedia(p, media));
    // منشور المستند في لينكدإن بعنوان المحتوى — وبلا عنوانٍ يأخذ اسم الملف
    if (platforms.includes('linkedin') && media.length === 1 && isDocument(media[0])) {
      mergeOptions(body, 'linkedin', { title: (input.title || media[0].filename).slice(0, 400) });
    }
    await this.applyOptions(body, platforms, input);
    if (input.scheduleAt) body.scheduleDate = input.scheduleAt;

    if (platforms.length === 1 && platforms[0] === 'snapchat') return this.publishSnapchat(body, !!video, input.idempotencyKey);
    return this.send(input.idempotencyKey ? { ...body, idempotencyKey: input.idempotencyKey } : body);
  }

  /* ═══ خيارات المنصة (`services/publishOptions.ts`) بحقول Ayrshare ═══

     - القصة («Instagram/Facebook Stories»): وسيطٌ واحدٌ بلا نصّ، فلا ريلز ولا
       غلاف ولا نصٌّ بديل (إنستغرام لا يقبله للقصة)، ولا تعليقٌ أوّل. ويبقى وسم
       الذكاء الاصطناعي: إنستغرام يقبله للقصة.
     - سلسلة إكس («X Thread»): `thread` و`threadNumber`. وAyrshare يقسّم النص
       على الجمل حتى حدّ المنشور — إلا إن وجد «\n\n» فيقطع عنده وحده ولو طال
       الجزء. ففواصل الفقرات تُكتب بالفاصل الذي لا يقطع (`\u2063\n\u2063\n`
       في توثيقه) وتبقى القسمة له.
     - نشاطي التجاري: `callToAction` بنوعه ورابطه (والاتصال بلا رابط)، و`event`
       بعنوانه وموعديه.
     - يوتيوب: `categoryId` و`tags`، وملف الترجمة يُرفع كالوسيط ويُرسل رابطه
       `subTitleUrl` مع لغته واسمها الظاهر للمشاهد. */
  private async applyOptions(body: Record<string, unknown>, platforms: string[], input: PublishInput): Promise<void> {
    const o = input.options || {};
    if (o.story && platforms.includes('instagram')) {
      const ai = (body.instagramOptions as Record<string, unknown> | undefined)?.isAIGenerated === true;
      body.instagramOptions = { stories: true, ...(ai ? { isAIGenerated: true } : {}) };
      delete body.firstComment;
    }
    if (o.story && platforms.includes('facebook')) {
      body.faceBookOptions = { stories: true };
      delete body.firstComment;
    }
    if (o.thread && platforms.includes('twitter')) {
      mergeOptions(body, 'twitter', { thread: true, ...(o.threadNumber ? { threadNumber: true } : {}) });
      body.post = String(body.post || '').replace(/\n\n/g, '\u2063\n\u2063\n');
    }
    if (platforms.includes('gmb')) {
      const g: Record<string, unknown> = {};
      if (o.cta) g.callToAction = o.cta.type === 'call' ? { actionType: 'call' } : { actionType: o.cta.type, url: o.cta.url };
      if (o.event) g.event = { title: o.event.title, startDate: o.event.start, endDate: o.event.end };
      mergeOptions(body, 'gmb', g);
    }
    if (platforms.includes('youtube')) {
      const y: Record<string, unknown> = {};
      if (o.categoryId) y.categoryId = o.categoryId;
      if (o.tags?.length) y.tags = o.tags;
      if (o.subtitle && input.subtitle) {
        y.subTitleUrl = await this.uploadMedia(input.subtitle);
        y.subTitleLanguage = o.subtitle.language;
        y.subTitleName = o.subtitle.language === 'en' ? 'English' : 'العربية';
      }
      mergeOptions(body, 'youtube', y);
    }
  }

  /* ═══ سناب: أكثر من نشرةٍ للموعد الواحد ═══

     القصة تختفي بعد يوم، فيُنشر المقطع سبوتلايت وقصةً محفوظة وقصة، والصورة
     قصةً محفوظة وقصة — كلٌّ في طلبٍ مستقل (`snapChatOptions`)، بالوسيط
     المرفوع نفسه. والموعد منشورٌ إن نجح أحدها، وما فشل يُكتب تحته بنوعه.

     ولكلّ نشرةٍ مفتاحُها من مفتاح الموعد: ثلاثة طلباتٍ بمفتاحٍ واحد يرفض
     Ayrshare ثانيها وثالثها. وإن لم تُعرف نتيجةُ إحداها لم تُعرف نتيجة الموعد. */
  private async publishSnapchat(base: Record<string, unknown>, video: boolean, key?: string): Promise<PublishResult> {
    const kinds: { label: string; key: string; options?: Record<string, boolean> }[] = [
      ...(video ? [{ label: 'سبوتلايت', key: 'spotlight', options: { spotlight: true } }] : []),
      { label: 'القصة المحفوظة', key: 'saved', options: { savedStory: true } },
      { label: 'القصة', key: 'story' },
    ];
    const done: PublishResult[] = [];
    const failed: string[] = [];
    let uncertain = false;
    for (const k of kinds) {
      const body = {
        ...base,
        ...(k.options ? { snapChatOptions: k.options } : {}),
        ...(key ? { idempotencyKey: `${key}-${k.key}` } : {}),
      };
      try {
        done.push(await this.send(body));
      } catch (err) {
        if (err instanceof PublishUncertain) uncertain = true;
        failed.push(`${k.label}: ${String((err as Error)?.message || err)}`);
      }
    }
    if (!done.length) throw uncertain ? new PublishUncertain(failed.join(' · ')) : new Error(failed.join(' · '));
    const [first, ...rest] = done;
    return {
      ...first,
      state: done.some((d) => d.state === 'published') ? 'published' : first.state,
      extraIds: rest.map((d) => d.providerPostId).filter(Boolean),
      ...(failed.length ? { note: `لم يُنشر على سناب: ${failed.join(' · ')}` } : {}),
    };
  }

  /** رابط الغلاف بعد رفعه — مضغوطاً إلى حدّ المنصة إن تجاوزه. */
  private async coverUrl(cover: PublishMedia, max: number): Promise<string> {
    const size = cover.data ? cover.data.byteLength : cover.size ?? 0;
    const fitted = this.images && COMPRESSIBLE.has(cover.mimeType) && size > max ? await fitImage(this.images, cover, max) : cover;
    return this.uploadMedia(fitted);
  }

  /* الرفض يأتي ٤٠٠ ومعه `errors` بسبب كل منصة — فيُقرأ السبب منها لا من
     رمز الحالة. وما يقول Ayrshare إنه يُعاد (`retryAvailable`) تعثّرٌ مؤقت
     لدى المنصة: يُقال ذلك مع سببه، فيُعاد بعد دقائق لا يُبحث في المحتوى. */
  private async send(body: Record<string, unknown>): Promise<PublishResult> {
    const failure = (raw: any, reason: string) =>
      `فشل النشر عبر Ayrshare: ${reason}${retryableFailure(raw) ? '. تعثّرٌ مؤقت لدى المنصة — أعد النشر بعد دقائق' : ''}`;
    let data: any;
    try {
      data = await this.call('POST', '/post', body);
    } catch (err) {
      if (uncertainOutcome(err)) throw new PublishUncertain(UNCERTAIN_ERROR);
      const e = err as AyrshareError;
      if (duplicateKeyRejection(e.body)) throw new Error(DUPLICATE_KEY_ERROR);
      // التعطيل يردّ ٤٠٣ — وبلا نصّه يُقرأ رفضاً للمفتاح
      if (e.status === 403 && this.suspended) throw new Error(this.suspended);
      // 419 سببُه مفهومٌ مسبقاً بنصٍّ يقول ما يُضبط — لا يُستبدل برسالة الواجهة
      const outcome = errorCodes(e.body).includes(419) ? null : ayrshareOutcome(e.body);
      const unsure = unsureFailure(e.body);
      if (outcome?.state === 'failed' && unsure) return unsure;
      if (outcome?.state === 'failed' && outcome.error) throw new Error(failure(e.body, outcome.error));
      throw err;
    }
    const post = unwrapAyrsharePost(data);
    const outcome = ayrshareOutcome(data);
    if (outcome?.state === 'failed') {
      if (duplicateKeyRejection(post)) throw new Error(DUPLICATE_KEY_ERROR);
      const unsure = unsureFailure(data);
      if (unsure) return unsure;
      throw new Error(failure(data, outcome.error || 'رفضت المنصة المنشور'));
    }
    const id = String(post?.id || '');
    // بلا معرّفٍ لا يُسأل عن حاله لاحقاً — فيُعدّ منشوراً كما كان
    const state = id && outcome ? outcome.state : 'published';
    return { providerPostId: id, status: String(post?.status || 'success'), state };
  }

  /* ═══ إعادة المنشور نفسه ═══

     `PUT /post/retry` يُعيد منشوراً فشل بتعثّرٍ يُعاد، بمعرّفه، مرّةً واحدة — ويعود
     «pending» فيُتابَع كأيّ منشورٍ قيد النشر. وإعادتُه بنشرٍ جديد كانت تُكرّره إن
     كانت المنصة استلمته (التوثيق: «Social networks may sometimes report errors
     even when they've successfully processed and published the post»). وما أُعيد
     قبلُ (329) يُقال، فيُنشر من جديد بعلم الفريق. */
  async retryPost(providerPostId: string): Promise<PublishResult> {
    let data: any;
    try {
      data = await this.call('PUT', '/post/retry', { id: providerPostId });
    } catch (err) {
      if (err instanceof AyrshareError && errorCodes(err.body).includes(329)) throw new Error(ALREADY_RETRIED_ERROR);
      if (uncertainOutcome(err)) throw new PublishUncertain(UNCERTAIN_ERROR);
      throw err;
    }
    return { providerPostId: String(data?.id || providerPostId), status: String(data?.status || 'pending'), state: 'pending' };
  }

  async getPublishStatus(providerPostId: string, ctx?: PublishStatusContext): Promise<PublishCheck | null> {
    let raw: any;
    try {
      raw = await this.call('GET', `/post/${encodeURIComponent(providerPostId)}`);
    } catch (err) {
      // ٢٢١ «History not found» — المنشور لا يُعرف لدى Ayrshare
      if (err instanceof AyrshareError && errorCodes(err.body).includes(221)) return null;
      throw err;
    }
    const check = ayrshareOutcome(raw);
    if (!ctx) return check;
    if (check?.state === 'pending') return (await this.seenOnPlatform(ctx)) ? { state: 'published' } : check;
    if (check?.state !== 'failed') return check;

    /* «فشل» يُصدَّق بعد سؤال المنصة نفسها: لينكدإن نشر وAyrshare يقول
       تعثّر — انظر `unsureFailure`. وما قال إنه يُعاد يُمهَل ربع ساعة. */
    if (await this.seenOnPlatform(ctx, { now: true })) return { state: 'published' };
    const sent = Date.parse(ctx.sentAt || '');
    if (retryableFailure(raw) && Number.isFinite(sent) && Date.now() - sent < RETRY_GRACE_MS) return { state: 'pending' };
    return check;
  }

  /** وقتُ منشورٍ بالنصّ نفسه في سجلّ المنصة بعد `since` — أو `null`. */
  async findOnPlatform(ctx: { platform: string; text: string; since: string }): Promise<string | null> {
    const since = Date.parse(ctx.since);
    const head = normalizeHead(ctx.text);
    if (!Number.isFinite(since) || head.length < 10) return null;
    if (!AYRSHARE_HISTORY_PLATFORMS.has(ayrsharePlatform(ctx.platform))) return null;
    const page = await ayrsharePlatformHistory(
      { key: this.key, x: this.x, rate: this.rate }, ayrsharePlatform(ctx.platform), ctx.platform, { limit: 20 },
    );
    const hit = page.posts.find((p) => {
      const at = Date.parse(p.sentAt || '');
      return (!Number.isFinite(at) || at >= since - SEEN_CLOCK_SKEW_MS) && normalizeHead(p.title) === head;
    });
    return hit ? hit.sentAt || ctx.since : null;
  }

  /* ═══ «pending» يطول: يُسأل سجلّ المنصة نفسها ═══

     Ayrshare قد يُبقي حال المنشور «pending» بعد وصوله — رآه الفريق على
     لينكدإن والموعد «قيد النشر». فبعد خمس دقائق من الإرسال يُقرأ سجلّ
     المنصة (`/history/:platform`): منشورٌ بالنصّ نفسه بعد الإرسال هو هو.
     وما لا يُطابَق يبقى ينتظر حتى مهلة التأكيد كما كان. */
  private async seenOnPlatform(ctx: PublishStatusContext, opts: { now?: boolean } = {}): Promise<boolean> {
    const sent = Date.parse(ctx.sentAt || '');
    if (!Number.isFinite(sent) || (!opts.now && Date.now() - sent < SEEN_AFTER_MS)) return false;
    try {
      return (await this.findOnPlatform({ platform: ctx.platform, text: ctx.text, since: ctx.sentAt! })) !== null;
    } catch {
      return false; // يُسأل في الدورة التالية
    }
  }

  async deletePost(providerPostId: string): Promise<void> {
    // إنستغرام وتيك توك لا يحذفان المنشور عبر الواجهة — والحذف غير حرِج
    try { await this.call('DELETE', '/post', { id: providerPostId }); } catch { /* لا يُعطّل */ }
  }

  /* ═══ حذفُ المنشور من منصته ═══

     `DELETE /post` بمعرّف Ayrshare يحذفه من المنصة نفسها («Delete Post» في
     توثيقه) — إلا إنستغرام وتيك توك: لا يتيحان الحذف عبر الواجهة، فيُحذف من
     تطبيقهما ثم يُرسل `markManualDeleted` فيتحقّق Ayrshare أنه زال (382 إن
     بقي) ويكفّ عن تتبّعه. و383 «حُذف من قبل» نجاحٌ: الحذف يُعاد بلا ضرر،
     فنشرةٌ من نشرات سناب حُذفت قبل أن يتعثّر غيرها لا تُعيق الإعادة. */
  async deleteFromPlatform(providerPostId: string, opts: { platform: string; extraIds?: string[] }): Promise<void> {
    const ayr = ayrsharePlatform(opts.platform);
    const name = platformNames([opts.platform], this.labels);
    const manual = MANUAL_DELETE.has(ayr);
    const failed: string[] = [];
    for (const id of [providerPostId, ...(opts.extraIds || [])].filter(Boolean)) {
      try {
        const data = await this.call<any>('DELETE', '/post', manual ? { id, markManualDeleted: true } : { id });
        const block = data?.[ayr];
        if (String(block?.status || data?.status || '').toLowerCase() === 'error') {
          failed.push(String(block?.message || ayrshareErrors(data) || 'رفضت المنصة الحذف'));
        }
      } catch (err) {
        const codes = err instanceof AyrshareError ? errorCodes(err.body) : [];
        if (codes.includes(383)) continue;
        if (err instanceof AyrshareError && err.status === 403 && this.suspended) throw new Error(this.suspended);
        if (codes.includes(382)) throw new Error(`المنشور ما زال على ${name}. احذفه من تطبيقها أولاً ثم أعد الحذف هنا`);
        if (codes.includes(114)) throw new Error(`لا يعرف Ayrshare هذا المنشور. احذفه من تطبيق ${name}`);
        failed.push(String((err as Error)?.message || err));
      }
    }
    if (failed.length) throw new Error(`تعذّر حذف المنشور من ${name}: ${failed.join(' · ')}`);
  }

  /* ═══ الردّ والإشراف ═══

     بمعرّفات المنصة لا بمعرّفات Ayrshare: التعليق كُتب على المنصة لا عبره.
     وما لا تتيحه المنصة بمعرّفها يُقال بسببه قبل أيّ طلب. */

  private unsupported(what: string, platform: string): never {
    throw new Error(`${what} على ${platformNames([ayrshareAccountPlatform({ platform })], this.labels)} غير متاح عبر Ayrshare. افعله من تطبيق المنصة`);
  }

  async replyComment(_providerPostId: string, commentId: string, text: string, opts: { media?: PublishMedia } = {}): Promise<string> {
    const d = decodeAyrshareId(commentId);
    if (!d) throw new Error('عنصرٌ لا يُعرف مصدره في Ayrshare — حدّث الصندوق ثم أعد المحاولة');
    if (opts.media && d.type !== 'dm') throw new Error('المرفق يُرسل مع الرسالة الخاصة وحدها');

    if (d.type === 'review') {
      const res = await this.call<any>('POST', '/reviews', { platform: d.platform, reviewId: d.reviewId, reply: text });
      return String(res?.[d.platform]?.id ?? '');
    }
    if (d.type === 'dm') {
      if (!d.participantId) throw new Error('لا يُعرف المُراسِل في هذه المحادثة — حدّث الصندوق ثم أعد المحاولة');
      /* المرفق يُرفع كوسيط النشر ويُرسل رابطه (`mediaUrls` في «Send Message»):
         رابطٌ ينتهي بامتداد الملف بلا استعلام، كما تشترط فيسبوك وإنستغرام. وإكس
         يشترط نصّاً مع المرفق. */
      if (opts.media && d.platform === 'twitter' && !text.trim()) {
        throw new Error(`${platformNames(['x'], this.labels)} يشترط نصّاً مع المرفق. اكتب سطراً ثم أرسل`);
      }
      const body: Record<string, unknown> = { recipientId: d.participantId, message: text };
      if (opts.media) body.mediaUrls = [await this.uploadMedia(opts.media)];
      const res = await this.call<any>('POST', `/messages/${d.platform}`, body);
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
    case 'twitter': {
      put('impressions', 'impressionCount', at(o, 'publicMetrics.impressionCount', 'nonPublicMetrics.impressionCount', 'organicMetrics.impressionCount'));
      /* مشاهدات المقطع: في أرقام المنشور تحت `organicMetrics.video`، وفي السجلّ
         لكل وسيطٍ في `media[]` — فكانت مقاطع السجلّ بلا مشاهدات. */
      let mediaViews: number | null = null;
      for (const m of Array.isArray(o.media) ? o.media : []) {
        const v = at(m, 'publicMetrics.viewCount', 'organicMetrics.viewCount');
        if (v !== null) mediaViews = (mediaViews ?? 0) + v;
      }
      const videoViews = at(o, 'organicMetrics.video.viewCount');
      put('views', videoViews !== null ? 'video.viewCount' : 'media.viewCount', videoViews ?? mediaViews);
      put('likes', 'likeCount', at(o, 'publicMetrics.likeCount', 'organicMetrics.likeCount'));
      put('comments', 'replyCount', at(o, 'publicMetrics.replyCount', 'organicMetrics.replyCount'));
      put('retweets', 'retweetCount', at(o, 'publicMetrics.retweetCount', 'organicMetrics.retweetCount'));
      put('quotes', 'quoteCount', at(o, 'publicMetrics.quoteCount'));
      put('bookmarks', 'bookmarkCount', at(o, 'publicMetrics.bookmarkCount'));
      break;
    }
    case 'youtube':
      /* يوتيوب غيّر عدّ المشاهدة في ٢٤ أغسطس ٢٠٢٦: `views` من أوّل لقطة،
         و`engagedViews` بالطريقة القديمة. فالمشاهدات بتعريف يوتيوب اليوم، ومعها
         القديمة محفوظةً كي تُقارن الفترتان عبر ذلك اليوم. */
      put('views', 'views', at(o, 'views'));
      put('engagedviews', 'engagedViews', at(o, 'engagedViews'));
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
      // «storyFavorites» إعجابُ سناب — «Number of times the post has been liked»
      put('likes', 'storyFavorites', sum('storyFavorites'));
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

/**
 * ريتويتٌ في سجلّ إكس — `referencedTweets` نوعه `retweeted`، أو نصُّه «RT @…»
 * كما يكتبه إكس دائماً. والاقتباس ليس منه: نصُّه نصُّنا وأرقامُه أرقامنا.
 */
export function isRetweet(p: any): boolean {
  const refs: any[] = Array.isArray(p?.referencedTweets) ? p.referencedTweets : [];
  if (refs.some((r) => r?.type === 'retweeted')) return true;
  return /^RT @/.test(String(p?.post ?? p?.text ?? ''));
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

/** بادئة مؤشّرٍ نصنعه لفيسبوك: ما بعدها وقتٌ يُرسل في `until`. */
const UNTIL = 'until:';

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
  // مؤشّرنا لفيسبوك (`until:…`) — انظر آخر الدالة
  if (opts.next?.startsWith(UNTIL)) q.set('until', opts.next.slice(UNTIL.length));
  else if (opts.next) q.set('next', opts.next);
  // فيسبوك: ما نشرته الصفحة لا كلّ ما في خلاصتها من منشورات غيرها
  if (platform === 'facebook') q.set('pagePublished', 'true');
  /* ٤٠٠ مع `posts` ليس رفضاً: «When some of the data is not available from the
     social networks. All available data is still returned» — منشوراتٌ تعذّرت
     أرقامها (code 187) بين منشوراتٍ سليمة. وكان يُرمى كلُّه خطأً بلا سبب
     («خطأ من Ayrshare (400)»)، فلا يُكتب منشورٌ واحد من صفحةٍ أغلبُها سليم. */
  let data: any;
  try {
    data = await ayrshareCall<any>(auth, 'GET', `/history/${platform}?${q}`, undefined, opts.budget);
  } catch (err) {
    if (err instanceof AyrshareError && Array.isArray((err.body as any)?.posts)) data = err.body;
    else throw err;
  }
  const list: any[] = Array.isArray(data?.posts) ? data.posts : [];
  const posts: AyrshareHistoryPost[] = [];
  for (const p of list) {
    const id = String(p?.id ?? '');
    // منشورٌ يحمل خطأه (code 187) بلا معرّف لا يُكتب
    if (!id || p?.status === 'error') continue;
    // الريتويت ليس منشورنا: أرقامُه أرقامُ التغريدة الأصلية
    if (platform === 'twitter' && isRetweet(p)) continue;
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
  let next = pg?.hasMore && pg?.next ? String(pg.next) : null;
  /* فيسبوك بلا مؤشّر، فكان لا يُقرأ منه إلا أحدث صفحة — ومنشورات الصفحة قبلها لا
     تُكتشف فلا تُطلب تعليقاتها أبداً. وتوثيقه يقبل `until` (ما نُشر قبل وقتٍ أو
     فيه): فالصفحة الممتلئة يليها ما قبل أقدم منشورٍ فيها بثانية. وإن لم يتقدّم
     الوقت — Ayrshare تجاهل `until` — يقف، فلا تُعاد الصفحة نفسها بلا نهاية. */
  if (!next && platform === 'facebook' && list.length >= opts.limit) {
    const oldest = Math.min(...posts.map((p) => (p.sentAt ? Date.parse(p.sentAt) : Infinity)));
    const prev = opts.next?.startsWith(UNTIL) ? Date.parse(opts.next.slice(UNTIL.length)) : Infinity;
    if (Number.isFinite(oldest) && oldest - 1000 < prev) next = UNTIL + new Date(oldest - 1000).toISOString();
  }
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

/**
 * أرقام منشورٍ بمعرّف Ayrshare — لسناب: لا يُسأل بمعرّف المنصة
 * (`searchPlatformId` لا يشمله)، وسجلُّه بلا أرقام. فما نُشر عبر Ayrshare وحده
 * تُعرف أرقامه، منشوراً في الطلب. `null` = لم تُعلَن.
 */
export async function ayrshareAnalyticsByAyrId(
  auth: AyrshareAuth,
  ayrId: string,
  platform: string,
  budget?: CallBudget,
): Promise<ReturnType<typeof mapMetrics> | null> {
  const data = await ayrshareCall<any>(auth, 'POST', '/analytics/post', { id: ayrId, platforms: [platform] }, budget);
  const analytics = data?.[platform]?.analytics;
  if (!analytics || typeof analytics !== 'object') return null;
  const m = ayrshareMapped(platform, analytics);
  return m.present ? m : null;
}

/* ═══ أرقام الحساب: المتابعون والمراجعات ═══ */

/**
 * عدد المتابعين لكل حسابٍ من ردّ `/analytics/social` المجموع. والملف التجاري
 * لا متابعين له — مراجعاته من `/reviews` — فلا يُطلب له.
 */
export function ayrshareFollowers(accounts: AyrshareAccount[], data: any): { platform: string; followers: number | null }[] {
  return accounts.map((a) => {
    const p = ayrsharePlatform(a.platform);
    const an = data?.[p]?.analytics;
    const o = Array.isArray(an) ? an[0] : an;
    // تيك توك `followerCount` مفرداً، ويوتيوب `subscriberCount` نصّاً، وصفحة لينكدإن تحت `followers`
    const followers = at(o, 'followersCount', 'followerCount', 'followers.totalFollowerCount', 'subscriberCount', 'subscribers');
    return { platform: a.platform, followers };
  });
}

/* ═══ أرقام الحساب كاملةً — `POST /analytics/social` ═══

   كان يُقرأ منه عددُ المتابعين وحده ويُرمى الباقي. وفيه لكل منصةٍ أرقامُ
   الحساب نفسه لا منشوراته: مشاهداتُ محتواه ووصولُه وزياراتُ ملفّه والمتابعون
   الجدد ومن ألغى المتابعة ووقتُ المشاهدة والنقرُ إلى الموقع، وتوزيعُ الجمهور
   على البلد والعمر والجنس، وأداءُ الملف التجاري.

   وبطريقتين: مجموعاً بنوافذ تختلف من حقلٍ إلى حقل (مدى الحياة، ١٨٠ يوماً،
   ٩٠ يوماً…) لا تطابق فتراتنا، أو يوماً بيوم (`daily: true`) لفيسبوك
   والملف التجاري وإنستغرام وسناب وتيك توك ويوتيوب. فأرقام الفترة من اليومي
   تُجمع أيامُها التي في الفترة؛ والمجموعُ للّقطات وحدها — المتابعون وتوزيعهم
   اليوم. والأسماء من صفحة «Analytics on a Social Network» في توثيقه. */

/** نقطةٌ لمؤشرٍ في السجلّ — بشكل `MetricPoint` في `adapters/sources.ts`. */
export type AccountPoint = { metricKey: string; dimKey?: string; dimValue?: string; value: number };

/** نداءٌ واحد للمنصات كلّها — مجموعاً، أو يوماً بيوم بعدد الأرباع. */
export async function ayrshareSocialAnalytics(
  auth: AyrshareAuth,
  platforms: string[],
  opts: { daily?: boolean; quarters?: number } = {},
  budget?: CallBudget,
): Promise<any> {
  const body: Record<string, unknown> = { platforms };
  if (opts.daily) body.daily = true;
  if (opts.quarters) body.quarters = opts.quarters;
  return ayrshareCall<any>(auth, 'POST', '/analytics/social', body, budget);
}

/**
 * اليوم الذي تخصّه قيمةٌ يومية. ميتا تُعلن نهاية اليوم — منتصف الليل بتوقيت
 * المحيط الهادئ، `T07:00:00Z` — فالقيمة لليوم الذي قبله. وما سواها يُعلن اليوم
 * نفسه منتصفَ ليله بتوقيت غرينتش، `T00:00:00Z`.
 */
export function dailyDay(endTime: unknown): string | null {
  const t = Date.parse(String(endTime ?? ''));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  return new Date(midnight ? t : t - 86_400_000).toISOString().slice(0, 10);
}

/** قيم سلسلةٍ يومية `{period, values: [{value, endTime}]}` — `null` إن لم تكن سلسلة. */
export function dailySeries(v: any): { day: string; value: number }[] | null {
  if (!v || typeof v !== 'object' || !Array.isArray(v.values)) return null;
  const out: { day: string; value: number }[] = [];
  for (const it of v.values) {
    const day = dailyDay(it?.endTime);
    const value = num(it?.value);
    if (day && value !== null) out.push({ day, value });
  }
  return out;
}

/**
 * كم يوماً إلى الوراء يردّ Ayrshare يوماً بيوم. تيك توك ستون يوماً أبداً،
 * وسناب ربعٌ واحد، وربعُ فيسبوك ٨٥ يوماً وربعُ غيره تسعون.
 */
export function dailyWindowDays(platform: string, quarters: number): number {
  if (platform === 'tiktok') return 60;
  if (platform === 'snapchat') return 90;
  return (platform === 'facebook' ? 85 : 90) * quarters;
}

/** ما يُجمع من اليومي إلى مؤشرٍ في السجلّ — بأسماء Ayrshare، ومعامل الوحدة. */
const DAILY_POINTS: { platform: string; fields: string[]; metricKey: string; perPlatform: boolean; scale?: number }[] = [
  { platform: 'facebook', fields: ['pageMediaView'], metricKey: 'account_views', perPlatform: true },
  { platform: 'instagram', fields: ['reach'], metricKey: 'account_reach', perPlatform: true },
  { platform: 'youtube', fields: ['views'], metricKey: 'account_views', perPlatform: true },
  { platform: 'youtube', fields: ['subscribersGained'], metricKey: 'new_followers', perPlatform: true },
  { platform: 'youtube', fields: ['subscribersLost'], metricKey: 'unfollows', perPlatform: true },
  { platform: 'youtube', fields: ['estimatedMinutesWatched'], metricKey: 'watch_time', perPlatform: true },
  { platform: 'tiktok', fields: ['viewCountTotal'], metricKey: 'account_views', perPlatform: true },
  { platform: 'tiktok', fields: ['profileViews'], metricKey: 'profile_views', perPlatform: true },
  { platform: 'tiktok', fields: ['bioLinkClicks'], metricKey: 'profile_website_clicks', perPlatform: true },
  { platform: 'snapchat', fields: ['views'], metricKey: 'account_views', perPlatform: true },
  { platform: 'snapchat', fields: ['viewers'], metricKey: 'account_reach', perPlatform: true },
  { platform: 'snapchat', fields: ['profileViews'], metricKey: 'profile_views', perPlatform: true },
  { platform: 'snapchat', fields: ['subscribes'], metricKey: 'new_followers', perPlatform: true },
  { platform: 'snapchat', fields: ['unsubscribes'], metricKey: 'unfollows', perPlatform: true },
  // سناب يُعلن المدّة بالأجزاء من الألف من الثانية، والمؤشر بالدقائق
  { platform: 'snapchat', fields: ['viewTime'], metricKey: 'watch_time', perPlatform: true, scale: 1 / 60_000 },
  { platform: 'gmb', fields: ['websiteClicks'], metricKey: 'profile_website_clicks', perPlatform: true },
  /* الملف التجاري رقمٌ واحد لا موزَّع: الظهور الأربعة مؤشرٌ واحد كما يطلب الدليل
     «ظهور الملف التجاري» لا أربعةَ أرقامٍ يجمعها القارئ في رأسه. */
  {
    platform: 'gmb',
    fields: ['businessImpressionsDesktopMaps', 'businessImpressionsDesktopSearch', 'businessImpressionsMobileMaps', 'businessImpressionsMobileSearch'],
    metricKey: 'gbp_views',
    perPlatform: false,
  },
  { platform: 'gmb', fields: ['callClicks'], metricKey: 'gbp_calls', perPlatform: false },
  { platform: 'gmb', fields: ['businessDirectionRequests'], metricKey: 'gbp_directions', perPlatform: false },
];

/**
 * أرقام الفترة من الردّ اليومي لمنصةٍ واحدة. `analytics` كائنُها (وسناب
 * مصفوفةٌ تُجمع عناصرها)، و`internal` مفتاحها عندنا للبُعد.
 *
 * ولا يُكتب رقمٌ لفترةٍ لا تغطّي النافذةُ أوّلَها: رقمٌ ناقص يُقرأ هبوطاً.
 * وسلسلةٌ لم تُعلَن لا تُكتب صفراً؛ وأيامٌ بلا قيمة في سلسلةٍ معلنة صفرٌ صادق
 * — يوتيوب يُسقط اليوم الذي لا مشاهدة فيه.
 */
export function ayrshareDailyPoints(
  platform: string,
  internal: string,
  analytics: any,
  range: { start: string; end: string },
  windowStart: string,
): AccountPoint[] {
  if (windowStart > range.start) return [];
  const blocks: any[] = Array.isArray(analytics) ? analytics : analytics && typeof analytics === 'object' ? [analytics] : [];
  const out: AccountPoint[] = [];
  for (const spec of DAILY_POINTS) {
    if (spec.platform !== platform) continue;
    let total: number | null = null;
    for (const block of blocks) {
      for (const field of spec.fields) {
        const series = dailySeries(block?.[field]);
        if (!series) continue;
        total = (total ?? 0) + series.filter((v) => v.day >= range.start && v.day <= range.end).reduce((s, v) => s + v.value, 0);
      }
    }
    if (total === null) continue;
    const value = Math.round(total * (spec.scale ?? 1) * 100) / 100;
    out.push(spec.perPlatform ? { metricKey: spec.metricKey, dimKey: 'platform', dimValue: internal, value } : { metricKey: spec.metricKey, value });
  }
  return out;
}

/** الفئات العمرية بأوسعها المشترك: إنستغرام يفصل ٥٥–٦٤ و٦٥+، وتيك توك يجمعهما «55+». */
function ageBucket(age: string): string | null {
  const a = age.trim();
  if (/^(55-64|65\+|55\+)$/.test(a)) return '55+';
  return /^\d{2}-\d{2}$/.test(a) ? a : null;
}

function genderKey(g: string): string {
  const v = g.trim().toLowerCase();
  if (v === 'f' || v === 'female') return 'female';
  if (v === 'm' || v === 'male') return 'male';
  return 'unknown';
}

/**
 * توزيع المتابعين على البلد والعمر والجنس — لقطةُ اليوم من الردّ المجموع.
 * إنستغرام يُعلن أعداداً (`audienceCountry` و`audienceGenderAge` «F.25-34»)،
 * وتيك توك نسباً من متابعيه (`audienceCountries` و`audienceAges`
 * و`audienceGenders`) فتُضرب في عدد متابعيه. فيُجمع الاثنان أعداداً تُقارن.
 * وكلاهما لا يُعلن التوزيع لحسابٍ دون مئة متابع — فلا يُكتب شيء.
 */
export function ayrshareAudiencePoints(data: any): AccountPoint[] {
  const country = new Map<string, number>();
  const age = new Map<string, number>();
  const gender = new Map<string, number>();
  const add = (m: Map<string, number>, k: string | null, v: number) => {
    if (!k || !Number.isFinite(v) || v <= 0) return;
    m.set(k, (m.get(k) ?? 0) + v);
  };

  const ig = data?.instagram?.analytics;
  if (ig && typeof ig === 'object') {
    for (const [k, v] of Object.entries(ig.audienceCountry ?? {})) add(country, k.toUpperCase(), Number(v));
    for (const [k, v] of Object.entries(ig.audienceGenderAge ?? {})) {
      const [g, a] = k.split('.');
      add(gender, genderKey(g ?? ''), Number(v));
      add(age, ageBucket(a ?? ''), Number(v));
    }
  }

  const ttRaw = data?.tiktok?.analytics;
  const tt = Array.isArray(ttRaw) ? ttRaw[0] : ttRaw;
  const followers = at(tt, 'followerCount');
  if (tt && typeof tt === 'object' && followers) {
    const share = (p: unknown) => Math.round(Number(p) * followers);
    for (const r of Array.isArray(tt.audienceCountries) ? tt.audienceCountries : []) add(country, String(r?.country ?? '').toUpperCase() || null, share(r?.percentage));
    for (const r of Array.isArray(tt.audienceAges) ? tt.audienceAges : []) add(age, ageBucket(String(r?.age ?? '')), share(r?.percentage));
    for (const r of Array.isArray(tt.audienceGenders) ? tt.audienceGenders : []) add(gender, genderKey(String(r?.gender ?? '')), share(r?.percentage));
  }

  const out: AccountPoint[] = [];
  for (const [k, v] of country) if (/^[A-Z]{2}$/.test(k)) out.push({ metricKey: 'followers_country', dimKey: 'country', dimValue: k, value: v });
  for (const [k, v] of age) out.push({ metricKey: 'followers_age', dimKey: 'age_range', dimValue: k, value: v });
  for (const [k, v] of gender) out.push({ metricKey: 'followers_gender', dimKey: 'gender', dimValue: k, value: v });
  return out;
}

/**
 * المتابعون الجدد في لينكدإن الشخصي — `followersDaily` في الردّ المجموع،
 * ثلاثون يوماً بأيامها (`dateRange.start`). وصفحة لينكدإن لا يوميَّ لها.
 */
export function linkedInNewFollowers(analytics: any, range: { start: string; end: string }, today: string): number | null {
  const list: any[] = Array.isArray(analytics?.followersDaily) ? analytics.followersDaily : [];
  if (!list.length) return null;
  // ثلاثون يوماً إلى الوراء — فترةٌ أوّلُها أقدم لا يُكتب لها رقم ناقص
  const windowStart = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  if (windowStart > range.start) return null;
  let total = 0;
  for (const d of list) {
    const s = d?.dateRange?.start;
    const day = s?.year ? `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}` : '';
    const v = num(d?.memberFollowersCount);
    if (day >= range.start && day <= range.end && v !== null) total += v;
  }
  return total;
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
  /** السلسلة تحت التعليق — ردودُنا وردودُ غيرنا. غيابُها: لا سلسلة لهذا النوع. */
  thread?: ThreadEntry[];
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

/** ردٌّ في السلسلة من عنصر Ayrshare — إنستغرام يُعلن معرّف الردّ `id` لا `commentId`. */
function threadEntry(c: any, ownerKeys: string[]): ThreadEntry | null {
  const body = String(c?.comment ?? c?.text ?? '').trim();
  if (!body) return null;
  return {
    id: String(c?.commentId ?? c?.id ?? ''),
    author: authorOf(c),
    own: isOwnAyrshareComment(c, ownerKeys),
    body,
    at: isoOrNull(c?.created ?? c?.createTime),
  };
}

/** ما يتيحه Ayrshare على تعليقٍ كُتب على المنصة — بمعرّفه عليها. */
function commentCapabilities(platform: string, ownRoot = false): Record<string, boolean> {
  return {
    can_like: false,
    // تعليقُنا الذي ردّ عليه العملاء لا يُخفى ولا يُحذف من بطاقتهم
    can_hide: !ownRoot && platform === 'tiktok',
    can_delete: !ownRoot && (platform === 'facebook' || platform === 'instagram' || platform === 'youtube'),
    can_private_reply: false,
    // يوتيوب وثريدز لا يُردّ عليهما عبر Ayrshare إلا لما نُشر عبره — فيُردّ من التطبيق
    can_reply: REPLY_BY_SOCIAL_ID.has(platform),
  };
}

/** الردُّ الذي يجيب العميل بشكل العنصر — آخرُ ما كتبناه إن لم يكتب أحدٌ بعده. */
function answerOf(thread: ThreadEntry[]): { repliedBody: string | null; repliedAt: string | null } {
  const a = threadAnswer(thread);
  return { repliedBody: a?.body ?? null, repliedAt: a?.at ?? null };
}

/**
 * تعليقات منشورٍ من ردّ `GET /comments/:id` — عنصرٌ لكل تعليقٍ من عملائنا،
 * وتحته سلسلتُه كلّها: ردودُنا (من هنا أو من تطبيق المنصة) وردودُ غيرنا.
 *
 * وتعليقٌ كتبه حسابُنا على منشوره — رابطٌ في أول تعليق — كان يُترك بردوده،
 * فلا يُرى سؤالُ عميلٍ ردّ عليه. فإن ردّ عليه غيرُنا صار عنصراً: أوّلُ من ردّ
 * من العملاء كاتبُه، وما بعده سلسلتُه، والردُّ منه يقع تحت تعليقنا نفسه.
 *
 * وإكس لا يُعشّش الردود: المحادثة كلُّها قائمةٌ واحدة، فتُبنى شجرتها من
 * `referencedTweets` — انظر `mapXConversation`.
 */
export function mapAyrshareComments(platform: string, postId: string, data: any, ownerKeys: string[]): AyrshareInboxItem[] {
  const list: any[] = Array.isArray(data?.[platform]) ? data[platform] : [];
  const now = new Date().toISOString();
  if (platform === 'twitter') return mapXConversation(postId, list, ownerKeys, now);

  const out: AyrshareInboxItem[] = [];
  for (const c of list) {
    const commentId = String(c?.commentId ?? c?.id ?? '');
    const body = String(c?.comment ?? c?.text ?? '').trim();
    if (!commentId) continue;
    const urn = typeof c?.commentUrn === 'string' ? c.commentUrn : '';
    const replies: any[] = Array.isArray(c?.replies) ? c.replies : [];
    const thread = sortThread(replies.map((r) => threadEntry(r, ownerKeys)).filter((e): e is ThreadEntry => !!e));

    if (!isOwnAyrshareComment(c, ownerKeys)) {
      if (!body) continue;
      /* لينكدإن لا يُعشّش الردود: تُطلب لكل تعليقٍ بطلبه (`ayrshareLinkedInReplies`)،
         فقائمةٌ فارغةٌ هنا لا تعني أن لا ردود — ولا تمحو سلسلةً محفوظة. */
      const known = platform !== 'linkedin' || replies.length > 0;
      out.push({
        id: encodeAyrshareComment(platform, postId, commentId, urn),
        platform,
        kind: 'comment',
        authorName: authorOf(c),
        body,
        createdAt: isoOr(c?.created ?? c?.createTime, now),
        isHidden: c?.hidden === true,
        capabilities: commentCapabilities(platform),
        ...answerOf(thread),
        ...(known ? { thread } : {}),
      });
      continue;
    }

    // تعليقُنا: عنصرٌ إن ردّ عليه أحدٌ من عملائنا
    const first = thread.findIndex((e) => !e.own);
    if (first < 0) continue;
    const root = thread[first];
    const rest = thread.slice(first + 1);
    out.push({
      id: encodeAyrshareComment(platform, postId, commentId, urn),
      platform,
      kind: 'comment',
      authorName: root.author,
      body: root.body,
      createdAt: root.at ?? now,
      capabilities: commentCapabilities(platform, true),
      ...answerOf(rest),
      thread: rest,
    });
  }
  return out;
}

/**
 * محادثة إكس: قائمةٌ مسطّحة لكل التغريدات تحت المنشور، ولكلٍّ أبوها في
 * `referencedTweets` (`replied_to`). فالعنصر تغريدةٌ من عملائنا جذرُ فرعها —
 * أبوها المنشور نفسه، أو تغريدةٌ منّا من سلسلة المنشور — وما تحتها كلُّه
 * سلسلتُها: ردُّنا، وردُّ العميل على ردّنا، وردُّ غيره.
 *
 * وكان كل ما لم يكتبه حسابُنا عنصراً مستقلاً: ردُّ العميل على ردّنا يظهر
 * تعليقاً جديداً بلا سياق، وردُّنا على التعليق يُطابق بأبيه المباشر وحده.
 */
function mapXConversation(postId: string, list: any[], ownerKeys: string[], now: string): AyrshareInboxItem[] {
  const byId = new Map<string, any>();
  for (const c of list) {
    const id = String(c?.commentId ?? c?.id ?? '');
    if (id) byId.set(id, c);
  }
  const parentOf = (c: any): string => {
    const ref = (Array.isArray(c?.referencedTweets) ? c.referencedTweets : []).find((r: any) => r?.type === 'replied_to');
    return String(ref?.id ?? c?.parentId ?? '');
  };
  // تغريدةٌ منّا آباؤها كلُّهم منّا حتى المنشور: تكملةُ المنشور، لا ردٌّ في محادثة
  const chainMemo = new Map<string, boolean>();
  const ownChain = (id: string, depth = 0): boolean => {
    if (chainMemo.has(id)) return chainMemo.get(id)!;
    const c = byId.get(id);
    let v = false;
    if (c && isOwnAyrshareComment(c, ownerKeys)) {
      const p = parentOf(c);
      v = !p || !byId.has(p) || depth > 50 ? true : ownChain(p, depth + 1);
    }
    chainMemo.set(id, v);
    return v;
  };
  const rootOf = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 100; i++) {
      const p = parentOf(byId.get(cur));
      if (!p || !byId.has(p) || ownChain(p)) return cur;
      cur = p;
    }
    return cur;
  };

  const threads = new Map<string, ThreadEntry[]>();
  const roots: string[] = [];
  for (const [id, c] of byId) {
    const root = rootOf(id);
    if (root === id) {
      roots.push(id);
      continue;
    }
    const e = threadEntry(c, ownerKeys);
    if (e) threads.set(root, [...(threads.get(root) ?? []), e]);
  }

  const out: AyrshareInboxItem[] = [];
  for (const id of roots) {
    const c = byId.get(id);
    const body = String(c?.comment ?? c?.text ?? '').trim();
    if (!body || isOwnAyrshareComment(c, ownerKeys)) continue;
    const thread = sortThread(threads.get(id) ?? []);
    out.push({
      id: encodeAyrshareComment('twitter', postId, id),
      platform: 'twitter',
      kind: 'comment',
      authorName: authorOf(c),
      body,
      createdAt: isoOr(c?.created ?? c?.createTime, now),
      capabilities: commentCapabilities('twitter'),
      ...answerOf(thread),
      thread,
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

/* ═══ الرد التلقائي على الرسائل الخاصة ═══

   «Set/Get Auto Response»: رسالةٌ تُرسل لكل من يراسل الحساب على منصات الرسائل
   كلّها، ولا تتكرّر للمُراسِل نفسه قبل مدّتها. وبلا ضبطٍ يردّ `status` وحده. */
export type AutoResponse = { active: boolean; message: string; waitSeconds: number };

export const AUTO_RESPONSE_DEFAULT_WAIT = 86_400;

export async function ayrshareAutoResponse(auth: AyrshareAuth): Promise<AutoResponse> {
  const d = await ayrshareCall<any>(auth, 'GET', '/messages/autoresponse');
  const wait = Number(d?.autoResponseWaitSeconds);
  return {
    active: d?.autoResponseActive === true,
    message: typeof d?.autoResponseMessage === 'string' ? d.autoResponseMessage : '',
    waitSeconds: Number.isFinite(wait) && wait > 0 ? wait : AUTO_RESPONSE_DEFAULT_WAIT,
  };
}

export async function setAyrshareAutoResponse(auth: AyrshareAuth, r: AutoResponse): Promise<void> {
  await ayrshareCall(auth, 'POST', '/messages/autoresponse', {
    autoResponseActive: r.active,
    autoResponseMessage: r.message,
    autoResponseWaitSeconds: r.waitSeconds,
  });
}

/** رسالةٌ خاصة كما يردّها `GET /messages/:platform` — `action` اتجاهها. */
export type AyrshareMessage = {
  /** معرّفها على منصتها — به تُطابَق في سجلّ المحادثة. */
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  text: string;
  created: string | null;
  direction: 'in' | 'out';
  /** مرفقاتها بنوعها ورابطها كما تردّها المنصة (`attachments` في «Get Messages»). */
  attachments: { type: string; url: string }[];
};

/**
 * اسمُ المرفق حين تخلو الرسالة من نصّ — وكانت تُكتب «[image]» بنوعه الإنجليزي.
 * الأنواع من أمثلة «Get Messages» ومن منصات ميتا: image وvideo وaudio وfile.
 */
export function attachmentLabel(type: string): string {
  switch (String(type || '').toLowerCase()) {
    case 'image':
    case 'sticker':
      return 'صورة مرفقة';
    case 'video':
    case 'reel':
      return 'مقطع مرفق';
    case 'audio':
      return 'تسجيل صوتي';
    case 'file':
      return 'ملف مرفق';
    default:
      return 'مرفق';
  }
}

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
      const attachments = (Array.isArray(m.attachments) ? m.attachments : [])
        .filter((a: any) => typeof a?.url === 'string' && /^https:\/\//.test(a.url))
        .map((a: any) => ({ type: String(a.type || ''), url: String(a.url) }));
      out.push({
        id: String(m.id ?? ''),
        conversationId: String(m.conversationId),
        senderId: String(m.senderId ?? ''),
        recipientId: String(m.recipientId ?? ''),
        senderName: String(m.senderDetails?.name || m.senderDetails?.username || ''),
        text: String(m.message ?? '').trim() || (attachments.length ? attachmentLabel(attachments[0].type) : ''),
        created: isoOrNull(m.created),
        direction: m.action === 'sent' ? 'out' : 'in',
        attachments,
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

/** الأحداث التي تُسجَّل: التعليقات والرسائل للصندوق، والمجدول لحال تيك توك،
    وإلغاءُ ربط الحسابات وتعطيلُ حساب النشر لتنبيه الفريق (`services/ayrshareAlerts.ts`). */
export const AYRSHARE_WEBHOOK_ACTIONS = ['comments', 'messages', 'scheduled', 'social', 'suspended'] as const;

export async function registerAyrshareWebhook(auth: AyrshareAuth, action: string, url: string, secret: string): Promise<void> {
  await ayrshareCall(auth, 'POST', '/hook/webhook', { action, url, secret });
}

export async function deleteAyrshareWebhook(auth: AyrshareAuth, action: string): Promise<void> {
  await ayrshareCall(auth, 'DELETE', '/hook/webhook', { action });
}

/* ═══ مقاطع يوتيوب من القناة نفسها ═══

   سجلُّ يوتيوب في Ayrshare لا يردّ المقاطع القصيرة (Shorts): قناةٌ فيها عشرات
   المقاطع ردّ منها مقطعين. وأرقامُه بمعرّف المقطع تعمل لكل مقطع. فالمعرّفات من
   قائمة القناة العامة في يوتيوب نفسه — `feeds/videos.xml` بلا مفتاح، وفيها
   أحدث خمسة عشر مقطعاً قصيرها وطويلها — والأرقام من Ayrshare كغيرها. */

export type YouTubeFeedVideo = { id: string; title: string; published: string | null; url: string };

/** يخرّط قائمة القناة (Atom) — المعرّف والعنوان والتاريخ والرابط. */
export function parseYouTubeFeed(xml: string): YouTubeFeedVideo[] {
  const out: YouTubeFeedVideo[] = [];
  const decode = (t: string) =>
    t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1]?.trim();
    if (!id) continue;
    const title = decode(/<title>([^<]*)<\/title>/.exec(entry)?.[1] ?? '').trim();
    const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1] ?? null;
    const href = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(entry)?.[1] ?? `https://www.youtube.com/watch?v=${id}`;
    out.push({ id, title, published: isoOrNull(published), url: decode(href) });
  }
  return out;
}

export async function youtubeChannelVideos(channelId: string, budget?: CallBudget): Promise<YouTubeFeedVideo[]> {
  budget?.spend();
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  if (!res.ok) throw new Error(`تعذّرت قراءة قائمة قناة يوتيوب (${res.status})`);
  return parseYouTubeFeed(await res.text());
}

/* ═══ ردود لينكدإن ═══

   لينكدإن لا يُعشّش الردود في التعليق: «Fetch with GET /comments/<commentId>
   ?commentId=true&searchPlatformId=true&platform=linkedin». فكان ردُّنا من تطبيق
   لينكدإن لا يُرى أبداً — قائمة الردود في التعليق فارغةٌ دائماً. وشكلُ الردّ غير
   موثّق كاملاً، فيُقرأ تسامحاً: الردود في القائمة أو في `replies` من كلٍّ منها،
   سوى التعليق نفسه. */
export async function ayrshareLinkedInReplies(
  auth: AyrshareAuth,
  commentId: string,
  ownerKeys: string[],
  budget?: CallBudget,
): Promise<ThreadEntry[]> {
  const q = new URLSearchParams({ commentId: 'true', searchPlatformId: 'true', platform: 'linkedin' });
  const data = await ayrshareCall<any>(auth, 'GET', `/comments/${encodeURIComponent(commentId)}?${q}`, undefined, budget);
  const block = data?.linkedin;
  const list: any[] = Array.isArray(block) ? block : block && typeof block === 'object' ? [block] : [];
  const all = list.flatMap((c) => [c, ...(Array.isArray(c?.replies) ? c.replies : [])]);
  const seen = new Set<string>();
  const entries: ThreadEntry[] = [];
  for (const c of all) {
    const id = String(c?.commentId ?? c?.commentUrn ?? '');
    // التعليق نفسه يعود أوّلَ القائمة — والردّ لا يُكتب مرّتين إن عاد في `replies` أيضاً
    if (id === commentId || String(c?.commentUrn ?? '') === commentId || (id && seen.has(id))) continue;
    if (id) seen.add(id);
    const e = threadEntry(c, ownerKeys);
    if (e) entries.push(e);
  }
  return sortThread(entries);
}

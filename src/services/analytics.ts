import type { Env } from '../types';
import { getProvider, providerKey } from '../adapters';
import { listSentPostMetrics } from '../adapters/buffer';
import {
  BudgetExhausted, CallBudget, fetchPostMetrics, getExportVideos, isUnsupported, listAccountPosts,
  listSocialApiAccountsDetailed, listSocialApiPostsPaged, mapMetrics, syncYouTubePosts,
  type AccountPost, type SocialApiAccount,
} from '../adapters/socialapi';
import { newId, nowIso } from '../util';

/* ============================================================
   سحب لقطات المنشورات — ومنها تُحتسب الطبقتان الأولى والثانية.

   ═══ ما كان يقع ═══

   ١) `/posts` في SocialAPI قراءةٌ من قاعدته لا من المنصّات: فيه ما نُشر
      عبره وحده، بالأرقام التي حُفظت آخر مرّة. والأرقام الحيّة لا تأتي إلا من
      `/posts/{id}/metrics` — ولم يكن يُنادى إطلاقاً، فبقي كل منشورٍ على
      أرقام لحظة نشره: أصفار.
   ٢) ما نُشر من تطبيق المنصّة مباشرةً لم يكن يُقرأ أصلاً — وهو عند فريقٍ
      يردّ على التعليقات من هناك كثيرُ المحتوى لا قليله.
   ٣) غيابُ الأرقام كان يُكتب صفراً، ويُمحى به رقمٌ صحيح سبقه.
   ٤) كل سحبٍ كان يحذف لقطات ما لم يُنشر عبر المنصة ثم يعيد كتابة ما في
      صفحته الأولى وحدها: فيختفي ما خرج من الصفحة، وتتناقص أرقام الشهر
      المنصرم يوماً بعد يوم.

   ═══ وما يقع الآن ═══

   السحب بميزانيةٍ معلومة من النداءات. يقرأ ما نُشر عبر المزوّد صفحاتٍ،
   وسجلَّ كل حسابٍ على منصّته، ويطلب الأرقام الحيّة لمنشورات الأسابيع
   الأخيرة بدءاً بأقدمها تحديثاً. ولا يُمحى رقمٌ بغياب، ولا تُحذف لقطةٌ لأنها
   خرجت من صفحةٍ قُرئت.
   ============================================================ */

type MetricRow = {
  providerPostId: string;
  platform: string;
  title: string | null;
  postId: string | null;
  viaPlatform: number;
  /** `null` = لم يُعلنه المزوّد. */
  reach: number | null;
  impressions: number | null;
  engagement: number | null;
  sentAt: string | null;
  metricsJson: string | null; // كل المقاييس الخام (JSON) — لعرض ديناميكي لكل منصة
  externalUrl: string | null; // رابط المنشور على منصته
  source?: string | null; // 'posts' | 'account' | 'export' | null
  providerUuid?: string | null; // معرّف المنشور عند SocialAPI — به تُطلب أرقامه الحيّة
  /** وقت الأرقام إن حملها الصفّ — وإلا فلا أرقام فيه تُكتب. */
  metricsAt: string | null;
};

/**
 * يكتب لقطة منشور (مفتاحها `provider_post_id`).
 *
 * والأرقام تُكتب حين تحملها اللقطة وحدها: صفٌّ بلا أرقام يُحدّث العنوان
 * والرابط والتاريخ ولا يمسّ ما قيس قبله. وكان كل سحبٍ يكتب ما وصله كيفما
 * وصل، فيمحو ردٌّ فارغٌ رقماً صحيحاً سبقه.
 */
function upsertStmt(env: Env, row: MetricRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO analytics_snapshots
       (id, provider_post_id, platform, title, post_id, via_platform, reach, impressions, engagement, sent_at,
        metrics_json, external_url, source, provider_uuid, metrics_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_post_id) DO UPDATE SET
       platform = excluded.platform,
       title = COALESCE(excluded.title, analytics_snapshots.title),
       post_id = COALESCE(excluded.post_id, analytics_snapshots.post_id),
       via_platform = MAX(excluded.via_platform, analytics_snapshots.via_platform),
       sent_at = COALESCE(excluded.sent_at, analytics_snapshots.sent_at),
       external_url = COALESCE(excluded.external_url, analytics_snapshots.external_url),
       source = COALESCE(analytics_snapshots.source, excluded.source),
       provider_uuid = COALESCE(excluded.provider_uuid, analytics_snapshots.provider_uuid),
       -- لقطةٌ بلا أرقام لا تمسّ ما قيس قبلها، ومقياسٌ لم يُعلَن هذه المرّة يبقى على آخر ما أُعلن
       reach = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.reach ELSE COALESCE(excluded.reach, analytics_snapshots.reach) END,
       impressions = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.impressions ELSE COALESCE(excluded.impressions, analytics_snapshots.impressions) END,
       engagement = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.engagement ELSE COALESCE(excluded.engagement, analytics_snapshots.engagement) END,
       metrics_json = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.metrics_json ELSE excluded.metrics_json END,
       metrics_at = COALESCE(excluded.metrics_at, analytics_snapshots.metrics_at),
       captured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  )
    .bind(
      newId('an'), row.providerPostId, row.platform, row.title, row.postId, row.viaPlatform,
      // بلا أرقام: غيابٌ يُكتب `NULL` لا صفراً — ولو أعاد المحوّل أصفاره
      row.metricsAt ? row.reach : null, row.metricsAt ? row.impressions : null, row.metricsAt ? row.engagement : null,
      row.sentAt, row.metricsAt ? row.metricsJson : null, row.externalUrl, row.source ?? null, row.providerUuid ?? null, row.metricsAt,
    );
}

async function upsertMetric(env: Env, row: MetricRow): Promise<void> {
  await upsertStmt(env, row).run();
}

/* الكتابة دفعاتٍ لا صفّاً صفّاً: للاستدعاء حدٌّ من العمليات على القاعدة
   (ألفٌ في الخطة المجانية)، وثلاثمئة منشورٍ بعبارةٍ لكلٍّ تقترب منه. */
async function runBatch(env: Env, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

// مقاييس مُصطنعة للمزوّدين الذين يعيدون reach/impressions/engagement فقط (Mock/Ayrshare)
function synthMetrics(reach: number, impressions: number, engagement: number): string {
  return JSON.stringify([
    { type: 'reach', name: 'الوصول', value: reach, unit: 'count' },
    { type: 'impressions', name: 'الانطباعات', value: impressions, unit: 'count' },
    { type: 'engagement', name: 'التفاعل', value: engagement, unit: 'count' },
  ]);
}

/* ─── تقرير السحب ─── */

/** تقرير السحب الأخير — يُحفظ في الإعدادات ويُعرض في «مصادر الأرقام». */
export type AnalyticsSyncReport = {
  at: string;
  provider: string;
  ok: boolean;
  /** لم يقف عند حدّ ميزانيته. */
  complete: boolean;
  calls: number;
  budget: number;
  /** وجهاتٌ قُرئت من منشورات المزوّد. */
  posts: number;
  /** منشوراتٌ قُرئت من سجلّ الحسابات على منصّاتها. */
  accountPosts: number;
  /** منها ما لم يكن معروفاً — نُشر من خارج المنصة. */
  newNative: number;
  /** منشوراتٌ طُلبت أرقامها الحيّة في هذا السحب. */
  refreshed: number;
  errors: string[];
  lastOkAt: string | null;
};

const REPORT_KEY = 'analytics_sync_report';

export const ANALYTICS_BUDGET = { cron: 40, manual: 45 } as const;

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run();
}

export async function readAnalyticsReport(env: Env): Promise<AnalyticsSyncReport | null> {
  const raw = await getSetting(env, REPORT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnalyticsSyncReport;
  } catch {
    return null;
  }
}

function errorText(err: unknown): string {
  return String((err as Error)?.message || err).slice(0, 240);
}

// سحب التحليلات دورياً — يختار المسار حسب المزوّد، ويعود بعدد اللقطات ويحفظ تقريره.
export async function pullAnalytics(env: Env, opts: { budget?: number } = {}): Promise<number> {
  const providerName = ((await getSetting(env, 'provider_name')) || env.PROVIDER_NAME || 'mock').toLowerCase();
  const prev = await readAnalyticsReport(env);
  const report: AnalyticsSyncReport = {
    at: nowIso(),
    provider: providerName,
    ok: true,
    complete: true,
    calls: 0,
    budget: opts.budget ?? ANALYTICS_BUDGET.cron,
    posts: 0,
    accountPosts: 0,
    newNative: 0,
    refreshed: 0,
    errors: [],
    lastOkAt: prev?.lastOkAt ?? null,
  };

  let captured = 0;
  try {
    if (providerName === 'buffer') captured = await pullAllBuffer(env);
    else if (providerName === 'socialapi') captured = await pullAllSocialApi(env, report);
    else captured = await pullViaSchedules(env);
  } catch (err) {
    report.errors.push(errorText(err));
  }

  report.ok = report.errors.length === 0;
  if (report.ok) report.lastOkAt = report.at;
  await setSetting(env, REPORT_KEY, JSON.stringify(report));
  if (!report.ok && !captured) throw new Error(report.errors[0]);
  return captured;
}

// مزوّدون يعتمدون getAnalytics لكل منشور نُشر عبر المنصة (Mock/Ayrshare)
async function pullViaSchedules(env: Env): Promise<number> {
  const provider = await getProvider(env);
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.post_id, s.platform, s.provider_post_id, s.published_at, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.status = 'published' AND s.provider_post_id IS NOT NULL`,
  ).all<{ post_id: string; platform: string; provider_post_id: string; published_at: string | null; title: string }>();

  let captured = 0;
  for (const row of results) {
    try {
      const a = await provider.getAnalytics(row.provider_post_id);
      await upsertMetric(env, {
        providerPostId: row.provider_post_id,
        platform: row.platform,
        title: row.title,
        postId: row.post_id,
        viaPlatform: 1,
        reach: a.reach,
        impressions: a.impressions,
        engagement: a.engagement,
        sentAt: row.published_at,
        metricsJson: synthMetrics(a.reach, a.impressions, a.engagement),
        externalUrl: null,
        metricsAt: nowIso(),
      });
      captured++;
    } catch {
      continue;
    }
  }
  return captured;
}

// Buffer: يسحب مقاييس كل المنشورات المُرسَلة في المؤسسة (لا فقط ما نُشر عبر المنصة)
async function pullAllBuffer(env: Env): Promise<number> {
  const token = providerKey(env, 'buffer');
  if (!token) return 0;

  // خريطة عكسية: معرّف قناة Buffer → مفتاح منصة المنصة
  const bpRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'buffer_profiles'").first<{ value: string }>();
  const channelToPlatform: Record<string, string> = {};
  try {
    const map = bpRow?.value ? JSON.parse(bpRow.value) : {};
    for (const [platform, channelId] of Object.entries(map)) {
      if (channelId) channelToPlatform[String(channelId)] = platform;
    }
  } catch { /* خريطة فارغة */ }

  const schedMap = await scheduleIndex(env);

  const posts = await listSentPostMetrics(token);
  let captured = 0;
  for (const post of posts) {
    const via = schedMap.get(post.id);
    const reported = Array.isArray(post.metrics) && post.metrics.length > 0;
    await upsertMetric(env, {
      providerPostId: post.id,
      platform: channelToPlatform[post.channelId] || post.service || 'unknown',
      title: via?.title || post.title || null,
      postId: via?.postId || null,
      viaPlatform: via ? 1 : 0,
      reach: post.reach,
      impressions: post.impressions,
      engagement: post.engagement,
      sentAt: post.sentAt,
      metricsJson: JSON.stringify(post.metrics || []),
      externalUrl: post.externalUrl || null,
      // Buffer بلا مقاييس للمنشور: غيابٌ لا أصفار
      metricsAt: reported ? nowIso() : null,
    });
    captured++;
  }
  return captured;
}

/** ما نُشر عبر المنصة: provider_post_id → {post_id, title} */
async function scheduleIndex(env: Env): Promise<Map<string, { postId: string; title: string }>> {
  const sched = await env.DB.prepare(
    `SELECT s.provider_post_id, s.post_id, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.provider_post_id IS NOT NULL`,
  ).all<{ provider_post_id: string; post_id: string; title: string }>();
  const out = new Map<string, { postId: string; title: string }>();
  for (const r of sched.results) out.set(r.provider_post_id, { postId: r.post_id, title: r.title });
  return out;
}

type Snapshot = {
  id: string;
  provider_post_id: string;
  platform: string;
  title: string | null;
  sent_at: string | null;
  external_url: string | null;
  reach: number | null;
  impressions: number | null;
  engagement: number | null;
  metrics_at: string | null;
  provider_uuid: string | null;
};

const SNAP_COLUMNS = 'id, provider_post_id, platform, title, sent_at, external_url, reach, impressions, engagement, metrics_at, provider_uuid';

async function snapshotsByKeys(env: Env, keys: string[]): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  const unique = [...new Set(keys.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT ${SNAP_COLUMNS} FROM analytics_snapshots WHERE provider_post_id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<Snapshot>();
    for (const r of results) out.set(r.provider_post_id, r);
  }
  return out;
}

/**
 * أتُؤخذ أرقام `/posts` المحفوظة؟ هي أقدمُ ما يصلنا: تُملأ بها لقطةٌ بلا أرقام،
 * ولا تمحو رقماً أحدث منها — وإلا تقلّبت اللوحة بين الحيّ والمحفوظ مع كل سحب.
 * وتُقبل إن أعلن المزوّد أنها أحدث، أو إن لم تنقص عمّا عندنا — التفاعل
 * والظهور يزيدان مع الوقت ولا ينقصان.
 */
export function acceptStored(existing: Snapshot | undefined, incoming: { hasMetrics: boolean; metricsSyncedAt: string | null; reach: number | null; impressions: number | null; engagement: number | null }): boolean {
  if (!incoming.hasMetrics) return false;
  if (!existing || !existing.metrics_at) return true;
  if (incoming.metricsSyncedAt) return incoming.metricsSyncedAt > existing.metrics_at;
  const notLower = (a: number | null, b: number | null) => b === null || (a !== null && a >= b);
  return notLower(incoming.reach, existing.reach) && notLower(incoming.impressions, existing.impressions) && notLower(incoming.engagement, existing.engagement);
}

/** عنوانٌ موحَّد للمطابقة: بلا مسافاتٍ ولا تشكيل، وأوّله وحده. */
function titleKey(t: string | null | undefined): string {
  return String(t ?? '').replace(/[ً-ْ\s]+/g, '').slice(0, 30).toLowerCase();
}

/**
 * يطابق منشوراً من سجلّ الحساب على لقطةٍ قائمة — بالمعرّف، ثم بالرابط، ثم
 * بوقت النشر (عشر دقائق) مع أوّل العنوان. فالمنشور الذي نُشر عبر المزوّد
 * يظهر في السجلّ بمعرّفٍ قد يختلف (لينكدإن وتيك توك)، ولا يُعدّ مرّتين.
 */
export function matchSnapshot(h: AccountPost, platform: string, candidates: Snapshot[]): Snapshot | null {
  const exact = candidates.find((c) => c.provider_post_id === h.id);
  if (exact) return exact;
  if (h.externalUrl) {
    const byUrl = candidates.find((c) => c.platform === platform && c.external_url && c.external_url === h.externalUrl);
    if (byUrl) return byUrl;
  }
  if (!h.sentAt) return null;
  const t = Date.parse(h.sentAt);
  const near = candidates.filter((c) => {
    if (c.platform !== platform || !c.sent_at) return false;
    if (Math.abs(Date.parse(c.sent_at) - t) > 10 * 60_000) return false;
    const a = titleKey(c.title);
    const b = titleKey(h.title);
    return !a || !b || a === b;
  });
  return near.length === 1 ? near[0] : null;
}

// SocialAPI: ما نُشر عبره، وسجلّ كل حساب، والأرقام الحيّة — بميزانية.
async function pullAllSocialApi(env: Env, report: AnalyticsSyncReport): Promise<number> {
  const token = providerKey(env, 'socialapi');
  if (!token) {
    report.errors.push('مفتاح SocialAPI غير مضبوط. اضبط SOCIALAPI_API_KEY.');
    return 0;
  }
  const budget = new CallBudget(report.budget);
  const stop = (err: unknown) => {
    if (err instanceof BudgetExhausted) report.complete = false;
    else report.errors.push(errorText(err));
  };

  // خريطة عكسية: معرّف حساب SocialAPI → مفتاح منصة المنصة
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'socialapi_profiles'").first<{ value: string }>();
  const accountToPlatform: Record<string, string> = {};
  try {
    const map = row?.value ? JSON.parse(row.value) : {};
    for (const [platform, accId] of Object.entries(map)) {
      if (accId) accountToPlatform[String(accId)] = platform;
    }
  } catch { /* خريطة فارغة */ }
  const platformOf = (accountId: string, fallback: string) => accountToPlatform[accountId] || fallback || 'unknown';

  const schedMap = await scheduleIndex(env);
  let captured = 0;

  // ١) الحسابات — لسجلّ كلٍّ منها، ولمزامنة يوتيوب
  let accounts: SocialApiAccount[] = [];
  try {
    accounts = await listSocialApiAccountsDetailed(token, budget);
  } catch (err) {
    stop(err);
  }

  /* مزامنة يوتيوب القسرية مرّةً في اليوم لا في كل سحب: تطلب من المزوّد أن
     يقرأ القناة من جديد، ونداؤها كل ساعة يأكل حصّة السحب ولا يزيد شيئاً. */
  const ytLast = await getSetting(env, 'youtube_sync_at');
  if (accounts.some((a) => a.platform === 'youtube') && (!ytLast || Date.now() - Date.parse(ytLast) > 20 * 3_600_000)) {
    await syncYouTubePosts(token, accounts, budget);
    await setSetting(env, 'youtube_sync_at', nowIso());
  }

  // ٢) ما نُشر عبر المزوّد — صفحاتٍ لا صفحة
  try {
    const { posts, exhausted } = await listSocialApiPostsPaged(token, { budget, maxPages: report.budget >= ANALYTICS_BUDGET.manual ? 5 : 3 });
    if (exhausted) report.complete = false;
    // والصفوف المؤقّتة «منشور:منصّة» معها — تُطوى إن وُجدت لا في كل مرّة
    const existing = await snapshotsByKeys(env, posts.flatMap((p) => [p.id, `${p.postUuid}:${p.platform}`]));
    const writes: D1PreparedStatement[] = [];
    for (const post of posts) {
      // الربط بجدول النشر عبر معرّف المنشور الداخلي (postUuid) أو معرّف المنصة
      const via = schedMap.get(post.postUuid) || schedMap.get(post.id);
      const take = acceptStored(existing.get(post.id), post);
      writes.push(upsertStmt(env, {
        providerPostId: post.id,
        platform: platformOf(post.accountId, post.platform),
        title: via?.title || post.title || null,
        postId: via?.postId || null,
        viaPlatform: via ? 1 : 0,
        reach: post.reach,
        impressions: post.impressions,
        engagement: post.engagement,
        sentAt: post.sentAt,
        metricsJson: JSON.stringify(post.metrics || []),
        externalUrl: post.externalUrl || null,
        source: 'posts',
        providerUuid: post.postUuid || null,
        metricsAt: take ? post.metricsSyncedAt ?? nowIso() : null,
      }));
      // وجهةٌ حُفظت قبل أن يُعرف معرّفها على المنصة — صفُّها المؤقّت يُطوى
      const placeholder = `${post.postUuid}:${post.platform}`;
      if (post.postUuid && post.id !== placeholder && existing.has(placeholder)) {
        writes.push(env.DB.prepare('DELETE FROM analytics_snapshots WHERE provider_post_id = ? AND post_id IS NULL').bind(placeholder));
      }
      captured++;
    }
    await runBatch(env, writes);
    report.posts = posts.length;
  } catch (err) {
    stop(err);
  }

  // ٣) سجلّ كل حساب على منصّته — ومنه ما نُشر من خارج المنصة
  const withHistory = accounts.filter((a) => !/google|trustpilot/.test(a.platform));
  for (const acc of withHistory) {
    // تُترك للأرقام الحيّة حصّتها
    if (budget.left <= 6) {
      report.complete = false;
      break;
    }
    let items: AccountPost[] = [];
    try {
      items = await listAccountPosts(token, acc, budget);
    } catch (err) {
      if (isUnsupported(err)) continue;
      stop(err);
      if (err instanceof BudgetExhausted) break;
      continue;
    }
    if (!items.length) continue;
    report.accountPosts += items.length;

    const platform = platformOf(acc.id, acc.platform);
    const oldest = items.reduce((m, h) => (h.sentAt && (!m || h.sentAt < m) ? h.sentAt : m), '' as string);
    const { results: candidates } = await env.DB.prepare(
      `SELECT ${SNAP_COLUMNS} FROM analytics_snapshots WHERE platform = ? AND (sent_at IS NULL OR sent_at >= ?)`,
    )
      .bind(platform, oldest ? new Date(Date.parse(oldest) - 86_400_000).toISOString() : '1970-01-01T00:00:00Z')
      .all<Snapshot>();

    const writes: D1PreparedStatement[] = [];
    for (const h of items) {
      const match = matchSnapshot(h, platform, candidates);
      const via = schedMap.get(h.id);
      const metricsAt = h.metrics.present ? h.metrics.syncedAt ?? nowIso() : null;
      writes.push(upsertStmt(env, {
        providerPostId: match?.provider_post_id ?? h.id,
        platform,
        title: match?.title || via?.title || h.title || null,
        postId: via?.postId || null,
        viaPlatform: via ? 1 : 0,
        reach: h.metrics.reach,
        impressions: h.metrics.impressions,
        engagement: h.metrics.engagement,
        sentAt: h.sentAt,
        metricsJson: JSON.stringify(h.metrics.raw),
        externalUrl: h.externalUrl,
        source: 'account',
        metricsAt,
      }));
      if (!match) {
        report.newNative++;
        // يُضاف إلى المرشّحين كي لا يُطابَق منشورٌ ثانٍ في الصفحة نفسها عليه
        candidates.push({
          id: '', provider_post_id: h.id, platform, title: h.title, sent_at: h.sentAt, external_url: h.externalUrl,
          reach: h.metrics.reach, impressions: h.metrics.impressions, engagement: h.metrics.engagement, metrics_at: metricsAt, provider_uuid: null,
        });
      }
      captured++;
    }
    await runBatch(env, writes);
  }

  // ٤) الأرقام الحيّة — منشورات الأسابيع الستّة الأخيرة، أقدمُها تحديثاً أوّلاً
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const staleBefore = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const { results: due } = await env.DB.prepare(
    `SELECT provider_uuid, MIN(COALESCE(metrics_at, '')) AS oldest
     FROM analytics_snapshots
     WHERE provider_uuid IS NOT NULL AND provider_uuid <> '' AND sent_at >= ?
     GROUP BY provider_uuid
     HAVING oldest < ?
     ORDER BY oldest ASC
     LIMIT 60`,
  )
    .bind(since, staleBefore)
    .all<{ provider_uuid: string }>();

  for (const { provider_uuid: uuid } of due) {
    if (budget.left <= 0) {
      report.complete = false;
      break;
    }
    let entries;
    try {
      entries = await fetchPostMetrics(token, uuid, budget);
    } catch (err) {
      if (isUnsupported(err)) continue;
      stop(err);
      if (err instanceof BudgetExhausted) break;
      continue;
    }
    const { results: rows } = await env.DB.prepare(
      `SELECT ${SNAP_COLUMNS} FROM analytics_snapshots WHERE provider_uuid = ?`,
    )
      .bind(uuid)
      .all<Snapshot>();
    const writes: D1PreparedStatement[] = [];
    for (const e of entries) {
      if (!e.metrics.present) continue;
      const target =
        rows.find((r) => e.platformPostId && r.provider_post_id === e.platformPostId) ??
        rows.find((r) => e.accountId && r.platform === platformOf(e.accountId, e.platform)) ??
        rows.find((r) => e.platform && r.platform === e.platform) ??
        (rows.length === 1 ? rows[0] : undefined);
      if (!target) continue;
      writes.push(env.DB.prepare(
        `UPDATE analytics_snapshots
         SET reach = COALESCE(?, reach), impressions = COALESCE(?, impressions), engagement = COALESCE(?, engagement),
             metrics_json = ?, metrics_at = ?, captured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?`,
      )
        .bind(e.metrics.reach, e.metrics.impressions, e.metrics.engagement, JSON.stringify(e.metrics.raw), e.metrics.syncedAt ?? nowIso(), target.id));
    }
    await runBatch(env, writes);
    report.refreshed++;
  }

  report.calls = budget.used;
  return captured;
}

// يستورد فيديوهات تصدير مكتمل إلى لقطات التحليلات (source='export')، فتظهر في اللوحة وتبقى.
export async function ingestExportVideos(env: Env, exportId: string): Promise<number> {
  const token = providerKey(env, 'socialapi');
  if (!token) return 0;
  const videos = await getExportVideos(token, exportId);
  let n = 0;
  for (const v of videos) {
    const id = String(v.platform_post_id || v.platform_id || v.video_id || v.id || '');
    if (!id) continue;
    const m = mapMetrics(v.metrics || v);
    await upsertMetric(env, {
      providerPostId: id,
      platform: String(v.platform || 'youtube'),
      title: String(v.title || v.caption || '').slice(0, 140) || null,
      postId: null,
      viaPlatform: 0,
      reach: m.reach,
      impressions: m.impressions,
      engagement: m.engagement,
      sentAt: v.published_at || v.created_at || null,
      metricsJson: JSON.stringify(m.raw),
      externalUrl: v.url || v.permalink || v.link || null,
      source: 'export',
      metricsAt: m.present ? m.syncedAt ?? nowIso() : null,
    });
    n++;
  }
  return n;
}

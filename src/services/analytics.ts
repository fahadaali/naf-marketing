import type { Env } from '../types';
import { BudgetExhausted, CallBudget } from '../adapters/budget';
import { mapMetrics } from '../adapters/metrics';
import type { AccountPost } from '../adapters/inbox';
import {
  AYRSHARE_HISTORY_PLATFORMS, AYRSHARE_SOCIAL_ID_PLATFORMS, AyrshareError, ayrshareAnalyticsByAyrId, ayrshareAnalyticsBySocialId,
  ayrsharePlatform, ayrsharePlatformHistory, ayrshareSentPosts, ayrshareUser, errorCodes as ayrshareErrorCodes,
  postSpecificRejection, youtubeChannelVideos,
  type AyrshareAccount,
} from '../adapters/ayrshare';
import { ayrshareAuth } from '../adapters';
import { beginScheduledRun, endScheduledRun, runLimits, type Plan, type Trigger } from './limits';
import { newId, nowIso } from '../util';
import { normalizePlatformKey } from '../platformLabels';
import { nativeIdFromUrl, URL_NATIVE_PLATFORMS } from './nativePostId';

/* ============================================================
   سحب لقطات المنشورات من Ayrshare — ومنها تُحتسب الطبقتان الأولى والثانية.

   السحب بميزانيةٍ معلومة من النداءات. يقرأ ما نُشر عبر المزوّد، وسجلَّ كل
   حسابٍ على منصّته (وفيه ما نُشر من تطبيق المنصّة مباشرةً)، ويطلب الأرقام
   الحيّة لمنشورات الأسابيع الأخيرة بدءاً بأقدمها تحديثاً. ولا يُكتب غيابُ
   الرقم صفراً، ولا يُمحى رقمٌ بغياب، ولا تُحذف لقطةٌ لأنها خرجت من صفحةٍ قُرئت.
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
  providerUuid?: string | null; // معرّف المنشور عند Ayrshare — به تُطلب أرقام سناب
  /** معرّف المنشور على منصته — به تُطلب تعليقاته وإن بقي مفتاحه من مزوّدٍ سابق (0045). */
  nativePostId?: string | null;
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
        metrics_json, external_url, source, provider_uuid, metrics_at, native_post_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_post_id) DO UPDATE SET
       platform = excluded.platform,
       title = COALESCE(excluded.title, analytics_snapshots.title),
       post_id = COALESCE(excluded.post_id, analytics_snapshots.post_id),
       via_platform = MAX(excluded.via_platform, analytics_snapshots.via_platform),
       sent_at = COALESCE(excluded.sent_at, analytics_snapshots.sent_at),
       external_url = COALESCE(excluded.external_url, analytics_snapshots.external_url),
       source = COALESCE(analytics_snapshots.source, excluded.source),
       provider_uuid = COALESCE(excluded.provider_uuid, analytics_snapshots.provider_uuid),
       native_post_id = COALESCE(excluded.native_post_id, analytics_snapshots.native_post_id),
       -- لقطةٌ بلا أرقام لا تمسّ ما قيس قبلها، ومقياسٌ لم يُعلَن هذه المرّة يبقى على آخر ما أُعلن
       reach = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.reach ELSE COALESCE(excluded.reach, analytics_snapshots.reach) END,
       impressions = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.impressions ELSE COALESCE(excluded.impressions, analytics_snapshots.impressions) END,
       engagement = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.engagement ELSE COALESCE(excluded.engagement, analytics_snapshots.engagement) END,
       metrics_json = CASE WHEN excluded.metrics_at IS NULL THEN analytics_snapshots.metrics_json ELSE excluded.metrics_json END,
       metrics_at = COALESCE(excluded.metrics_at, analytics_snapshots.metrics_at),
       captured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  )
    .bind(
      // باسم منصتنا لا باسم المزوّد (`twitter`) — وإلا لم تُطلب تعليقاتها (0046)
      newId('an'), row.providerPostId, normalizePlatformKey(row.platform), row.title, row.postId, row.viaPlatform,
      // بلا أرقام: غيابٌ يُكتب `NULL` لا صفراً — ولو أعاد المحوّل أصفاره
      row.metricsAt ? row.reach : null, row.metricsAt ? row.impressions : null, row.metricsAt ? row.engagement : null,
      row.sentAt, row.metricsAt ? row.metricsJson : null, row.externalUrl, row.source ?? null, row.providerUuid ?? null, row.metricsAt,
      row.nativePostId ?? null,
    );
}

/* الكتابة دفعاتٍ لا صفّاً صفّاً: للاستدعاء حدٌّ من العمليات على القاعدة
   (ألفٌ في الخطة المجانية)، وثلاثمئة منشورٍ بعبارةٍ لكلٍّ تقترب منه. */
async function runBatch(env: Env, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
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
  /** الخطة المعلنة، وهل نزلت حصصها إلى المجانية احتياطاً — انظر `limits.ts`. */
  plan?: Plan;
  fallback?: boolean;
  /** وقف السحب قبل حصّته: المزوّد طلب التمهّل، أو بلغ الاستدعاء حدّ طلباته. */
  stoppedBy?: 'rate_limit' | 'platform_cap' | null;
  /** سحب السجلّ: حساباتٌ قُرئ سجلّها إلى أقدم منشور، من كم حساب. */
  historyDone?: number;
  historyAccounts?: number;
};

/**
 * `regular` الجديدُ والأرقام الحيّة لمنشورات الأسابيع الستّة — كل ساعة.
 * `history` السجلّ القديم: صفحاتُ سجلّ كل حساب إلى أقدم منشور، وما نُشر عبر
 * المزوّد كلُّه مرّةً في اليوم، وأرقامُ ما مضى عليه أكثر من ستة أسابيع كل أسبوع.
 */
export type AnalyticsMode = 'regular' | 'history';

const REPORT_KEY = 'analytics_sync_report';
const HISTORY_REPORT_KEY = 'analytics_history_report';
const DAY = 86_400_000;

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run();
}

async function readReport(env: Env, key: string): Promise<AnalyticsSyncReport | null> {
  const raw = await getSetting(env, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnalyticsSyncReport;
  } catch {
    return null;
  }
}

export async function readAnalyticsReport(env: Env): Promise<AnalyticsSyncReport | null> {
  return readReport(env, REPORT_KEY);
}

export async function readAnalyticsHistoryReport(env: Env): Promise<AnalyticsSyncReport | null> {
  return readReport(env, HISTORY_REPORT_KEY);
}

function errorText(err: unknown): string {
  return String((err as Error)?.message || err).slice(0, 240);
}

// سحب التحليلات دورياً — يختار المسار حسب المزوّد، ويعود بعدد اللقطات ويحفظ تقريره.
export async function pullAnalytics(
  env: Env,
  opts: { trigger?: Trigger; budget?: number; mode?: AnalyticsMode } = {},
): Promise<number> {
  const history = opts.mode === 'history';
  const reportKey = history ? HISTORY_REPORT_KEY : REPORT_KEY;
  const trigger: Trigger = opts.trigger ?? (history ? 'history' : 'cron');
  // المجدولة وحدها يُرصد سقوطها، وقبل أن تُقرأ حصّتها — انظر `limits.ts`
  const job = history ? 'analytics-history' : 'analytics';
  const mark = trigger === 'cron' || trigger === 'history' ? await beginScheduledRun(env, job) : null;
  try {
    return await pullWithLimits(env, { trigger, budget: opts.budget, history, reportKey });
  } finally {
    if (mark) await endScheduledRun(env, job, mark);
  }
}

async function pullWithLimits(
  env: Env,
  opts: { trigger: Trigger; budget?: number; history: boolean; reportKey: string },
): Promise<number> {
  const { trigger, history, reportKey } = opts;
  const providerName = ((await getSetting(env, 'provider_name')) || env.PROVIDER_NAME || 'mock').toLowerCase();
  const prev = await readReport(env, reportKey);
  const limits = await runLimits(env, trigger);
  const report: AnalyticsSyncReport = {
    at: nowIso(),
    provider: providerName,
    ok: true,
    complete: true,
    calls: 0,
    budget: opts.budget ?? limits.calls,
    posts: 0,
    accountPosts: 0,
    newNative: 0,
    refreshed: 0,
    errors: [],
    lastOkAt: prev?.lastOkAt ?? null,
    plan: limits.plan,
    fallback: limits.fallback,
  };

  let captured = 0;
  try {
    // Ayrshare وحده يقيس؛ والتجريبي لا لقطة تُكتب منه (انظر `adapters/mock.ts`)
    if (providerName === 'ayrshare') {
      captured = await pullAllAyrshare(env, report, { deadline: limits.deadline, deep: trigger === 'manual', history });
    }
  } catch (err) {
    report.errors.push(errorText(err));
  }

  report.ok = report.errors.length === 0;
  if (report.ok) report.lastOkAt = report.at;
  await setSetting(env, reportKey, JSON.stringify(report));
  if (!report.ok && !captured) throw new Error(report.errors[0]);
  return captured;
}

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
  metrics_json: string | null;
};

const SNAP_COLUMNS = 'id, provider_post_id, platform, title, sent_at, external_url, reach, impressions, engagement, metrics_at, provider_uuid, metrics_json';

/**
 * أرقامُ السجلّ تُضمّ إلى المحفوظ نوعاً بنوع ولا تمحوه.
 *
 * السجلّ يُقرأ كل ساعة وأرقامه أقلّ من الحيّة: إنستغرام فيه الإعجاب والتعليق
 * وحدهما، وفيسبوك بلا ظهور. وكانت لقطته تُكتب مكان الحيّة كلَّها، فيصير ظهور
 * فيسبوك صفراً — يُؤخذ من مشاهدات المقطع — وينقص تفاعل إنستغرام بلا حفظٍ ولا
 * مشاركة، خمسَ ساعاتٍ من كل ستّ حتى يعيدها الطلب الحيّ. فما في السجلّ يُحدّث
 * نوعه، وما ليس فيه يبقى على آخر ما قيس، ثم يُحسب الوصول والظهور والتفاعل
 * من المجموع.
 */
export function mergeRawMetrics(stored: string | null, fresh: any[]): any[] {
  let old: unknown = [];
  try {
    old = stored ? JSON.parse(stored) : [];
  } catch {
    old = [];
  }
  const keyOf = (m: any) => String(m?.type ?? m?.name ?? '').toLowerCase();
  const freshKeys = new Set(fresh.map(keyOf));
  let kept = (Array.isArray(old) ? old : []).filter((m) => m && typeof m === 'object' && keyOf(m) && !freshKeys.has(keyOf(m)));
  let incoming = fresh;
  /* «reactions» في فيسبوك تضمّ الإعجاب، فلا يُجمعان إن جاء كلٌّ من مصدر: قصّةُ
     فيسبوك في السجلّ بلا تفاعلات (`reactions: {}`) فيُكتب إعجابُها وحده. */
  if (freshKeys.has('reactions') && !freshKeys.has('likes')) kept = kept.filter((m) => keyOf(m) !== 'likes');
  if (!freshKeys.has('reactions') && kept.some((m) => keyOf(m) === 'reactions')) incoming = fresh.filter((m) => keyOf(m) !== 'likes');
  return [...kept, ...incoming];
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
  /* ورابطان بصيغتين لمنشورٍ واحد (`youtu.be/…` و`watch?v=…`) يُطابَقان بالمعرّف
     الذي يحملانه — انظر `nativeIdFromUrl`. */
  const native = nativeIdFromUrl(platform, h.externalUrl) ?? (URL_NATIVE_PLATFORMS.includes(platform) ? h.id : null);
  if (native) {
    const byNative = candidates.find((c) => c.platform === platform && nativeIdFromUrl(platform, c.external_url) === native);
    if (byNative) return byNative;
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

/* ─── سجلّ كل حساب ─── */

/** أين بلغت قراءة سجلّ حسابٍ نحو أقدم منشور، ومتى اكتملت. */
type HistoryState = { cursor: string | null; doneAt: string | null };

const historyKey = (accountId: string) => `account_history:${accountId}`;

async function readHistoryState(env: Env, accountId: string): Promise<HistoryState> {
  const raw = await getSetting(env, historyKey(accountId));
  try {
    const v = raw ? JSON.parse(raw) : null;
    return { cursor: v?.cursor || null, doneAt: v?.doneAt || null };
  } catch {
    return { cursor: null, doneAt: null };
  }
}

async function writeHistoryState(env: Env, accountId: string, st: HistoryState): Promise<void> {
  await setSetting(env, historyKey(accountId), JSON.stringify(st));
}

/**
 * يكتب صفحةً من سجلّ حسابٍ لقطاتٍ — ما عُرف يُحدَّث في صفّه، وما لم يُعرف
 * منشورٌ من خارج المنصة. والمطابقة بالمعرّف ثم الرابط ثم وقت النشر وأوّل العنوان
 * (`matchSnapshot`) كي لا يُعدّ منشورٌ في المسلكين مرّتين.
 */
async function ingestAccountPosts(
  env: Env,
  report: AnalyticsSyncReport,
  items: AccountPost[],
  platform: string,
  schedMap: Map<string, { postId: string; title: string }>,
): Promise<number> {
  if (!items.length) return 0;
  report.accountPosts += items.length;
  const oldest = items.reduce((m, h) => {
    const t = h.sentAt ? Date.parse(h.sentAt) : NaN;
    return Number.isFinite(t) && t < m ? t : m;
  }, Number.POSITIVE_INFINITY);
  const { results: candidates } = await env.DB.prepare(
    `SELECT ${SNAP_COLUMNS} FROM analytics_snapshots WHERE platform = ? AND (sent_at IS NULL OR sent_at >= ?)`,
  )
    .bind(platform, Number.isFinite(oldest) ? new Date(oldest - DAY).toISOString() : '1970-01-01T00:00:00Z')
    .all<Snapshot>();

  const writes: D1PreparedStatement[] = [];
  for (const h of items) {
    const match = matchSnapshot(h, platform, candidates);
    const via = schedMap.get(h.id);
    const metricsAt = h.metrics.present ? h.metrics.syncedAt ?? nowIso() : null;
    // ما قيس قبله يُضمّ إليه ولا يُمحى — انظر `mergeRawMetrics`
    const m = h.metrics.present && match?.metrics_json ? mapMetrics(mergeRawMetrics(match.metrics_json, h.metrics.raw)) : h.metrics;
    writes.push(upsertStmt(env, {
      providerPostId: match?.provider_post_id ?? h.id,
      platform,
      title: match?.title || via?.title || h.title || null,
      postId: via?.postId || null,
      viaPlatform: via ? 1 : 0,
      reach: m.reach,
      impressions: m.impressions,
      engagement: m.engagement,
      sentAt: h.sentAt,
      metricsJson: JSON.stringify(m.raw),
      externalUrl: h.externalUrl,
      source: 'account',
      metricsAt,
      // المفتاح قد يبقى من مزوّدٍ سابق، والمعرّف الأصلي يُحفظ بجانبه
      nativePostId: h.id,
    }));
    if (!match) {
      report.newNative++;
      // يُضاف إلى المرشّحين كي لا يُطابَق منشورٌ ثانٍ في الصفحة نفسها عليه
      candidates.push({
        id: '', provider_post_id: h.id, platform, title: h.title, sent_at: h.sentAt, external_url: h.externalUrl,
        reach: h.metrics.reach, impressions: h.metrics.impressions, engagement: h.metrics.engagement, metrics_at: metricsAt, provider_uuid: null,
        metrics_json: h.metrics.present ? JSON.stringify(h.metrics.raw) : null,
      });
    }
  }
  await runBatch(env, writes);
  return items.length;
}

/* ═══ Ayrshare ═══

   أربع خطوات بحصّة الاستدعاء نفسها:
   ١) الحسابات المربوطة (`GET /user`) — ومنها نوع لينكدإن: صفحةٌ أم شخصي.
   ٢) ما نُشر عبر Ayrshare (`GET /history`) — والجدول عندنا يحفظ معرّف Ayrshare
      لا معرّف المنصة، وهذا ما يربطهما: لكل منشورٍ وجهاتُه بمعرّفاتها. فتُكتب
      لقطةٌ لكل وجهةٍ بمعرّف المنصة، مربوطةً بالمحتوى إن نُشر منها.
   ٣) سجلّ كل منصة (`GET /history/:platform`) — ومنه ما نُشر من تطبيق المنصة
      مباشرةً. المعتاد أحدث خمسةٍ وعشرين، والسجلّ يمضي من مؤشّره المحفوظ إلى
      أقدم منشور ثم يستريح ثلاثين يوماً.
   ٤) الأرقام الحيّة بمعرّف المنصة (`searchPlatformId`) — مئةُ منشورٍ في الطلب،
      وتعمل لما نُشر من خارج Ayrshare. وسجلُّ إنستغرام لا يحمل إلا الإعجاب
      والتعليق، ويوتيوب لا شيء: فهذه الخطوة ما يأتي بالوصول والمشاهدات.

   وAyrshare يحدّث أرقام المنشور كل إحدى عشرة دقيقة تقريباً ولينكدإن القديم
   مرّةً في اليوم، فلا فائدة من طلبها أكثر من كل ستّ ساعات. */

const AYRSHARE_LIVE_EVERY_MS = 6 * 3_600_000;

/** منشورات سناب التي تُطلب أرقامها في السحب الواحد — طلبٌ لكلٍّ منها. */
const SNAPCHAT_PER_PULL = 20;

/**
 * حجم صفحة السجلّ. إكس وثريدز لهما مؤشّرٌ يُمضى به صفحةً بعد صفحة؛ وما سواهما
 * بلا مؤشّر في التوثيق فيُقرأ بصفحةٍ واحدة بأقصاها (٥٠٠). وفيسبوك وإنستغرام
 * ينصح التوثيق ألا يتجاوزا المئة: فوقها تسقط قراءة الأرقام.
 */
function historyPageSize(platform: string): number {
  if (platform === 'twitter' || platform === 'threads' || platform === 'facebook' || platform === 'instagram') return 100;
  return 500;
}

async function pullAllAyrshare(
  env: Env,
  report: AnalyticsSyncReport,
  opts: { deadline: number; deep: boolean; history: boolean },
): Promise<number> {
  const auth = ayrshareAuth(env);
  if (!auth) {
    report.errors.push('مفتاح Ayrshare غير مضبوط. اضبط AYRSHARE_API_KEY.');
    return 0;
  }
  const budget = new CallBudget(report.budget, opts.deadline);
  const stop = (err: unknown) => {
    if (err instanceof BudgetExhausted) report.complete = false;
    else report.errors.push(errorText(err));
  };
  const hasX = !!(auth.x?.key && auth.x.secret);
  let captured = 0;

  // ١) الحسابات
  let accounts: AyrshareAccount[] = [];
  try {
    accounts = (await ayrshareUser(auth, budget)).accounts;
  } catch (err) {
    stop(err);
    report.calls = budget.used;
    return 0;
  }
  // إكس بلا مفتاحَي التطبيق يُرفض كل طلبٍ له — يُترك ويُقال مرّةً
  if (!hasX && accounts.some((a) => a.platform === 'x')) {
    report.errors.push('إكس عبر Ayrshare يشترط مفتاحَي تطبيق المطوّر. اضبط AYRSHARE_X_API_KEY وAYRSHARE_X_API_SECRET.');
    accounts = accounts.filter((a) => a.platform !== 'x');
  }
  const internalOf = (ayrPlatform: string) =>
    accounts.find((a) => ayrsharePlatform(a.platform) === ayrPlatform)?.platform ?? ayrPlatform;

  // ٢) ما نُشر عبر Ayrshare — يربط معرّف كل وجهةٍ بجدول النشر
  const schedMap = await scheduleIndex(env);
  const { results: schedRows } = await env.DB.prepare(
    'SELECT provider_post_id, platform FROM schedules WHERE provider_post_id IS NOT NULL',
  ).all<{ provider_post_id: string; platform: string }>();
  const schedPlatforms = new Map<string, string[]>();
  for (const r of schedRows) schedPlatforms.set(r.provider_post_id, [...(schedPlatforms.get(r.provider_post_id) ?? []), r.platform]);
  const nativeIndex = new Map<string, { postId: string; title: string }>();

  const sentAt = opts.history ? await getSetting(env, 'ayrshare_posts_history_at') : null;
  const readSent = !opts.history || !sentAt || Date.now() - Date.parse(sentAt) > DAY;
  if (readSent) {
    try {
      const sent = await ayrshareSentPosts(auth, {
        lastDays: opts.history ? 0 : opts.deep ? 90 : 30,
        limit: opts.history ? 1000 : 200,
        budget,
      });
      const writes: D1PreparedStatement[] = [];
      for (const post of sent) {
        const via = schedMap.get(post.ayrId);
        for (const t of post.targets) {
          if (t.platform === 'twitter' && !hasX) continue;
          const platform = schedPlatforms.get(post.ayrId)?.find((p) => ayrsharePlatform(p) === t.platform) ?? internalOf(t.platform);
          if (via) nativeIndex.set(t.id, via);
          writes.push(upsertStmt(env, {
            providerPostId: t.id,
            platform,
            title: via?.title || post.text.slice(0, 140) || null,
            postId: via?.postId || null,
            viaPlatform: via ? 1 : 0,
            reach: null,
            impressions: null,
            engagement: null,
            sentAt: post.created,
            metricsJson: null,
            externalUrl: t.postUrl,
            source: 'posts',
            providerUuid: post.ayrId,
            metricsAt: null,
            nativePostId: t.id,
          }));
          report.posts++;
          captured++;
        }
      }
      await runBatch(env, writes);
      if (opts.history) await setSetting(env, 'ayrshare_posts_history_at', nowIso());
    } catch (err) {
      stop(err);
    }
  }

  // ٣) سجلّ كل منصة
  const withHistory = accounts.filter((a) => AYRSHARE_HISTORY_PLATFORMS.has(ayrsharePlatform(a.platform)));
  if (opts.history) {
    report.historyAccounts = withHistory.length;
    report.historyDone = 0;
  }
  for (const acc of withHistory) {
    // تُترك للأرقام الحيّة حصّتها
    if (budget.left <= 4) {
      report.complete = false;
      break;
    }
    const p = ayrsharePlatform(acc.platform);
    const stateKey = `ayrshare:${p}`;
    const state = opts.history ? await readHistoryState(env, stateKey) : null;
    if (state?.doneAt && Date.now() - Date.parse(state.doneAt) < 30 * DAY) continue;

    let next = state?.cursor ?? null;
    let partial = false;
    let failed = false;
    for (let page = 0; page < (opts.history ? 4 : 1); page++) {
      try {
        const res = await ayrsharePlatformHistory(auth, p, acc.platform, { limit: opts.history ? historyPageSize(p) : 25, next, budget });
        captured += await ingestAccountPosts(env, report, res.posts, acc.platform, nativeIndex);
        partial ||= res.partial;
        next = res.next;
      } catch (err) {
        failed = true;
        // 196 «غير مربوط»: لا سجلّ يُقرأ — ولا يُعدّ خطأً كل ساعة
        if (!(err instanceof AyrshareError && ayrshareErrorCodes(err.body).includes(196))) stop(err);
        break;
      }
      if (!next) break;
    }
    if (partial) report.complete = false;
    if (opts.history && !failed) {
      // «partial» لا يُعدّ مكتملاً: يُعاد من الأحدث في السحب التالي
      await writeHistoryState(env, stateKey, next ? { cursor: next, doneAt: null } : { cursor: null, doneAt: partial ? null : nowIso() });
    }
    if (budget.stoppedBy) break;
  }
  if (opts.history) {
    let done = 0;
    for (const acc of withHistory) {
      const st = await readHistoryState(env, `ayrshare:${ayrsharePlatform(acc.platform)}`);
      if (st.doneAt && Date.now() - Date.parse(st.doneAt) < 30 * DAY) done++;
    }
    report.historyDone = done;
  }

  /* ٣ب) مقاطع يوتيوب من قائمة القناة نفسها — سجلُّ Ayrshare لا يردّ القصيرة
     منها. تُكتب بلا أرقام، وأرقامُها من الخطوة التالية بمعرّف المقطع. */
  const yt = accounts.find((a) => a.platform === 'youtube' && a.channelId);
  if (yt?.channelId && !budget.stoppedBy && budget.left > 4) {
    try {
      const videos = await youtubeChannelVideos(yt.channelId, budget);
      captured += await ingestAccountPosts(env, report, videos.map((v) => ({
        id: v.id,
        platform: 'youtube',
        accountId: '',
        title: v.title.slice(0, 140),
        sentAt: v.published,
        externalUrl: v.url,
        metrics: mapMetrics([]),
      })), 'youtube', nativeIndex);
    } catch (err) {
      // القائمة زيادةٌ على السجلّ: تعذّرها يُقال ولا يوقف السحب
      if (err instanceof BudgetExhausted) report.complete = false;
      else report.errors.push(errorText(err));
    }
  }

  /* ٤) الأرقام الحيّة بمعرّف المنصة — أقدمُها طلباً أوّلاً. والموعد بوقت
     آخر طلبٍ لها (`metrics_checked_at`) لا بوقت آخر رقم: سجلُّ إنستغرام يحمل
     الإعجاب والتعليق وحدهما، فلو عُدّت أرقامُه حديثةً لما طُلب الوصول أبداً. */
  const livePlatforms = accounts.map((a) => a.platform).filter((k) => AYRSHARE_SOCIAL_ID_PLATFORMS.has(ayrsharePlatform(k)));
  if (livePlatforms.length && !budget.stoppedBy) {
    const since = new Date(Date.now() - 45 * DAY).toISOString();
    const staleBefore = new Date(Date.now() - (opts.history ? 7 * DAY : AYRSHARE_LIVE_EVERY_MS)).toISOString();
    const { results: due } = await env.DB.prepare(
      `SELECT provider_post_id, platform FROM analytics_snapshots
       WHERE platform IN (${livePlatforms.map(() => '?').join(',')})
         AND COALESCE(source, '') <> 'newsletter' AND sent_at IS NOT NULL AND sent_at ${opts.history ? '<' : '>='} ?
         AND COALESCE(metrics_checked_at, '') < ?
       ORDER BY COALESCE(metrics_checked_at, '') ASC
       LIMIT 300`,
    )
      .bind(...livePlatforms, since, staleBefore)
      .all<{ provider_post_id: string; platform: string }>();

    const byPlatform = new Map<string, string[]>();
    for (const r of due) {
      const p = ayrsharePlatform(r.platform);
      byPlatform.set(p, [...(byPlatform.get(p) ?? []), r.provider_post_id]);
    }
    outer: for (const [p, ids] of byPlatform) {
      for (let i = 0; i < ids.length; i += 100) {
        if (budget.left <= 0) {
          report.complete = false;
          break outer;
        }
        const chunk = ids.slice(i, i + 100);
        let metrics: Awaited<ReturnType<typeof ayrshareAnalyticsBySocialId>>;
        try {
          metrics = await ayrshareAnalyticsBySocialId(auth, p, chunk, budget);
        } catch (err) {
          if (err instanceof BudgetExhausted) {
            report.complete = false;
            break outer;
          }
          /* رفضٌ يخصّ هذه المنشورات (محذوفة، 186) يُختم وقتُ طلبها كي لا تبقى
             أوّل القائمة تأكل حصّتها. وما يخصّ الحساب — تمهّلُ المنصة، وحسابٌ
             يحتاج إعادة ربط (475) — يُقال ويُترك باقي منصّته إلى السحب التالي،
             ولا يُختم: كان يُختم فلا تُطلب أرقامها ستّ ساعات بلا سبب ظاهر. */
          if (!(err instanceof AyrshareError) || !postSpecificRejection(err)) {
            stop(err);
            continue outer;
          }
          metrics = new Map();
        }
        const writes: D1PreparedStatement[] = [];
        for (const id of chunk) {
          const m = metrics.get(id);
          if (m?.present) {
            writes.push(env.DB.prepare(
              `UPDATE analytics_snapshots
               SET reach = COALESCE(?, reach), impressions = COALESCE(?, impressions), engagement = COALESCE(?, engagement),
                   metrics_json = ?, metrics_at = ?, captured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE provider_post_id = ?`,
            ).bind(m.reach, m.impressions, m.engagement, JSON.stringify(m.raw), nowIso(), id));
            report.refreshed++;
          }
          writes.push(env.DB.prepare(
            "UPDATE analytics_snapshots SET metrics_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE provider_post_id = ?",
          ).bind(id));
        }
        await runBatch(env, writes);
      }
    }
  }

  /* ٤ب) سناب بمعرّف Ayrshare — لا يُسأل بمعرّف المنصة، وسجلُّه بلا أرقام، فكانت
     منشوراته كلّها بلا رقمٍ واحد. وما نُشر عبر Ayrshare وحده له معرّفٌ يُسأل به
     (`provider_uuid`)، منشوراً في الطلب — فيُطلب منه عددٌ محدود في كل سحب. */
  if (accounts.some((a) => a.platform === 'snapchat') && !budget.stoppedBy) {
    const staleBefore = new Date(Date.now() - (opts.history ? 7 * DAY : AYRSHARE_LIVE_EVERY_MS)).toISOString();
    const since = new Date(Date.now() - 45 * DAY).toISOString();
    const { results: due } = await env.DB.prepare(
      `SELECT provider_post_id, provider_uuid FROM analytics_snapshots
       WHERE platform = 'snapchat' AND provider_uuid IS NOT NULL AND sent_at IS NOT NULL AND sent_at ${opts.history ? '<' : '>='} ?
         AND COALESCE(metrics_checked_at, '') < ?
       ORDER BY COALESCE(metrics_checked_at, '') ASC
       LIMIT ${SNAPCHAT_PER_PULL}`,
    )
      .bind(since, staleBefore)
      .all<{ provider_post_id: string; provider_uuid: string }>();
    for (const row of due) {
      if (budget.left <= 0) {
        report.complete = false;
        break;
      }
      let m: Awaited<ReturnType<typeof ayrshareAnalyticsByAyrId>> = null;
      try {
        m = await ayrshareAnalyticsByAyrId(auth, row.provider_uuid, 'snapchat', budget);
      } catch (err) {
        if (err instanceof BudgetExhausted) {
          report.complete = false;
          break;
        }
        if (!(err instanceof AyrshareError) || !postSpecificRejection(err)) {
          stop(err);
          break;
        }
      }
      const writes: D1PreparedStatement[] = [];
      if (m) {
        writes.push(env.DB.prepare(
          `UPDATE analytics_snapshots
           SET reach = COALESCE(?, reach), impressions = COALESCE(?, impressions), engagement = COALESCE(?, engagement),
               metrics_json = ?, metrics_at = ?, captured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
           WHERE provider_post_id = ?`,
        ).bind(m.reach, m.impressions, m.engagement, JSON.stringify(m.raw), nowIso(), row.provider_post_id));
        report.refreshed++;
      }
      writes.push(env.DB.prepare(
        "UPDATE analytics_snapshots SET metrics_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE provider_post_id = ?",
      ).bind(row.provider_post_id));
      await runBatch(env, writes);
    }
  }

  report.calls = budget.used;
  report.stoppedBy = budget.stoppedBy;
  if (budget.stoppedBy) report.complete = false;
  return captured;
}

/* ============================================================
   المصادر الخارجية للمؤشرات.

   كل مصدر يعيد نقاطاً بمفاتيح المؤشرات المسجّلة في `metric_definitions`، ولا
   يعرف شيئاً عن الفترات ولا عن التخزين: يستقبل مدىً بتاريخين ويعيد أرقاماً.
   والتجميع والحفظ في `services/metrics.ts`.

   ═══ ثلاثة مصادر بواجهاتها الحقيقية، وأربعة بعقدٍ واحد ═══

   تحليلات الموقع وأدوات مشرفي المواقع والملف التجاري كلها من جوجل، وواجهاتها
   مستقرّة وموثّقة، فتُنادى مباشرةً.

   وأمّا منصات الإعلان وقنوات المراسلة وتتبّع المكالمات ورصد الذكر فلا واجهة
   واحدة لها: الإعلان وحده خمس منصات بخمس واجهات وخمس دورات موافقة، وتتبّع
   المكالمات ورصد الذكر يعتمدان على مزوّدٍ لم يُختر بعد. فبناءُ عميلٍ لكل
   واحد اليوم هو كتابةُ آلاف الأسطر لواجهاتٍ قد لا تُستعمل، ولا سبيل لاختبار
   سطرٍ منها قبل أن يوجد الحساب.

   فهذه الأربعة تُنادَى بعقدٍ واحد مكتوب: عنوانٌ يُضبط من شاشة التكاملات،
   ومفتاحٌ في السرّ، وردٌّ بالشكل المذكور في `SOURCE_CONTRACT` أدناه. ووصلُ
   مزوّدٍ بعينه يصير عندها محوّلاً صغيراً عنده لا تغييراً في هذه المنصة —
   وهو ما يجعل المصدر «مُجهَّزاً» لا «موعوداً».
   ============================================================ */

import type { Env } from '../types';
import { getAccessToken, googleJson, parseServiceAccount, GoogleAuthError } from './googleAuth';

export type MetricPoint = {
  metricKey: string;
  dimKey?: string;
  dimValue?: string;
  value: number;
  /** حجم العيّنة حين تكون القيمة متوسطاً — يُعرض تحت الرقم. */
  sample?: number;
};

export type SourceRange = { start: string; end: string }; // YYYY-MM-DD

export type SourceConfig = Record<string, unknown>;

export class SourceError extends Error {}

/**
 * العقد الذي تردّ به المصادر الأربعة العامة.
 *
 * ```json
 * { "points": [ { "metric": "cpc", "value": 3.4 },
 *               { "metric": "audience_seniority", "dim": "seniority",
 *                 "dimValue": "مدير إدارة", "value": 128 } ] }
 * ```
 *
 * `metric` مفتاحٌ من `metric_definitions`، وما لم يُعرَف منه يُطرح صامتاً —
 * مصدرٌ يرسل مفتاحاً لا نعرفه لا يُسقط السحب كلَّه.
 */
export const SOURCE_CONTRACT = '{ "points": [ { "metric": "<key>", "dim": "<optional>", "dimValue": "<optional>", "value": <number>, "sample": <optional number> } ] }';

function cfgString(cfg: SourceConfig, key: string): string {
  const v = cfg[key];
  return typeof v === 'string' ? v.trim() : '';
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ═══ تحليلات الموقع — GA4 Data API ═══ */

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** يقرأ تقريراً واحداً من GA4 ويعيد صفوفه خاماً. */
async function ga4Report(
  token: string,
  propertyId: string,
  range: SourceRange,
  dimensions: string[],
  metrics: string[],
  limit = 50,
): Promise<{ dims: string[]; metrics: number[] }[]> {
  const body = await googleJson(
    token,
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: 'POST',
      body: {
        dateRanges: [{ startDate: range.start, endDate: range.end }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        limit,
      },
    },
  );
  const rows = (body as { rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[] })?.rows ?? [];
  return rows.map((r) => ({
    dims: (r.dimensionValues ?? []).map((d) => String(d.value ?? '')),
    metrics: (r.metricValues ?? []).map((m) => toNumber(m.value)),
  }));
}

async function fetchWebAnalytics(env: Env, cfg: SourceConfig, range: SourceRange): Promise<MetricPoint[]> {
  const propertyId = cfgString(cfg, 'property_id');
  if (!propertyId) throw new SourceError('معرّف خاصية GA4 غير مضبوط. اضبطه من التكاملات.');

  const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const token = await getAccessToken(sa, [GA4_SCOPE]);
  const out: MetricPoint[] = [];

  // المجاميع: الجلسات، المستخدمون، الارتداد، زمن الجلسة، الصفحات لكل جلسة
  const totals = await ga4Report(token, propertyId, range, [], [
    'sessions',
    'totalUsers',
    'bounceRate',
    'averageSessionDuration',
    'screenPageViewsPerSession',
  ], 1);
  if (totals[0]) {
    const [sessions, users, bounce, duration, pages] = totals[0].metrics;
    out.push({ metricKey: 'sessions', value: sessions });
    out.push({ metricKey: 'unique_users', value: users });
    // GA4 يعيد الارتداد نسبةً بين صفر وواحد، والمؤشر مسجّل `percentage`.
    out.push({ metricKey: 'bounce_rate', value: Math.round(bounce * 1000) / 10 });
    out.push({ metricKey: 'session_duration', value: Math.round(duration) });
    out.push({ metricKey: 'pages_per_session', value: Math.round(pages * 100) / 100 });
  }

  // مصادر الزيارات — البُعد المسجّل `channel`
  for (const row of await ga4Report(token, propertyId, range, ['sessionDefaultChannelGroup'], ['sessions'], 20)) {
    out.push({ metricKey: 'traffic_sources', dimKey: 'channel', dimValue: row.dims[0] || 'unassigned', value: row.metrics[0] });
  }

  // التوزيع بين الأجهزة — نسبةً لا عدداً، فالمؤشر مسجّل `percentage`
  const devices = await ga4Report(token, propertyId, range, ['deviceCategory'], ['sessions'], 10);
  const deviceTotal = devices.reduce((sum, r) => sum + r.metrics[0], 0);
  for (const row of devices) {
    out.push({
      metricKey: 'device_split',
      dimKey: 'device',
      dimValue: row.dims[0] || 'unknown',
      value: deviceTotal > 0 ? Math.round((row.metrics[0] / deviceTotal) * 1000) / 10 : 0,
      sample: row.metrics[0],
    });
  }

  // مسار الزائر — أكثر الصفحات دخولاً
  for (const row of await ga4Report(token, propertyId, range, ['landingPage'], ['sessions'], 20)) {
    out.push({ metricKey: 'user_flow', dimKey: 'page', dimValue: row.dims[0] || '/', value: row.metrics[0] });
  }

  // التوزيع الجغرافي حتى مستوى المدينة — الطبقة السابعة
  for (const row of await ga4Report(token, propertyId, range, ['city'], ['sessions'], 25)) {
    out.push({ metricKey: 'audience_geo', dimKey: 'city', dimValue: row.dims[0] || 'unknown', value: row.metrics[0] });
  }

  /* الأحداث المسمّاة: تعبئة النموذج وتحميل المحتوى المسوّر. أسماؤها تُضبط
     من شاشة التكاملات لأنها اصطلاحُ من ركّب القياس على الموقع، لا اصطلاحُ
     GA4 — ومنصةٌ تفترض `generate_lead` تقرأ صفراً على موقعٍ سمّاه `contact`. */
  const formEvent = cfgString(cfg, 'form_event');
  const gatedEvent = cfgString(cfg, 'gated_event');
  if (formEvent || gatedEvent) {
    for (const row of await ga4Report(token, propertyId, range, ['eventName'], ['eventCount'], 100)) {
      if (formEvent && row.dims[0] === formEvent) out.push({ metricKey: 'form_completions', value: row.metrics[0] });
      if (gatedEvent && row.dims[0] === gatedEvent) out.push({ metricKey: 'gated_downloads', value: row.metrics[0] });
    }
  }

  return out;
}

/* ═══ أدوات مشرفي المواقع — Search Console API ═══ */

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

async function fetchSearchConsole(env: Env, cfg: SourceConfig, range: SourceRange): Promise<MetricPoint[]> {
  const siteUrl = cfgString(cfg, 'site_url');
  if (!siteUrl) throw new SourceError('عنوان الموقع في أدوات مشرفي المواقع غير مضبوط. اضبطه من التكاملات.');

  const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const token = await getAccessToken(sa, [GSC_SCOPE]);
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const out: MetricPoint[] = [];

  const totals = (await googleJson(token, endpoint, {
    method: 'POST',
    body: { startDate: range.start, endDate: range.end, rowLimit: 1 },
  })) as { rows?: { clicks?: number; impressions?: number }[] };
  const t = totals?.rows?.[0];
  if (t) {
    out.push({ metricKey: 'organic_impressions', value: toNumber(t.impressions) });
    out.push({ metricKey: 'organic_clicks', value: toNumber(t.clicks) });
  }

  const byQuery = (await googleJson(token, endpoint, {
    method: 'POST',
    body: { startDate: range.start, endDate: range.end, dimensions: ['query'], rowLimit: 50 },
  })) as { rows?: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[] };

  for (const row of byQuery?.rows ?? []) {
    const keyword = row.keys?.[0];
    if (!keyword) continue;
    out.push({
      metricKey: 'keyword_rank',
      dimKey: 'keyword',
      dimValue: keyword,
      value: Math.round(toNumber(row.position) * 10) / 10,
      sample: toNumber(row.impressions),
    });
    /* الكلمات التي تجلب زيارات فعلية — مفصولةً عمّا يجلب ظهوراً بلا نقر،
       وهو التمييز الذي يطلبه الدليل صراحةً. */
    if (toNumber(row.clicks) > 0) {
      out.push({ metricKey: 'converting_keywords', dimKey: 'keyword', dimValue: keyword, value: toNumber(row.clicks) });
    }
  }

  return out;
}

/* ═══ الملف التجاري — Business Profile Performance API ═══ */

const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

/** المقاييس اليومية التي يعيدها الملف التجاري، ومفتاحُ كلٍّ منها عندنا. */
const GBP_METRICS: { daily: string; metricKey: string }[] = [
  { daily: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', metricKey: 'gbp_views' },
  { daily: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', metricKey: 'gbp_views' },
  { daily: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', metricKey: 'gbp_views' },
  { daily: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', metricKey: 'gbp_views' },
  { daily: 'CALL_CLICKS', metricKey: 'gbp_calls' },
  { daily: 'BUSINESS_DIRECTION_REQUESTS', metricKey: 'gbp_directions' },
];

function splitDate(day: string): { year: number; month: number; day: number } {
  const [y, m, d] = day.split('-').map(Number);
  return { year: y, month: m, day: d };
}

async function fetchBusinessProfile(env: Env, cfg: SourceConfig, range: SourceRange): Promise<MetricPoint[]> {
  const locationId = cfgString(cfg, 'location_id');
  if (!locationId) throw new SourceError('معرّف موقع الملف التجاري غير مضبوط. اضبطه من التكاملات.');

  const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const token = await getAccessToken(sa, [GBP_SCOPE]);

  const s = splitDate(range.start);
  const e = splitDate(range.end);
  const params = new URLSearchParams();
  for (const m of GBP_METRICS) params.append('dailyMetrics', m.daily);
  params.set('dailyRange.start_date.year', String(s.year));
  params.set('dailyRange.start_date.month', String(s.month));
  params.set('dailyRange.start_date.day', String(s.day));
  params.set('dailyRange.end_date.year', String(e.year));
  params.set('dailyRange.end_date.month', String(e.month));
  params.set('dailyRange.end_date.day', String(e.day));

  const body = (await googleJson(
    token,
    `https://businessprofileperformance.googleapis.com/v1/locations/${encodeURIComponent(locationId)}:fetchMultiDailyMetricsTimeSeries?${params}`,
  )) as {
    multiDailyMetricTimeSeries?: {
      dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: { value?: string }[] } }[];
    }[];
  };

  // المقاييس الأربعة للظهور تُجمع في مؤشر واحد — الدليل يطلب «ظهور الملف
  // التجاري» لا أربعةَ أرقامٍ يجمعها القارئ في رأسه.
  const totals = new Map<string, number>();
  for (const group of body?.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      const mapped = GBP_METRICS.find((m) => m.daily === series.dailyMetric);
      if (!mapped) continue;
      const sum = (series.timeSeries?.datedValues ?? []).reduce((acc, dv) => acc + toNumber(dv.value), 0);
      totals.set(mapped.metricKey, (totals.get(mapped.metricKey) ?? 0) + sum);
    }
  }

  return Array.from(totals.entries()).map(([metricKey, value]) => ({ metricKey, value }));
}

/* ═══ المصادر الأربعة بالعقد الواحد ═══ */

function sourceSecret(env: Env, key: string): string {
  const raw =
    key === 'ads' ? env.ADS_API_KEY :
    key === 'messaging' ? env.MESSAGING_API_KEY :
    key === 'call_tracking' ? env.CALL_TRACKING_API_KEY :
    key === 'listening' ? env.LISTENING_API_KEY :
    undefined;
  return (raw || '').trim();
}

async function fetchByContract(env: Env, key: string, cfg: SourceConfig, range: SourceRange): Promise<MetricPoint[]> {
  const endpoint = cfgString(cfg, 'endpoint');
  if (!endpoint) throw new SourceError('عنوان المصدر غير مضبوط. اضبطه من التكاملات.');

  const url = new URL(endpoint);
  url.searchParams.set('start', range.start);
  url.searchParams.set('end', range.end);

  const secret = sourceSecret(env, key);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { accept: 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    });
  } catch (err) {
    throw new SourceError(`تعذّر الوصول إلى ${url.host} — ${String((err as Error)?.message || err)}`);
  }
  if (!res.ok) throw new SourceError(`ردّ المصدر بالحالة ${res.status}`);

  const body = (await res.json().catch(() => null)) as { points?: unknown } | null;
  const points = Array.isArray(body?.points) ? body.points : null;
  if (!points) throw new SourceError(`ردّ المصدر لا يطابق العقد المتوقّع: ${SOURCE_CONTRACT}`);

  const out: MetricPoint[] = [];
  for (const raw of points) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const metricKey = typeof p.metric === 'string' ? p.metric.trim() : '';
    const value = Number(p.value);
    if (!metricKey || !Number.isFinite(value)) continue;
    out.push({
      metricKey,
      dimKey: typeof p.dim === 'string' ? p.dim : undefined,
      dimValue: typeof p.dimValue === 'string' ? p.dimValue : undefined,
      value,
      sample: Number.isFinite(Number(p.sample)) ? Number(p.sample) : undefined,
    });
  }
  return out;
}

/* ═══ السجلّ ═══ */

export type SourceDefinition = {
  key: string;
  /** حقول الإعداد غير السرّية التي تظهر في شاشة التكاملات. */
  fields: { key: string; label: string; placeholder?: string }[];
  /** اسم السرّ الذي يحمل مفتاح هذا المصدر — للعرض في الشاشة لا لقراءته. */
  secretName: string;
  fetch: (env: Env, cfg: SourceConfig, range: SourceRange) => Promise<MetricPoint[]>;
};

/**
 * المصادر السبعة التي تُسحب. ومنصة إدارة الشركة ليست منها: تلك تُنسخ مرآةً
 * صفوفاً لا نقاطَ مؤشرات، ومسارُها في `services/crmSync.ts`.
 */
export const SOURCES: Record<string, SourceDefinition> = {
  web_analytics: {
    key: 'web_analytics',
    secretName: 'GOOGLE_SERVICE_ACCOUNT_JSON',
    fields: [
      { key: 'property_id', label: 'معرّف الخاصية', placeholder: '123456789' },
      { key: 'form_event', label: 'اسم حدث تعبئة النموذج', placeholder: 'generate_lead' },
      { key: 'gated_event', label: 'اسم حدث تحميل المحتوى المسوّر', placeholder: 'file_download' },
      /* خريطة الحرارة ليست رقماً — لا قيمة عددية لها، وهي مخرَجٌ بصريّ من
         أداة قياسٍ خارجية. فتُحفظ رابطاً هنا ويُعرض في طبقتها زرَّ فتح، ولا
         تُسجَّل مؤشراً بوحدةٍ مخترعة. */
      { key: 'heatmap_url', label: 'رابط خريطة الحرارة', placeholder: 'https://…' },
    ],
    fetch: fetchWebAnalytics,
  },
  search_console: {
    key: 'search_console',
    secretName: 'GOOGLE_SERVICE_ACCOUNT_JSON',
    fields: [{ key: 'site_url', label: 'عنوان الموقع', placeholder: 'sc-domain:naf.sa' }],
    fetch: fetchSearchConsole,
  },
  business_profile: {
    key: 'business_profile',
    secretName: 'GOOGLE_SERVICE_ACCOUNT_JSON',
    fields: [{ key: 'location_id', label: 'معرّف الموقع', placeholder: 'locations/123456789' }],
    fetch: fetchBusinessProfile,
  },
  ads: {
    key: 'ads',
    secretName: 'ADS_API_KEY',
    fields: [{ key: 'endpoint', label: 'عنوان المصدر', placeholder: 'https://…/metrics' }],
    fetch: (env, cfg, range) => fetchByContract(env, 'ads', cfg, range),
  },
  messaging: {
    key: 'messaging',
    secretName: 'MESSAGING_API_KEY',
    fields: [{ key: 'endpoint', label: 'عنوان المصدر', placeholder: 'https://…/metrics' }],
    fetch: (env, cfg, range) => fetchByContract(env, 'messaging', cfg, range),
  },
  call_tracking: {
    key: 'call_tracking',
    secretName: 'CALL_TRACKING_API_KEY',
    fields: [{ key: 'endpoint', label: 'عنوان المصدر', placeholder: 'https://…/metrics' }],
    fetch: (env, cfg, range) => fetchByContract(env, 'call_tracking', cfg, range),
  },
  listening: {
    key: 'listening',
    secretName: 'LISTENING_API_KEY',
    fields: [{ key: 'endpoint', label: 'عنوان المصدر', placeholder: 'https://…/metrics' }],
    fetch: (env, cfg, range) => fetchByContract(env, 'listening', cfg, range),
  },
};

export { GoogleAuthError };

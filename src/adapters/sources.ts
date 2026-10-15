/* ============================================================
   المصادر الخارجية للمؤشرات.

   كل مصدر يعيد نقاطاً بمفاتيح المؤشرات المسجّلة في `metric_definitions`، ولا
   يعرف شيئاً عن الفترات ولا عن التخزين: يستقبل مدىً بتاريخين ويعيد أرقاماً.
   والتجميع والحفظ في `services/metrics.ts`.

   ═══ أربعة مصادر بواجهاتها الحقيقية، وأربعة بعقدٍ واحد ═══

   تحليلات الموقع وأدوات مشرفي المواقع والملف التجاري كلها من جوجل، وواجهاتها
   مستقرّة وموثّقة، فتُنادى مباشرةً. ومعها مزوّد النشر بمفتاحه القائم — لا
   واجهة جديدة له ولا سرّ ثانٍ.

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
import { ayrshareAuth } from './index';
import {
  ayrshareAudiencePoints, ayrshareDailyPoints, ayrshareFollowers, ayrsharePlatform, ayrshareReviewSummary, ayrshareSocialAnalytics,
  ayrshareUser, dailyWindowDays, linkedInNewFollowers,
} from './ayrshare';
import { riyadhToday } from '../services/period';

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
     GA4 — ومنصةٌ تفترض `generate_lead` تقرأ صفراً على موقعٍ سمّاه `contact`.

     ويقابلها ثلاثةُ أحداثٍ يولّدها GA4 نفسه في «القياس المحسَّن»: `scroll`
     و`form_start` و`form_submit`. أسماؤها من عنده لا من عند من ركّب القياس،
     فتُفترض افتراضاً ويبقى تغييرها ممكناً من الشاشة لمن عطّل القياس المحسَّن
     وسمّاها بنفسه. */
  const formEvent = cfgString(cfg, 'form_event');
  const gatedEvent = cfgString(cfg, 'gated_event');
  const scrollEvent = cfgString(cfg, 'scroll_event') || 'scroll';
  const formStartEvent = cfgString(cfg, 'form_start_event') || 'form_start';
  const formSubmitEvent = formEvent || 'form_submit';

  const events = new Map<string, number>();
  for (const row of await ga4Report(token, propertyId, range, ['eventName'], ['eventCount'], 200)) {
    events.set(row.dims[0], row.metrics[0]);
  }

  if (formEvent && events.has(formEvent)) out.push({ metricKey: 'form_completions', value: events.get(formEvent) as number });
  if (gatedEvent && events.has(gatedEvent)) out.push({ metricKey: 'gated_downloads', value: events.get(gatedEvent) as number });

  /* التمرير حتى النهاية — حدث `scroll` في GA4 يقع مرّةً واحدة عند بلوغ ٩٠٪
     من الصفحة، فنسبتُه إلى الجلسات هي المؤشر المسجّل. ونسبته إلى الجلسات لا
     إلى مشاهدات الصفحة: من فتح خمس صفحات وأتمّ واحدةً أتمّ زيارةً لا خُمسها. */
  const sessionCount = totals[0]?.metrics[0] ?? 0;
  const scrolls = events.get(scrollEvent);
  if (scrolls !== undefined && sessionCount > 0) {
    out.push({ metricKey: 'scroll_depth', value: Math.round((scrolls / sessionCount) * 1000) / 10, sample: sessionCount });
  }

  /* عدم إكمال النموذج — من بدأه ولم يُرسله. والمقام من بدأ لا من رأى:
     نسبةٌ إلى الزيارات كلها تقيس شيئاً آخر (اهتماماً بالنموذج أصلاً)، وهو
     مؤشرٌ مختلف لم يطلبه الدليل. */
  const starts = events.get(formStartEvent);
  const submits = events.get(formSubmitEvent);
  if (starts !== undefined && starts > 0) {
    const abandoned = Math.max(starts - (submits ?? 0), 0);
    out.push({ metricKey: 'form_abandonment_rate', value: Math.round((abandoned / starts) * 1000) / 10, sample: starts });
  }

  out.push(...(await fetchWebVitals(env, cfg, range)));

  return out;
}

/* ═══ مؤشرات تجربة الصفحة — تقرير تجربة كروم (CrUX) ═══

   الثلاثة مسجّلة مصدرُها «تحليلات الموقع»، وGA4 لا يحملها: تلك أرقامُ
   مستخدمين حقيقيين يجمعها المتصفّح نفسه، وتُقرأ من تقرير تجربة كروم مجاناً.

   ومداها ثمانيةٌ وعشرون يوماً منتهيةً بالأمس — لا يُضبط بتاريخين. فالرقم
   المكتوب في فترةٍ شهرية هو حال الموقع عند احتسابها لا متوسّط الشهر، وهو ما
   يعنيه المؤشر أصلاً: أهو اليوم ضمن الحدّ أم لا. ولذلك لا يُكتب في فترةٍ
   منقضية — الدورة اليومية تسحبها مع الجارية، فيصير حال اليوم مكتوباً في كل
   شهرٍ مضى.

   وموقعٌ زوّارُه قليلون لا سجلّ له في التقرير، فيردّ ٤٠٤ ولا يُكتب شيء —
   غيابٌ معلوم لا صفرٌ يُقرأ إتقاناً. */

const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

/** أجهزة التقرير ومقابلها في بُعد `device` المستعمل في «التوزيع بين الأجهزة». */
const CRUX_FORM_FACTORS: { factor: string; device: string }[] = [
  { factor: 'PHONE', device: 'mobile' },
  { factor: 'DESKTOP', device: 'desktop' },
];

/** مقاييس التقرير ومفاتيحها عندنا، ومعامل الوحدة: المؤشران الأولان بالثواني والثالث بلا وحدة. */
const CRUX_METRICS: { crux: string; metricKey: string; divisor: number }[] = [
  { crux: 'largest_contentful_paint', metricKey: 'cwv_lcp', divisor: 1000 },
  { crux: 'interaction_to_next_paint', metricKey: 'cwv_inp', divisor: 1000 },
  { crux: 'cumulative_layout_shift', metricKey: 'cwv_cls', divisor: 1 },
];

async function fetchWebVitals(env: Env, cfg: SourceConfig, range: SourceRange): Promise<MetricPoint[]> {
  const origin = cfgString(cfg, 'crux_origin');
  const key = (env.GOOGLE_API_KEY || '').trim();
  // بلا عنوانٍ أو بلا مفتاح: لا تُسحب الثلاثة ولا يسقط سحب تحليلات الموقع
  // معها — مصدرٌ واحد يحمل واجهتين، وغيابُ إحداهما لا يُبطل الأخرى.
  if (!origin || !key) return [];
  if (range.end < riyadhToday()) return [];

  const out: MetricPoint[] = [];
  for (const { factor, device } of CRUX_FORM_FACTORS) {
    let body: any;
    try {
      const res = await fetch(`${CRUX_ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ origin, formFactor: factor }),
      });
      if (res.status === 404) continue; // لا سجلّ لهذا الجهاز — زيارات لا تكفي
      if (!res.ok) throw new SourceError(`ردّ تقرير تجربة كروم بالحالة ${res.status}`);
      body = await res.json();
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`تعذّر الوصول إلى تقرير تجربة كروم — ${String((err as Error)?.message || err)}`);
    }

    const metrics = body?.record?.metrics ?? {};
    for (const { crux, metricKey, divisor } of CRUX_METRICS) {
      const p75 = metrics?.[crux]?.percentiles?.p75;
      if (p75 === undefined || p75 === null) continue;
      const n = Number(p75);
      if (!Number.isFinite(n)) continue;
      out.push({ metricKey, dimKey: 'device', dimValue: device, value: Math.round((n / divisor) * 100) / 100 });
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

/* ═══ مزوّد النشر — أرقام الحساب لا أرقام المنشور ═══

   مقاييس المنشورات تصل أصلاً مع كل منشور وتُحتسب منها الطبقتان الأولى
   والثانية، وليست مصدراً يُسحب. وما يُسحب هنا ثلاثةٌ لا مسار لها من
   المنشورات: عددُ المتابعين لكل منصّة، وعددُ مراجعات الملف التجاري
   ومتوسّطها.

   ولا مفتاح جديد له: هو المزوّد المضبوط في «الإعدادات ← المنصات والمزوّد»
   بمفتاحه نفسه. ومفتاحان لمزوّدٍ واحد ينتهيان في وقتين.

   والمراجعتان تحت هذا المصدر لا تحت «الملف التجاري»: واجهةُ جوجل للمراجعات
   لا تزال الإصدار الرابع وتحتاج اعتماداً مستقلاً للحساب، ومزوّد النشر يقرأها
   اليوم بالمفتاح القائم. والرقم واحد في الحالين — مصدرُ جوجل نفسه. */

/** سرُّ مصدر «مزوّد النشر» — مفتاح Ayrshare. */
export async function socialSecretName(_env: Env): Promise<string> {
  return 'AYRSHARE_API_KEY';
}

/** الأيام بين تاريخين (YYYY-MM-DD) شاملاً الطرفين. */
function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** المنصات التي يردّها Ayrshare يوماً بيوم. */
const AYRSHARE_DAILY = new Set(['facebook', 'gmb', 'instagram', 'snapchat', 'tiktok', 'youtube']);

/* ═══ Ayrshare: أرقام الحساب كاملةً ═══

   كان يُقرأ منه المتابعون والمراجعات وحدها. وفيه — بالمفتاح نفسه — مشاهداتُ
   محتوى كل حساب ووصولُه وزياراتُ ملفّه والمتابعون الجدد ومن ألغى المتابعة
   ووقتُ المشاهدة والنقرُ إلى الموقع، وأداءُ الملف التجاري (الظهور والاتصال
   والاتجاهات) بقرار المالك بدل الاعتماد المستقلّ في جوجل، وتوزيعُ الجمهور.

   وأرقام الفترة من اليومي تُكتب للفترة المنقضية أيضاً — هي مجموعُ أيامها
   لا لقطةُ اليوم — ما دامت نافذة Ayrshare تغطّي أوّلها (أربعة أرباعٍ على
   الأكثر). واللقطات للفترة الجارية وحدها كما كانت. */
async function fetchAyrshareSocial(env: Env, range: SourceRange): Promise<MetricPoint[]> {
  const auth = ayrshareAuth(env);
  if (!auth) throw new SourceError('مفتاح مزوّد النشر غير مضبوط. اضبط AYRSHARE_API_KEY.');
  const today = riyadhToday();
  const out: MetricPoint[] = [];

  // إكس بلا مفتاحَي التطبيق يُرفض كل طلبٍ له — فلا يُطلب، كي لا يُسقط غيره
  const hasX = !!(auth.x?.key && auth.x.secret);
  const accounts = (await ayrshareUser(auth)).accounts.filter((a) => a.platform !== 'x' || hasX);
  const internalOf = (p: string) => accounts.find((a) => ayrsharePlatform(a.platform) === p)?.platform ?? p;

  if (range.end >= today) {
    /* المتابعون لقطةٌ لا مجموع فترة: العدد اليوم هو العدد، ولا يُجمع على أيام
       الشهر. والنموّ يُحتسب بمقارنة الفترتين في `services/metrics.ts`. */
    const wanted = accounts.filter((a) => a.platform !== 'google');
    const platforms = [...new Set(wanted.map((a) => ayrsharePlatform(a.platform)))];
    const aggregate = platforms.length ? await ayrshareSocialAnalytics(auth, platforms) : null;
    if (aggregate) {
      for (const acc of ayrshareFollowers(wanted, aggregate)) {
        if (acc.followers === null) continue; // منصّة لا تُعلن العدد — يبقى تسجيلها باليد
        out.push({ metricKey: 'followers_total', dimKey: 'platform', dimValue: acc.platform, value: acc.followers });
      }
      out.push(...ayrshareAudiencePoints(aggregate));
    }

    const ayrReviews = await ayrshareReviewSummary(auth);
    if (ayrReviews) {
      out.push({ metricKey: 'gbp_reviews', value: ayrReviews.count });
      if (ayrReviews.average !== null) out.push({ metricKey: 'gbp_rating', value: ayrReviews.average, sample: ayrReviews.count });
    }

    // لينكدإن الشخصي: متابعوه الجدد يوماً بيوم في الردّ المجموع (ثلاثون يوماً)
    const li = aggregate?.linkedin?.analytics;
    const liNew = li ? linkedInNewFollowers(li, range, today) : null;
    if (liNew !== null) out.push({ metricKey: 'new_followers', dimKey: 'platform', dimValue: internalOf('linkedin'), value: liNew });
  }

  // أرقام الفترة يوماً بيوم — الأرباعُ بقدر ما يغطّي أوّلَها، وفوق أربعةٍ لا يُطلب
  const daily = [...new Set(accounts.map((a) => ayrsharePlatform(a.platform)).filter((p) => AYRSHARE_DAILY.has(p)))];
  const quarters = Math.max(1, Math.ceil(daysBetween(range.start, today) / 85));
  if (daily.length && quarters <= 4) {
    const data = await ayrshareSocialAnalytics(auth, daily, { daily: true, quarters });
    for (const p of daily) {
      const windowStart = shiftDay(today, -(dailyWindowDays(p, quarters) - 1));
      out.push(...ayrshareDailyPoints(p, internalOf(p), data?.[p]?.analytics, range, windowStart));
    }
  }
  return out;
}

async function fetchSocial(env: Env, _cfg: SourceConfig, range: SourceRange): Promise<MetricPoint[]> {
  return fetchAyrshareSocial(env, range);
}

/* ═══ المصادر الأربعة بالعقد الواحد ═══ */

function sourceSecret(env: Env, key: string): string {
  const raw =
    key === 'ads' ? env.ADS_API_KEY :
    key === 'messaging' ? env.MESSAGING_API_KEY :
    key === 'call_tracking' ? env.CALL_TRACKING_API_KEY :
    key === 'listening' ? env.LISTENING_API_KEY :
    /* الموقع الرئيسي: الرمز نفسه الذي تحمله نقاطه العامة، فسرٌّ واحد
       للاتجاهين لا اثنان يفترقان عند التدوير. */
    key === 'website' ? env.SITE_API_TOKEN :
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
 * المصادر الثمانية التي تُسحب. ومنصة إدارة الشركة ليست منها: تلك تُنسخ مرآةً
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
      /* مؤشرات تجربة الصفحة تُقرأ من تقرير تجربة كروم لا من GA4، ومفتاحُها
         `GOOGLE_API_KEY` لا الحساب الخدمي. وبلا أحدهما تبقى الثلاثة بلا قيمة
         ويُسحب ما عداها. */
      { key: 'crux_origin', label: 'عنوان الموقع لمؤشرات تجربة الصفحة', placeholder: 'https://naf.sa' },
    ],
    fetch: fetchWebAnalytics,
  },
  social: {
    key: 'social',
    secretName: 'AYRSHARE_API_KEY',
    fields: [],
    fetch: fetchSocial,
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
  /*
   * الموقع الرئيسي — مصدرٌ يُقرأ منه ما لا يعرفه مزوّد تحليلات: عدد
   * طلبات التواصل التي وصلت فعلاً، وطلبات التوظيف، ومن اشترك في النشرة
   * من الموقع، وما نُشر من مقالات وخدمات. GA4 يرى الصفحة ولا يرى الصفّ
   * في القاعدة، ويعدّ الإرسال حدثاً لا سجلّاً — والرقمان يفترقان.
   *
   * وهو من مصادر العقد العام: الموقع يردّ `{ points: [...] }` نفسه الذي
   * تردّه بقية المصادر المتعاقَد عليها، فلا محوّل خاصّاً له.
   */
  website: {
    key: 'website',
    secretName: 'SITE_API_TOKEN',
    fields: [
      { key: 'endpoint', label: 'عنوان المصدر', placeholder: 'https://naflaw.sa/api/public/metrics' },
    ],
    fetch: (env, cfg, range) => fetchByContract(env, 'website', cfg, range),
  },
};

export { GoogleAuthError };

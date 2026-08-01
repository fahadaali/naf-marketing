/* ============================================================
   احتساب المؤشرات.

   كل مؤشر مسجَّل `source = 'auto'` في `metric_definitions` له دالّةُ احتسابٍ
   هنا، وما عداه يصل من مصدرٍ مربوط أو يُسجَّل باليد. والملفّ يُقرأ طبقةً
   طبقةً بترتيب الدليل.

   ═══ الغياب ليس صفراً ═══

   دالّةٌ لا تجد ما تحسب منه لا تكتب شيئاً. وكتابةُ صفرٍ مكان الغياب تُدخل
   الرقم في المتوسطات وفي مقارنة الفترات وفي حالة المستهدف، فيُقرأ «تكلفة
   اكتساب صفر» إنجازاً وهو غيابُ بيانات. والشاشة تعرض «لا قيمة مسجّلة لهذه
   الفترة» حيث لا صفّ — وهي جملةٌ تدعو إلى فعلٍ لا تُقرأ نتيجة.
   ============================================================ */

import type { Env } from '../types';
import { newId, nowIso } from '../util';
import { periodBoundsUtc, periodDays, previousPeriod, type Period } from './period';

export type MetricValueInput = {
  metricKey: string;
  dimKey?: string;
  dimValue?: string;
  value: number;
  sample?: number | null;
  source: 'auto' | 'integration' | 'manual';
  integrationKey?: string | null;
  enteredBy?: string | null;
  note?: string | null;
};

/** يُدوّر إلى منزلتين — الأرقام تُقرأ لا تُدقَّق حسابياً، و`3.7142857` ضجيج. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return round2((part / whole) * 100);
}

function ratio(a: number, b: number): number | null {
  if (!b) return null;
  return round2(a / b);
}

/** يكتب قيمةً واحدة — والمفتاح المركّب يجعل إعادة الاحتساب تحديثاً لا تكراراً. */
export async function upsertValue(env: Env, p: Period, v: MetricValueInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO metric_values
       (id, metric_key, period, period_start, period_end, dim_key, dim_value, value, sample,
        source, integration_key, entered_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(metric_key, period, period_start, dim_key, dim_value) DO UPDATE SET
       period_end = excluded.period_end, value = excluded.value, sample = excluded.sample,
       source = excluded.source, integration_key = excluded.integration_key,
       entered_by = excluded.entered_by, note = excluded.note,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  )
    .bind(
      newId('mv'), v.metricKey, p.kind, p.start, p.end, v.dimKey ?? '', v.dimValue ?? '',
      v.value, v.sample ?? null, v.source, v.integrationKey ?? null, v.enteredBy ?? null, v.note ?? null,
    )
    .run();
}

/** يقرأ قيمةً مفردة سبق احتسابها — تعتمد عليها المؤشرات المشتقّة. */
async function readValue(env: Env, p: Period, key: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT value FROM metric_values
     WHERE metric_key = ? AND period = ? AND period_start = ? AND dim_key = '' AND dim_value = ''`,
  )
    .bind(key, p.kind, p.start)
    .first<{ value: number }>();
  return row ? row.value : null;
}

/** كاتبٌ يطرح الغياب: `null` لا يُكتب، والصفر يُكتب لأنه قيمة. */
function writer(env: Env, p: Period) {
  return async (metricKey: string, value: number | null, extra?: Partial<MetricValueInput>) => {
    if (value === null || !Number.isFinite(value)) return;
    await upsertValue(env, p, { metricKey, value, source: 'auto', ...extra });
  };
}

/* ============================================================
   الطبقة الأولى والثانية — من لقطات التحليلات
   ============================================================ */

type SnapshotRow = {
  post_id: string | null;
  platform: string;
  reach: number;
  impressions: number;
  engagement: number;
  sent_at: string | null;
  metrics_json: string | null;
  content_type: string | null;
};

/** يجمع مقياساً خاماً من `metrics_json` عبر كل اللقطات — الأسماء كما يرسلها المزوّد. */
function sumRaw(rows: SnapshotRow[], types: string[]): number | null {
  let total = 0;
  let seen = false;
  for (const r of rows) {
    let arr: unknown[] = [];
    try {
      arr = r.metrics_json ? JSON.parse(r.metrics_json) : [];
    } catch {
      arr = [];
    }
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const key = String(m.type ?? m.name ?? '').toLowerCase();
      if (!types.includes(key)) continue;
      const n = Number(m.value);
      if (!Number.isFinite(n)) continue;
      total += n;
      seen = true;
    }
  }
  return seen ? total : null;
}

async function computeSocial(env: Env, p: Period): Promise<void> {
  const put = writer(env, p);
  const { from, to } = periodBoundsUtc(p);

  const { results: rows } = await env.DB.prepare(
    `SELECT a.post_id, a.platform, a.reach, a.impressions, a.engagement, a.sent_at, a.metrics_json,
            cp.content_type
     FROM analytics_snapshots a
     LEFT JOIN content_posts cp ON cp.id = a.post_id
     WHERE a.sent_at IS NOT NULL AND a.sent_at >= ? AND a.sent_at < ?`,
  )
    .bind(from, to)
    .all<SnapshotRow>();

  if (!rows.length) return;

  const reach = rows.reduce((s, r) => s + (r.reach || 0), 0);
  const impressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
  const engagement = rows.reduce((s, r) => s + (r.engagement || 0), 0);

  await put('reach', reach);
  await put('impressions', impressions);
  await put('engagement', engagement);
  await put('frequency', ratio(impressions, reach));
  await put('engagement_rate_reach', pct(engagement, reach), { sample: rows.length });

  await put('likes', sumRaw(rows, ['likes', 'reactions']));
  await put('comments', sumRaw(rows, ['comments']));
  await put('shares', sumRaw(rows, ['shares', 'reposts', 'retweets']));
  await put('saves', sumRaw(rows, ['saves', 'bookmarks']));

  const clicks = sumRaw(rows, ['clicks']);
  if (clicks !== null) await put('ctr', pct(clicks, impressions));

  /* متوسط مدة المشاهدة: المزوّدون يعطون مجموع وقت المشاهدة بالدقائق وعدد
     المشاهدات، والمؤشر مسجَّل `seconds`. ولا يُكتب إلا إذا وُجد الطرفان —
     قسمةٌ على مشاهداتٍ مفقودة تعطي رقماً لا معنى له. */
  const watchMinutes = sumRaw(rows, ['totaltimewatched']);
  const views = sumRaw(rows, ['views', 'view_count']);
  if (watchMinutes !== null && views) await put('avg_view_duration', round2((watchMinutes * 60) / views), { sample: views });

  const completion = sumRaw(rows, ['completionrate', 'completion_rate']);
  if (completion !== null && rows.length) await put('completion_rate', round2(completion / rows.length), { sample: rows.length });

  // معدل التفاعل حسب نوع المحتوى — للمنشورات التي عبرت هذه المنصة فقط،
  // فنوعُ المحتوى عمودٌ عندنا لا عند المزوّد.
  const byType = new Map<string, { eng: number; imp: number; n: number }>();
  for (const r of rows) {
    if (!r.content_type) continue;
    const e = byType.get(r.content_type) ?? { eng: 0, imp: 0, n: 0 };
    e.eng += r.engagement || 0;
    e.imp += r.impressions || 0;
    e.n += 1;
    byType.set(r.content_type, e);
  }
  for (const [type, e] of byType) {
    const rate = pct(e.eng, e.imp);
    if (rate !== null) await put('engagement_by_content_type', rate, { dimKey: 'content_type', dimValue: type, sample: e.n });
  }

  /* التفاعل حسب التوقيت — البُعد `يوم-ساعة` بتوقيت الرياض، رقمين لا اسمين.
     أسماء الأيام العربية نصُّ عرضٍ تبنيه الواجهة من `naf-terms`، وتخزينُها
     هنا يجعل تغيير التسمية هجرةَ بيانات. */
  const bySlot = new Map<string, { eng: number; n: number }>();
  for (const r of rows) {
    if (!r.sent_at) continue;
    const at = new Date(new Date(r.sent_at).getTime() + 3 * 60 * 60 * 1000);
    const slot = `${at.getUTCDay()}-${String(at.getUTCHours()).padStart(2, '0')}`;
    const e = bySlot.get(slot) ?? { eng: 0, n: 0 };
    e.eng += r.engagement || 0;
    e.n += 1;
    bySlot.set(slot, e);
  }
  for (const [slot, e] of bySlot) {
    await put('engagement_by_time_slot', round2(e.eng / e.n), { dimKey: 'time_slot', dimValue: slot, sample: e.n });
  }

  /* العضوي مقابل المدفوع: ما لم يُشترَ ظهورُه عضويٌّ بالتعريف. والظهور
     المدفوع من `ad_spend` لأنه الموضع الوحيد الذي يعرف ما دُفع عليه. */
  const paid = await env.DB.prepare(
    `SELECT COALESCE(SUM(impressions), 0) AS n FROM ad_spend WHERE period_start >= ? AND period_start <= ?`,
  )
    .bind(p.start, p.end)
    .first<{ n: number }>();
  const paidImpressions = paid?.n ?? 0;
  if (impressions > 0) {
    await put('organic_paid_split', pct(Math.max(impressions - paidImpressions, 0), impressions));
  }

  // نمو المتابعين — من قيم «إجمالي المتابعين» المسجّلة، وهو مؤشر مُدخَل.
  const prev = previousPeriod(p);
  const nowFollowers = await sumDimension(env, p, 'followers_total');
  const prevFollowers = await sumDimension(env, prev, 'followers_total');
  if (nowFollowers !== null && prevFollowers) {
    await put('follower_growth_rate', pct(nowFollowers - prevFollowers, prevFollowers));
  }
}

/** مجموع كل أبعاد مؤشرٍ في فترة — «إجمالي المتابعين» موزّع على المنصات. */
async function sumDimension(env: Env, p: Period, key: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT SUM(value) AS total, COUNT(*) AS n FROM metric_values
     WHERE metric_key = ? AND period = ? AND period_start = ?`,
  )
    .bind(key, p.kind, p.start)
    .first<{ total: number | null; n: number }>();
  return row && row.n > 0 ? Number(row.total ?? 0) : null;
}

/* ============================================================
   الطبقة الثانية والرابعة — من التعليقات والرسائل
   ============================================================ */

/* ═══ ما هو «التعليق النوعي» ═══
   الدليل يعرّفه: ما حمل سؤالاً حقيقياً أو طلبَ استشارة، مفصولاً عن تعليقات
   المجاملة. والفصلُ هنا بعلامة الاستفهام وبألفاظٍ يستعملها من يطلب خدمة.
   وهو تقديرٌ لا تصنيفٌ قاطع — ولذلك يُحفظ حجم العيّنة مع الرقم، ويظهر تحته
   في الشاشة كي لا يُقرأ عدّاً مضبوطاً. */
const QUALITATIVE_HINTS = [
  '؟', '?', 'استشار', 'محام', 'كم سعر', 'التكلفة', 'أحتاج', 'احتاج', 'أريد', 'اريد',
  'ممكن', 'رقم التواصل', 'تواصل', 'واتس', 'قضي', 'عقد', 'مذكرة', 'دعوى',
];

async function computeInbox(env: Env, p: Period): Promise<void> {
  const put = writer(env, p);
  const { from, to } = periodBoundsUtc(p);

  const { results } = await env.DB.prepare(
    `SELECT kind, platform, body, replied_at, created_at FROM platform_comments
     WHERE created_at >= ? AND created_at < ?`,
  )
    .bind(from, to)
    .all<{ kind: string; platform: string; body: string | null; replied_at: string | null; created_at: string }>();

  if (!results.length) return;

  const qualitative = results.filter(
    (r) => (r.kind === 'comment' || r.kind === 'dm') && QUALITATIVE_HINTS.some((h) => (r.body || '').includes(h)),
  ).length;
  await put('qualitative_comments', qualitative, { sample: results.length });

  // المحادثات المباشرة — الرسائل الخاصة، موزّعةً على القناة ومجموعةً
  const dms = results.filter((r) => r.kind === 'dm');
  await put('direct_conversations', dms.length);
  const byChannel = new Map<string, number>();
  for (const d of dms) byChannel.set(d.platform, (byChannel.get(d.platform) ?? 0) + 1);
  for (const [channel, n] of byChannel) {
    await put('direct_conversations', n, { dimKey: 'channel', dimValue: channel });
  }

  await put('first_reply_rate', pct(results.filter((r) => r.replied_at).length, results.length));

  /* زمن الاستجابة الأول — المؤشر التنافسي في القطاع القانوني: من يردّ أولاً
     غالباً يفوز بالعميل. ويُحسب على ما رُدّ عليه فقط؛ إدخالُ ما لم يُرَد
     عليه بزمنٍ مفتوح يجعل المتوسط يكبر كلما بقي سؤالٌ بلا جواب، وهو صحيحٌ
     منطقياً لكنه يخلط مؤشرين: سرعةَ الردّ ونسبةَ الردّ. والثاني مؤشر مستقلّ. */
  const replied = results.filter((r) => r.replied_at);
  if (replied.length) {
    const minutes = replied.map((r) => (new Date(r.replied_at as string).getTime() - new Date(r.created_at).getTime()) / 60_000);
    const positive = minutes.filter((m) => m >= 0);
    if (positive.length) {
      await put('first_response_minutes', round2(positive.reduce((a, b) => a + b, 0) / positive.length), { sample: positive.length });
    }
  }
}

/* ============================================================
   الطبقة الثامنة — البريد
   ============================================================ */

async function computeEmail(env: Env, p: Period): Promise<void> {
  const put = writer(env, p);
  const { from, to } = periodBoundsUtc(p);

  const sends = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
            SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
     FROM newsletter_sends
     WHERE COALESCE(sent_at, created_at) >= ? AND COALESCE(sent_at, created_at) < ?`,
  )
    .bind(from, to)
    .first<{ total: number; sent: number; failed: number; opened: number; clicked: number }>();

  if (sends && sends.total > 0) {
    const sent = sends.sent || 0;
    await put('email_open_rate', pct(sends.opened || 0, sent), { sample: sent });
    await put('email_click_rate', pct(sends.clicked || 0, sent), { sample: sent });
    // النقر إلى الفتح — أدقّ من سابقيه لأنه يقيس جودة المحتوى لا جودة العنوان
    await put('email_ctor', pct(sends.clicked || 0, sends.opened || 0), { sample: sends.opened || 0 });
    await put('email_bounce_rate', pct(sends.failed || 0, sends.total), { sample: sends.total });
  }

  // نمو القائمة وإلغاء الاشتراك — من سجلّ المشتركين لا من الإرسال
  const subs = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM subscribers WHERE created_at < ?) AS at_start,
       (SELECT COUNT(*) FROM subscribers WHERE created_at >= ? AND created_at < ?) AS joined,
       (SELECT COUNT(*) FROM subscribers WHERE unsubscribed_at >= ? AND unsubscribed_at < ?) AS left_list`,
  )
    .bind(from, from, to, from, to)
    .first<{ at_start: number; joined: number; left_list: number }>();

  if (subs && subs.at_start > 0) {
    await put('list_growth_rate', pct((subs.joined || 0) - (subs.left_list || 0), subs.at_start), { sample: subs.at_start });
    await put('email_unsubscribe_rate', pct(subs.left_list || 0, subs.at_start), { sample: subs.at_start });
  }

  /* أثر اختبار العنوانين — الفرق بين معدّل فتح العنوان الفائز والخاسر.
     يُحسب على النشرات التي حُسم فيها الاختبار في هذه الفترة وحدها. */
  const ab = await env.DB.prepare(
    `SELECT n.id, n.ab_winner,
            SUM(CASE WHEN s.variant = 'a' THEN 1 ELSE 0 END) AS sent_a,
            SUM(CASE WHEN s.variant = 'a' AND s.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS open_a,
            SUM(CASE WHEN s.variant = 'b' THEN 1 ELSE 0 END) AS sent_b,
            SUM(CASE WHEN s.variant = 'b' AND s.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS open_b
     FROM newsletters n JOIN newsletter_sends s ON s.newsletter_id = n.id
     WHERE n.ab_winner IS NOT NULL AND n.sent_at >= ? AND n.sent_at < ?
     GROUP BY n.id`,
  )
    .bind(from, to)
    .all<{ sent_a: number; open_a: number; sent_b: number; open_b: number }>();

  const lifts: number[] = [];
  for (const r of ab.results) {
    if (!r.sent_a || !r.sent_b) continue;
    const a = (r.open_a / r.sent_a) * 100;
    const b = (r.open_b / r.sent_b) * 100;
    const loser = Math.min(a, b);
    if (loser <= 0) continue;
    lifts.push(((Math.max(a, b) - loser) / loser) * 100);
  }
  if (lifts.length) {
    await put('ab_test_lift', round2(lifts.reduce((x, y) => x + y, 0) / lifts.length), { sample: lifts.length });
  }
}

/* ============================================================
   الطبقة العاشرة — التشغيل
   ============================================================ */

async function computeOperations(env: Env, p: Period): Promise<void> {
  const put = writer(env, p);
  const { from, to } = periodBoundsUtc(p);

  /* الالتزام بخطة النشر: من كل ما استُحقّ نشره في هذه الفترة، كم نُشر فعلاً.
     والمقام هو المجدول لا المنشور — وإلا كانت النسبة مئةً دائماً. */
  const sched = await env.DB.prepare(
    `SELECT COUNT(*) AS due, SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS done
     FROM schedules WHERE scheduled_at >= ? AND scheduled_at < ?`,
  )
    .bind(from, to)
    .first<{ due: number; done: number }>();
  if (sched && sched.due > 0) {
    await put('calendar_adherence', pct(sched.done || 0, sched.due), { sample: sched.due });
  }

  /* زمن دورة الاعتماد: من إنشاء المحتوى إلى نشره — الدورة الثلاثية كاملةً
     كما يسمّيها الدليل، لا خطوةً منها. */
  const cycle = await env.DB.prepare(
    `SELECT AVG((julianday(a.created_at) - julianday(p.created_at)) * 24) AS hours, COUNT(*) AS n
     FROM approvals a JOIN content_posts p ON p.id = a.post_id
     WHERE a.to_status = 'published' AND a.created_at >= ? AND a.created_at < ?`,
  )
    .bind(from, to)
    .first<{ hours: number | null; n: number }>();
  if (cycle && cycle.n > 0 && cycle.hours !== null) {
    await put('approval_cycle_hours', round2(cycle.hours), { sample: cycle.n });
  }
}

/* ============================================================
   الطبقات الرابعة والخامسة والسادسة والسابعة — من مرآة إدارة المكتب
   ============================================================ */

async function settingList(env: Env, key: string): Promise<string[]> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  try {
    const parsed = JSON.parse(row?.value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** حالات المحتمل التي تُعدّ خسارة — مصدرها إعدادات تلك المنصة الافتراضية. */
const LOST_STATUSES = ['غير مناسب', 'تم الرفض'];

/** ما يدلّ على أن المحتمل جاء بتوصية عميل قائم — والقناة الأعلى تحويلاً في القطاع. */
const REFERRAL_HINTS = ['إحالة', 'احالة', 'توصية', 'referral'];

async function computeFunnel(env: Env, p: Period): Promise<void> {
  const put = writer(env, p);
  const { from, to } = periodBoundsUtc(p);
  const mqlStatuses = await settingList(env, 'mql_statuses');
  const sqlStatuses = await settingList(env, 'sql_statuses');

  const { results: leads } = await env.DB.prepare(
    `SELECT id, source, status, expected_value, phone, email, created_at, converted_client_id
     FROM crm_leads WHERE created_at >= ? AND created_at < ?`,
  )
    .bind(from, to)
    .all<{
      id: string; source: string | null; status: string | null; expected_value: number | null;
      phone: string | null; email: string | null; created_at: string; converted_client_id: string | null;
    }>();

  if (!leads.length) return;

  await put('leads', leads.length);

  const bySource = new Map<string, number>();
  for (const l of leads) bySource.set(l.source || 'غير معروف', (bySource.get(l.source || 'غير معروف') ?? 0) + 1);
  for (const [source, n] of bySource) await put('leads_by_source', n, { dimKey: 'source', dimValue: source });

  const mqls = leads.filter((l) => l.status && mqlStatuses.includes(l.status));
  const sqls = leads.filter((l) => l.status && sqlStatuses.includes(l.status));
  await put('mql', mqls.length);
  await put('sql', sqls.length);
  await put('lead_quality_ratio', pct(mqls.length, leads.length), { sample: leads.length });

  const mqlBySource = new Map<string, number>();
  for (const l of mqls) mqlBySource.set(l.source || 'غير معروف', (mqlBySource.get(l.source || 'غير معروف') ?? 0) + 1);
  for (const [source, n] of mqlBySource) await put('mql_by_source', n, { dimKey: 'source', dimValue: source });

  // نسبة الإحالات — القناة الأقلّ تكلفةً والأعلى تحويلاً في القطاع القانوني
  const referrals = leads.filter((l) => REFERRAL_HINTS.some((h) => (l.source || '').includes(h)));
  await put('referral_rate', pct(referrals.length, leads.length), { sample: leads.length });

  // أسباب الخسارة — بحالة المحتمل، وهي أقصى ما يحمله المصدر اليوم
  const lost = leads.filter((l) => l.status && LOST_STATUSES.includes(l.status));
  if (lost.length) {
    const byReason = new Map<string, number>();
    for (const l of lost) byReason.set(l.status as string, (byReason.get(l.status as string) ?? 0) + 1);
    for (const [reason, n] of byReason) await put('loss_reasons', n, { dimKey: 'reason', dimValue: reason });
  }

  /* اكتمال البيانات: مصدرٌ وجهةُ اتصالٍ وتصنيف — الثلاثة التي يذكرها الدليل.
     وسجلٌّ ناقصٌ منها لا يدخل أي تحليل مصدرٍ أو شريحة، فيُخرج نفسه من كل رقم بعده. */
  const complete = leads.filter((l) => l.source && (l.phone || l.email) && l.status).length;
  await put('data_completeness', pct(complete, leads.length), { sample: leads.length });

  // التكرار: جوالٌ أو بريدٌ يتكرّر بين سجلّين
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();
  let duplicates = 0;
  for (const l of leads) {
    const ph = (l.phone || '').replace(/\D/g, '').slice(-9);
    const em = (l.email || '').trim().toLowerCase();
    const dupPhone = ph.length === 9 && seenPhone.has(ph);
    const dupEmail = em !== '' && seenEmail.has(em);
    if (dupPhone || dupEmail) duplicates++;
    if (ph.length === 9) seenPhone.add(ph);
    if (em !== '') seenEmail.add(em);
  }
  await put('duplicate_rate', pct(duplicates, leads.length), { sample: leads.length });

  /* التحويل على كل مرحلة. المراحل الستّ في السجلّ، وثلاثةٌ منها لها بيانات
     اليوم: الزائر من تحليلات الموقع، والمحتمل والمؤهل من هذه المرآة،
     والتعاقد من القضايا. والاجتماعُ والعرضُ لا يسجّلهما المصدر بعد، فلا
     يُكتب لهما رقم — وغيابُهما في الشاشة ثغرةٌ معروفة لا صفرٌ يُقرأ فشلاً. */
  const sessions = await readValue(env, p, 'sessions');
  const contracts = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM crm_cases WHERE created_at >= ? AND created_at < ?`,
  )
    .bind(from, to)
    .first<{ n: number }>();
  const contractCount = contracts?.n ?? 0;

  if (sessions) await put('stage_conversion', pct(leads.length, sessions), { dimKey: 'stage', dimValue: 'visitor_lead' });
  await put('stage_conversion', pct(mqls.length, leads.length), { dimKey: 'stage', dimValue: 'lead_qualified' });
  await put('stage_conversion', pct(contractCount, mqls.length), { dimKey: 'stage', dimValue: 'qualified_contract' });
  await put('qualified_to_contract', pct(contractCount, mqls.length), { sample: mqls.length });
}

async function computeCrmRevenue(env: Env, p: Period): Promise<void> {
  const put = writer(env, p);
  const { from, to } = periodBoundsUtc(p);

  const cases = await env.DB.prepare(
    `SELECT id, client_id, status, outcome, fee_amount, collected_amount, created_at
     FROM crm_cases WHERE created_at >= ? AND created_at < ?`,
  )
    .bind(from, to)
    .all<{
      id: string; client_id: string | null; status: string | null; outcome: string | null;
      fee_amount: number | null; collected_amount: number | null; created_at: string;
    }>();

  // متوسط قيمة العقد — على ما له قيمة مسجّلة، والغياب يُستثنى لا يُصفَّر
  const valued = cases.results.filter((c) => c.fee_amount !== null && c.fee_amount > 0);
  if (valued.length) {
    await put('acv', round2(valued.reduce((s, c) => s + (c.fee_amount || 0), 0) / valued.length), { sample: valued.length });
  }

  // معدل الإغلاق — على ما حُسم وحده: قضيةٌ جارية ليست خسارة
  const decided = cases.results.filter((c) => c.outcome === 'won' || c.outcome === 'lost');
  if (decided.length) {
    await put('win_rate', pct(decided.filter((c) => c.outcome === 'won').length, decided.length), { sample: decided.length });
  }

  // إيراد التوسّع — ما جاء من عميلٍ له أكثر من عقد في الفترة
  const perClient = new Map<string, { n: number; extra: number }>();
  for (const c of cases.results) {
    if (!c.client_id) continue;
    const e = perClient.get(c.client_id) ?? { n: 0, extra: 0 };
    if (e.n >= 1) e.extra += c.collected_amount ?? c.fee_amount ?? 0;
    e.n += 1;
    perClient.set(c.client_id, e);
  }
  const expansion = Array.from(perClient.values()).reduce((s, e) => s + e.extra, 0);
  if (perClient.size) await put('expansion_revenue', round2(expansion), { sample: perClient.size });

  /* زمن دورة البيع — من أول تواصلٍ بالمحتمل إلى أول عقدٍ لعميله. ويعتمد على
     ربط المحتمل بالعميل في المرآة، وهو الربط الذي يزول عند المصدر بالتحويل. */
  const cycle = await env.DB.prepare(
    `SELECT AVG(julianday(k.first_case) - julianday(l.created_at)) AS days, COUNT(*) AS n
     FROM crm_leads l
     JOIN (SELECT client_id, MIN(created_at) AS first_case FROM crm_cases
           WHERE client_id IS NOT NULL GROUP BY client_id) k
       ON k.client_id = l.converted_client_id
     WHERE l.converted_client_id IS NOT NULL AND l.created_at IS NOT NULL
       AND k.first_case >= ? AND k.first_case < ? AND k.first_case > l.created_at`,
  )
    .bind(from, to)
    .first<{ days: number | null; n: number }>();
  if (cycle && cycle.n > 0 && cycle.days !== null) {
    await put('sales_cycle_days', round2(cycle.days), { sample: cycle.n });
  }

  /* الاحتفاظ والتسرب — على من كان عميلاً قبل بداية الفترة وحده. وإدخالُ من
     انضمّ داخلها يرفع النسبة بلا سبب: عميلٌ انضمّ أمس لم تُختبر مواصلتُه بعد. */
  const retention = await env.DB.prepare(
    `SELECT COUNT(*) AS base, SUM(CASE WHEN status = 'current' THEN 1 ELSE 0 END) AS kept
     FROM crm_clients WHERE join_date IS NOT NULL AND join_date < ?`,
  )
    .bind(p.start)
    .first<{ base: number; kept: number }>();
  if (retention && retention.base > 0) {
    const rate = pct(retention.kept || 0, retention.base);
    await put('retention_rate', rate, { sample: retention.base });
    if (rate !== null) await put('churn_rate', round2(100 - rate), { sample: retention.base });
  }

  // القيمة العمرية — متوسط ما حصّله العميل الواحد عبر كل عقوده
  const ltvRow = await env.DB.prepare(
    `SELECT AVG(total) AS ltv, COUNT(*) AS n FROM (
       SELECT client_id, SUM(COALESCE(collected_amount, fee_amount, 0)) AS total
       FROM crm_cases WHERE client_id IS NOT NULL GROUP BY client_id)`,
  ).first<{ ltv: number | null; n: number }>();
  if (ltvRow && ltvRow.n > 0 && ltvRow.ltv) await put('ltv', round2(ltvRow.ltv), { sample: ltvRow.n });

  /* الإيراد المتكرر السنوي — مجموع ما حُصّل في الاثني عشر شهراً المنتهية
     بنهاية الفترة. والنافذة متحرّكة لا سنةٌ تقويمية: الربع الأول من سنةٍ
     جديدة لا يُقرأ إيرادُه ربعَ ما كان. */
  const yearAgo = new Date(new Date(to).getTime() - 365 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const arr = await env.DB.prepare(
    `SELECT COALESCE(SUM(COALESCE(collected_amount, 0)), 0) AS total, COUNT(*) AS n
     FROM crm_cases WHERE created_at >= ? AND created_at < ?`,
  )
    .bind(yearAgo, to)
    .first<{ total: number; n: number }>();
  if (arr && arr.n > 0) await put('arr', round2(arr.total), { sample: arr.n });

  // الشرائح عالية القيمة — متوسط ما يُحصَّل من كل تصنيف عميل
  const segments = await env.DB.prepare(
    `SELECT c.client_type AS segment, AVG(k.total) AS avg_value, COUNT(*) AS n FROM (
       SELECT client_id, SUM(COALESCE(collected_amount, fee_amount, 0)) AS total
       FROM crm_cases WHERE client_id IS NOT NULL GROUP BY client_id) k
     JOIN crm_clients c ON c.id = k.client_id
     WHERE c.client_type IS NOT NULL GROUP BY c.client_type`,
  ).all<{ segment: string; avg_value: number; n: number }>();
  for (const s of segments.results) {
    await put('high_value_segments', round2(s.avg_value), { dimKey: 'segment', dimValue: s.segment, sample: s.n });
  }

  // احتفاظ الدفعة — العملاء مجموعين بشهر انضمامهم
  const cohorts = await env.DB.prepare(
    `SELECT substr(join_date, 1, 7) AS cohort, COUNT(*) AS n,
            SUM(CASE WHEN status = 'current' THEN 1 ELSE 0 END) AS kept
     FROM crm_clients WHERE join_date IS NOT NULL
     GROUP BY cohort ORDER BY cohort DESC LIMIT 12`,
  ).all<{ cohort: string; n: number; kept: number }>();
  for (const c of cohorts.results) {
    await put('cohort_retention', pct(c.kept, c.n), { dimKey: 'cohort', dimValue: c.cohort, sample: c.n });
  }
}

/* ============================================================
   الطبقة الخامسة — التكلفة والعائد
   ============================================================ */

async function computeCost(env: Env, p: Period): Promise<void> {
  const put = writer(env, p);
  const { from, to } = periodBoundsUtc(p);

  const spendRows = await env.DB.prepare(
    `SELECT platform, SUM(amount) AS amount, SUM(impressions) AS impressions, SUM(clicks) AS clicks
     FROM ad_spend WHERE period_start >= ? AND period_start <= ? GROUP BY platform`,
  )
    .bind(p.start, p.end)
    .all<{ platform: string; amount: number; impressions: number; clicks: number }>();

  const adSpend = spendRows.results.reduce((s, r) => s + (r.amount || 0), 0);
  const adImpressions = spendRows.results.reduce((s, r) => s + (r.impressions || 0), 0);
  const adClicks = spendRows.results.reduce((s, r) => s + (r.clicks || 0), 0);

  if (spendRows.results.length) {
    await put('ad_spend', round2(adSpend));
    for (const r of spendRows.results) {
      await put('ad_spend', round2(r.amount || 0), { dimKey: 'platform', dimValue: r.platform });
    }
    if (adImpressions) await put('cpm', round2((adSpend / adImpressions) * 1000));
    if (adClicks) await put('cpc', ratio(adSpend, adClicks));
  }

  /* تكلفة اكتساب العميل تشمل أربعة بنود لا بنداً واحداً — والدليل صريح فيها:
     الإنفاق الإعلاني، وأجور الفريق، والأدوات والاشتراكات، وتكلفة وقت الشركاء.
     وحسابُها من الإعلان وحده يعطي رقماً جميلاً لا يصف شيئاً. والثلاثة الأخيرة
     مُدخَلة، فما لم يُسجَّل منها يُعدّ صفراً — وهذا صفرُ تكلفةٍ حقيقي لا غياب. */
  const team = (await readValue(env, p, 'team_cost')) ?? 0;
  const tools = (await readValue(env, p, 'tools_cost')) ?? 0;
  const partners = (await readValue(env, p, 'partner_time_cost')) ?? 0;
  const marketingCost = adSpend + team + tools + partners;

  const leadCount = await readValue(env, p, 'leads');
  const mqlCount = await readValue(env, p, 'mql');
  if (marketingCost > 0 && leadCount) await put('cpl', ratio(marketingCost, leadCount));
  if (marketingCost > 0 && mqlCount) await put('cpql', ratio(marketingCost, mqlCount));

  // العملاء الجدد في الفترة — مقام تكلفة الاكتساب
  const newClients = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM crm_clients WHERE join_date >= ? AND join_date <= ?`,
  )
    .bind(p.start, p.end)
    .first<{ n: number }>();

  let cac: number | null = null;
  if (marketingCost > 0 && newClients && newClients.n > 0) {
    cac = ratio(marketingCost, newClients.n);
    await put('cac', cac, { sample: newClients.n });
  }

  // الإيراد المنسوب للفترة — ما حُصّل من عقودٍ أُنشئت فيها
  const revenueRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(COALESCE(collected_amount, 0)), 0) AS revenue, COUNT(*) AS n
     FROM crm_cases WHERE created_at >= ? AND created_at < ?`,
  )
    .bind(from, to)
    .first<{ revenue: number; n: number }>();
  const revenue = revenueRow?.revenue ?? 0;

  if (adSpend > 0 && revenue > 0) await put('roas', ratio(revenue, adSpend));
  if (marketingCost > 0 && revenue > 0) {
    await put('romi', pct(revenue - marketingCost, marketingCost));
    await put('spend_of_revenue', pct(marketingCost, revenue));
  }

  const ltv = await readValue(env, p, 'ltv');
  if (ltv && cac) await put('ltv_cac_ratio', ratio(ltv, cac));

  /* فترة استرداد تكلفة الاكتساب — بالأيام: كم يوماً يحتاج العميل ليغطّي ما
     كلّفه اكتسابُه، بمعدّل إيراده اليومي في هذه الفترة. */
  if (cac && revenue > 0 && newClients && newClients.n > 0) {
    const dailyPerClient = revenue / newClients.n / periodDays(p);
    if (dailyPerClient > 0) await put('cac_payback', round2(cac / dailyPerClient));
  }
}

/* ============================================================
   المُشغّل
   ============================================================ */

export type ComputeResult = { period: Period; written: number };

/**
 * يحتسب كل مؤشر آليّ لفترةٍ واحدة.
 *
 * والترتيب ليس اعتباطاً: التكلفة تقرأ «العملاء المحتملون» و«المؤهلون»
 * و«القيمة العمرية» من قيمٍ كُتبت قبلها في المسار نفسه، ومسار البيع يقرأ
 * «الجلسات» التي كتبها سحبُ تحليلات الموقع. فما يُقرأ يُكتب أوّلاً.
 */
export async function computeAuto(env: Env, p: Period): Promise<ComputeResult> {
  const before = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM metric_values WHERE period = ? AND period_start = ?`,
  )
    .bind(p.kind, p.start)
    .first<{ n: number }>();

  await computeSocial(env, p);
  await computeInbox(env, p);
  await computeEmail(env, p);
  await computeOperations(env, p);
  await computeFunnel(env, p);
  await computeCrmRevenue(env, p);
  await computeCost(env, p); // آخرها: يقرأ ما كتبته الثلاثة قبله

  const after = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM metric_values WHERE period = ? AND period_start = ?`,
  )
    .bind(p.kind, p.start)
    .first<{ n: number }>();

  return { period: p, written: Math.max((after?.n ?? 0) - (before?.n ?? 0), 0) };
}

/* ============================================================
   القراءة للعرض
   ============================================================ */

export type MetricDefinition = {
  key: string;
  layer: string;
  name_ar: string;
  name_en: string;
  unit: string;
  class: string;
  source: string;
  integration_key: string | null;
  cadence: string;
  dim_key: string;
  target_value: number | null;
  target_direction: string;
  target_min: number | null;
  target_max: number | null;
  board_rank: number | null;
  sort: number;
};

export type MetricReading = MetricDefinition & {
  value: number | null;
  sample: number | null;
  value_source: string | null;
  updated_at: string | null;
  note: string | null;
  previous: number | null;
  /** التوزيع على البُعد إن كان للمؤشر بُعد. */
  breakdown: { dim_value: string; value: number; sample: number | null }[];
};

/** تعريفات المؤشرات كاملةً — الدليل كما هو، بلا تصفية. */
export async function listDefinitions(env: Env, layer?: string): Promise<MetricDefinition[]> {
  const sql = layer
    ? 'SELECT * FROM metric_definitions WHERE layer = ? ORDER BY sort'
    : 'SELECT * FROM metric_definitions ORDER BY sort';
  const stmt = layer ? env.DB.prepare(sql).bind(layer) : env.DB.prepare(sql);
  const { results } = await stmt.all<MetricDefinition>();
  return results;
}

/**
 * قراءةُ طبقةٍ في فترة — التعريف والقيمة والقيمة السابقة والتوزيع معاً.
 *
 * وتُقرأ الفترة السابقة في النداء نفسه: الاتجاه جزءٌ من الرقم لا إضافةٌ
 * عليه، ورقمٌ بلا مقارنة زمنية لا يعني شيئاً — وهي القاعدة الثالثة في
 * ملاحظات الدليل الختامية.
 */
export async function readLayer(env: Env, p: Period, layer?: string): Promise<MetricReading[]> {
  const defs = await listDefinitions(env, layer);
  if (!defs.length) return [];

  const prev = previousPeriod(p);
  const keys = defs.map((d) => d.key);
  const placeholders = keys.map(() => '?').join(', ');

  const { results: values } = await env.DB.prepare(
    `SELECT metric_key, dim_key, dim_value, value, sample, source, updated_at, note
     FROM metric_values
     WHERE period = ? AND period_start = ? AND metric_key IN (${placeholders})`,
  )
    .bind(p.kind, p.start, ...keys)
    .all<{
      metric_key: string; dim_key: string; dim_value: string; value: number;
      sample: number | null; source: string; updated_at: string; note: string | null;
    }>();

  const { results: prevValues } = await env.DB.prepare(
    `SELECT metric_key, value FROM metric_values
     WHERE period = ? AND period_start = ? AND dim_key = '' AND dim_value = '' AND metric_key IN (${placeholders})`,
  )
    .bind(prev.kind, prev.start, ...keys)
    .all<{ metric_key: string; value: number }>();

  const prevMap = new Map(prevValues.map((r) => [r.metric_key, r.value]));

  return defs.map((d) => {
    const rows = values.filter((v) => v.metric_key === d.key);
    const total = rows.find((v) => v.dim_key === '' && v.dim_value === '');
    const breakdown = rows
      .filter((v) => v.dim_value !== '')
      .sort((a, b) => b.value - a.value)
      .map((v) => ({ dim_value: v.dim_value, value: v.value, sample: v.sample }));

    return {
      ...d,
      value: total ? total.value : null,
      sample: total ? total.sample : null,
      value_source: total ? total.source : null,
      updated_at: total ? total.updated_at : null,
      note: total ? total.note : null,
      previous: prevMap.get(d.key) ?? null,
      breakdown,
    };
  });
}

/** اللوحة المختصرة — عشرة أرقام بترتيبها المسجَّل. */
export async function readBoard(env: Env, p: Period): Promise<MetricReading[]> {
  const all = await readLayer(env, p);
  return all
    .filter((m) => m.board_rank !== null)
    .sort((a, b) => (a.board_rank as number) - (b.board_rank as number));
}

/** سلسلةٌ زمنية لمؤشر — للاتجاه عبر فترات، لا لفترة واحدة. */
export async function readSeries(
  env: Env,
  metricKey: string,
  kind: Period['kind'],
  limit = 12,
): Promise<{ period_start: string; value: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT period_start, value FROM metric_values
     WHERE metric_key = ? AND period = ? AND dim_key = '' AND dim_value = ''
     ORDER BY period_start DESC LIMIT ?`,
  )
    .bind(metricKey, kind, limit)
    .all<{ period_start: string; value: number }>();
  return results.reverse();
}

/** يسجّل قيمةً باليد — تحمل اسم من أدخلها ووقته، فتُدقَّق كما يُدقَّق المسحوب. */
export async function recordManual(
  env: Env,
  p: Period,
  input: { metricKey: string; dimValue?: string; value: number; note?: string | null },
  userId: string,
): Promise<void> {
  const def = await env.DB.prepare('SELECT dim_key FROM metric_definitions WHERE key = ?')
    .bind(input.metricKey)
    .first<{ dim_key: string }>();
  if (!def) throw new Error(`مؤشر غير مسجَّل: ${input.metricKey}`);

  await upsertValue(env, p, {
    metricKey: input.metricKey,
    dimKey: input.dimValue ? def.dim_key : '',
    dimValue: input.dimValue ?? '',
    value: input.value,
    source: 'manual',
    enteredBy: userId,
    note: input.note ?? null,
  });
}

export { nowIso };

import type { Env } from '../types';
import { buildXlsx, type Sheet } from './xlsx';
import { isConfigured, getMgmtProjectId, createAttachment, getRootVaultId, ensureSubVault, createUpload } from './basecamp';
import { readBoard, readLayer } from './metrics';
import { periodOf } from './period';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REPORT_FOLDER = 'تقارير الأداء الأسبوعية (آلي)';
const MONTHLY_REPORT_FOLDER = 'تقارير الأداء الشهرية (آلي)';

export type ReportPeriod = 'week' | 'month';

const STATUS_AR: Record<string, string> = {
  draft: 'مسودة', pending_marketing: 'بانتظار مراجعة التسويق', pending_gm: 'بانتظار اعتماد المدير العام',
  approved: 'معتمد', scheduled: 'مجدول', published: 'منشور', archived: 'مؤرشف', rejected: 'مرفوض',
};
const SOURCE_AR: Record<string, string> = { manual: 'يدوي', ai: 'ذكاء اصطناعي', rss: 'خبر RSS' };

/* مفردات المؤشرات — كلها من `naf-terms.md` §١٣. ولا تُشتقّ من الواجهة:
   هذا الملفّ يعمل في `Cron` بلا متصفّح، ونسخُها هنا نسخةٌ من السجلّ لا منها. */
const LAYER_AR: Record<string, string> = {
  reach: 'الوصول والظهور', engagement: 'التفاعل والمحتوى', web: 'الموقع والبحث',
  funnel: 'التحويل ومسار البيع', cost: 'التكلفة والعائد', retention: 'الاحتفاظ والنمو',
  audience: 'الجمهور والاستهداف', email: 'البريد والتواصل', attribution: 'الإسناد والقياس',
  operations: 'التشغيل وجودة البيانات',
};
const CLASS_AR: Record<string, string> = {
  north_star: 'مؤشر قيادي', operational: 'مؤشر تشغيل', vanity: 'مؤشر غرور',
};
const SOURCE_AR_METRIC: Record<string, string> = {
  auto: 'محتسب', integration: 'من تكامل', manual: 'مُدخَل',
};
const CADENCE_AR: Record<string, string> = {
  weekly: 'أسبوعياً', monthly: 'شهرياً', quarterly: 'ربعياً', annual: 'سنوياً',
};
const UNIT_AR: Record<string, string> = {
  count: 'عدد', percentage: 'نسبة مئوية', currency: 'ريال', ratio: 'نسبة إلى واحد',
  days: 'يوم', hours: 'ساعة', minutes: 'دقيقة', seconds: 'ثانية',
  rank: 'ترتيب', score: 'درجة', rating: 'تقييم',
};

function riyadh(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch { return iso; }
}

// يبني مصنّف Excel تفصيلياً بالأعمال والتحليلات لفترة أسبوعية أو شهرية
export async function buildReportWorkbook(env: Env, period: ReportPeriod = 'week'): Promise<{ bytes: Uint8Array; filename: string; sheets: Sheet[] }> {
  const days = period === 'month' ? 30 : 7;
  const periodLabel = period === 'month' ? 'الشهري' : 'الأسبوعي';
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const q = (sql: string, ...binds: any[]) => env.DB.prepare(sql).bind(...binds).all<any>();
  const one = (sql: string, ...binds: any[]) => env.DB.prepare(sql).bind(...binds).first<any>();

  // ملخص الأعمال (الفترة + الحالة العامة)
  const createdPeriod = (await one('SELECT COUNT(*) c FROM content_posts WHERE created_at >= ?', since))?.c || 0;
  const apprPeriod = (await one('SELECT COUNT(*) c FROM approvals WHERE created_at >= ?', since))?.c || 0;
  const publishedPeriod = (await one("SELECT COUNT(DISTINCT post_id) c FROM approvals WHERE to_status='published' AND created_at >= ?", since))?.c || 0;
  const rejectedPeriod = (await one("SELECT COUNT(*) c FROM approvals WHERE to_status='rejected' AND created_at >= ?", since))?.c || 0;
  const scheduledPeriod = (await one("SELECT COUNT(*) c FROM schedules WHERE created_at >= ?", since))?.c || 0;
  const byStatus = (await q('SELECT status, COUNT(*) c FROM content_posts GROUP BY status')).results;

  const summary: (string | number)[][] = [
    [`تقرير الأداء ${periodLabel} — منصة ناف للتسويق`],
    ['تاريخ التوليد', riyadh(new Date().toISOString())],
    [],
    [`ملخص أعمال الفترة (آخر ${days} يوماً)`],
    ['محتوى أُنشئ', createdPeriod],
    ['إجراءات اعتماد', apprPeriod],
    ['منشورات نُشرت', publishedPeriod],
    ['مرفوضات', rejectedPeriod],
    ['عمليات جدولة', scheduledPeriod],
    [],
    ['توزيع المحتوى حسب الحالة (إجمالي)'],
    ['الحالة', 'العدد'],
    ...byStatus.map((r: any) => [STATUS_AR[r.status] || r.status, r.c]),
  ];

  // كل المحتوى
  const posts = (await q(
    `SELECT p.title, p.status, p.source, p.content_type, u.name author, cm.name campaign, p.created_at, p.updated_at
     FROM content_posts p LEFT JOIN users u ON u.id=p.author_id LEFT JOIN campaigns cm ON cm.id=p.campaign_id
     ORDER BY p.updated_at DESC`,
  )).results;
  const content: (string | number)[][] = [
    ['العنوان', 'الحالة', 'المصدر', 'النوع', 'الكاتب', 'الحملة', 'أُنشئ', 'آخر تحديث'],
    ...posts.map((p: any) => [p.title, STATUS_AR[p.status] || p.status, SOURCE_AR[p.source] || p.source, p.content_type, p.author || '', p.campaign || '', riyadh(p.created_at), riyadh(p.updated_at)]),
  ];

  // سجل الاعتمادات خلال الفترة
  const appr = (await q(
    `SELECT p.title, a.from_status, a.to_status, u.name actor, a.note, a.created_at
     FROM approvals a LEFT JOIN content_posts p ON p.id=a.post_id LEFT JOIN users u ON u.id=a.actor_id
     WHERE a.created_at >= ? ORDER BY a.created_at DESC`, since,
  )).results;
  const approvals: (string | number)[][] = [
    ['المنشور', 'من', 'إلى', 'المنفّذ', 'ملاحظة', 'الوقت'],
    ...appr.map((a: any) => [a.title || '', STATUS_AR[a.from_status] || a.from_status || '', STATUS_AR[a.to_status] || a.to_status, a.actor || '', a.note || '', riyadh(a.created_at)]),
  ];

  // تحليلات المنصات (نموذج upsert: سطر حديث واحد لكل منشور، مجمّعة حسب المنصة)
  const byPlat = (await q('SELECT platform, SUM(reach) reach, SUM(impressions) impressions, SUM(engagement) engagement FROM analytics_snapshots GROUP BY platform ORDER BY impressions DESC')).results;
  const platforms: (string | number)[][] = [
    ['المنصة', 'الوصول', 'الانطباعات', 'التفاعل'],
    ...byPlat.map((p: any) => [p.platform, p.reach || 0, p.impressions || 0, p.engagement || 0]),
  ];

  // تحليلات المنشورات
  const byPost = (await q("SELECT COALESCE(title,'—') title, platform, reach, impressions, engagement, captured_at, via_platform FROM analytics_snapshots ORDER BY impressions DESC")).results;
  const postAnalytics: (string | number)[][] = [
    ['المنشور', 'المنصة', 'المصدر', 'الوصول', 'الانطباعات', 'التفاعل', 'وقت القياس'],
    ...byPost.map((r: any) => [r.title || '', r.platform, r.via_platform ? 'عبر المنصة' : 'خارجي', r.reach || 0, r.impressions || 0, r.engagement || 0, riyadh(r.captured_at)]),
  ];

  /* ═══ المؤشرات ═══
     التقرير كان يحمل ما تعرفه المنصة عن منشوراتها وحدها — وهي الطبقتان
     الأوليان من عشر. ومن يقرؤه شهرياً لا يرى فيه رقماً واحداً من الطبقة
     الرابعة، وهي أهمّها لشركة استشارات قانونية. */
  const metricPeriod = periodOf(period === 'month' ? 'monthly' : 'weekly');
  const board = await readBoard(env, metricPeriod);
  const boardRows: (string | number)[][] = [
    [`اللوحة المختصرة — ${period === 'month' ? 'الشهر' : 'الأسبوع'} المنتهي`],
    ['الفترة', `${metricPeriod.start} — ${metricPeriod.end}`],
    [],
    ['#', 'المؤشر', 'القيمة', 'الوحدة', 'المستهدف', 'المعيار القطاعي', 'الفترة السابقة', 'المصدر', 'القرار المحتمل'],
    ...board.map((m) => [
      m.board_rank ?? '',
      m.name_ar,
      // القيمة الغائبة تُكتب صراحةً: خانةٌ فارغة في جدول تُقرأ صفراً
      m.value === null ? 'لا قيمة مسجّلة' : m.value,
      UNIT_AR[m.unit] ?? m.unit,
      m.target_value ?? 'لا مستهدف',
      m.benchmark_value ?? '',
      m.previous ?? 'لا مقارنة',
      SOURCE_AR_METRIC[m.value_source ?? ''] ?? '',
      m.decision ?? '',
    ]),
  ];

  const allMetrics = await readLayer(env, metricPeriod);
  const layerRows: (string | number)[][] = [
    ['الطبقة', 'المؤشر', 'الفئة', 'القيمة', 'الوحدة', 'المستهدف', 'المعيار القطاعي', 'المصدر', 'حجم العيّنة'],
    ...allMetrics.map((m) => [
      LAYER_AR[m.layer] ?? m.layer,
      m.name_ar,
      CLASS_AR[m.class] ?? m.class,
      m.value === null ? 'لا قيمة مسجّلة' : m.value,
      UNIT_AR[m.unit] ?? m.unit,
      m.target_value ?? 'لا مستهدف',
      m.benchmark_value ?? '',
      SOURCE_AR_METRIC[m.value_source ?? ''] ?? '',
      m.sample ?? '',
    ]),
  ];

  /* ورقةُ المستحقّ للمراجعة — الدورية وحدها لا تُنبّه. والتقرير هو موضع
     التنبيه الطبيعي: يُفتح في موعده، ومن يفتحه هو من يراجع. */
  const due = allMetrics.filter((m) => m.review_due);
  const dueRows: (string | number)[][] = [
    ['المؤشر', 'الطبقة', 'الدورية', 'آخر مراجعة', 'القيمة الحالية'],
    ...due.map((m) => [
      m.name_ar,
      LAYER_AR[m.layer] ?? m.layer,
      CADENCE_AR[m.cadence] ?? m.cadence,
      m.reviewed_at ? riyadh(m.reviewed_at) : 'لم يُراجع بعد',
      m.value === null ? 'لا قيمة مسجّلة' : m.value,
    ]),
  ];

  const sheets: Sheet[] = [
    { name: 'اللوحة المختصرة', rows: boardRows },
    { name: 'ملخص الأعمال', rows: summary },
    { name: 'المؤشرات', rows: layerRows },
    { name: 'مستحقّ المراجعة', rows: dueRows },
    { name: 'المحتوى', rows: content },
    { name: 'سجل الاعتمادات', rows: approvals },
    { name: 'تحليلات المنصات', rows: platforms },
    { name: 'تحليلات المنشورات', rows: postAnalytics },
  ];

  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  const prefix = period === 'month' ? 'تقرير-شهري' : 'تقرير-الأداء';
  return { bytes: buildXlsx(sheets), filename: `${prefix}-${stamp}.xlsx`, sheets };
}

function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// يحوّل نفس بيانات التقرير إلى CSV (كل الأوراق متتالية بعناوين فاصلة) — صيغة تصدير إضافية
export function sheetsToCsv(sheets: Sheet[]): string {
  const lines: string[] = [];
  for (const sheet of sheets) {
    lines.push(`## ${sheet.name}`);
    for (const row of sheet.rows) lines.push(row.map(csvEscape).join(','));
    lines.push('');
  }
  return '﻿' + lines.join('\n');
}

// يبني التقرير ويرفعه إلى ملفات المشروع في مجلد التقارير (أسبوعي أو شهري)
async function uploadReport(env: Env, period: ReportPeriod): Promise<{ ok: boolean; reason?: string }> {
  if (!(await isConfigured(env))) return { ok: false, reason: 'تكامل بيسكامب غير مضبوط' };
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return { ok: false, reason: 'لم يُضبط معرّف مشروع إدارة التسويق' };

  const { bytes, filename } = await buildReportWorkbook(env, period);
  const sgid = await createAttachment(env, filename, XLSX_MIME, bytes);
  const rootVault = await getRootVaultId(env, projectId);
  const folderName = period === 'month' ? MONTHLY_REPORT_FOLDER : REPORT_FOLDER;
  const folder = await ensureSubVault(env, projectId, rootVault, folderName);
  const label = period === 'month' ? 'تقرير أداء شهري' : 'تقرير أداء أسبوعي';
  await createUpload(env, projectId, folder, sgid, `${label} — ${filename}`);
  return { ok: true };
}

export async function uploadWeeklyReport(env: Env): Promise<{ ok: boolean; reason?: string }> {
  return uploadReport(env, 'week');
}
export async function uploadMonthlyReport(env: Env): Promise<{ ok: boolean; reason?: string }> {
  return uploadReport(env, 'month');
}

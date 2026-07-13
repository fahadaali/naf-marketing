import type { Env } from '../types';
import { buildXlsx, type Sheet } from './xlsx';
import { isConfigured, getMgmtProjectId, createAttachment, getRootVaultId, ensureSubVault, createUpload } from './basecamp';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REPORT_FOLDER = 'تقارير الأداء الأسبوعية (آلي)';

const STATUS_AR: Record<string, string> = {
  draft: 'مسودة', pending_marketing: 'بانتظار مراجعة التسويق', pending_gm: 'بانتظار اعتماد المدير العام',
  approved: 'معتمد', scheduled: 'مجدول', published: 'منشور', archived: 'مؤرشف', rejected: 'مرفوض',
};
const SOURCE_AR: Record<string, string> = { manual: 'يدوي', ai: 'ذكاء اصطناعي', rss: 'خبر RSS' };

function riyadh(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch { return iso; }
}

// يبني مصنّف Excel تفصيلياً بالأعمال والتحليلات
export async function buildReportWorkbook(env: Env): Promise<{ bytes: Uint8Array; filename: string }> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const q = (sql: string, ...binds: any[]) => env.DB.prepare(sql).bind(...binds).all<any>();
  const one = (sql: string, ...binds: any[]) => env.DB.prepare(sql).bind(...binds).first<any>();

  // ملخص الأعمال (هذا الأسبوع + الحالة العامة)
  const createdWeek = (await one('SELECT COUNT(*) c FROM content_posts WHERE created_at >= ?', weekAgo))?.c || 0;
  const apprWeek = (await one('SELECT COUNT(*) c FROM approvals WHERE created_at >= ?', weekAgo))?.c || 0;
  const publishedWeek = (await one("SELECT COUNT(DISTINCT post_id) c FROM approvals WHERE to_status='published' AND created_at >= ?", weekAgo))?.c || 0;
  const rejectedWeek = (await one("SELECT COUNT(*) c FROM approvals WHERE to_status='rejected' AND created_at >= ?", weekAgo))?.c || 0;
  const scheduledWeek = (await one("SELECT COUNT(*) c FROM schedules WHERE created_at >= ?", weekAgo))?.c || 0;
  const byStatus = (await q('SELECT status, COUNT(*) c FROM content_posts GROUP BY status')).results;

  const summary: (string | number)[][] = [
    ['تقرير الأداء الأسبوعي — منصة ناف للتسويق'],
    ['تاريخ التوليد', riyadh(new Date().toISOString())],
    [],
    ['ملخص أعمال الأسبوع'],
    ['محتوى أُنشئ', createdWeek],
    ['إجراءات اعتماد', apprWeek],
    ['منشورات نُشرت', publishedWeek],
    ['مرفوضات', rejectedWeek],
    ['عمليات جدولة', scheduledWeek],
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

  // سجل الاعتمادات هذا الأسبوع
  const appr = (await q(
    `SELECT p.title, a.from_status, a.to_status, u.name actor, a.note, a.created_at
     FROM approvals a LEFT JOIN content_posts p ON p.id=a.post_id LEFT JOIN users u ON u.id=a.actor_id
     WHERE a.created_at >= ? ORDER BY a.created_at DESC`, weekAgo,
  )).results;
  const approvals: (string | number)[][] = [
    ['المنشور', 'من', 'إلى', 'المنفّذ', 'ملاحظة', 'الوقت'],
    ...appr.map((a: any) => [a.title || '', STATUS_AR[a.from_status] || a.from_status || '', STATUS_AR[a.to_status] || a.to_status, a.actor || '', a.note || '', riyadh(a.created_at)]),
  ];

  // تحليلات المنصات (أحدث لقطة لكل منشور/منصة، مجمّعة حسب المنصة)
  const platBase = `WITH latest AS (
      SELECT a.* FROM analytics_snapshots a
      JOIN (SELECT post_id, platform, MAX(captured_at) mx FROM analytics_snapshots GROUP BY post_id, platform) m
        ON m.post_id=a.post_id AND m.platform=a.platform AND m.mx=a.captured_at)`;
  const byPlat = (await q(`${platBase} SELECT platform, SUM(reach) reach, SUM(impressions) impressions, SUM(engagement) engagement FROM latest GROUP BY platform ORDER BY impressions DESC`)).results;
  const platforms: (string | number)[][] = [
    ['المنصة', 'الوصول', 'الانطباعات', 'التفاعل'],
    ...byPlat.map((p: any) => [p.platform, p.reach || 0, p.impressions || 0, p.engagement || 0]),
  ];

  // تحليلات المنشورات
  const byPost = (await q(`${platBase} SELECT p.title, l.platform, l.reach, l.impressions, l.engagement, l.captured_at FROM latest l LEFT JOIN content_posts p ON p.id=l.post_id ORDER BY l.impressions DESC`)).results;
  const postAnalytics: (string | number)[][] = [
    ['المنشور', 'المنصة', 'الوصول', 'الانطباعات', 'التفاعل', 'وقت القياس'],
    ...byPost.map((r: any) => [r.title || '', r.platform, r.reach || 0, r.impressions || 0, r.engagement || 0, riyadh(r.captured_at)]),
  ];

  const sheets: Sheet[] = [
    { name: 'ملخص الأعمال', rows: summary },
    { name: 'المحتوى', rows: content },
    { name: 'سجل الاعتمادات', rows: approvals },
    { name: 'تحليلات المنصات', rows: platforms },
    { name: 'تحليلات المنشورات', rows: postAnalytics },
  ];

  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  return { bytes: buildXlsx(sheets), filename: `تقرير-الأداء-${stamp}.xlsx` };
}

// يبني التقرير ويرفعه إلى ملفات المشروع في مجلد التقارير
export async function uploadWeeklyReport(env: Env): Promise<{ ok: boolean; reason?: string }> {
  if (!(await isConfigured(env))) return { ok: false, reason: 'تكامل بيسكامب غير مضبوط' };
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return { ok: false, reason: 'لم يُضبط معرّف مشروع إدارة التسويق' };

  const { bytes, filename } = await buildReportWorkbook(env);
  const sgid = await createAttachment(env, filename, XLSX_MIME, bytes);
  const rootVault = await getRootVaultId(env, projectId);
  const folder = await ensureSubVault(env, projectId, rootVault, REPORT_FOLDER);
  await createUpload(env, projectId, folder, sgid, `تقرير أداء أسبوعي — ${filename}`);
  return { ok: true };
}

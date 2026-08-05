import type { Env } from '../types';
import { newId, nowIso } from '../util';
import { getEmailProvider } from './email';
import { EMAIL } from './emailTheme';
import { logAudit } from './audit';
import {
  parseBlocks, renderBlocks, escapeHtml, publicSettings, articleUrl,
} from './newsletter';
import { DEFAULT_THEME, parseTheme, RADIUS_PX, WIDTH_PX } from './blockStyle';
import type { NewsletterTheme } from './blockStyle';
import { pushIssueToSite } from './siteSync';

// ===== إرسال النشرة على دفعات =====
// Cloudflare يحدّ زمن الطلب/المهمة، فنرسل دفعة في كل دورة Cron بدل حلقة طويلة.
// كل مشترك له صف في newsletter_sends — فالاستئناف بعد أي انقطاع طبيعي وبلا تكرار.
const BATCH = 40;

type NL = {
  id: string; title: string; slug: string; subject: string | null; subject_b: string | null;
  ab_percent: number; ab_winner: string | null; segment_tag: string | null;
  preheader: string | null; blocks_json: string; cover_media_id: string | null;
  theme_json: string | null;
};

/* قالب الرسالة: رأس بسيط + المحتوى + تذييل فيه إلغاء الاشتراك (إلزامي نظاماً)

   والسمة تصل إلى هنا لا إلى الكتل وحدها: نشرةٌ صبغ كاتبها متنَها على
   سطحٍ داكن ثم بقيت البطاقة بيضاء تُخرج رسالةً لا تُقرأ. الخلفية
   والسطح والعرض والاستدارة كلّها من السمة، وافتراضها قيم EMAIL
   نفسها — فرسالةٌ بلا سمة تخرج بايتاً ببايت كما كانت تخرج. */
function emailShell(opts: {
  siteName: string; preheader: string; body: string; unsubUrl: string;
  articleUrl: string; trackOpenUrl: string; theme?: NewsletterTheme;
}): string {
  const { siteName, preheader, body, unsubUrl, articleUrl: aUrl, trackOpenUrl } = opts;
  const t = opts.theme || DEFAULT_THEME;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${t.pageBackground};font-family:${EMAIL.fontStack}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.pageBackground};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${WIDTH_PX[t.width]}px;background:${t.cardBackground};border-radius:${RADIUS_PX[t.radius]};overflow:hidden">
<tr><td style="padding:20px 28px;border-bottom:1px solid ${t.border}">
  <span style="font-weight:700;color:${t.link};font-size:17px">${escapeHtml(siteName)}</span>
</td></tr>
<tr><td style="padding:28px" dir="rtl">${body}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid ${t.border};background:${t.pageBackground};font-size:12px;color:${EMAIL.mutedForeground};text-align:center">
  <p style="margin:0 0 8px"><a href="${escapeHtml(aUrl)}" style="color:${t.link}">اقرأ هذه المقالة على الموقع</a></p>
  <p style="margin:0">وصلتك هذه الرسالة لاشتراكك في نشرة ${escapeHtml(siteName)}.
    <a href="${escapeHtml(unsubUrl)}" style="color:${EMAIL.mutedForeground};text-decoration:underline">إلغاء الاشتراك</a></p>
</td></tr>
</table></td></tr></table>
<img src="${escapeHtml(trackOpenUrl)}" width="1" height="1" alt="" style="display:block">
</body></html>`;
}

// يعيد كتابة الروابط لتمرّ بمسار التتبّع (نتجاهل إلغاء الاشتراك والتتبّع نفسه)
function trackLinks(html: string, base: string, sendId: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (m, url) => {
    if (url.includes('/e/u/') || url.includes('/e/o/')) return m;
    return `href="${base}/e/c/${sendId}?u=${encodeURIComponent(url)}"`;
  });
}

async function siteName(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'app_name'").first<{ value: string }>();
  return row?.value || env.APP_NAME || 'شركة ناف القانونية';
}

// يُنشئ صفوف الإرسال لكل المشتركين النشطين ويضع النشرة في وضع الإرسال
export async function queueNewsletter(env: Env, newsletterId: string): Promise<number> {
  const nl = await env.DB.prepare("SELECT id, status FROM newsletters WHERE id = ?")
    .bind(newsletterId)
    .first<{ id: string; status: string }>();
  if (!nl) throw new Error('النشرة غير موجودة');
  if (nl.status === 'sending') throw new Error('النشرة قيد الإرسال بالفعل');
  if (nl.status === 'sent') throw new Error('أُرسلت هذه النشرة مسبقاً');

  const meta = await env.DB.prepare(
    'SELECT segment_tag, subject_b, ab_percent FROM newsletters WHERE id = ?',
  ).bind(newsletterId).first<{ segment_tag: string | null; subject_b: string | null; ab_percent: number }>();

  // الشريحة: وسم محدّد أو كل المشتركين النشطين
  const tag = meta?.segment_tag?.trim();
  const where = tag ? "status = 'active' AND tags LIKE ?" : "status = 'active'";
  const binds: unknown[] = tag ? [newsletterId, `%"${tag}"%`] : [newsletterId];

  // صف واحد لكل مشترك في الشريحة (UNIQUE يمنع التكرار عند إعادة المحاولة)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO newsletter_sends (id, newsletter_id, subscriber_id)
     SELECT lower(hex(randomblob(8))), ?, id FROM subscribers WHERE ${where}`,
  ).bind(...binds).run();

  const n = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM newsletter_sends WHERE newsletter_id = ? AND status = 'queued'",
  ).bind(newsletterId).first<{ n: number }>();

  // اختبار A/B: نُعيّن العنوان (ب) لعيّنة عشوائية.
  // نحسب حجم العيّنة هنا لا داخل SQL — تمرير معامل داخل LIMIT يسبّب SQLITE_MISMATCH.
  if (meta?.subject_b?.trim() && (n?.n || 0) > 1) {
    const pct = Math.min(50, Math.max(5, meta.ab_percent || 20));
    const sample = Math.max(1, Math.floor(((n?.n || 0) * pct) / 100));
    await env.DB.prepare(
      `UPDATE newsletter_sends SET variant = 'b'
       WHERE id IN (
         SELECT id FROM newsletter_sends
         WHERE newsletter_id = ? AND status = 'queued'
         ORDER BY random() LIMIT ${sample}
       )`,
    ).bind(newsletterId).run();
  }

  if (!n?.n) throw new Error('لا يوجد مشتركون نشطون لإرسال النشرة إليهم');

  await env.DB.prepare("UPDATE newsletters SET status = 'sending', updated_at = ? WHERE id = ?")
    .bind(nowIso(), newsletterId)
    .run();
  return n.n;
}

/* ===== النشرات المجدولة =====

   عمود scheduled_at وحالة 'scheduled' موجودان في الترحيل 0020 منذ أول
   يوم، ولم يكن يقرؤهما أحد: لا واجهة تضبط الموعد ولا كرون يبلغه.
   هذه الدالة هي القارئ الناقص.

   والفشل هنا لا مستخدمَ أمامه. أشيع أسبابه «لا مشترك نشط في الشريحة»،
   وهو سببٌ يزول بإضافة مشترك — فتُعاد المحاولة كل دورة. لكن الإعادة
   الأبدية بصمت أسوأ من التوقّف: بعد نافذة RETRY_WINDOW تعود النشرة
   مسودةً بلا موعد، ويُسجَّل السبب في سجلّ التدقيق ليُقرأ. */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** هل انقضت نافذة إعادة المحاولة على نشرةٍ فشل إدخالها الطابور؟ */
export function retryWindowPassed(scheduledAt: string, now: number): boolean {
  const due = Date.parse(scheduledAt);
  if (!Number.isFinite(due)) return true; // موعد تالف لا يُعاد إلى الأبد
  return now - due > RETRY_WINDOW_MS;
}

export async function queueDueNewsletters(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, scheduled_at FROM newsletters
      WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
      ORDER BY scheduled_at ASC LIMIT 5`,
  ).bind(nowIso()).all<{ id: string; scheduled_at: string }>();

  let started = 0;
  for (const r of results) {
    try {
      await queueNewsletter(env, r.id);
      started++;
    } catch (e: any) {
      if (!retryWindowPassed(r.scheduled_at, Date.now())) continue; // تُعاد في الدورة التالية
      await env.DB.prepare(
        "UPDATE newsletters SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?",
      ).bind(nowIso(), r.id).run();
      await logAudit(
        env, { id: null, name: 'النظام' },
        'newsletter.schedule.expired', 'newsletter', r.id, String(e?.message || e),
      );
    }
  }
  return started;
}

// يرسل دفعة واحدة من النشرات قيد الإرسال — يُستدعى من Cron
export async function sendQueuedBatch(env: Env, requestOrigin?: string): Promise<{ sent: number; failed: number }> {
  const sending = await env.DB.prepare(
    "SELECT id FROM newsletters WHERE status = 'sending' ORDER BY updated_at ASC LIMIT 1",
  ).first<{ id: string }>();
  if (!sending) return { sent: 0, failed: 0 };

  const nl = await env.DB.prepare(
    `SELECT id, title, slug, subject, subject_b, ab_percent, ab_winner, segment_tag,
            preheader, blocks_json, cover_media_id, theme_json FROM newsletters WHERE id = ?`,
  ).bind(sending.id).first<NL>();
  if (!nl) return { sent: 0, failed: 0 };

  const { results: batch } = await env.DB.prepare(
    `SELECT s.id AS send_id, s.variant, sub.email, sub.token
     FROM newsletter_sends s JOIN subscribers sub ON sub.id = s.subscriber_id
     WHERE s.newsletter_id = ? AND s.status = 'queued' AND sub.status = 'active'
     LIMIT ?`,
  ).bind(nl.id, BATCH).all<{ send_id: string; variant: string; email: string; token: string }>();

  // لا مزيد من المشتركين → النشرة اكتملت
  if (!batch.length) {
    await env.DB.prepare("UPDATE newsletters SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), nl.id)
      .run();
    // الموقع الرئيسي يسحب كل ثلاثين دقيقة؛ وهذا يختصرها إلى ثوانٍ.
    // وفشلُه لا يُفشل الإرسال — السحب التالي يلتقط ما فاته.
    await pushIssueToSite(env, nl.id, requestOrigin);
    return { sent: 0, failed: 0 };
  }

  const { base, path } = await publicSettings(env, requestOrigin || 'https://localhost');
  const name = await siteName(env);
  const provider = await getEmailProvider(env);
  const theme = parseTheme(nl.theme_json);
  const contentHtml = renderBlocks(parseBlocks(nl.blocks_json), 'email', base, theme);
  const aUrl = articleUrl(base, path, nl.slug);
  const subjectA = nl.subject || nl.title;
  const subjectB = nl.subject_b || subjectA;
  // بعد حسم الاختبار يُستخدم العنوان الفائز للجميع
  const pickSubject = (variant: string) => {
    if (nl.ab_winner === 'a') return subjectA;
    if (nl.ab_winner === 'b') return subjectB;
    return variant === 'b' ? subjectB : subjectA;
  };

  let sent = 0;
  let failed = 0;
  for (const row of batch) {
    try {
      const body = trackLinks(contentHtml, base, row.send_id);
      const html = emailShell({
        siteName: name,
        preheader: nl.preheader || '',
        body,
        unsubUrl: `${base}${path}/unsubscribe/${row.token}`,
        articleUrl: aUrl,
        trackOpenUrl: `${base}/e/o/${row.send_id}.gif`,
        theme,
      });
      await provider.send(row.email, pickSubject(row.variant), html);
      await env.DB.prepare("UPDATE newsletter_sends SET status = 'sent', sent_at = ? WHERE id = ?")
        .bind(nowIso(), row.send_id)
        .run();
      sent++;
    } catch (e: any) {
      await env.DB.prepare("UPDATE newsletter_sends SET status = 'failed', error = ? WHERE id = ?")
        .bind(String(e?.message || e).slice(0, 300), row.send_id)
        .run();
      failed++;
    }
  }

  return { sent, failed };
}

// إحصاءات نشرة واحدة (تُستخدم في الواجهة وفي إدخال التحليلات)
export async function newsletterStats(env: Env, newsletterId: string) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
            SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
     FROM newsletter_sends WHERE newsletter_id = ?`,
  ).bind(newsletterId).first<{
    total: number; sent: number; failed: number; queued: number; opened: number; clicked: number;
  }>();
}

// يُدخل مقاييس النشرات المُرسَلة في لوحة التحليلات الموحّدة.
// metrics_json ديناميكي أصلاً، فالفتح/النقر يظهران كبقية المقاييس بلا تغيير في المخطط.
export async function syncNewsletterAnalytics(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, title, slug, sent_at FROM newsletters WHERE status = 'sent'",
  ).all<{ id: string; title: string; slug: string; sent_at: string | null }>();

  let n = 0;
  for (const nl of results) {
    const s = await newsletterStats(env, nl.id);
    if (!s) continue;
    const opened = s.opened || 0;
    const clicked = s.clicked || 0;
    const delivered = s.sent || 0;
    const metrics = [
      { type: 'delivered', name: 'رسائل مُسلَّمة', value: delivered, unit: 'count' },
      { type: 'opens', name: 'مرات الفتح', value: opened, unit: 'count' },
      { type: 'clicks', name: 'النقرات', value: clicked, unit: 'count' },
      { type: 'open_rate', name: 'معدل الفتح', value: delivered ? Math.round((opened / delivered) * 1000) / 10 : 0, unit: 'percentage' },
      { type: 'click_rate', name: 'معدل النقر', value: delivered ? Math.round((clicked / delivered) * 1000) / 10 : 0, unit: 'percentage' },
    ];

    await env.DB.prepare(
      `INSERT INTO analytics_snapshots
         (id, provider_post_id, platform, title, post_id, via_platform, reach, impressions, engagement,
          sent_at, metrics_json, external_url, source)
       VALUES (?, ?, 'email', ?, NULL, 1, ?, ?, ?, ?, ?, NULL, 'newsletter')
       ON CONFLICT(provider_post_id) DO UPDATE SET
         title = excluded.title, reach = excluded.reach, impressions = excluded.impressions,
         engagement = excluded.engagement, sent_at = excluded.sent_at,
         metrics_json = excluded.metrics_json, source = excluded.source,
         captured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    )
      .bind(
        newId('an'), `nl:${nl.id}`, nl.title,
        delivered, opened, clicked, nl.sent_at, JSON.stringify(metrics),
      )
      .run();
    n++;
  }
  return n;
}

// ===== اختبار العنوانين (A/B) =====
// يقارن معدل الفتح بين العنوانين على العيّنة، ويعتمد الأفضل لبقية القائمة.
export async function abResults(env: Env, newsletterId: string) {
  const { results } = await env.DB.prepare(
    `SELECT variant,
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened
     FROM newsletter_sends WHERE newsletter_id = ? GROUP BY variant`,
  ).bind(newsletterId).all<{ variant: string; total: number; sent: number; opened: number }>();

  const pick = (v: string) => results.find((r) => r.variant === v) || { variant: v, total: 0, sent: 0, opened: 0 };
  const a = pick('a');
  const b = pick('b');
  const rate = (r: { sent: number; opened: number }) => (r.sent > 0 ? Math.round((r.opened / r.sent) * 1000) / 10 : 0);
  return { a: { ...a, open_rate: rate(a) }, b: { ...b, open_rate: rate(b) } };
}

// يعتمد العنوان الفائز يدوياً أو آلياً (الأعلى فتحاً)
export async function decideAbWinner(env: Env, newsletterId: string, forced?: 'a' | 'b'): Promise<string> {
  let winner = forced;
  if (!winner) {
    const r = await abResults(env, newsletterId);
    if (r.a.sent < 5 && r.b.sent < 5) throw new Error('العيّنة صغيرة جداً للحسم — انتظر مزيداً من الفتحات');
    winner = r.b.open_rate > r.a.open_rate ? 'b' : 'a';
  }
  await env.DB.prepare('UPDATE newsletters SET ab_winner = ?, updated_at = ? WHERE id = ?')
    .bind(winner, nowIso(), newsletterId)
    .run();
  return winner;
}

// ===== رسالة الترحيب الآلية =====
// تُرسل مرة واحدة عند اشتراك جديد — أفضل جهد فلا تُعطّل تسجيل الاشتراك.
export async function sendWelcome(env: Env, email: string, token: string, requestUrl: string): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('welcome_enabled','welcome_subject','welcome_body','app_name')",
  ).all<{ key: string; value: string }>();
  const cfg: Record<string, string> = {};
  for (const r of rows.results) cfg[r.key] = r.value || '';
  if (cfg.welcome_enabled !== '1') return;

  const { base, path } = await publicSettings(env, requestUrl);
  const name = cfg.app_name || env.APP_NAME || 'شركة ناف القانونية';
  const body = `<p style="margin:0 0 14px;line-height:1.9;font-size:16px;color:${EMAIL.foreground}">${escapeHtml(cfg.welcome_body || '')}</p>`;

  const provider = await getEmailProvider(env);
  await provider.send(
    email,
    cfg.welcome_subject || `أهلاً بك في نشرة ${name}`,
    emailShell({
      siteName: name,
      preheader: cfg.welcome_body || '',
      body,
      unsubUrl: `${base}${path}/unsubscribe/${token}`,
      articleUrl: `${base}${path}`,
      trackOpenUrl: `${base}/e/o/welcome.gif`,
    }),
  );
}

/**
 * ===== الدفع الفوري إلى الموقع الرئيسي =====
 *
 * الموقع يسحب كل ثلاثين دقيقة، وهذا يختصر الانتظار إلى ثوانٍ: النشرة
 * تُرسَل فتظهر في «المقالات» في حينها.
 *
 * والدفع تحسينٌ لا ركن: فشلُه لا يُفشل الإرسال ولا يُبلَّغ به المستعمل،
 * لأن السحب التالي يلتقط ما فاته على كل حال. أما لو أُفشل الإرسالُ به
 * لصار عطبُ شبكةٍ في طرفٍ آخر سبباً في بقاء نشرةٍ عالقة في «قيد الإرسال».
 *
 * والتوقيع كما يتحقّق منه `naf-home` في `verifyWebhook`: بصمة HMAC-SHA256
 * على بايتات الجسم كما تُرسل — لا على الوقت معها — والوقت ترويسةٌ مستقلّة
 * يرفض الموقع ما تجاوز فارقُه خمس دقائق.
 */
import type { Env } from '../types';
import { publicSettings } from './newsletter';
import { issuePayload, type IssueRow } from '../routes/siteApi';

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * يدفع نشرةً واحدة إلى خطاف الموقع. يعيد `false` إن لم يُضبط الخطاف أو
 * تعذّر الوصول — وكلاهما حالٌ يعمل معها السحب الدوري.
 */
export async function pushIssueToSite(
  env: Env,
  newsletterId: string,
  requestOrigin?: string,
): Promise<boolean> {
  const url = (env.SITE_WEBHOOK_URL || '').trim();
  const secret = (env.SITE_WEBHOOK_SECRET || '').trim();
  if (!url || !secret) return false;

  const row = await env.DB.prepare(
    `SELECT id, title, subject, excerpt, blocks_json, cover_media_id, sent_at, segment_tag
     FROM newsletters WHERE id = ?`,
  )
    .bind(newsletterId)
    .first<IssueRow>();
  if (!row) return false;

  const { base } = await publicSettings(env, requestOrigin || url);
  const body = JSON.stringify(issuePayload(row, base));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-naf-signature': `sha256=${await sign(secret, body)}`,
        'x-naf-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

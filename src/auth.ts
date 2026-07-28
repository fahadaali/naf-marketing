import type { Env, User } from './types';

/* ═══ قارئ المستخدم — من جلسة المركز وحدها ═══

   جلسة المنصة في KV بمفتاح `sess:{sid}`، تحمل `sub` القادم من المركز —
   وهو نفسه `users.id` بعد الترحيل الكسول في `sso.ts`.

   ولا قارئ ثانٍ هنا. كان جدول `sessions` المحلي يُقرأ احتياطاً، فمن يحمل
   كوكي جلسة قديمة يُقبل بلا مرور بالمركز ولا سريان إيقاف. وعمرها أربعة
   عشر يوماً في مقابل رمزٍ عمره ربع ساعة، فكانت هي الحقيقة عملياً لا
   الرمز — وهو نقض للسبب الذي جُعل الرمز قصيراً لأجله. حُذف القارئ،
   وبقي الجدول في مكانه لا يُقرأ ولا يُكتب.

   ووُضع هذا كلُّه في دالة واحدة لأن كل قارئ للمستخدم يمرّ بها:
   `requireAuth` و`‎/api/auth/me` وكل المسارات. فبقيت المسارات بلا تعديل. */

const SSO_COOKIE = 'naf_sid';

export async function getUserFromRequest(env: Env, req: Request): Promise<User | null> {
  if (!env.AUTH_KV) return null;

  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SSO_COOKIE}=([^;]*)`));
  if (!match) return null;

  const session = await env.AUTH_KV.get(`sess:${decodeURIComponent(match[1])}`, 'json');
  if (!session || typeof session !== 'object') return null;
  const sub = (session as { sub?: string }).sub;
  if (!sub) return null;

  const row = await env.DB.prepare(
    'SELECT id, name, email, role_name, is_active, created_at FROM users WHERE id = ?',
  )
    .bind(sub)
    .first<User>();

  if (!row || !row.is_active) return null;
  return row;
}

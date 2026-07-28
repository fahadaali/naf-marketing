// قراءة المستخدم من الجلسة. مصدرٌ واحد لا مصدران.
//
// المصادقة كلُّها في `naf-id`: لا كلمة مرور تُفحص هنا، ولا جلسة تُصنع هنا.
// جلسة المنصة يكتبها مسار الاستقبال في `AUTH_KV` بمفتاح `sess:{sid}`، وتحمل
// `sub` القادم من المركز — وهو نفسه `users.id` بعد الترحيل الكسول.
//
// ووُضعت القراءة هنا وحدها لأن كل قارئ للمستخدم يمرّ بهذه الدالة: requireAuth
// و`/api/auth/me` وكل المسارات. فبقيت المسارات العشرون بلا تعديل.

import { clearCookie, readCookie } from 'naf-auth';
import type { Env, User } from './types';
import { ssoConfig } from './sso';
import { nowIso } from './util';

/**
 * مفتاح الجلسة في KV — كما تكتبه الحزمة في مسار الاستقبال.
 *
 * مكتوب هنا لأن الحزمة لا تصدّره: صيغةٌ واحدة في طرفين، فتغييرها هناك دون
 * هنا يجعل الجلسة تُكتب بمفتاح وتُقرأ بآخر — أي «لا جلسة» في كل طلب، ودورةَ
 * تحويلٍ إلى المركز لا تنتهي. فإن صدّرتها الحزمة يوماً، تُستورد ويُحذف هذا.
 */
const sessionKey = (sid: string) => `sess:${sid}`;

/**
 * المستخدم الحالي، أو `null`.
 *
 * ولا مسار ثانٍ إليه: كان هنا فرعٌ يقرأ كوكي `naf_session` وجدول `sessions`
 * من نظام الدخول المحلي، وقد أُزيل مع النظام كلّه. وبقاؤه كان يعني بابين
 * لبيتٍ حارسُه واحد — والثاني لا يعرفه المركز ولا يسري عليه إيقافُه.
 */
export async function getUserFromRequest(env: Env, req: Request): Promise<User | null> {
  if (!env.AUTH_KV) return null;

  const config = ssoConfig(env);
  const sid = readCookie(req, config.cookieName);
  if (!sid) return null;

  const session = await env.AUTH_KV.get(sessionKey(sid), 'json');
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

/**
 * إنهاء جلسة المنصة.
 *
 * تُحذف من `AUTH_KV` ولا يُكتفى بمحو الكوكي: كوكي محذوف وجلسةٌ حيّة يعني أن
 * نسخةً من المعرّف — في سجلّ وكيل أو في متصفّح آخر — لا تزال تفتح الباب.
 *
 * ولا يمسّ هذا جلسةَ المركز: الخروج من المنصة خروجٌ منها وحدها، ومن أراد
 * الخروج من الشبكة كلّها يخرج من المركز.
 */
export async function endSession(env: Env, req: Request): Promise<string> {
  const config = ssoConfig(env);
  const sid = readCookie(req, config.cookieName);
  if (sid && env.AUTH_KV) await env.AUTH_KV.delete(sessionKey(sid));
  return clearCookie(config.cookieName);
}

export { nowIso };

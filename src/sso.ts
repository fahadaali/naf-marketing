// ربط المنصة بخدمة الهوية المركزية naf-id عبر حزمة naf-auth.
//
// كل ما يخصّ الدخول موضعه هذا الملف. ولم يُعَد بناء شيء من منطق المنصة:
// الأدوار تبقى في users والصلاحيات في roles_permissions كما هي.

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { createConfig, handleCallback, authenticate, reportAccessChange } from 'naf-auth';
import type { Env, Variables } from './types';

type Bindings = { Bindings: Env; Variables: Variables };

/**
 * المسارات العامة — مكتوبة صراحةً، وأي مسار جديد محمي افتراضياً.
 *
 * الأربعة الأولى أسطح يفتحها من ليس مستخدماً أصلاً: مدوّنة عامة يقرأها
 * الزائر، وبكسل يفتحه عميل البريد، وخطّاف يستدعيه مزوّد النشر، وفحص صحة.
 * حمايتها تعني كسرها، لا تأمينها.
 */
const PUBLIC_PATHS = ['/auth/callback', '/denied', '/api/health'];

const PUBLIC_PREFIXES = [
  '/assets/', // أصول الواجهة المبنية
  '/articles', // المدوّنة العامة والتغذية والاشتراك
  '/e/', // تتبّع البريد — يفتحه عميل البريد لا المستخدم
  '/api/webhooks/', // يستدعيها المزوّد خارجياً
];

/**
 * الأعمدة التي تشير إلى users(id) في المخطّط الحيّ.
 * لا ON UPDATE CASCADE على أيٍّ منها، فتغيير المفتاح يستلزم تحديثها يدوياً.
 */
/** أقلّ الأدوار الثلاثة صلاحية — يوافق DEFAULT_ROLE في wrangler.toml. */
const DEFAULT_ROLE = 'writer';

const USER_REFERENCES: Array<[table: string, column: string]> = [
  ['content_posts', 'author_id'],
  ['approvals', 'actor_id'],
  ['notifications', 'user_id'],
  ['media_assets', 'uploaded_by'],
  ['rss_feeds', 'added_by'],
  ['media_gen_jobs', 'requested_by'],
  ['platform_comments', 'replied_by'],
  ['content_versions', 'edited_by'],
  ['content_templates', 'created_by'],
  ['audit_log', 'actor_id'],
  ['newsletters', 'author_id'],
];

/**
 * الترحيل الكسول.
 *
 * المعرّف المحلي القديم يُستبدل بـ sub القادم من المركز عند أول دخول للعضو،
 * فيصير جدول users هو جدول الأعضاء بمفتاح المركز — بلا جدول ثانٍ وبلا
 * ازدواج هوية. والمطابقة بالبريد لأنه الحقل المشترك الوحيد بين الطرفين،
 * وهو UNIQUE في الجدول.
 *
 * ويجري كله في دفعة واحدة مع defer_foreign_keys: تغيير المفتاح الأساسي
 * يترك أبناءه معلّقين لحظة، فتُؤجَّل المطابقة إلى نهاية المعاملة بدل أن
 * تفشل عند أول عبارة. ومن لم يدخل بعدُ يبقى سجلّه ومحتواه كما هو.
 */
export async function linkOrCreateUser(
  env: Env,
  claims: { sub: string; email?: string; name?: string },
): Promise<void> {
  // مُرحَّل سلفاً؟ لا شيء يُفعل.
  const already = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
    .bind(claims.sub)
    .first<{ id: string }>();
  if (already) return;

  const existing = claims.email
    ? await env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
        .bind(claims.email)
        .first<{ id: string }>()
    : null;

  // عضو جديد تماماً: يُنشأ سجلّه هنا لا في الحزمة، لأن password_hash
  // في هذا الجدول NOT NULL ولا تعرفه الحزمة — ومستخدم الدخول الموحّد
  // بلا كلمة مرور. قيمة فارغة صريحة، وverifyPassword يردّ أي محاولة
  // دخول بها لأن الهاش الفارغ لا يطابق شيئاً.
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO users (id, name, email, password_hash, role_name, is_active)
       VALUES (?, ?, ?, '', ?, 1)`,
    )
      .bind(claims.sub, claims.name ?? '', (claims.email ?? '').toLowerCase(), DEFAULT_ROLE)
      .run();
    return;
  }

  if (existing.id === claims.sub) return;

  const statements = [
    env.DB.prepare('PRAGMA defer_foreign_keys = ON'),
    env.DB.prepare('UPDATE users SET id = ? WHERE id = ?').bind(claims.sub, existing.id),
    // الجلسات القديمة تُطرح لا تُرحَّل: الجلسة صارت في KV،
    // وترحيلها يبقي بابًا مفتوحاً بمصادقة النظام القديم.
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(existing.id),
    ...USER_REFERENCES.map(([table, column]) =>
      env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).bind(
        claims.sub,
        existing.id,
      ),
    ),
  ];

  await env.DB.batch(statements);
}

export function ssoConfig(env: Env) {
  return createConfig(env, {
    publicPaths: PUBLIC_PATHS,
    publicPrefixes: PUBLIC_PREFIXES,
    onClaims: (claims: { sub: string; email?: string; name?: string }) => linkOrCreateUser(env, claims),
  });
}

/**
 * الحارس العام. يسبق كل شيء عدا المسارات العامة، فيتحقّق من الجلسة
 * ويحوّل غير المسجَّل إلى المركز.
 *
 * ولا يحقن المستخدم في السياق هنا: المنصة تقرأه عبر getUserFromRequest
 * كما كانت، وقد صارت تلك الدالة تعرف جلسة KV. فبقيت المسارات كما هي.
 */
export const ssoGuard: MiddlewareHandler<Bindings> = async (c, next) => {
  const result = await authenticate(c.req.raw, c.env, ssoConfig(c.env));
  if (result.response) return result.response;
  await next();
};

/** مسار الاستقبال. */
export const ssoRoutes = new Hono<Bindings>();

ssoRoutes.get('/auth/callback', (c) => handleCallback(c.req.raw, c.env, ssoConfig(c.env)));

// صفحة /denied لا تُخدَم من هنا عمداً.
// هي مسار عام في الحارس، فتصلها واجهة React كأي شاشة أخرى وتقرأ
// naf-theme.css ومصطلحات naf-terms.md. وصفحة تُبنى في الخادم لا تحمّل
// ورقة أنماط المنصة، فتضطرّ إلى قيم لون حرفية — وهذا سياق غير مستثنى
// في قواعد ناف، والاستثناءات أربعة ليس هذا منها.
/**
 * التبليغ العكسي (§٦-٤): إيقاف عضو من إعدادات المنصة يُبلَّغ المركز
 * ليظهر السبب للمستخدم في شبكته بدل أن يجد الباب مغلقاً بلا تفسير.
 *
 * لا يرمي: يُستدعى من waitUntil بعد أن تمّ التعطيل في القاعدة، فتعذّر
 * الوصول إلى المركز خلل في التبليغ لا في العملية. ولا يُسجَّل السرّ ولا
 * نصّ استجابة المركز — قد يعيد ما أُرسل إليه.
 */
export async function notifyAccessChange(
  env: Env,
  userId: string,
  isActive: boolean,
): Promise<void> {
  if (!env.AUTH_CLIENT_SECRET || !env.AUTH_ISSUER || !env.PLATFORM_ID) return;
  try {
    await reportAccessChange(env, ssoConfig(env), {
      userId,
      status: isActive ? 'active' : 'revoked',
      reason: isActive ? 'أُعيد تفعيله من إعدادات المنصة' : 'أُوقف من إعدادات المنصة',
    });
  } catch {
    // يُبتلع عمداً — انظر تعليق الدالة.
  }
}

export { PUBLIC_PATHS, PUBLIC_PREFIXES, USER_REFERENCES, DEFAULT_ROLE };

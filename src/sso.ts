// ربط المنصة بخدمة الهوية المركزية naf-id عبر حزمة naf-auth.
//
// كل ما يخصّ الدخول موضعه هذا الملف. ولم يُعَد بناء شيء من منطق المنصة:
// الأدوار تبقى في users والصلاحيات في roles_permissions كما هي.

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import {
  createConfig,
  handleCallback,
  handleLogout,
  handleBackchannelLogout,
  authenticate,
  reportAccessChange,
} from 'naf-auth';
import type { Env, Variables } from './types';

type Bindings = { Bindings: Env; Variables: Variables };

/**
 * المسارات العامة — مكتوبة صراحةً، وأي مسار جديد محمي افتراضياً.
 *
 * الأربعة الأولى أسطح يفتحها من ليس مستخدماً أصلاً: مدوّنة عامة يقرأها
 * الزائر، وبكسل يفتحه عميل البريد، وخطّاف يستدعيه مزوّد النشر، وفحص صحة.
 * حمايتها تعني كسرها، لا تأمينها.
 */
const PUBLIC_PATHS = [
  '/auth/callback',
  '/denied',
  '/api/health',
  // ورقة أنماط الصفحات العامة. تشير إليها `layout()` في `routes/publicPages.ts`،
  // وهي مولَّدة من سجلّ ناف وتستورد ملفات الخطّ من `/fonts/`.
  '/naf-public.css',
];

const PUBLIC_PREFIXES = [
  '/assets/', // أصول الواجهة المبنية
  '/articles', // المدوّنة العامة والتغذية والاشتراك
  '/e/', // تتبّع البريد — يفتحه عميل البريد لا المستخدم
  '/api/webhooks/', // يستدعيها المزوّد خارجياً

  /* ═══ أصول الصفحة العامة ═══

     `‎/articles` وحده لا يكفي: الصفحة تصل الزائر سليمةً ثم يطلب متصفّحُه
     ورقةَ أنماطها وخطوطَها وشعارَها. وتلك طلباتٌ بـ`Sec-Fetch-Mode: no-cors`،
     فـ`wantsDocument` في الحزمة تردّ `false` ويُردّ عليها ٤٠١ بجسم JSON.
     فتسقط الأنماط وتسقط معها الخطوط، وتبقى كل `var(--…)` بلا قيمة —
     فتصل المقالة بلا لون ولا خط، والشعار صورةٌ مكسورة.

     و`run_worker_first = true` في `wrangler.toml` يجعل كل طلب يمرّ بالحارس،
     فلا تُستثنى هذه الأصول من نفسها.

     وهي أصول ساكنة لا تحمل بيانات عضو، حالُها حال `‎/assets/` المُعلنة فوق. */
  '/brand/', // الشعار وأيقونة التبويب
  '/fonts/', // ملفات الخطّ التي يستوردها `naf-public.css`

  /* ═══ الموقع الرئيسي ═══

     ‏`/api/public/` ليست مفتوحة: تحرسها مقارنةٌ ثابتة الزمن لرمزٍ مشترك
     في `routes/siteApi.ts`. واستثناؤها من الدخول الموحّد ضرورةٌ لا
     تساهل — الطالبُ خادمُ الموقع لا متصفّحُ عضو، فلا جلسة له ولا صفحةَ
     دخولٍ يُساق إليها. ولو بقيت محروسةً لوصله ٤٠١ بجسم JSON، فيسجّل
     «تعذّر الاتصال» ولا يعرف أحدٌ أن السبب حارسٌ لا عطب.

     و`/api/public-media/` بلا رمز أصلاً: جالبُها متصفّحُ القارئ وزاحفُ
     محرّك البحث وبطاقةُ المشاركة، وثلاثتها بلا ترويسة. وحدُّها في
     `routes/siteMedia.ts`: لا يخرج منها إلا أصلٌ مذكورٌ في نشرةٍ أُرسلت
     أو نُشرت صفحتها — أي ما هو منشورٌ فعلاً. */
  '/api/public/',
  '/api/public-media/',
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
      // `DO NOTHING`: دخولان متزامنان لعضوٍ جديد يبلغان هنا معاً، فيُنشئ
      // أحدهما الصفّ ويجد الآخر تعارضاً — وهو سباقٌ لا خطأ. وبلا هذا يصل
      // الثاني «تعذّر التحقق من دخولك» على صفٍّ أُنشئ له فعلاً.
      `INSERT INTO users (id, name, email, password_hash, role_name, is_active)
       VALUES (?, ?, ?, '', ?, 1)
       ON CONFLICT(id) DO NOTHING`,
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
    //
    // وهذا آخر ما بقي لجدول `sessions`: لا يُدرج فيه شيء ولا يُقرأ منه
    // شيء في المستودع كلّه، وهذه العبارة تستنزف ما خلّفه الدخول المحلي
    // عضواً عضواً عند أول دخولٍ له من المركز. ويبقى الجدول لأن الهجرات
    // للأمام فقط، ولأن إسقاطه يمحو ما لم يُستنزف بعد.
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
    // رمز الخطأ وحده لا يكفي: كل فشل مبادلة يصل رمزه `exchange_failed`،
    // وحالةُ ردّ المركز هي ما يفرّق بين سرّ خاطئ (401) وصفّ وصول ناقص
    // (403) ورمز عبور مستهلَك (400). ورسالة AuthError تحمل الحالة.
    // ولا يُسجَّل السرّ ولا نصّ استجابة المركز — قد يعيد ما أُرسل إليه.
    onError: (code: string, err: unknown) => {
      const detail =
        err instanceof Error && err.message && err.message !== code ? ` — ${err.message}` : '';
      console.error(`naf-auth: ${code}${detail}`);
    },
  });
}

/**
 * الحارس العام. يسبق كل شيء عدا المسارات العامة، فيتحقّق من الجلسة
 * ويحوّل غير المسجَّل إلى المركز.
 *
 * ويضع المعرّف المركزي في السياق: هو ثمرةُ تحقّقٍ تمّ في هذا الطلب نفسه،
 * فتقرؤه `getUser` بدل أن تفتح جلسة KV بنفسها. وفتحُها كان يعني اشتقاق
 * اسم مفتاح الحزمة — تفصيلٌ داخلي تغيّر في v3.3.0 فافترق القارئان،
 * ودارت اللوحة في تحميلٍ لا ينتهي. الشرح في `src/auth.ts`.
 *
 * ولا يُحقن العضو نفسه: الحارس يقرأ منه المعرّف والدور والتفعيل، واللوحة
 * تحتاج الاسم والبريد وتاريخ الإنشاء — فيبقى صفّ الجدول المحلي مقروءاً
 * حيث كان.
 */
export const ssoGuard: MiddlewareHandler<Bindings> = async (c, next) => {
  const result = await authenticate(c.req.raw, c.env, ssoConfig(c.env));
  if (result.response) return result.response;
  if (result.claims?.sub) c.set('sub', result.claims.sub);
  await next();
};

/** مسار الاستقبال. */
export const ssoRoutes = new Hono<Bindings>();

ssoRoutes.get('/auth/callback', (c) => handleCallback(c.req.raw, c.env, ssoConfig(c.env)));

/**
 * الخروج — في الحزمة، ووجهته المركز.
 *
 * كان هنا تنفيذٌ محلي يحذف الجلسة ويمسح الكوكي ويعيد `{ ok: true }`، ثم
 * تنتقل اللوحة إلى `‎/`. والحذف والمسح كانا يقعان فعلاً، ولا أثر يراه
 * المستخدم: جذر المنصة محميّ، فيحوّله الحارس إلى المركز، وجلسة المركز لم
 * تُمسّ فتُصدر رمزاً جديداً، فيعود إلى الشاشة التي خرج منها قبل أن يقرأ
 * شيئاً. فيقرأ من ذلك أن الزرّ لا يعمل.
 *
 * و`handleLogout` يخرج بالمتصفّح إلى `‎{issuer}/` — خارج السياج — ويعيد
 * الوجهة في `next` لأن نداء `fetch` لا يتبع تحويلةً إلى أصل آخر.
 *
 * ولا تُبطَل جلسة المركز من هنا: الخروج من هذه المنصة لا يُخرج صاحبه من
 * الأربع الأخرى وهو لم يطلب.
 */
export const ssoLogout: MiddlewareHandler<Bindings> = (c) =>
  handleLogout(c.req.raw, c.env, ssoConfig(c.env));

// مسجَّل قبل الحارس عمداً: الخروج يجب أن يعمل لمن جلسته انتهت أصلاً،
// وإلا حُوِّل الخارجُ إلى المركز ليدخل قبل أن يُسمح له بالخروج.
ssoRoutes.post('/auth/logout', ssoLogout);

/**
 * إشعار الخروج الخلفي — المركز يُنهي جلسات عضوٍ هنا.
 *
 * الخروج من هذه المنصة محليّ، أمّا الخروج من المركز فهو الباب نفسه: يُنهي
 * جلسات صاحبه في المنصات الخمس. وبلا هذا المسار تبقى جلسته هنا حيّة حتى
 * ينتهي رمزها، فيفتح رابط المنصة بعد خروجه من المركز فيدخل.
 *
 * وهو قبل الحارس كالخروج، ولسببٍ أقوى: المنادي هو المركز خادماً لخادم، لا
 * متصفّح له جلسة هنا. وحراستُه توقيعُ المركز نفسه — تتحقّق منه الحزمة
 * بمفتاح `JWKS` الذي تعرفه أصلاً.
 */
ssoRoutes.post('/auth/backchannel-logout', (c) =>
  handleBackchannelLogout(c.req.raw, c.env, ssoConfig(c.env)),
);

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
  isActive?: boolean,
): Promise<void> {
  if (!env.AUTH_CLIENT_SECRET || !env.AUTH_ISSUER || !env.PLATFORM_ID) return;

  // العضو يُعرَّف بالبريد لا بمعرّفه المركزي: جدول الوصول في المركز
  // يُطابَق بالبريد وحده. ومعرّفنا المحلي — ولو صار sub بعد الترحيل —
  // لا يُقرأ هناك، فتبليغٌ به يمرّ بلا أثر.
  //
  // والدور يُقرأ معه: المركز يعرضه في صفّ الوصول ولا يقرّره — فمسؤول
  // النظام يرى ماذا صار يرى من منحه بدل أن يسأل مسؤول المنصة.
  const row = await env.DB.prepare('SELECT email, role_name FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string; role_name: string }>();
  if (!row?.email) return;

  try {
    await reportAccessChange(env, ssoConfig(env), {
      email: row.email,
      // بلا حالة حين يكون التبليغ عن دورٍ تغيّر وحده: كتابةُ `granted` مع
      // كل ترقية تمحو سحباً صادراً من المركز.
      ...(typeof isActive === 'boolean'
        ? {
            // granted أو revoked حصراً — وما عداهما يردّ عليه المركز invalid_state.
            state: (isActive ? 'granted' : 'revoked') as 'granted' | 'revoked',
            reason: isActive ? 'أُعيد تفعيله من إعدادات المنصة' : 'أُوقف من إعدادات المنصة',
          }
        : {}),
      role: row.role_name,
    });
  } catch (err) {
    // يُبتلع عمداً — انظر تعليق الدالة. ويُسجَّل ليُقرأ من اللوغ:
    // تبليغٌ يفشل صامتاً يترك بطاقة المستخدم في شبكته تدعوه إلى باب لا يفتح.
    console.error(`naf-auth: access_report_failed — ${err instanceof Error ? err.message : ''}`);
  }
}

export { PUBLIC_PATHS, PUBLIC_PREFIXES, USER_REFERENCES, DEFAULT_ROLE };

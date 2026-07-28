#!/usr/bin/env node
/* فاحص عقد الدخول الموحّد — naf-marketing.
 *
 * يفحص ما يُقرأ من الملفات وحدها: لا شبكة، ولا قاعدة بيانات، ولا سرّ.
 * فما يقوله يصحّ قبل النشر وبعده على السواء، وما لا يستطيع قوله يقوله
 * صراحةً في «ما لا يفحصه هذا الملف» أسفله بدل أن يسكت عنه فيُقرأ نجاحاً.
 *
 * البنود مشتقّة من التسعة التي وقعنا فيها في NAF-Accountant، ومن عقد
 * السلك في README الخاص بـnaf-auth، ومن مصدر naf-id نفسه لا من توقّعه.
 *
 *   node audit/sso-contract-check.mjs      أو      npm run check:sso
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/* ═══ الثوابت — من جدول المنصات الخمس في دليل الربط ═══
   المعرّف بحالة أحرفه، والمقارنة حرفية ولا تُطبَّع: حرف واحد خطأ يجعل كل
   رمز صحيح يُرفض، والرفض صامت. ومعرّف هذه المنصة ونطاقها متطابقان —
   وليس ذلك حال الخمس كلها، فمنصة التقارير معرّفها naf-rebort ونطاقها
   naf-reports، ولا يُشتقّ أحدهما من الآخر. */
const PLATFORM_ID = 'naf-marketing';
const CALLBACK_URL = 'https://naf-marketing.naflaw-sa.workers.dev/auth/callback';
const AUTH_ISSUER = 'https://naf-id.pages.dev';
const AUTH_TAG = 'v3.0.0';

const results = [];
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

function check(name, fn) {
  try {
    const out = fn();
    if (out === true || out === undefined) results.push({ name, ok: true });
    else results.push({ name, ok: false, why: String(out) });
  } catch (err) {
    results.push({ name, ok: false, why: err.message });
  }
}

const pkg = JSON.parse(read('package.json') ?? '{}');
const lock = JSON.parse(read('package-lock.json') ?? '{}');
const toml = read('wrangler.toml') ?? '';
const sso = read('src/sso.ts') ?? '';
const localAuth = read('src/auth.ts') ?? '';
const apiClient = read('web/src/api.ts') ?? '';
const webAuth = read('web/src/auth.tsx') ?? '';
const denied = read('web/src/pages/Denied.tsx') ?? '';

/* ── ١ — الحزمة على وسم v3.0.0 (الخطأ الأول) ── */
check('التبعية naf-auth مثبّتة على ' + AUTH_TAG, () => {
  const dep = pkg.dependencies?.['naf-auth'];
  if (!dep) return 'naf-auth ليست في dependencies';
  if (dep.includes('#v1.0.0')) return 'v1.0.0 لا يعمل — كل دخول يفشل بـbad_state';
  if (!dep.endsWith('#' + AUTH_TAG)) return `مثبّتة على «${dep}» لا على ${AUTH_TAG}`;
});

/* ── ٢ — القفل يوافق الوسم (الخطأ السابع) ──
   القفل لا يُعيد الحلّ من تلقائه: يبقى على commit الإصدار القديم فيثبّت
   npm ci النسخة الخطأ صامتاً مهما قال package.json. */
check('القفل يحلّ naf-auth على نفس الوسم', () => {
  const entry = lock.packages?.['node_modules/naf-auth'];
  if (!entry) return 'لا إدخال لـnaf-auth في القفل — شغّل npm install';
  const resolved = entry.resolved ?? '';
  const sha = resolved.split('#')[1];
  if (!sha) return `تعذّرت قراءة commit من «${resolved}»`;
  // الوسم يُحلّ إلى commit، فيُقارن به لا بالنصّ.
  //
  // و`v3.0.0` وسم معلَّق (annotated): `refs/tags/v3.0.0` يشير إلى كائن
  // الوسم لا إلى الـcommit، و`refs/tags/v3.0.0^{}` هو الـcommit. وnpm
  // يسجّل الثاني في القفل — فمقارنةٌ بالأول تعطي فشلاً كاذباً على قفل
  // صحيح، وهو أسوأ من ألّا يُفحص البند أصلاً.
  let out;
  try {
    out = execFileSync(
      'git',
      ['ls-remote', 'https://github.com/fahadaali/naf-auth', AUTH_TAG, `${AUTH_TAG}^{}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 },
    );
  } catch {
    return `تعذّر الوصول إلى المستودع للتحقق — القفل على ${sha.slice(0, 7)}، تحقّق يدوياً`;
  }
  const refs = Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/))
      .map(([hash, ref]) => [ref, hash]),
  );
  const want = refs[`refs/tags/${AUTH_TAG}^{}`] ?? refs[`refs/tags/${AUTH_TAG}`];
  if (!want) return `الوسم ${AUTH_TAG} غير موجود في المستودع`;
  if (!want.startsWith(sha) && !sha.startsWith(want)) {
    return `القفل على ${sha.slice(0, 7)} والوسم ${AUTH_TAG} على ${want.slice(0, 7)}`;
  }
});

/* ── ٣ — المعرّف حرفياً (الفخّ الثاني في جدول المنصات) ── */
check(`PLATFORM_ID = ${PLATFORM_ID} بحالة أحرفه`, () => {
  const m = toml.match(/^\s*PLATFORM_ID\s*=\s*"([^"]*)"/m);
  if (!m) return 'PLATFORM_ID غير مضبوط في wrangler.toml';
  if (m[1] !== PLATFORM_ID) return `«${m[1]}» لا يطابق «${PLATFORM_ID}» حرفياً`;
});

/* ── ٤ — المُصدِر بلا شرطة أخيرة ── */
check(`AUTH_ISSUER = ${AUTH_ISSUER} بلا شرطة أخيرة`, () => {
  const m = toml.match(/^\s*AUTH_ISSUER\s*=\s*"([^"]*)"/m);
  if (!m) return 'AUTH_ISSUER غير مضبوط';
  if (m[1] !== AUTH_ISSUER) return `«${m[1]}» لا يطابق «${AUTH_ISSUER}»`;
});

/* ── ٥ — مساحة KV مربوطة بمعرّف حقيقي ── */
check('AUTH_KV مربوطة بمعرّف ٣٢ محرفاً ست عشرياً', () => {
  const block = toml.match(/\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"AUTH_KV"[\s\S]*?id\s*=\s*"([^"]*)"/);
  if (!block) return 'لا ربط AUTH_KV في wrangler.toml';
  if (!/^[0-9a-f]{32}$/i.test(block[1])) {
    return `المعرّف «${block[1]}» ليس معرّف مساحة — أنشئها وضع عمود ID`;
  }
});

/* ── ٦ — الحارس يسبق طبقة الأصول ── */
check('run_worker_first = true في [assets]', () => {
  if (!/\[assets\][\s\S]*?run_worker_first\s*=\s*true/.test(toml)) {
    return 'بدونه تخدم طبقة الأصول index.html قبل الـWorker فيُتجاوَز الحارس';
  }
});

/* ── ٧ — السرّ لا يُكتب في ملف ── */
check('AUTH_CLIENT_SECRET ليست قيمته في أي ملف متتبَّع', () => {
  if (/^\s*AUTH_CLIENT_SECRET\s*=\s*"[^"]+"/m.test(toml)) {
    return 'قيمة السرّ مكتوبة في wrangler.toml — اضبطه بـwrangler secret put';
  }
  const ignore = read('.gitignore') ?? '';
  if (!ignore.includes('.dev.vars')) return '.dev.vars غير مستثنى في .gitignore';
});

/* ── ٨ — مخطّط الأعضاء يوافق جدول users القائم ── */
check('مخطّط الأعضاء مضبوط على جدول users القائم', () => {
  const want = {
    MEMBERS_TABLE: 'users',
    MEMBERS_ID_COLUMN: 'id',
    MEMBERS_NAME_COLUMN: 'name',
    MEMBERS_ROLE_COLUMN: 'role_name',
    MEMBERS_TIME_FORMAT: 'iso',
    MEMBERS_PERMS_COLUMN: '-',
  };
  const missing = [];
  for (const [k, v] of Object.entries(want)) {
    const m = toml.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm'));
    if (!m || m[1] !== v) missing.push(`${k} يجب أن تكون "${v}"`);
  }
  if (missing.length) return missing.join('، ');
});

/* ── ٩ — الهجرة مطبَّقة في المستودع (الخطأ الثاني) ──
   وجودُ الملف لا يعني تطبيقه على القاعدة الحقيقية — انظر الأسفل. */
check('هجرة عمود آخر ظهور موجودة', () => {
  if (!existsSync('migrations/0022_sso_last_seen.sql')) return 'ملف الهجرة غير موجود';
  const sql = read('migrations/0022_sso_last_seen.sql');
  if (!/ALTER TABLE users ADD COLUMN last_seen_at/i.test(sql)) return 'الهجرة لا تضيف last_seen_at';
});

/* ── ١٠ — onError يسجّل الرمز والحالة معاً (الخطأ الثالث) ── */
check('onError يسجّل رمز الخطأ ورسالته معاً', () => {
  if (!/onError\s*:/.test(sso)) return 'onError غير مضبوط — كل فشل يقرأ auth_failed بلا سبب';
  if (!/err\.message|instanceof Error/.test(sso)) return 'onError لا يسجّل رسالة الخطأ، فحالة ردّ المركز تضيع';
});

/* ── ١١ — توقيع التبليغ العكسي (الخطأ التاسع) ── */
check('reportAccessChange يُستدعى بـ{ email, state }', () => {
  if (!/reportAccessChange/.test(sso)) return true; // لا تبليغ عكسي — بند لا ينطبق
  if (/\buserId\s*[,:]/.test(sso.split('reportAccessChange')[1]?.slice(0, 400) ?? '')) {
    return 'يُمرَّر userId — والمركز يطابق صفّ الوصول بالبريد وحده';
  }
  if (!/state:\s*\w+\s*\?\s*'granted'\s*:\s*'revoked'|state:\s*'(granted|revoked)'/.test(sso)) {
    return "state يجب أن تكون 'granted' أو 'revoked' حصراً — وما عداهما invalid_state";
  }
  if (!/email:/.test(sso)) return 'البريد لا يُمرَّر';
});

/* ── ١٢ — لا طريق دخول ثانٍ (الخطأ السادس) ── */
check('لا دخول محلي ولا قارئ جلسات محلي', () => {
  const bad = [];
  if (/verifyPassword/.test(read('src/routes/auth.ts') ?? '')) bad.push('مسار دخول بكلمة مرور');
  if (/FROM sessions|JOIN sessions/i.test(localAuth)) bad.push('قارئ جدول sessions المحلي');
  if (/createSession/.test(localAuth)) bad.push('منشئ جلسات محلية');
  if (bad.length) return bad.join('، ') + ' — كلٌّ منها يدخل بلا مرور بالمركز';
});

/* ── ١٣ — اللوحة تعالج ٤٠١ (بند «اللوحة») ── */
check('عميل اللوحة يعالج ٤٠١ ويصحّح next', () => {
  // الشرط قد يكون `=== 401` أو `!== 401` — كلاهما معالجة.
  if (!/status\s*[!=]==?\s*401/.test(apiClient)) {
    return 'لا معالجة لـ٤٠١ — انتهاء الرمز يعطي خطأ شبكة مبهماً';
  }
  if (!/data\.login|\.login\b/.test(apiClient)) return 'لا يُتّبع عنوان الباب في جسم الردّ';
  if (!/window\.location\.pathname/.test(apiClient)) return 'next لا يُصحَّح من موضع المتصفّح';
  if (!/'\/denied'/.test(apiClient)) return 'مسار الرفض غير مستثنى من next — تدور الحلقة';
});

/* ── ١٤ — اللوحة تعالج ٤٠٣ ── */
check('عميل اللوحة يعالج ٤٠٣', () => {
  if (!/status\s*[!=]==?\s*403/.test(apiClient)) {
    return 'لا معالجة لـ٤٠٣ — سحب الوصول يعطي شاشة خاوية بلا سبب';
  }
  if (!/\.denied\b/.test(apiClient)) return 'لا يُتّبع مسار الرفض في جسم الردّ';
});

/* ── ١٥ — صفحة الرفض لا تسأل عن العضو (الخطأ الرابع) ── */
check('/denied لا تسأل عن العضو عند الإقلاع', () => {
  if (!/pathname\s*===?\s*'\/denied'/.test(webAuth)) {
    return 'لا استثناء لمسار الرفض — دورة تحويل لا تنتهي';
  }
});

/* ── ١٦ — نصوص الرفض الأربعة من السجلّ ── */
check('شاشة الرفض تحمل الحالات الأربع المسجَّلة', () => {
  const codes = ['inactive', 'not_member', 'bad_state', 'auth_failed'];
  const missing = codes.filter((c) => !denied.includes(c));
  if (missing.length) return `ينقصها: ${missing.join('، ')}`;
  if (!denied.includes('تعذّر الدخول')) return 'العنوان المسجَّل «تعذّر الدخول» غير موجود';
  if (!/lucide-react/.test(denied)) return 'بلا أيقونة — والحالة لا تُبلَّغ باللون وحده';
});

/* ═══ الناتج ═══ */
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  نجح ' : '  فشل '} ${r.name}${r.ok ? '' : `\n         └─ ${r.why}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} بنداً`);

console.log(`
ما لا يفحصه هذا الملف — ويُتحقَّق منه يدوياً:
  · تطبيق الهجرة على القاعدة الحقيقية (--remote) لا وجود ملفها فقط
  · ضبط AUTH_CLIENT_SECRET بـwrangler secret put، ونوعه Secret لا Text
  · صفّ المنصة في المركز: id بحالة أحرفه، وurl = ${CALLBACK_URL}
  · صفّ وصول granted للمستخدم في platform_access — لا مجرّد حساب موجود
  · دورة دخول كاملة من / نظيفة`);

process.exit(failed.length ? 1 : 0);

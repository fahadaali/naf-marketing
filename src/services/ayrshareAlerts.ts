/* ============================================================
   تنبيهات حساب Ayrshare: حسابٌ لم يعد مربوطاً، وربطٌ يحتاج تجديداً، وحسابُ نشرٍ عُطّل.

   Ayrshare يُرسل ثلاثتها بالويب هوك (`social` و`suspended` في «Webhook
   Actions» من توثيقه) وكانت لا تُستقبل: حسابٌ يُلغى ربطه فيفشل كل موعدٍ عليه
   بنصٍّ لا يقول السبب، وحسابُ نشرٍ يُعطَّل (suspended) فيُقرأ كل طلبٍ «رفض
   Ayrshare المفتاح» — والتعطيل يردّ ٤٠٣ — فيُبحث في السرّ وهو سليم. فتصل من
   يدير الإعدادات إشعاراً بسببها وما يُفعل، ويُحفظ التعطيل ما دام قائماً لتقوله
   رسالةُ النشر وبطاقةُ صحّة التكامل بدل المفتاح.

   و«معطّل» لا «موقوف»: اللفظ المسجّل لحالة suspended في الحالات العامة.
   ============================================================ */

import type { Env } from '../types';
import { notifyUsers, usersWithPermission } from './notify';
import { customPlatformLabels, platformName } from '../platformLabels';
import { ayrshareAccountPlatform } from '../adapters/ayrshare';

/** التعطيل القائم في `settings` — يُكتب مع `suspend` ويُمحى مع `unsuspend`. */
export const SUSPENSION_KEY = 'ayrshare_suspension';

export type Suspension = {
  /** السبب كما قالته المنصة أو Ayrshare — بلغته. */
  reason: string | null;
  /** مفتاح المنصة عندنا إن كانت هي سبب التعطيل. */
  platform: string | null;
  /** policy · payment · rateLimit · manual · report · subscription */
  origin: string | null;
  unsuspendAt: string | null;
};

/** وجهةُ الإشعار: بطاقة المزوّد في الإعدادات — حساباته المربوطة وصحّته. */
const SETTINGS_LINK = '/settings?tab=platforms';

/** نصٌّ لاتينيٌّ معزولُ الاتجاه في جملةٍ عربية — لا `<bdi>` في الإشعار والبريد. */
const iso = (s: string) => `\u2068${s}\u2069`;

/** التاريخ بالصيغة المعتمدة (2026/07/26) بتوقيت الرياض — أو فارغ. */
function day(at: string | null | undefined): string {
  const t = Date.parse(String(at || ''));
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(t)).replace(/-/g, '/');
}

/** اسم المنصة كما يعرفها الفريق — من اسمها لدى Ayrshare. */
function platformLabel(ayrPlatform: unknown, custom: Record<string, string>): { key: string; name: string } {
  const key = ayrshareAccountPlatform({ platform: ayrPlatform });
  return { key, name: key ? platformName(key, custom) : '' };
}

/**
 * سبب التعطيل وما يُفعّل الحساب من جديد — جملتان. المنصة إن كانت السبب يُحلّ
 * عندها، والدفع من حساب Ayrshare، وتجاوزُ الحدّ يزول وحده، وما سواها لدى دعم Ayrshare.
 */
export function suspensionText(s: Suspension, name: string): string {
  const cause = s.reason ? `حساب النشر معطّلٌ لدى Ayrshare: ${iso(s.reason)}.` : 'حساب النشر معطّلٌ لدى Ayrshare.';
  const until = day(s.unsuspendAt);
  let fix: string;
  if (s.origin === 'payment' || s.origin === 'subscription') fix = 'حدّث الدفع أو الاشتراك في حساب Ayrshare ليُفعَّل من جديد.';
  else if (s.origin === 'rateLimit') fix = until ? `يُفعَّل وحده في ${iso(until)}.` : 'يُفعَّل وحده حين يهدأ معدّل الطلبات.';
  else if (s.origin === 'policy' && name) fix = `حُلّ السبب على ${name} نفسها ثم أعد ربطها في Ayrshare.`;
  else fix = 'تواصل مع دعم Ayrshare لتفعيله.';
  return `${cause} ${fix}`;
}

/** التعطيل القائم بنصّه — أو فارغ. */
export async function suspensionNotice(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(SUSPENSION_KEY).first<{ value: string }>();
  if (!row?.value) return '';
  let s: Suspension;
  try {
    s = JSON.parse(row.value) as Suspension;
  } catch {
    return '';
  }
  const name = s.platform ? platformName(s.platform, await customPlatformLabels(env)) : '';
  return suspensionText(s, name);
}

/**
 * إشعارٌ وصل بنصّه نفسه قريباً لا يُعاد — Ayrshare يعيد الحدث إن لم يُجَب في
 * مهلته، والتجديد يُنبَّه إليه أكثر من مرّة.
 *
 * والحدّ بصيغة `created_at` نفسها (`…T…Z`): `datetime()` تكتب مسافةً مكان
 * `T`، فيُقارَن نصّاً كلُّ إشعارٍ في اليوم نفسه «أحدث» أيّاً كانت ساعته.
 */
async function notifyOnce(
  env: Env,
  input: { type: string; title: string; body: string },
  withinMinutes: number,
): Promise<void> {
  const seen = await env.DB.prepare(
    `SELECT id FROM notifications WHERE type = ? AND title = ? AND body = ?
       AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) LIMIT 1`,
  )
    .bind(input.type, input.title, input.body, `-${withinMinutes} minutes`)
    .first();
  if (seen) return;
  const ids = await usersWithPermission(env, 'settings.manage');
  await notifyUsers(env, ids, { ...input, link: SETTINGS_LINK });
}

/* ═══ `social`: ربطٌ وفصلٌ وتجديد ═══

   الفصل بيد النظام (`source: system`) سببُه في `details` — حسابٌ قُفل أو
   صلاحيةٌ سُحبت. وبيد أحدٍ من الحساب (`user`) قرارٌ يُعلَم ولا يُنبَّه إليه
   كعطل. والتجديد يحمل موعده (`refreshBy`). والربط لا إشعار له: يظهر في
   بطاقة صحّة التكامل. */
export async function onSocialEvent(env: Env, evt: any): Promise<void> {
  const type = String(evt?.type || '');
  if (type !== 'unlink' && type !== 'refresh') return;
  const { name } = platformLabel(evt?.platform, await customPlatformLabels(env));
  if (!name) return;

  if (type === 'refresh') {
    const by = day(evt?.refreshBy);
    await notifyOnce(env, {
      type: 'account_refresh',
      title: `ربط ${name} في Ayrshare يحتاج تجديداً`,
      body: by
        ? `جدّده قبل ${iso(by)} من Social Accounts في Ayrshare، وإلا لم يُنشر عليه شيءٌ بعده.`
        : 'جدّده من Social Accounts في Ayrshare، وإلا لم يُنشر عليه شيءٌ بعده.',
    }, 7 * 24 * 60);
    return;
  }

  const detail = String(evt?.details?.message || '').trim();
  const byUser = evt?.source === 'user';
  await notifyOnce(env, {
    type: 'account_unlinked',
    title: byUser ? `أُلغي ربط حساب ${name} في Ayrshare` : `حساب ${name} لم يعد مربوطاً في Ayrshare`,
    body: byUser
      ? 'ألغاه أحدٌ من حساب Ayrshare نفسه. لن يُنشر عليه شيءٌ حتى يُعاد ربطه.'
      : `${detail ? `${iso(detail)}. ` : ''}لن يُنشر عليه شيءٌ حتى يُعاد ربطه من Social Accounts في Ayrshare.`,
  }, 10);
}

/** يمحو التعطيل المحفوظ — فُعّل الحساب، أو نجح طلبٌ لا ينجح والحسابُ معطّل. */
export async function clearSuspension(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(SUSPENSION_KEY).run();
}

/* ═══ `suspended`: تعطيلُ حساب النشر وتفعيلُه ═══

   لا يصل إلا حين تتغيّر حالُ التعطيل كلّها: سببٌ ثانٍ والحسابُ معطّل لا حدث
   له، والتفعيلُ يصل بعد زوال آخر سبب. فالمحفوظ يبقى حتى `unsuspend` — أو حتى
   ينجح طلبٌ في بطاقة صحّة التكامل، إن فات حدثُ التفعيل. */
export async function onSuspendedEvent(env: Env, evt: any): Promise<void> {
  const type = String(evt?.type || '');
  if (type === 'unsuspend') {
    await clearSuspension(env);
    await notifyOnce(env, {
      type: 'account_suspended',
      title: 'فعّل Ayrshare حساب النشر من جديد',
      body: 'عاد النشر والسحب. أعد نشر ما فشل خلال التعطيل.',
    }, 10);
    return;
  }
  if (type !== 'suspend') return;

  const custom = await customPlatformLabels(env);
  const { key, name } = evt?.platform ? platformLabel(evt.platform, custom) : { key: '', name: '' };
  const s: Suspension = {
    reason: typeof evt?.reason === 'string' && evt.reason.trim() ? evt.reason.trim() : null,
    platform: key || null,
    origin: typeof evt?.origin === 'string' ? evt.origin : null,
    unsuspendAt: typeof evt?.unsuspendAt === 'string' ? evt.unsuspendAt : null,
  };
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(SUSPENSION_KEY, JSON.stringify(s)).run();
  await notifyOnce(env, {
    type: 'account_suspended',
    title: 'عطّل Ayrshare حساب النشر',
    body: `${suspensionText(s, name)} ولا يعمل النشر ولا السحب حتى يُفعَّل.`,
  }, 10);
}

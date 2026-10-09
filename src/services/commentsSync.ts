import type { Env } from '../types';
import type { ModerateAction } from '../adapters/provider';
import { ayrshareAuth, getProvider, providerKey } from '../adapters';
import {
  AYRSHARE_COMMENT_PLATFORMS, AYRSHARE_DM_PLATFORMS, AyrshareError, ayrshareComments, ayrshareLinkedInReply, ayrshareMessages,
  ayrsharePlatform, ayrshareReviews, ayrshareUser, decodeAyrshareId, errorCodes, mapAyrshareComments,
  type AyrshareAccount, type AyrshareAuth, type AyrshareMessage,
} from '../adapters/ayrshare';
import {
  BudgetExhausted, CallBudget, conversationLatest, isNotFound, isOwnAuthor, isUnsupported, listCommentReplies,
  listConversations, listInboxPosts, listMentions, listPostComments, listReviews,
  listSocialApiAccountsDetailed, ownReply, SocialApiError, supportsDirectInbox,
  type InboxItem, type InboxPost, type MentionsPath, type RepliesPath, type SocialApiOwnedAccount,
} from '../adapters/socialapi';
import { newId, nowIso } from '../util';
import { notifyUsers, usersWithPermission } from './notify';
import { customPlatformLabels, normalizePlatformKey, platformName } from '../platformLabels';
import { beginScheduledRun, endScheduledRun, runLimits, type Plan, type Trigger } from './limits';

/* ============================================================
   مزامنة صندوق التعليقات والرسائل.

   ═══ ما كان يقع ═══

   ثلاثة أسبابٍ اجتمعت فغابت تعليقاتٌ عن الصندوق كلِّه — لا عن «بلا رد» ولا
   عن «تم الرد»:

   ١) الصفحة الأولى وحدها. تعليقات المنشور تُردّ من الأقدم إلى الأحدث بخمسٍ
      وعشرين في الصفحة، والمزامنة لا تتبع الصفحة التالية — فكل منشورٍ تجاوز
      الخمسة والعشرين يُقرأ أقدمُه ويُترك أحدثُه أبداً.
   ٢) نداءٌ لكل منشورٍ في كل دورة، بلا حدّ. والعامل يُحدّ بخمسين طلباً في
      الاستدعاء على الخطة المجانية، فيسقط ما بعد الحدّ صامتاً — ويتبدّل
      الساقط من دورةٍ إلى دورة.
   ٣) لا شيء يعرف أن حسابنا ردّ من تطبيق المنصّة. الردّ يُسجَّل هنا حين
      يُكتب هنا وحده.

   ═══ وما يقع الآن ═══

   كل دورة بميزانيةٍ معلومة من النداءات، تقف عندها واقفةً لا ساقطة، وتحفظ
   تقريرها: ما قُرئ وما تعذّر وهل اكتملت. والمنشور لا يُعاد جلبُ تعليقاته إلا
   إذا تغيّرت بصمتُه أو بقيت عليه تعليقاتٌ بلا رد تُفحص ردودها. والمنشور
   الكبير يُستأنف من آخر صفحةٍ بلغها.

   والردّ من خارج المنصة يُعرف من ردود التعليق نفسها: ردٌّ كاتبُه حسابُنا
   ينقل التعليق إلى «تم الرد» بنصّه ووقته، موسوماً «من خارج المنصة». وما لم
   تثبت نسبتُه إلينا يبقى «بلا رد» — تعليقُ عميلٍ يُحسب مردوداً عليه وهو ليس
   كذلك لا يجيبه أحد، وهذا أسوأ الخطأين.
   ============================================================ */

/**
 * `incremental` الدورة المجدولة والخطّاف: الجديد وما تغيّر. `full` «جلب الآن»:
 * صفحاتٌ أكثر وكل منشور. `history` سحبُ السجلّ: منشوراتٌ قديمة لم
 * تُقرأ قطّ، وردودُنا على التعليقات القديمة، والمراجعات والرسائل والإشارات
 * إلى آخرها مرّةً في اليوم — بتقريرٍ وقفلٍ غير تقرير الصندوق وقفله.
 */
export type SyncMode = 'incremental' | 'full' | 'history';
export type InboxKind = 'comment' | 'dm' | 'review' | 'mention';

export type InboxKindStatus = {
  /** `true` قُرئ، `false` تعذّر، `null` لم يُطلب أو لا يدعمه أيُّ حسابٍ مربوط. */
  ok: boolean | null;
  items: number;
  error?: string;
};

/** تقرير الدورة — يُحفظ في الإعدادات ويُعرض في الشاشة. لا سرّ فيه. */
export type InboxSyncReport = {
  at: string;
  mode: SyncMode;
  provider: string;
  /** لا عطلَ في أيّ نوع. */
  ok: boolean;
  /** لم تقف الدورة عند حدّ ميزانيتها — ما لم يُقرأ يُكمله ما بعدها. */
  complete: boolean;
  calls: number;
  budget: number;
  added: number;
  externalReplies: number;
  kinds: Record<InboxKind, InboxKindStatus>;
  errors: string[];
  lastOkAt: string | null;
  repliesPath: RepliesPath | 'none' | null;
  mentionsPath: MentionsPath | 'none' | null;
  /** الخطة المعلنة، وهل نزلت حصصها إلى المجانية احتياطاً — انظر `limits.ts`. */
  plan?: Plan;
  fallback?: boolean;
  /** وقفت الدورة قبل حصّتها: المزوّد طلب التمهّل، أو بلغ الاستدعاء حدّ طلباته. */
  stoppedBy?: 'rate_limit' | 'platform_cap' | null;
};

const REPORT_KEY = 'inbox_sync_report';
const LOCK_KEY = 'inbox_sync_lock';
const HISTORY_REPORT_KEY = 'inbox_history_report';
const HISTORY_LOCK_KEY = 'inbox_history_lock';
/** أين بلغت قراءة قائمة منشورات الصندوق نحو أقدمها، ومتى اكتملت. */
const HISTORY_CURSOR_KEY = 'inbox_history_cursor';
const HISTORY_DONE_KEY = 'inbox_history_done_at';
/** آخر قراءةٍ للمراجعات والرسائل والإشارات إلى آخرها — مرّةً في اليوم. */
const HISTORY_DEEP_KEY = 'inbox_history_deep_at';

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run();
}

async function providerName(env: Env): Promise<string> {
  return ((await getSetting(env, 'provider_name')) || env.PROVIDER_NAME || 'mock').toLowerCase();
}

async function readReport(env: Env, key: string): Promise<InboxSyncReport | null> {
  const raw = await getSetting(env, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InboxSyncReport;
  } catch {
    return null;
  }
}

export async function readInboxReport(env: Env): Promise<InboxSyncReport | null> {
  return readReport(env, REPORT_KEY);
}

export async function readInboxHistoryReport(env: Env): Promise<InboxSyncReport | null> {
  return readReport(env, HISTORY_REPORT_KEY);
}

/** متى بلغت قراءة سجلّ الصندوق أقدم منشور — أو `null` ما دامت تُقرأ. */
export async function inboxHistoryDoneAt(env: Env): Promise<string | null> {
  return (await getSetting(env, HISTORY_DONE_KEY)) || null;
}

/**
 * `hints` تقريرٌ تُؤخذ منه المسارات التي تعلّمتها الدورات — مسارُ ردود التعليقات
 * ومسارُ الإشارات. وهو السابق نفسه، إلا في سحب السجلّ: يأخذها من الصندوق.
 */
function newReport(
  mode: SyncMode,
  provider: string,
  budget: number,
  prev: InboxSyncReport | null,
  hints: InboxSyncReport | null = prev,
): InboxSyncReport {
  const kind = (): InboxKindStatus => ({ ok: null, items: 0 });
  return {
    at: nowIso(),
    mode,
    provider,
    ok: true,
    complete: true,
    calls: 0,
    budget,
    added: 0,
    externalReplies: 0,
    kinds: { comment: kind(), dm: kind(), review: kind(), mention: kind() },
    errors: [],
    lastOkAt: prev?.lastOkAt ?? null,
    repliesPath: hints?.repliesPath ?? null,
    mentionsPath: hints?.mentionsPath ?? null,
  };
}

function errorText(err: unknown): string {
  return String((err as Error)?.message || err).slice(0, 240);
}

/**
 * رفضٌ يخصّ منشوراً بعينه: ٤xx من المزوّد بعد أن قُبلت قائمة المنشورات نفسها —
 * حُذف المنشور، أو مُنع عنه الحساب، أو رُدّ الطلب بمحتواه. وليس منه ٤٠١ (الرمز
 * كلّه)، ولا ٤٠٨ و٤٢٩ (مهلةٌ وتمهّل). وما سواه عطلٌ عامّ لا ذنب للمنشور فيه.
 */
function rejectedPost(err: unknown): boolean {
  return err instanceof SocialApiError && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status);
}

/**
 * قفلٌ قصير: خطّافٌ يصل مع كل تعليق، ودورةٌ آلية كل عشرين دقيقة — فلا
 * تُشغَّل مزامنتان معاً على الحصّة نفسها. يُعاد الإذن بعد انقضاء المدّة ولو
 * سقطت الدورة السابقة قبل أن تُنهي.
 */
async function takeLock(env: Env, key: string, withinMs: number): Promise<boolean> {
  const last = await getSetting(env, key);
  if (last && Date.now() - Date.parse(last) < withinMs) return false;
  await setSetting(env, key, nowIso());
  return true;
}

/**
 * يجلب التعليقات/الرسائل الجديدة ويخزّنها — يختار المسار حسب المزوّد.
 *
 * `full` للجلب اليدوي: يقرأ صفحاتٍ أكثر ويشمل كل منشور. و`incremental`
 * للدورة الآلية والخطّاف. ويعود بتقرير الدورة، أو `null` إن تخطّاها القفل.
 */
export async function syncComments(
  env: Env,
  opts: { mode?: SyncMode; trigger?: Trigger; budget?: number; skipIfRunningWithinMs?: number } = {},
): Promise<InboxSyncReport | null> {
  const mode = opts.mode ?? 'incremental';
  const history = mode === 'history';
  const trigger: Trigger = opts.trigger ?? (mode === 'full' ? 'manual' : history ? 'history' : 'cron');
  const reportKey = history ? HISTORY_REPORT_KEY : REPORT_KEY;
  const lockKey = history ? HISTORY_LOCK_KEY : LOCK_KEY;
  if (opts.skipIfRunningWithinMs) {
    if (!(await takeLock(env, lockKey, opts.skipIfRunningWithinMs))) return null;
  } else {
    await setSetting(env, lockKey, nowIso());
  }

  // المجدولة وحدها يُرصد سقوطها، وقبل أن تُقرأ حصّتها — انظر `limits.ts`
  const job = history ? 'inbox-history' : 'inbox';
  const mark = trigger === 'cron' || trigger === 'history' ? await beginScheduledRun(env, job) : null;
  try {
    const prev = await readReport(env, reportKey);
    const limits = await runLimits(env, trigger);
    const provider = await providerName(env);
    const report = newReport(mode, provider, opts.budget ?? limits.calls, prev, history ? await readInboxReport(env) : prev);
    report.plan = limits.plan;
    report.fallback = limits.fallback;

    try {
      if (provider === 'socialapi') await syncSocialApiInbox(env, report, limits.deadline);
      else if (provider === 'ayrshare') await syncAyrshareInbox(env, report, limits.deadline);
      // المزوّدون الآخرون يُقرأ صندوقهم كلُّه في كل دورة — لا سجلّ له مستقلّ
      else if (!history) await syncPerPost(env, report);
    } catch (err) {
      report.errors.push(errorText(err));
    }

    report.ok = report.errors.length === 0;
    if (report.ok) report.lastOkAt = report.at;
    await setSetting(env, reportKey, JSON.stringify(report));
    return report;
  } finally {
    if (mark) await endScheduledRun(env, job, mark);
  }
}

/* ============================================================
   SocialAPI — الصندوق الموحّد عبر كل الحسابات
   ============================================================ */

type Owners = { forAccount: (accountId: string) => Set<string> };

function ownerIndex(accounts: SocialApiOwnedAccount[]): Owners {
  const byAccount = new Map(accounts.map((a) => [a.id, new Set(a.ownerKeys)]));
  const all = new Set(accounts.flatMap((a) => a.ownerKeys));
  return { forAccount: (accountId) => byAccount.get(accountId) ?? all };
}

async function syncSocialApiInbox(env: Env, report: InboxSyncReport, deadline: number): Promise<void> {
  const token = providerKey(env, 'socialapi');
  if (!token) {
    report.errors.push('مفتاح SocialAPI غير مضبوط. اضبط SOCIALAPI_API_KEY.');
    return;
  }
  const budget = new CallBudget(report.budget, deadline);

  // تنظيف السجلات الفارغة (بلا نص ولم يُردّ عليها) — يشمل التقييمات بلا تعليق مكتوب.
  await env.DB.prepare(
    "DELETE FROM platform_comments WHERE (body IS NULL OR TRIM(body) = '') AND reply_body IS NULL AND replied_at IS NULL",
  ).run();

  const fail = (kind: InboxKind | null, err: unknown) => {
    if (err instanceof BudgetExhausted) {
      report.complete = false;
      return;
    }
    const message = errorText(err);
    if (kind) {
      report.kinds[kind].ok = false;
      report.kinds[kind].error = message;
    }
    report.errors.push(message);
  };

  let accounts: SocialApiOwnedAccount[] = [];
  try {
    accounts = await listSocialApiAccountsDetailed(token, budget);
  } catch (err) {
    fail(null, err);
  }
  const owners = ownerIndex(accounts);

  /* ما يُحجز لبقية الأنواع: المراجعات بنداء، والرسائل بنداءٍ ونداءين لتعرّف
     آخر رسالة، والإشارات بنداءٍ لكل حسابٍ يدعمها. والتعليقات تأخذ الباقي —
     فلا يأكل منشورٌ كثيرُ التعليقات حصّةَ الرسائل في كل دورة. */
  const direct = accounts.filter((a) => supportsDirectInbox(a.platform)).length;

  /* سحب السجلّ يقرأ المراجعات والرسائل والإشارات إلى آخرها مرّةً في اليوم —
     أحدثُها تقرؤه الدورات المعتادة كل عشرين دقيقة، وقديمُها لا يتغيّر كثيراً. */
  const history = report.mode === 'history';
  const deepAt = history ? await getSetting(env, HISTORY_DEEP_KEY) : null;
  const deep = history && (!deepAt || Date.now() - Date.parse(deepAt) > DAY);
  const others = !history || deep;
  const reserve = others ? Math.min(1 + (direct ? 3 : 0) + direct, 12) * (deep ? 3 : 1) : 0;

  try {
    await syncCommentThreads(env, token, budget, report, owners, reserve);
  } catch (err) {
    fail('comment', err);
  }

  if (history) {
    try {
      await sweepOldReplies(env, token, budget, report, owners, reserve);
    } catch (err) {
      fail('comment', err);
    }
  }

  const fresh: InboxItem[] = [];
  if (others) {
    try {
      fresh.push(...(await syncReviews(env, token, budget, report, deep ? 10 : 2)));
    } catch (err) {
      fail('review', err);
    }

    try {
      await syncConversations(env, token, budget, report, accounts, deep ? 5 : 2);
    } catch (err) {
      fail('dm', err);
    }

    try {
      await syncMentions(env, token, budget, report, accounts, deep ? 3 : 1);
    } catch (err) {
      fail('mention', err);
    }
    // لم تُستكمل قبل الحصّة — تُعاد في السحب التالي لا بعد يوم
    if (deep && budget.left > 0) await setSetting(env, HISTORY_DEEP_KEY, nowIso());
  }

  report.calls = budget.used;
  report.stoppedBy = budget.stoppedBy;
  if (budget.stoppedBy) report.complete = false;
  /* التنبيه لما جدّ لا لما قُرئ أوّل مرّة: قراءةُ الصفحات إلى آخرها تُدخل
     الصندوقَ مراجعاتِ سنواتٍ مضت، ولكلّ سلبيةٍ منها بريدٌ لكل مسؤول. فلا يُنبَّه
     إلا لمراجعة الأسبوع الأخير، ولا شيء من سحب السجلّ. */
  const since = Date.now() - 7 * DAY;
  const negative = history ? [] : fresh.filter((it) => it.rating != null && it.rating <= 2 && Date.parse(it.createdAt) >= since);
  if (negative.length) await notifyNegative(env, negative);
}

/* ─── صفوف القاعدة ─── */

type Row = {
  id: string;
  provider_comment_id: string;
  platform: string;
  kind: string;
  author_name: string | null;
  body: string | null;
  is_hidden: number;
  capabilities_json: string | null;
  rating: number | null;
  reply_body: string | null;
  replied_at: string | null;
  reply_source: string | null;
  reply_checked_at: string | null;
  provider_interaction_id: string | null;
  created_at: string;
};

const ROW_COLUMNS =
  'id, provider_comment_id, platform, kind, author_name, body, is_hidden, capabilities_json, rating, reply_body, replied_at, reply_source, reply_checked_at, provider_interaction_id, created_at';

/** صفوف منشورٍ واحد بترميزها `منشور|حساب|` — مطابقةُ بادئةٍ حرفية لا `LIKE` (معرّفات فيسبوك فيها `_`). */
async function rowsByPrefix(env: Env, prefix: string): Promise<Map<string, Row>> {
  const { results } = await env.DB.prepare(
    `SELECT ${ROW_COLUMNS} FROM platform_comments WHERE substr(provider_comment_id, 1, ?) = ?`,
  )
    .bind(prefix.length, prefix)
    .all<Row>();
  return new Map(results.map((r) => [r.provider_comment_id, r]));
}

/** صفوفٌ بمعرّفاتها — دفعاتٍ دون حدّ الروابط في D1. */
async function rowsByIds(env: Env, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT ${ROW_COLUMNS} FROM platform_comments WHERE provider_comment_id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<Row>();
    for (const r of results) out.set(r.provider_comment_id, r);
  }
  return out;
}

async function runBatch(env: Env, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  const out: D1Result[] = [];
  for (let i = 0; i < stmts.length; i += 50) {
    out.push(...(await env.DB.batch(stmts.slice(i, i + 50))));
  }
  return out;
}

type ExternalReply = { text: string; at: string | null; id: string | null };

/** ردٌّ من خارج المنصة على صفٍّ بلا رد — لا يمسّ ردّاً كُتب من هنا. */
function externalReplyStmt(env: Env, rowId: string, reply: ExternalReply): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE platform_comments
     SET reply_body = ?, replied_at = ?, reply_provider_id = COALESCE(reply_provider_id, ?),
         reply_source = 'external', replied_by = NULL
     WHERE id = ? AND reply_body IS NULL`,
  ).bind(reply.text || '—', reply.at, reply.id, rowId);
}

type WriteResult = { added: number; externalReplies: number; fresh: InboxItem[] };

/**
 * يكتب عناصر الصندوق: الجديد إدراجاً، والمتغيّر تحديثاً، والثابت لا يُمسّ.
 *
 * وكان كل عنصرٍ يُكتب في كل دورة ويُعدّ «جديداً» لأن التحديث يُرجع صفّاً
 * متأثّراً — فيقرأ «جلب الآن» مئةَ عنصرٍ جديد في صندوقٍ لم يتغيّر فيه شيء.
 */
async function writeItems(env: Env, items: InboxItem[], existing?: Map<string, Row>): Promise<WriteResult> {
  const result: WriteResult = { added: 0, externalReplies: 0, fresh: [] };
  if (!items.length) return result;
  const rows = existing ?? (await rowsByIds(env, items.map((i) => i.id)));

  const inserts: { stmt: D1PreparedStatement; item: InboxItem }[] = [];
  const updates: D1PreparedStatement[] = [];

  for (const it of items) {
    const caps = it.capabilities ? JSON.stringify(it.capabilities) : null;
    const row = rows.get(it.id);
    if (!row) {
      const replied = it.repliedBody ? 1 : 0;
      inserts.push({
        item: it,
        stmt: env.DB.prepare(
          `INSERT INTO platform_comments
             (id, post_id, schedule_id, platform, provider_comment_id, kind, author_name, body, created_at,
              capabilities_json, is_hidden, rating, reply_body, replied_at, reply_source, provider_interaction_id)
           VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(platform, provider_comment_id) DO NOTHING`,
        ).bind(
          newId('cm'), it.platform, it.id, it.kind, it.authorName, it.body, it.createdAt,
          caps, it.isHidden ? 1 : 0, it.rating ?? null,
          replied ? it.repliedBody : null, replied ? it.repliedAt ?? null : null, replied ? 'external' : null,
          it.interactionId ?? null,
        ),
      });
      if (replied) result.externalReplies++;
      continue;
    }

    // معرّف المزوّد يُستكمل لصفٍّ كُتب قبل أن يُحفظ — ولا يُستبدل ما حُفظ
    const interaction = !row.provider_interaction_id && it.interactionId ? it.interactionId : null;
    const changed =
      row.body !== it.body || row.author_name !== it.authorName || row.kind !== it.kind ||
      (row.is_hidden ? 1 : 0) !== (it.isHidden ? 1 : 0) || (row.capabilities_json ?? null) !== caps ||
      (row.rating ?? null) !== (it.rating ?? null) || interaction !== null;
    const reopened = it.kind === 'dm' && row.body !== it.body;
    if (changed) {
      updates.push(
        env.DB.prepare(
          /* رسالةٌ متجاهَلة كتب صاحبها من جديد تعود إلى «بلا رد»: التجاهل كان
             لما قاله، لا لما سيقوله. */
          `UPDATE platform_comments
           SET kind = ?, body = ?, author_name = ?, capabilities_json = ?, is_hidden = ?, rating = ?,
               provider_interaction_id = COALESCE(provider_interaction_id, ?),
               ignored_at = CASE WHEN ? THEN NULL ELSE ignored_at END,
               ignored_by = CASE WHEN ? THEN NULL ELSE ignored_by END
           WHERE id = ?`,
        ).bind(
          it.kind, it.body, it.authorName, caps, it.isHidden ? 1 : 0, it.rating ?? null, interaction,
          reopened ? 1 : 0, reopened ? 1 : 0, row.id,
        ),
      );
    }
    if (it.repliedBody && row.reply_body === null) {
      updates.push(externalReplyStmt(env, row.id, { text: it.repliedBody, at: it.repliedAt ?? null, id: null }));
      result.externalReplies++;
    } else if (it.repliedBody && row.reply_source === 'external' && !row.replied_at && it.repliedAt) {
      // ردٌّ خارجيٌّ عُرف نصُّه قبل وقته — يُستكمل الوقت ولا يُمسّ النص
      updates.push(env.DB.prepare('UPDATE platform_comments SET replied_at = ? WHERE id = ?').bind(it.repliedAt, row.id));
    }
  }

  const res = await runBatch(env, inserts.map((i) => i.stmt));
  res.forEach((r, i) => {
    if ((r.meta?.changes ?? 0) > 0) {
      result.added++;
      result.fresh.push(inserts[i].item);
    }
  });
  await runBatch(env, updates);
  return result;
}

/* ─── التعليقات ─── */

type PostState = {
  inbox_post_id: string;
  account_id: string;
  signature: string;
  synced_at: string | null;
  tail_cursor: string | null;
  needs_more: number;
};

type ReplyCheck = {
  rowKey: string; // provider_comment_id
  postId: string;
  accountId: string;
  commentId: string;
  interactionId: string;
  createdAt: string;
  known: boolean; // المزوّد أعلن عدد الردود وهو فوق الصفر
  checkedAt: string | null;
};

const DAY = 86_400_000;

/**
 * أولويّة المنشور في الدورة — أصغرُها أسبق، و`null` لا يُجلب هذه المرّة.
 * ٠ لم يُقرأ قطّ · ١ منشورٌ كبير لم تكتمل قراءته · ٢ تغيّرت بصمتُه ·
 * ٣ المزوّد لا يُعلن بصمةً فيُقرأ بالتناوب · ٤ عليه تعليقاتٌ بلا رد تُفحص
 * ردودها · ٥ كل ما عداه في الجلب اليدوي.
 */
export function postPriority(
  p: InboxPost,
  st: PostState | null,
  hasOpen: boolean,
  mode: SyncMode,
  now: number,
): number | null {
  if (!st) return 0;
  if (st.needs_more) return 1;
  // سحب السجلّ للقديم وحده: ما لم يُقرأ قطّ أو وقفت قراءته — والباقي للدورة المعتادة
  if (mode === 'history') return null;
  if (p.signature && p.signature !== st.signature) return 2;
  const age = now - Date.parse(st.synced_at || '1970-01-01T00:00:00Z');
  if (!p.signature && age > 30 * 60_000) return 3;
  if (hasOpen && age > 2 * 3_600_000) return 4;
  if (mode === 'full') return 5;
  return null;
}

async function syncCommentThreads(
  env: Env,
  token: string,
  budget: CallBudget,
  report: InboxSyncReport,
  owners: Owners,
  reserve: number,
): Promise<void> {
  const mode = report.mode;

  /* سحب السجلّ يمضي في قائمة المنشورات من مؤشّره المحفوظ نحو أقدمها، ثلاث
     صفحاتٍ في كل سحب. فإذا بلغ آخرها استراح ثلاثين يوماً ثم عاد من أحدثها —
     المنشور القديم الذي يجدّ عليه تعليقٌ يصعد إلى أوّل القائمة فتقرؤه الدورة
     المعتادة، ولا ينتظر السجلّ. */
  let startCursor: string | null = null;
  if (mode === 'history') {
    const doneAt = await getSetting(env, HISTORY_DONE_KEY);
    if (doneAt && Date.now() - Date.parse(doneAt) < 30 * DAY) {
      report.kinds.comment.ok = true;
      return;
    }
    startCursor = (await getSetting(env, HISTORY_CURSOR_KEY)) || null;
  }
  let listing;
  try {
    listing = await listInboxPosts(token, { budget, maxPages: mode === 'full' ? 5 : mode === 'history' ? 3 : 2, startCursor });
  } catch (err) {
    // مؤشّرٌ لم يعد يقبله المزوّد — يُبدأ السجلّ من أوّله في السحب التالي
    if (startCursor && isUnsupported(err)) {
      await setSetting(env, HISTORY_CURSOR_KEY, '');
      report.complete = false;
      return;
    }
    throw err;
  }
  report.kinds.comment.ok = true;
  if (listing.exhausted) report.complete = false;

  const { results: stateRows } = await env.DB.prepare(
    'SELECT inbox_post_id, account_id, signature, synced_at, tail_cursor, needs_more FROM inbox_post_state',
  ).all<PostState>();
  const state = new Map(stateRows.map((s) => [`${s.inbox_post_id}|${s.account_id}`, s]));

  // منشوراتٌ عليها تعليقاتٌ بلا رد في الأسبوعين الأخيرين — تُفحص ردودها
  const { results: openRows } = await env.DB.prepare(
    `SELECT DISTINCT substr(provider_comment_id, 1, instr(provider_comment_id, '|') - 1) AS post_id
     FROM platform_comments
     WHERE kind = 'comment' AND reply_body IS NULL AND created_at >= ? AND instr(provider_comment_id, '|') > 0`,
  )
    .bind(new Date(Date.now() - 14 * DAY).toISOString())
    .all<{ post_id: string }>();
  const open = new Set(openRows.map((r) => r.post_id));

  const now = Date.now();
  const ranked = listing.posts
    .map((p) => {
      const st = state.get(`${p.postId}|${p.accountId}`) ?? null;
      return { p, st, pr: postPriority(p, st, open.has(p.postId), report.mode, now) };
    })
    .filter((x): x is { p: InboxPost; st: PostState | null; pr: number } => x.pr !== null)
    .sort((a, b) => a.pr - b.pr || (a.st?.synced_at ?? '').localeCompare(b.st?.synced_at ?? ''));

  const replyQueue: ReplyCheck[] = [];
  const stateWrites: D1PreparedStatement[] = [];
  const stamp = nowIso();
  let seen = 0;
  let processed = 0;
  let unfinished = 0;

  const stateOf = (p: InboxPost, resume: string | null, needsMore: boolean) =>
    env.DB.prepare(
      `INSERT INTO inbox_post_state (inbox_post_id, account_id, platform, signature, seen_at, synced_at, tail_cursor, needs_more)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(inbox_post_id, account_id) DO UPDATE SET
         platform = excluded.platform, signature = excluded.signature, seen_at = excluded.seen_at,
         synced_at = excluded.synced_at, tail_cursor = excluded.tail_cursor, needs_more = excluded.needs_more`,
    ).bind(p.postId, p.accountId, p.platform, p.signature, stamp, stamp, resume, needsMore ? 1 : 0);
  let failed = 0;
  /** ما تعذّر لعطلٍ عامّ — لم يُقرأ ولا حالة له. */
  let unread = 0;
  let firstError: string | null = null;

  for (const { p, st } of ranked) {
    // يُترك للردود ثلاثةُ نداءاتٍ على الأقل، وللأنواع الأخرى حصّتها
    if (budget.left <= reserve + 3) {
      report.complete = false;
      break;
    }
    let r;
    try {
      r = await syncOnePost(env, token, budget, report, owners, p, st, replyQueue);
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        report.complete = false;
        break;
      }
      /* منشورٌ واحد يتعذّر — حُذف على المنصّة أو مُنع عنه الحساب — لا يوقف
         الباقي. وكان خطؤه يُسقط الحلقة كلَّها: لا تُكتب حالةُ ما قُرئ قبله ولا
         يُقرأ ما بعده، وهو أوّل القائمة في كل دورة لأنه لم يُقرأ قطّ. فيُعطى
         حالةً ببصمته الحالية — لا يُعاد حتى يتغيّر نشاطه — ويُمضى إلى غيره.

         وذلك للمنشور الذي رفضه المزوّد وحده. أما العطل العامّ — مزوّدٌ متوقّف،
         أو شبكة، أو قاعدةٌ ينقصها عمود — فحالتُه تعلّم المنشور مقروءاً ولم
         تُحفظ تعليقاته، فتضيع بصمت. فلا حالة له: يُعاد في السحب التالي. */
      failed++;
      firstError ??= errorText(err);
      if (rejectedPost(err)) stateWrites.push(stateOf(p, st?.tail_cursor ?? null, false));
      else unread++;
      processed++;
      continue;
    }
    seen += r.seen;
    stateWrites.push(stateOf(p, r.resume, !r.complete));
    if (r.exhausted) {
      report.complete = false;
      break;
    }
    processed++;
    if (!r.complete) unfinished++;
  }
  await runBatch(env, stateWrites);
  report.kinds.comment.items = seen;
  if (failed) {
    report.kinds.comment.error = firstError ?? undefined;
    // كلُّ ما جُرّب تعذّر — عطلٌ يُقال، لا منشورٌ شاذّ
    if (failed === processed) {
      report.kinds.comment.ok = false;
      report.errors.push(firstError ?? '');
    }
  }

  /* لا يتقدّم مؤشّر السجلّ إلا وقد قُرئت منشورات صفحاته كلُّها إلى آخر
     تعليقاتها — وإلا تخطّى منشوراتٍ لم تُقرأ أو بقي منها شيء، ولا تبلغها
     الدورة المعتادة لأنها في أعماق القائمة. وما اكتمل منها له حالةٌ الآن، فلا
     يُعاد في السحب التالي، وما بقي منه يُستأنف من آخر صفحةٍ بلغها. وما تعذّر
     لعطلٍ عامّ لم يُقرأ ولا حالة له، فالمؤشّر يقف عنده كما يقف عند ما بقي. */
  if (mode === 'history' && processed === ranked.length && !unfinished && !unread && !listing.exhausted) {
    if (listing.complete) {
      await setSetting(env, HISTORY_DONE_KEY, stamp);
      await setSetting(env, HISTORY_CURSOR_KEY, '');
    } else {
      await setSetting(env, HISTORY_CURSOR_KEY, listing.resume ?? '');
    }
  }

  await checkReplies(env, token, budget, report, owners, replyQueue, reserve, { anyAge: mode === 'history' });
}

async function syncOnePost(
  env: Env,
  token: string,
  budget: CallBudget,
  report: InboxSyncReport,
  owners: Owners,
  p: InboxPost,
  st: PostState | null,
  replyQueue: ReplyCheck[],
): Promise<{ seen: number; complete: boolean; exhausted: boolean; resume: string | null }> {
  /* كل نمطٍ يستأنف المنشور من آخر صفحةٍ بلغها: التعليقات من الأقدم إلى
     الأحدث، فالبدء من أوّله في «جلب الآن» كان يقرأ أقدم خمسمئةٍ على منشورٍ
     كبير ولا يبلغ أحدثها — ثم يعيد مؤشّره إلى الصفحة السادسة فتعيد الدورات
     قراءة ما قُرئ. واليدوي يزيد الصفحات ويشمل كل منشور. */
  const full = report.mode === 'full';
  const startCursor = st?.tail_cursor ?? null;
  const maxPages = full || report.mode === 'history' ? 5 : 3;
  let res;
  try {
    res = await listPostComments(token, p.postId, p.accountId, { budget, maxPages, startCursor });
  } catch (err) {
    // مؤشّرٌ قديم لم يعد يقبله المزوّد — يُبدأ من أوّل المنشور
    if (!startCursor || !isUnsupported(err)) throw err;
    res = await listPostComments(token, p.postId, p.accountId, { budget, maxPages });
  }

  const ownerKeys = owners.forAccount(p.accountId);
  // الترميز القديم نفسه (منشور|حساب|تعليق) — به يُردّ على التعليق ويُشرف عليه
  const prefix = `${p.postId}|${p.accountId}|`;
  const existing = await rowsByPrefix(env, prefix);

  const items: InboxItem[] = [];
  const replies: { key: string; reply: ExternalReply }[] = [];
  const stale: string[] = [];

  for (const c of res.comments) {
    if (!c.commentId && !c.body) continue;
    const key = `${prefix}${c.commentId}`;

    if (isOwnAuthor(c.raw, ownerKeys)) {
      /* تعليقٌ كتبه حسابُنا: ردٌّ على تعليق — فالتعليق الأصل مردودٌ عليه —
         أو أوّلُ تعليقٍ ننشره تحت منشورنا. وليس في الحالين عنصراً ينتظر ردّاً. */
      if (c.parentId) replies.push({ key: `${prefix}${c.parentId}`, reply: { text: c.body, at: c.createdAt, id: c.commentId || null } });
      const row = existing.get(key);
      if (row && row.reply_body === null) stale.push(row.id);
      continue;
    }
    // نتجاهل ما لا نص له — بنفس شرط التنظيف، وإلّا حُذف وأُعيدت إضافته كل دورة.
    if (!c.body.trim()) continue;

    items.push({
      id: key,
      platform: String(c.raw?.platform || p.platform),
      kind: 'comment',
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt,
      capabilities: c.capabilities,
      isHidden: c.isHidden,
      interactionId: c.interactionId || null,
    });

    const row = existing.get(key);
    if (row && row.reply_body !== null) continue;
    if (c.replies) {
      const own = ownReply(c.replies, ownerKeys);
      if (own) replies.push({ key, reply: own });
    } else if (c.replyCount === null || c.replyCount > 0) {
      replyQueue.push({
        rowKey: key,
        postId: p.postId,
        accountId: p.accountId,
        commentId: c.commentId,
        interactionId: c.interactionId,
        createdAt: c.createdAt,
        known: c.replyCount !== null,
        checkedAt: row?.reply_checked_at ?? null,
      });
    }
  }

  const written = await writeItems(env, items, existing);
  report.added += written.added;

  // الردود بعد الإدراج: تعليقٌ جديدٌ ردُّه معه في الدفعة نفسها
  if (replies.length) {
    const after = await rowsByPrefix(env, prefix);
    const stmts: D1PreparedStatement[] = [];
    for (const { key, reply } of replies) {
      const row = after.get(key);
      if (row && row.reply_body === null) {
        stmts.push(externalReplyStmt(env, row.id, reply));
        report.externalReplies++;
      }
    }
    await runBatch(env, stmts);
  }

  if (stale.length) {
    await runBatch(env, stale.map((id) => env.DB.prepare('DELETE FROM platform_comments WHERE id = ? AND reply_body IS NULL').bind(id)));
  }

  return { seen: res.comments.length, complete: res.complete, exhausted: res.exhausted, resume: res.resume };
}

/**
 * يبحث في ردود التعليقات عن ردٍّ كتبه حسابُنا من تطبيق المنصّة.
 *
 * ما أعلن المزوّد أن عليه ردوداً يسبق، ثم ما لم يُفحص قطّ، ثم أقدمُها فحصاً.
 * وما لا يُعلَن عددُ ردوده يُفحص في أسبوعيه الأوّلين وحدهما — فحصُ كل تعليقٍ
 * قديم في كل دورة يأكل الحصّة ولا يجد شيئاً.
 */
async function checkReplies(
  env: Env,
  token: string,
  budget: CallBudget,
  report: InboxSyncReport,
  owners: Owners,
  queue: ReplyCheck[],
  reserve: number,
  opts: { anyAge?: boolean } = {},
): Promise<void> {
  const cutoff = Date.now() - 14 * DAY;
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  /* ما أعلن المزوّد أن عليه ردوداً، وتعليقات الأسبوعين، تُفحص في كل دورة.
     والأقدم يُفحص أوّل ما يُقرأ، ثم كل أسبوع — لا في كل دورة. وسحب السجلّ
     يفحص ما يقرؤه كلَّه: هو القراءة الأولى لمنشوراتٍ قديمة. */
  const eligible = queue
    .filter((q) => opts.anyAge || q.known || Date.parse(q.createdAt) >= cutoff || q.checkedAt === null || q.checkedAt < weekAgo)
    .sort((a, b) =>
      Number(b.known) - Number(a.known) ||
      Number(Date.parse(b.createdAt) >= cutoff) - Number(Date.parse(a.createdAt) >= cutoff) ||
      Number(a.checkedAt !== null) - Number(b.checkedAt !== null) ||
      (a.checkedAt ?? '').localeCompare(b.checkedAt ?? '') ||
      b.createdAt.localeCompare(a.createdAt),
    );
  if (!eligible.length) return;

  let path: RepliesPath | null = report.repliesPath === 'inbox' || report.repliesPath === 'interactions' ? report.repliesPath : null;
  let answered = false;
  const checked: string[] = [];
  const found: { key: string; reply: ExternalReply }[] = [];

  for (const q of eligible) {
    if (budget.left <= reserve) {
      report.complete = false;
      break;
    }
    let res;
    try {
      res = await listCommentReplies(
        token,
        { postId: q.postId, accountId: q.accountId, commentId: q.commentId, interactionId: q.interactionId },
        { budget, prefer: path },
      );
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        report.complete = false;
        break;
      }
      /* تعليقٌ تتعذّر ردودُه لا يُسقط ما فُحص قبله ولا ما بعده — وكان يُسقطهما
         ويبقى أوّلَ الدور في كل دورة. فيُختم وقتُ فحصه كغيره ويُمضى. */
      report.kinds.comment.error ??= errorText(err);
      checked.push(q.rowKey);
      continue;
    }
    checked.push(q.rowKey);
    if (res.path) {
      path = res.path;
      answered = true;
    }
    const own = ownReply(res.replies, owners.forAccount(q.accountId));
    if (own) found.push({ key: q.rowKey, reply: own });
  }
  if (checked.length) report.repliesPath = answered ? path : report.repliesPath ?? 'none';

  const rows = await rowsByIds(env, [...checked, ...found.map((f) => f.key)]);
  const stamp = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const key of checked) {
    const row = rows.get(key);
    if (row) stmts.push(env.DB.prepare('UPDATE platform_comments SET reply_checked_at = ? WHERE id = ?').bind(stamp, row.id));
  }
  for (const { key, reply } of found) {
    const row = rows.get(key);
    if (row && row.reply_body === null) {
      stmts.push(externalReplyStmt(env, row.id, reply));
      report.externalReplies++;
    }
  }
  await runBatch(env, stmts);
}

/**
 * يدور سحبُ السجلّ على التعليقات القديمة بلا رد — ما مضى عليه أكثر من
 * أسبوعين، وأحدثُه تفحصه الدورة المعتادة — فيفحص ردودها: ما لم يُفحص قطّ
 * أوّلاً، ثم أقدمُها فحصاً، وكلٌّ مرّةً في الأسبوع على الأكثر. هكذا يُعرف ردٌّ
 * كتبه الفريق من تطبيق المنصّة قبل شهورٍ على تعليقٍ لم يُفتح منشورُه منذئذ.
 */
async function sweepOldReplies(
  env: Env,
  token: string,
  budget: CallBudget,
  report: InboxSyncReport,
  owners: Owners,
  reserve: number,
): Promise<void> {
  const room = budget.left - reserve;
  if (room <= 0) return;
  const { results } = await env.DB.prepare(
    `SELECT provider_comment_id, provider_interaction_id, created_at, reply_checked_at
     FROM platform_comments
     WHERE kind = 'comment' AND reply_body IS NULL AND created_at < ?
       AND (reply_checked_at IS NULL OR reply_checked_at < ?)
       AND instr(provider_comment_id, '|') > 0
     ORDER BY reply_checked_at IS NOT NULL, reply_checked_at, created_at DESC
     LIMIT ?`,
  )
    .bind(new Date(Date.now() - 14 * DAY).toISOString(), new Date(Date.now() - 7 * DAY).toISOString(), Math.min(room, 60))
    .all<{ provider_comment_id: string; provider_interaction_id: string | null; created_at: string; reply_checked_at: string | null }>();

  const queue: ReplyCheck[] = [];
  for (const r of results) {
    // الترميز `منشور|حساب|تعليق`
    const [postId, accountId, ...rest] = r.provider_comment_id.split('|');
    const commentId = rest.join('|');
    if (!postId || !commentId) continue;
    queue.push({
      rowKey: r.provider_comment_id,
      postId,
      accountId: accountId ?? '',
      commentId,
      interactionId: r.provider_interaction_id ?? '',
      createdAt: r.created_at,
      known: false,
      checkedAt: r.reply_checked_at,
    });
  }
  await checkReplies(env, token, budget, report, owners, queue, reserve, { anyAge: true });
}

/* ─── المراجعات ─── */

async function syncReviews(env: Env, token: string, budget: CallBudget, report: InboxSyncReport, pages: number): Promise<InboxItem[]> {
  if (budget.left <= 0) {
    report.complete = false;
    return [];
  }
  let r;
  try {
    r = await listReviews(token, { budget, maxPages: pages });
  } catch (err) {
    if (isNotFound(err)) return []; // لا حساب مراجعاتٍ مربوط
    throw err;
  }
  report.kinds.review.ok = true;
  report.kinds.review.items = r.items.length;
  if (r.exhausted) report.complete = false;

  /* مراجعةٌ بلا حسابٍ في الردّ الحالي تُرمَّز «rv::{مراجعة}»، وقد كُتبت قبلُ
     بحسابها «rv:{حساب}:{مراجعة}» من ملخّص الحساب. فتُطابَق بالمراجعة وحدها
     كي لا تظهر مرّتين. */
  const orphan = r.items.filter((it) => it.id.startsWith('rv::'));
  if (orphan.length) {
    const { results } = await env.DB.prepare(
      "SELECT provider_comment_id FROM platform_comments WHERE kind = 'review' AND provider_comment_id LIKE 'rv:%'",
    ).all<{ provider_comment_id: string }>();
    const bySuffix = new Map(results.map((x) => [x.provider_comment_id.slice(x.provider_comment_id.indexOf(':', 3) + 1), x.provider_comment_id]));
    for (const it of orphan) {
      const known = bySuffix.get(it.id.slice(4));
      if (known) it.id = known;
    }
  }

  const res = await writeItems(env, r.items);
  report.added += res.added;
  report.externalReplies += res.externalReplies;
  return res.fresh;
}

/* ─── الرسائل الخاصة ─── */

async function syncConversations(
  env: Env,
  token: string,
  budget: CallBudget,
  report: InboxSyncReport,
  accounts: SocialApiOwnedAccount[],
  pages: number,
): Promise<void> {
  if (!accounts.some((a) => supportsDirectInbox(a.platform))) return;
  if (budget.left <= 0) {
    report.complete = false;
    return;
  }
  const r = await listConversations(token, accounts, { budget, pages });
  if (r.exhausted) report.complete = false;
  report.kinds.dm.ok = true;
  report.kinds.dm.items = r.conversations.length;

  const keyOf = (cv: { id: string; accountId: string }) => `dm:${cv.id}:${cv.accountId}`;
  const existing = await rowsByIds(env, r.conversations.map(keyOf));
  const items: InboxItem[] = [];
  const replies: { key: string; reply: ExternalReply }[] = [];
  const reopen: { key: string; text: string; at: string }[] = [];

  for (const cv of r.conversations) {
    const key = keyOf(cv);
    const row = existing.get(key);
    // الاتجاه لا يُعتدّ به بلا وقت: لا يُعرف أهو قبل آخر ردٍّ أم بعده
    let lastIn = cv.lastDirection === 'in' && cv.lastAt ? { text: cv.lastText, at: cv.lastAt } : null;
    let lastOut: ExternalReply | null = cv.lastDirection === 'out' && cv.lastAt ? { text: cv.lastText, at: cv.lastAt, id: null } : null;

    /* الاتجاه مجهول، أو آخرُ رسالةٍ منّا في محادثةٍ لم تُحفظ بعد — فنصُّ
       العميل غير معروف. تُقرأ رسائلها مرّةً إن تغيّرت منذ آخر دورة. */
    const changed = !row || row.body !== cv.lastText;
    if ((!lastIn && !lastOut || (lastOut && !row)) && changed) {
      if (budget.left > 0) {
        try {
          const latest = await conversationLatest(token, cv.id, budget);
          lastIn = latest.lastIn ?? lastIn;
          lastOut = latest.lastOut ?? lastOut;
        } catch (err) {
          if (err instanceof BudgetExhausted) report.complete = false;
          else if (!isUnsupported(err)) throw err;
        }
      } else {
        report.complete = false;
      }
    }

    if (lastIn) {
      items.push({ id: key, platform: cv.platform, kind: 'dm', authorName: cv.participant, body: lastIn.text, createdAt: lastIn.at });
      const weAnsweredLast = lastOut && lastOut.at && lastOut.at >= lastIn.at;
      if (weAnsweredLast) {
        if (!row || row.reply_body === null) replies.push({ key, reply: lastOut as ExternalReply });
      } else if (row && row.reply_body !== null && (!row.replied_at || row.replied_at < lastIn.at)) {
        // العميل كتب بعد آخر ردّ: المحادثة تنتظر ردّاً من جديد
        reopen.push({ key, text: lastIn.text, at: lastIn.at });
      }
    } else if (lastOut) {
      // ردٌّ منّا على محادثةٍ محفوظة — لا نصَّ عميلٍ جديد
      if (row && row.reply_body === null) replies.push({ key, reply: lastOut });
    } else {
      // لا اتجاه معروف: السلوك القديم — آخرُ رسالةٍ نصّاً، بلا حكمٍ على الردّ
      items.push({ id: key, platform: cv.platform, kind: 'dm', authorName: cv.participant, body: cv.lastText, createdAt: cv.lastAt ?? nowIso() });
    }
  }

  const written = await writeItems(env, items, existing);
  report.added += written.added;

  if (replies.length || reopen.length) {
    const after = await rowsByIds(env, [...replies.map((x) => x.key), ...reopen.map((x) => x.key)]);
    const stmts: D1PreparedStatement[] = [];
    for (const { key, reply } of replies) {
      const row = after.get(key);
      if (row && row.reply_body === null) {
        stmts.push(externalReplyStmt(env, row.id, reply));
        report.externalReplies++;
      }
    }
    for (const { key, text, at } of reopen) {
      const row = after.get(key);
      if (!row) continue;
      stmts.push(
        env.DB.prepare(
          `UPDATE platform_comments
           SET body = ?, created_at = ?, reply_body = NULL, replied_at = NULL, replied_by = NULL,
               reply_provider_id = NULL, reply_source = NULL, ignored_at = NULL, ignored_by = NULL
           WHERE id = ?`,
        ).bind(text, at, row.id),
      );
    }
    await runBatch(env, stmts);
  }
}

/* ─── الإشارات ─── */

async function syncMentions(
  env: Env,
  token: string,
  budget: CallBudget,
  report: InboxSyncReport,
  accounts: SocialApiOwnedAccount[],
  pages: number,
): Promise<void> {
  const targets = accounts.filter((a) => supportsDirectInbox(a.platform));
  if (!targets.length) return;
  let path: MentionsPath | null = report.mentionsPath === 'accounts' || report.mentionsPath === 'inbox' ? report.mentionsPath : null;
  let supported = false;
  const items: InboxItem[] = [];
  for (const acc of targets) {
    if (budget.left <= 0) {
      report.complete = false;
      break;
    }
    try {
      const r = await listMentions(token, acc, { budget, prefer: path, pages });
      if (r.path) {
        path = r.path;
        supported = true;
      }
      items.push(...r.items);
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        report.complete = false;
        break;
      }
      throw err;
    }
  }
  report.mentionsPath = supported ? path : report.mentionsPath ?? 'none';
  if (supported) {
    report.kinds.mention.ok = true;
    report.kinds.mention.items = items.length;
  }
  const res = await writeItems(env, items.filter((it) => it.body.trim()));
  report.added += res.added;
}

/* ============================================================
   Ayrshare — التعليقات بمنشوراتها، والرسائل والمراجعات بمنصاتها

   لا صندوق موحّداً في Ayrshare يسرد «المنشورات التي عليها تعليقات» كما في
   SocialAPI: التعليقات تُطلب لكل منشورٍ بمعرّفه على منصته. فالمنشورات من
   لقطات التحليلات (وفيها ما نُشر من خارج المنصة)، ويُختار منها ما تغيّر:
   - لم يُقرأ قطّ — أوّلاً.
   - تغيّر عدد تعليقاته في أرقامه منذ آخر قراءة — البصمة عدد التعليقات.
   - عليه تعليقاتٌ بلا ردّ — تُفحص ردودها كل ستّ ساعات، فما ردّ عليه حسابُنا
     من تطبيق المنصة ينتقل إلى «تم الرد».
   والمعتاد منشورات الثلاثين يوماً؛ والسجلّ ما قبلها مرّةً لكلٍّ.
   ============================================================ */

const AYRSHARE_RECENT_DAYS = 30;
/* ساعةٌ لا ستّ: الردّ من تطبيق المنصة لا يُعرف إلا بإعادة قراءة تعليقات
   منشوره، وستُّ ساعاتٍ كانت تُبقي ما رُدّ عليه من إكس «بلا رد» نصفَ يوم. */
const AYRSHARE_RECHECK_MS = 3_600_000;

/* ═══ ما سُحب أيام SocialAPI ═══

   الصفوف القديمة بمعرّفات SocialAPI — التعليق `منشور|حساب|تعليق`، والمراجعة
   `rv:حساب:مراجعة` — فلا يجدها Ayrshare بمعرّفه: يبقى القديم «بلا رد» ولو رُدّ
   عليه من المنصة، ويُكتب التعليق نفسه صفّاً ثانياً. ومعرّف التعليق والمراجعة
   على المنصة واحدٌ في الاثنين، فبه يُطابَقان:
   - لا صفَّ جديداً بعد: يُنقل القديم إلى معرّف Ayrshare بردّه كما هو.
   - كُتب الجديد: يُنقل إليه ردُّ القديم إن لم يكن له ردّ، ويُحذف القديم —
     قرار المالك. والرسائل لا تُطابَق: معرّف المحادثة عند SocialAPI غيرُه
     عند المنصة. */

type LegacyRow = {
  id: string; platform: string; kind: string; provider_comment_id: string;
  reply_body: string | null; replied_at: string | null; replied_by: string | null;
  reply_source: string | null; reply_provider_id: string | null;
};

/** الصفوف القديمة بمفتاح «منصة|نوع|معرّف المنصة» — تُقرأ مرّةً في الدورة. */
async function legacyIndex(env: Env): Promise<Map<string, LegacyRow>> {
  const { results } = await env.DB.prepare(
    `SELECT id, platform, kind, provider_comment_id, reply_body, replied_at, replied_by, reply_source, reply_provider_id
     FROM platform_comments
     WHERE kind IN ('comment', 'review') AND substr(provider_comment_id, 1, 4) NOT IN ('ayc|', 'ayd|', 'ayr|')`,
  ).all<LegacyRow>();
  const out = new Map<string, LegacyRow>();
  for (const r of results) {
    let native = '';
    if (r.kind === 'review' && r.provider_comment_id.startsWith('rv:')) {
      native = r.provider_comment_id.slice(r.provider_comment_id.indexOf(':', 3) + 1);
    } else if (r.kind === 'comment') {
      const parts = r.provider_comment_id.split('|');
      if (parts.length === 3) native = parts[2];
    }
    if (native) out.set(`${normalizePlatformKey(r.platform)}|${r.kind}|${native}`, r);
  }
  return out;
}

/** يضمّ القديم إلى عناصر Ayrshare قبل كتابتها — انظر أعلاه. */
async function adoptLegacy(env: Env, legacy: Map<string, LegacyRow>, items: InboxItem[]): Promise<void> {
  if (!legacy.size || !items.length) return;
  const matches: { item: InboxItem; old: LegacyRow; key: string }[] = [];
  for (const it of items) {
    const d = decodeAyrshareId(it.id);
    const native = d?.type === 'comment' ? d.commentId : d?.type === 'review' ? d.reviewId : '';
    const key = `${normalizePlatformKey(it.platform)}|${it.kind}|${native}`;
    const old = native ? legacy.get(key) : undefined;
    if (old) matches.push({ item: it, old, key });
  }
  if (!matches.length) return;
  const current = await rowsByIds(env, matches.map((m) => m.item.id));
  const stmts: D1PreparedStatement[] = [];
  for (const { item, old, key } of matches) {
    const fresh = current.get(item.id);
    if (!fresh) {
      // والمنصة باسمها عندنا: SocialAPI كتب إكس `twitter`
      stmts.push(env.DB.prepare('UPDATE platform_comments SET provider_comment_id = ?, platform = ? WHERE id = ?').bind(item.id, item.platform, old.id));
    } else {
      if (fresh.reply_body === null && old.reply_body !== null) {
        stmts.push(env.DB.prepare(
          `UPDATE platform_comments
           SET reply_body = ?, replied_at = ?, replied_by = ?, reply_source = ?, reply_provider_id = COALESCE(reply_provider_id, ?)
           WHERE id = ? AND reply_body IS NULL`,
        ).bind(old.reply_body, old.replied_at, old.replied_by, old.reply_source, old.reply_provider_id, fresh.id));
      }
      stmts.push(env.DB.prepare('DELETE FROM platform_comments WHERE id = ?').bind(old.id));
    }
    legacy.delete(key);
  }
  await runBatch(env, stmts);
}

async function syncAyrshareInbox(env: Env, report: InboxSyncReport, deadline: number): Promise<void> {
  const auth = ayrshareAuth(env);
  if (!auth) {
    report.errors.push('مفتاح Ayrshare غير مضبوط. اضبط AYRSHARE_API_KEY.');
    return;
  }
  const budget = new CallBudget(report.budget, deadline);

  await env.DB.prepare(
    "DELETE FROM platform_comments WHERE (body IS NULL OR TRIM(body) = '') AND reply_body IS NULL AND replied_at IS NULL",
  ).run();

  const fail = (kind: InboxKind | null, err: unknown) => {
    if (err instanceof BudgetExhausted) {
      report.complete = false;
      return;
    }
    const message = errorText(err);
    if (kind) {
      report.kinds[kind].ok = false;
      report.kinds[kind].error = message;
    }
    report.errors.push(message);
  };

  let accounts: AyrshareAccount[] = [];
  let messagingEnabled = false;
  try {
    ({ accounts, messagingEnabled } = await ayrshareUser(auth, budget));
  } catch (err) {
    fail(null, err);
    report.calls = budget.used;
    return;
  }
  if (!(auth.x?.key && auth.x.secret) && accounts.some((a) => a.platform === 'x')) {
    report.errors.push('إكس عبر Ayrshare يشترط مفتاحَي تطبيق المطوّر. اضبط AYRSHARE_X_API_KEY وAYRSHARE_X_API_SECRET.');
    accounts = accounts.filter((a) => a.platform !== 'x');
  }

  const history = report.mode === 'history';
  const deepAt = history ? await getSetting(env, HISTORY_DEEP_KEY) : null;
  const deep = history && (!deepAt || Date.now() - Date.parse(deepAt) > DAY);
  const others = !history || deep;

  // الرسائل تشترط تفعيلها في الحساب وعلى كل منصة (`messagingActive`)
  const dmAccounts = messagingEnabled
    ? accounts.filter((a) => a.messaging && AYRSHARE_DM_PLATFORMS.has(ayrsharePlatform(a.platform)))
    : [];
  const reviewAccounts = accounts.filter((a) => a.platform === 'google' || a.platform === 'facebook');
  const legacy = await legacyIndex(env);
  const reserve = others ? (dmAccounts.length + reviewAccounts.length) * (deep ? 3 : 1) : 0;

  try {
    await syncAyrshareComments(env, auth, budget, report, accounts, reserve, history, legacy);
  } catch (err) {
    fail('comment', err);
  }

  const fresh: InboxItem[] = [];
  if (others) {
    try {
      for (const acc of reviewAccounts) {
        if (budget.left <= 0) {
          report.complete = false;
          break;
        }
        const items = (await ayrshareReviews(auth, ayrsharePlatform(acc.platform), budget)).map((it) => ({ ...it, platform: acc.platform }));
        report.kinds.review.ok = true;
        report.kinds.review.items += items.length;
        await adoptLegacy(env, legacy, items);
        const res = await writeItems(env, items);
        report.added += res.added;
        report.externalReplies += res.externalReplies;
        fresh.push(...res.fresh);
      }
    } catch (err) {
      fail('review', err);
    }

    try {
      for (const acc of dmAccounts) {
        if (budget.left <= 0) {
          report.complete = false;
          break;
        }
        const messages = await ayrshareMessages(auth, ayrsharePlatform(acc.platform), { pages: deep ? 5 : 1, budget });
        report.kinds.dm.ok = true;
        report.kinds.dm.items += await writeAyrshareConversations(env, report, acc.platform, ayrsharePlatform(acc.platform), messages);
      }
    } catch (err) {
      fail('dm', err);
    }
    if (deep && budget.left > 0) await setSetting(env, HISTORY_DEEP_KEY, nowIso());
  }

  report.calls = budget.used;
  report.stoppedBy = budget.stoppedBy;
  if (budget.stoppedBy) report.complete = false;
  const since = Date.now() - 7 * DAY;
  const negative = history ? [] : fresh.filter((it) => it.rating != null && it.rating <= 2 && Date.parse(it.createdAt) >= since);
  if (negative.length) await notifyNegative(env, negative);
}

async function syncAyrshareComments(
  env: Env,
  auth: AyrshareAuth,
  budget: CallBudget,
  report: InboxSyncReport,
  accounts: AyrshareAccount[],
  reserve: number,
  history: boolean,
  legacy: Map<string, LegacyRow>,
): Promise<void> {
  const byInternal = new Map(accounts.filter((a) => AYRSHARE_COMMENT_PLATFORMS.has(ayrsharePlatform(a.platform))).map((a) => [a.platform, a]));
  if (!byInternal.size) return;
  report.kinds.comment.ok = true;

  const platforms = [...byInternal.keys()];
  const cutoff = new Date(Date.now() - AYRSHARE_RECENT_DAYS * DAY).toISOString();
  const { results: posts } = await env.DB.prepare(
    `SELECT provider_post_id, platform, metrics_json FROM analytics_snapshots
     WHERE platform IN (${platforms.map(() => '?').join(',')})
       AND COALESCE(source, '') <> 'newsletter' AND sent_at IS NOT NULL AND sent_at ${history ? '<' : '>='} ?
     ORDER BY sent_at DESC
     LIMIT 400`,
  )
    .bind(...platforms, cutoff)
    .all<{ provider_post_id: string; platform: string; metrics_json: string | null }>();

  const { results: states } = await env.DB.prepare(
    "SELECT inbox_post_id, account_id, signature, synced_at FROM inbox_post_state WHERE account_id LIKE 'ayrshare:%'",
  ).all<{ inbox_post_id: string; account_id: string; signature: string; synced_at: string | null }>();
  const stateOf = new Map(states.map((st) => [`${st.account_id}|${st.inbox_post_id}`, st]));

  // منشوراتٌ عليها تعليقاتٌ بلا ردّ — من معرّفاتها المحفوظة `ayc|منصة|منشور|…`
  const { results: open } = await env.DB.prepare(
    "SELECT provider_comment_id FROM platform_comments WHERE kind = 'comment' AND reply_body IS NULL AND substr(provider_comment_id, 1, 4) = 'ayc|'",
  ).all<{ provider_comment_id: string }>();
  const unreplied = new Set(open.map((r) => r.provider_comment_id.split('|').slice(1, 3).join('|')));

  const commentsOf = (json: string | null): string => {
    try {
      const raw = JSON.parse(json || '[]');
      const c = Array.isArray(raw) ? raw.find((m: any) => m?.type === 'comments') : null;
      return c ? String(c.value) : '';
    } catch {
      return '';
    }
  };

  const now = Date.now();
  const queue: { postId: string; internal: string; ayr: string; signature: string; rank: number }[] = [];
  for (const p of posts) {
    const ayr = ayrsharePlatform(p.platform);
    const st = stateOf.get(`ayrshare:${ayr}|${p.provider_post_id}`);
    const signature = commentsOf(p.metrics_json);
    const age = st?.synced_at ? now - Date.parse(st.synced_at) : Infinity;
    let rank: number | null = null;
    if (!st?.synced_at) rank = 0;
    else if (!history && signature && signature !== st.signature) rank = 1;
    else if (unreplied.has(`${ayr}|${p.provider_post_id}`) && age > (history ? 7 * DAY : AYRSHARE_RECHECK_MS)) rank = 2;
    else if (report.mode === 'full' && age > 30 * 60_000) rank = 3;
    if (rank !== null) queue.push({ postId: p.provider_post_id, internal: p.platform, ayr, signature, rank });
  }
  queue.sort((a, b) => a.rank - b.rank);

  let cut = false;
  /* أوّلُ رفضٍ لكل منصة، ومنصّاتٌ قُرئ منها منشورٌ واحد على الأقل. فرفضُ
     منشورٍ بعينه — إنستغرام يرفض بعض منشوراته — لا يجعل الوارد كلَّه «تعذّر
     السحب» ما دامت بقيّتها تُقرأ. ويُقال حين ترفض المنصة كل ما طُلب منها. */
  const refused = new Map<string, string>();
  const reached = new Set<string>();
  for (const q of queue) {
    if (budget.left <= reserve) {
      cut = true;
      break;
    }
    let data: any;
    try {
      data = await ayrshareComments(auth, q.ayr, q.postId, budget);
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        cut = true;
        break;
      }
      // منشورٌ حُذف أو لا تُقرأ تعليقاته — يُختم كي لا يأكل حصّة كل دورة
      if (!(err instanceof AyrshareError && err.status >= 400 && err.status < 500 && err.status !== 429)) throw err;
      /* وكان الرفض كلُّه يُبتلع: إكس رفض طلب التعليقات لكل منشور فلم يظهر تعليقٌ
         واحد منه، ولا سطرٌ يقول لماذا. فيُحفظ الرفض لكل منصة بسببه، إلا
         «لا يوجد» (404 و186): منشورٌ حُذف لا عطلَ فيه. */
      const notFound = err.status === 404 || errorCodes(err.body).includes(186);
      if (!notFound && !refused.has(q.internal)) refused.set(q.internal, err.message);
      data = null;
    }
    if (data) {
      reached.add(q.internal);
      const keys = byInternal.get(q.internal)?.ownerKeys ?? [];
      const items = mapAyrshareComments(q.ayr, q.postId, data, keys).map((it) => ({ ...it, platform: q.internal }));
      report.kinds.comment.items += items.length;
      await adoptLegacy(env, legacy, items);
      if (q.ayr === 'linkedin') await linkedInReplies(env, auth, budget, reserve, items, keys);
      const res = await writeItems(env, items);
      report.added += res.added;
      report.externalReplies += res.externalReplies;
    }
    await env.DB.prepare(
      `INSERT INTO inbox_post_state (inbox_post_id, account_id, platform, signature, seen_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(inbox_post_id, account_id) DO UPDATE SET signature = excluded.signature, synced_at = excluded.synced_at`,
    ).bind(q.postId, `ayrshare:${q.ayr}`, q.internal, q.signature, nowIso(), nowIso()).run();
  }
  for (const [p, message] of refused) {
    if (!reached.has(p)) report.errors.push(`تعليقات ${platformName(p)}: ${message}`);
  }
  if (cut) report.complete = false;
  // السجلّ اكتمل حين لا يبقى منشورٌ قديم لم يُقرأ
  if (history && !cut && posts.length < 400) await setSetting(env, HISTORY_DONE_KEY, nowIso());
}

/**
 * ردودنا على تعليقات لينكدإن — تُطلب لكل تعليقٍ بلا ردٍّ عندنا (لينكدإن لا
 * يُعشّشها في التعليق)، وتُكتب في العنصر قبل كتابته فينتقل إلى «تم الرد».
 */
async function linkedInReplies(
  env: Env,
  auth: AyrshareAuth,
  budget: CallBudget,
  reserve: number,
  items: InboxItem[],
  ownerKeys: string[],
): Promise<void> {
  const pending = items.filter((it) => !it.repliedBody);
  if (!pending.length) return;
  const rows = await rowsByIds(env, pending.map((it) => it.id));
  for (const it of pending) {
    if (rows.get(it.id)?.reply_body) continue; // رُدّ عليه عندنا
    if (budget.left <= reserve) break;
    const d = decodeAyrshareId(it.id);
    if (d?.type !== 'comment') continue;
    try {
      const reply = await ayrshareLinkedInReply(auth, d.urn || d.commentId, ownerKeys, budget);
      if (reply) {
        it.repliedBody = reply.text;
        it.repliedAt = reply.at;
      }
    } catch (err) {
      if (err instanceof BudgetExhausted) break;
      // تعليقٌ لا تُقرأ ردوده (حُذف) — يبقى كما هو ويُعاد في الدورة التالية
      if (!(err instanceof AyrshareError)) throw err;
    }
  }
}

/**
 * محادثات منصةٍ من رسائلها — عنصرٌ لكل محادثة كما في SocialAPI: نصُّه آخرُ ما
 * كتبه العميل، وردُّنا آخرُ ما أرسلناه بعده. وعميلٌ كتب بعد آخر ردٍّ يُعيد
 * المحادثة إلى «بلا رد». يعود بعدد المحادثات.
 */
async function writeAyrshareConversations(
  env: Env,
  report: InboxSyncReport,
  internal: string,
  ayr: string,
  messages: AyrshareMessage[],
): Promise<number> {
  type Conv = { lastIn: AyrshareMessage | null; lastOut: AyrshareMessage | null };
  const convs = new Map<string, Conv>();
  // الأحدث أوّلاً — فأوّلُ ما يُرى من كل اتجاهٍ هو الأخير
  for (const m of messages) {
    const cv = convs.get(m.conversationId) ?? { lastIn: null, lastOut: null };
    if (m.direction === 'in' && !cv.lastIn) cv.lastIn = m;
    if (m.direction === 'out' && !cv.lastOut) cv.lastOut = m;
    convs.set(m.conversationId, cv);
  }

  const keyOf = (id: string, cv: Conv) => `ayd|${ayr}|${id}|${cv.lastIn?.senderId || cv.lastOut?.recipientId || ''}`;
  const existing = await rowsByIds(env, [...convs].map(([id, cv]) => keyOf(id, cv)));
  const items: InboxItem[] = [];
  const replies: { key: string; reply: ExternalReply }[] = [];
  const reopen: { key: string; text: string; at: string }[] = [];

  for (const [id, cv] of convs) {
    if (!cv.lastIn?.created) continue; // محادثةٌ بدأناها نحن — لا عميلَ ينتظر
    const key = keyOf(id, cv);
    const row = existing.get(key);
    const lastIn = { text: cv.lastIn.text, at: cv.lastIn.created };
    items.push({ id: key, platform: internal, kind: 'dm', authorName: cv.lastIn.senderName || 'مستخدم', body: lastIn.text, createdAt: lastIn.at });
    const out = cv.lastOut?.created && cv.lastOut.created >= lastIn.at ? cv.lastOut : null;
    if (out) {
      if (!row || row.reply_body === null) replies.push({ key, reply: { text: out.text, at: out.created, id: null } });
    } else if (row && row.reply_body !== null && (!row.replied_at || row.replied_at < lastIn.at)) {
      reopen.push({ key, text: lastIn.text, at: lastIn.at });
    }
  }

  const written = await writeItems(env, items, existing);
  report.added += written.added;

  if (replies.length || reopen.length) {
    const after = await rowsByIds(env, [...replies.map((x) => x.key), ...reopen.map((x) => x.key)]);
    const stmts: D1PreparedStatement[] = [];
    for (const { key, reply } of replies) {
      const row = after.get(key);
      if (row && row.reply_body === null) {
        stmts.push(externalReplyStmt(env, row.id, reply));
        report.externalReplies++;
      }
    }
    for (const { key, text, at } of reopen) {
      const row = after.get(key);
      if (!row) continue;
      stmts.push(
        env.DB.prepare(
          `UPDATE platform_comments
           SET body = ?, created_at = ?, reply_body = NULL, replied_at = NULL, replied_by = NULL,
               reply_provider_id = NULL, reply_source = NULL, ignored_at = NULL, ignored_by = NULL
           WHERE id = ?`,
        ).bind(text, at, row.id),
      );
    }
    await runBatch(env, stmts);
  }
  return items.length;
}

// يُشعِر مسؤولي التعليقات بالتفاعلات السلبية الجديدة فور رصدها
async function notifyNegative(
  env: Env,
  items: { platform: string; authorName: string; body: string; rating?: number | null }[],
): Promise<void> {
  try {
    const userIds = await usersWithPermission(env, 'comments.manage');
    if (!userIds.length) return;
    const custom = await customPlatformLabels(env);
    for (const it of items) {
      await notifyUsers(env, userIds, {
        type: 'negative_feedback',
        title: `تقييم سلبي (${it.rating} من 5) على ${platformName(it.platform, custom)}`,
        body: `${it.authorName}: ${String(it.body).slice(0, 160)}`,
        link: '/comments',
      });
    }
  } catch { /* التنبيه أفضل جهد — لا يُعطّل المزامنة */ }
}

// مزوّدون يعتمدون getComments لكل منشور نُشر عبر المنصة — ما سوى SocialAPI وAyrshare
async function syncPerPost(env: Env, report: InboxSyncReport): Promise<void> {
  const provider = await getProvider(env);
  if (!provider.getComments) return;
  report.kinds.comment.ok = true;

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.post_id, s.platform, s.provider_post_id, s.id AS schedule_id
     FROM schedules s WHERE s.status = 'published' AND s.provider_post_id IS NOT NULL`,
  ).all<{ post_id: string; platform: string; provider_post_id: string; schedule_id: string }>();

  for (const row of results) {
    let items: Awaited<ReturnType<NonNullable<typeof provider.getComments>>> = [];
    try {
      items = await provider.getComments(row.provider_post_id);
    } catch {
      continue;
    }
    report.kinds.comment.items += items.length;
    for (const it of items) {
      const res = await env.DB.prepare(
        `INSERT OR IGNORE INTO platform_comments
           (id, post_id, schedule_id, platform, provider_comment_id, kind, author_name, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(newId('cm'), row.post_id, row.schedule_id, row.platform, it.id, it.kind, it.authorName, it.body, it.createdAt)
        .run();
      if (res.meta.changes > 0) report.added++;
    }
  }
}

export async function replyToComment(env: Env, commentId: string, text: string, userId: string): Promise<void> {
  // LEFT JOIN كي يعمل الرد حتى لتعليقات الصندوق غير المرتبطة بجدول نشر (schedule_id = NULL)
  const comment = await env.DB.prepare(
    `SELECT pc.provider_comment_id, s.provider_post_id
     FROM platform_comments pc LEFT JOIN schedules s ON s.id = pc.schedule_id
     WHERE pc.id = ?`,
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; provider_post_id: string | null }>();
  if (!comment) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.replyComment) throw new Error('المزوّد الحالي لا يدعم الرد على التعليقات');
  const replyId = await provider.replyComment(comment.provider_post_id || '', comment.provider_comment_id, text);

  await env.DB.prepare(
    "UPDATE platform_comments SET reply_body = ?, reply_provider_id = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ?, reply_source = 'platform' WHERE id = ?",
  )
    .bind(text, replyId || null, userId, commentId)
    .run();
}

// تعديل ردّي على المنصة (يحدّثه فعلياً للتقييمات؛ ولغيرها يستبدله)
export async function editReply(env: Env, commentId: string, text: string, userId: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT provider_comment_id, reply_provider_id, reply_body FROM platform_comments WHERE id = ?',
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; reply_provider_id: string | null; reply_body: string | null }>();
  if (!row) throw new Error('التعليق غير موجود');
  if (!row.reply_body) throw new Error('لا يوجد ردّ لتعديله');

  const provider = await getProvider(env);
  if (!provider.editReply) throw new Error('المزوّد الحالي لا يدعم تعديل الرد');
  const newReplyId = await provider.editReply(row.provider_comment_id, row.reply_provider_id, text);

  await env.DB.prepare(
    "UPDATE platform_comments SET reply_body = ?, reply_provider_id = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ?, reply_source = 'platform' WHERE id = ?",
  )
    .bind(text, newReplyId || row.reply_provider_id || null, userId, commentId)
    .run();
}

// حذف ردّي من المنصة، وإرجاع العنصر إلى حالة «بلا رد» محلياً
export async function deleteReply(env: Env, commentId: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT provider_comment_id, reply_provider_id FROM platform_comments WHERE id = ?',
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; reply_provider_id: string | null }>();
  if (!row) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.deleteReply) throw new Error('المزوّد الحالي لا يدعم حذف الرد');
  await provider.deleteReply(row.provider_comment_id, row.reply_provider_id);

  await env.DB.prepare(
    'UPDATE platform_comments SET reply_body = NULL, reply_provider_id = NULL, replied_at = NULL, replied_by = NULL, reply_source = NULL WHERE id = ?',
  )
    .bind(commentId)
    .run();
}

// إشراف على تعليق: إخفاء/إظهار/حذف/إعجاب عبر المزوّد، وتحديث الحالة محلياً.
export async function moderateComment(env: Env, commentId: string, action: ModerateAction): Promise<void> {
  const row = await env.DB.prepare('SELECT provider_comment_id FROM platform_comments WHERE id = ?')
    .bind(commentId)
    .first<{ provider_comment_id: string }>();
  if (!row) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.moderateComment) throw new Error('المزوّد الحالي لا يدعم الإشراف على التعليقات');
  await provider.moderateComment(row.provider_comment_id, action);

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM platform_comments WHERE id = ?').bind(commentId).run();
  } else if (action === 'hide' || action === 'unhide') {
    await env.DB.prepare('UPDATE platform_comments SET is_hidden = ? WHERE id = ?')
      .bind(action === 'hide' ? 1 : 0, commentId)
      .run();
  }
}

// رد خاص لصاحب التعليق (Instagram/Facebook) — يُسجَّل كردّ محلياً.
export async function privateReplyToComment(env: Env, commentId: string, text: string, userId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT provider_comment_id FROM platform_comments WHERE id = ?')
    .bind(commentId)
    .first<{ provider_comment_id: string }>();
  if (!row) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.privateReply) throw new Error('المزوّد الحالي لا يدعم الرد الخاص');
  await provider.privateReply(row.provider_comment_id, text);

  await env.DB.prepare(
    "UPDATE platform_comments SET reply_body = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ?, reply_source = 'platform' WHERE id = ?",
  )
    .bind(`(رد خاص) ${text}`, userId, commentId)
    .run();
}

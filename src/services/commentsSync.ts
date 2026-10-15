import type { Env } from '../types';
import type { ModerateAction } from '../adapters/provider';
import { ayrshareAuth, getProvider } from '../adapters';
import {
  attachmentLabel, AYRSHARE_COMMENT_PLATFORMS, AYRSHARE_DM_PLATFORMS, AyrshareError, ayrshareComments, ayrshareLinkedInReplies,
  ayrshareMessages,
  ayrsharePlatform, ayrshareReviews, ayrshareUser, decodeAyrshareId, encodeAyrshareComment, errorCodes, mapAyrshareComments,
  postSpecificRejection,
  type AyrshareAccount, type AyrshareAuth, type AyrshareMessage,
} from '../adapters/ayrshare';
import { mergeDmThread, mergeThread, parseThread, sortThread, threadAnswer, threadDecision, type ThreadEntry } from './inboxThread';
import { BudgetExhausted, CallBudget } from '../adapters/budget';
import type { InboxItem } from '../adapters/inbox';
import { newId, nowIso } from '../util';
import { loadMedia } from './publish';
import { notifyUsers, usersWithPermission } from './notify';
import { customPlatformLabels, platformName } from '../platformLabels';
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
  /** الخطة المعلنة، وهل نزلت حصصها إلى المجانية احتياطاً — انظر `limits.ts`. */
  plan?: Plan;
  fallback?: boolean;
  /** وقفت الدورة قبل حصّتها: المزوّد طلب التمهّل، أو بلغ الاستدعاء حدّ طلباته. */
  stoppedBy?: 'rate_limit' | 'platform_cap' | null;
  /** منشوراتٌ ردّها المزوّد «غير موجود» لكل منصة — حُذفت، أو مفتاحها لا يعرفه.
   *  ليس عطلاً فلا يُكتب في `errors`، لكنه يُعدّ: كان يُبتلع فيغيب السبب. */
  notFound?: Record<string, number>;
  /** منشوراتٌ رفضها المزوّد لسببٍ يخصّها لكل منصة — والمنصة تُقرأ بقيّتُها، فلا
   *  يُكتب الرفض في `errors`. كان يُبتلع: يُختم المنشور مقروءاً ولا يُعرف أنه رُفض. */
  rejected?: Record<string, number>;
};

const REPORT_KEY = 'inbox_sync_report';
const LOCK_KEY = 'inbox_sync_lock';
const HISTORY_REPORT_KEY = 'inbox_history_report';
const HISTORY_LOCK_KEY = 'inbox_history_lock';
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

function newReport(mode: SyncMode, provider: string, budget: number, prev: InboxSyncReport | null): InboxSyncReport {
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
  };
}

function errorText(err: unknown): string {
  return String((err as Error)?.message || err).slice(0, 240);
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
    const report = newReport(mode, provider, opts.budget ?? limits.calls, prev);
    report.plan = limits.plan;
    report.fallback = limits.fallback;

    try {
      // Ayrshare وحده يُقرأ صندوقه؛ والتجريبي لا صندوق له
      if (provider === 'ayrshare') await syncAyrshareInbox(env, report, limits.deadline);
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
  created_at: string;
  reply_provider_id: string | null;
  ignored_at: string | null;
  thread_json: string | null;
};

const ROW_COLUMNS =
  'id, provider_comment_id, platform, kind, author_name, body, is_hidden, capabilities_json, rating, reply_body, replied_at, reply_source, reply_checked_at, created_at, reply_provider_id, ignored_at, thread_json';

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

/**
 * سلسلة تعليقٍ قائم: تُكتب كما قُرئت مع ما يُعرف هنا وحده (`mergeThread`)،
 * ويُكتب حاله منها (`threadDecision`): ردُّنا من التطبيق يجيبه، وما كتبه
 * العميل بعد ردّنا يعيده إلى «بلا رد» — ومن «متجاهَل» كذلك. يعود بعدد
 * الردود الجديدة من خارج المنصة.
 */
function threadUpdates(env: Env, row: Row, fetched: ThreadEntry[], updates: D1PreparedStatement[]): number {
  const hereIds = row.reply_source === 'platform' && row.reply_provider_id ? [row.reply_provider_id] : [];
  const thread = mergeThread(parseThread(row.thread_json), fetched, hereIds);
  const json = JSON.stringify(thread);
  if (json !== (row.thread_json ?? '')) {
    updates.push(env.DB.prepare('UPDATE platform_comments SET thread_json = ? WHERE id = ?').bind(json, row.id));
  }
  const d = threadDecision(thread, row);
  if (d.action === 'answer') {
    if (d.reply.here) {
      // ردٌّ كُتب من هنا وعاد بعد أن أُعيد التعليق «بلا رد» ثم حُذف ما بعده
      updates.push(env.DB.prepare(
        `UPDATE platform_comments SET reply_body = ?, replied_at = ?, reply_provider_id = COALESCE(reply_provider_id, ?), reply_source = 'platform'
         WHERE id = ? AND reply_body IS NULL`,
      ).bind(d.reply.body, d.reply.at, d.reply.id || null, row.id));
      return 0;
    }
    updates.push(externalReplyStmt(env, row.id, { text: d.reply.body, at: d.reply.at, id: d.reply.id || null }));
    return 1;
  }
  if (d.action === 'reopen') {
    updates.push(env.DB.prepare(
      `UPDATE platform_comments
       SET reply_body = NULL, replied_at = NULL, replied_by = NULL, reply_provider_id = NULL, reply_source = NULL,
           ignored_at = NULL, ignored_by = NULL
       WHERE id = ?`,
    ).bind(row.id));
  } else if (d.action === 'unignore') {
    updates.push(env.DB.prepare('UPDATE platform_comments SET ignored_at = NULL, ignored_by = NULL WHERE id = ?').bind(row.id));
  }
  return 0;
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
              capabilities_json, is_hidden, rating, reply_body, replied_at, reply_source, thread_json)
           VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(platform, provider_comment_id) DO NOTHING`,
        ).bind(
          newId('cm'), it.platform, it.id, it.kind, it.authorName, it.body, it.createdAt,
          caps, it.isHidden ? 1 : 0, it.rating ?? null,
          replied ? it.repliedBody : null, replied ? it.repliedAt ?? null : null, replied ? 'external' : null,
          it.thread ? JSON.stringify(sortThread(it.thread)) : null,
        ),
      });
      if (replied) result.externalReplies++;
      continue;
    }

    const changed =
      row.body !== it.body || row.author_name !== it.authorName || row.kind !== it.kind ||
      (row.is_hidden ? 1 : 0) !== (it.isHidden ? 1 : 0) || (row.capabilities_json ?? null) !== caps ||
      (row.rating ?? null) !== (it.rating ?? null);
    const reopened = it.kind === 'dm' && row.body !== it.body;
    if (changed) {
      updates.push(
        env.DB.prepare(
          /* رسالةٌ متجاهَلة كتب صاحبها من جديد تعود إلى «بلا رد»: التجاهل كان
             لما قاله، لا لما سيقوله. */
          `UPDATE platform_comments
           SET kind = ?, body = ?, author_name = ?, capabilities_json = ?, is_hidden = ?, rating = ?,
               ignored_at = CASE WHEN ? THEN NULL ELSE ignored_at END,
               ignored_by = CASE WHEN ? THEN NULL ELSE ignored_by END
           WHERE id = ?`,
        ).bind(
          it.kind, it.body, it.authorName, caps, it.isHidden ? 1 : 0, it.rating ?? null,
          reopened ? 1 : 0, reopened ? 1 : 0, row.id,
        ),
      );
    }
    if (it.thread) {
      result.externalReplies += threadUpdates(env, row, it.thread, updates);
      continue;
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

const DAY = 86_400_000;

/* ============================================================
   Ayrshare — التعليقات بمنشوراتها، والرسائل والمراجعات بمنصاتها

   لا صندوق موحّداً في Ayrshare يسرد «المنشورات التي عليها تعليقات»: التعليقات
   تُطلب لكل منشورٍ بمعرّفه على منصته. فالمنشورات من لقطات التحليلات (وفيها ما نُشر من خارج المنصة)، ويُختار منها ما تغيّر:
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
/* وكل منشورٍ في الثلاثين يوماً يُعاد كل ستّ ساعات ولو لم يتغيّر عدد تعليقاته:
   ردُّ العميل على ردّنا في إكس لا يُحسب في عدّ المنشور، فلا يُعرف إلا بإعادة
   القراءة. والأقدم كل ثلاثين يوماً — تعليقٌ جديد على منشورٍ قديم أُجيب عن كل
   ما فيه كان لا يُرى أبداً. */
const AYRSHARE_ROTATE_MS = 6 * 3_600_000;
const AYRSHARE_ROTATE_OLD_MS = 30 * 86_400_000;
/** منشوراتٌ وصل عليها تعليقٌ بالخطّاف — تُقرأ أوّلاً في الدورة التالية أيّاً كانت. */
const PENDING_POSTS_KEY = 'inbox_pending_posts';

/** منشورٌ عليه تعليقٌ جديد كما أعلنه الخطّاف — بمعرّفه على منصته. */
export type PendingPost = { platform: string; postId: string };

/**
 * يُضاف المنشور إلى ما يُقرأ أوّلاً. والقائمة في الإعدادات لا في ذاكرة الطلب:
 * قفلُ المزامنة قد يُسقط دورة الخطّاف، فتقرؤه الدورة التي بعدها.
 */
export async function queuePendingPost(env: Env, post: PendingPost): Promise<void> {
  const list = await readPendingPosts(env);
  if (list.some((p) => p.platform === post.platform && p.postId === post.postId)) return;
  await setSetting(env, PENDING_POSTS_KEY, JSON.stringify([...list, post].slice(-50)));
}

async function readPendingPosts(env: Env): Promise<PendingPost[]> {
  try {
    const v = JSON.parse((await getSetting(env, PENDING_POSTS_KEY)) || '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.platform === 'string' && typeof p.postId === 'string') : [];
  } catch {
    return [];
  }
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
  const reserve = others ? (dmAccounts.length + reviewAccounts.length) * (deep ? 3 : 1) : 0;

  try {
    await syncAyrshareComments(env, auth, budget, report, accounts, reserve, history);
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
): Promise<void> {
  const byInternal = new Map(accounts.filter((a) => AYRSHARE_COMMENT_PLATFORMS.has(ayrsharePlatform(a.platform))).map((a) => [a.platform, a]));
  if (!byInternal.size) return;
  report.kinds.comment.ok = true;

  /* لينكدإن المربوط صفحةٌ لا حساب: لقطةٌ كُتبت `linkedin` (من جدولةٍ بمفتاح
     الحساب أو من مزوّدٍ سابق) هي منشور الصفحة، فتُطلب تعليقاتها باسمها. */
  const asPage = byInternal.has('linkedin_page') && !byInternal.has('linkedin');
  const internalOf = (platform: string) => (asPage && platform === 'linkedin' ? 'linkedin_page' : platform);
  const platforms = [...byInternal.keys(), ...(asPage ? ['linkedin'] : [])];
  const cutoff = new Date(Date.now() - AYRSHARE_RECENT_DAYS * DAY).toISOString();
  /* السجلّ كان يقف عند أحدث أربعمئةٍ من المنشورات القديمة، فما بعدها لا يُقرأ
     أبداً ولا يُختم السجلّ مكتملاً. والقراءة تدور بموعد آخر قراءة لا بتاريخ
     النشر، فيكفي سقفٌ أوسع يحمل المنشورات كلّها. */
  const { results: posts } = await env.DB.prepare(
    /* بالمعرّف الأصلي على المنصة إن عُرف (0045) — ولقطتان لمنشورٍ واحد تُطلبان مرّةً. */
    `SELECT COALESCE(native_post_id, provider_post_id) AS provider_post_id, platform, MAX(metrics_json) AS metrics_json
     FROM analytics_snapshots
     WHERE platform IN (${platforms.map(() => '?').join(',')})
       AND COALESCE(source, '') <> 'newsletter' AND sent_at IS NOT NULL AND sent_at ${history ? '<' : '>='} ?
     GROUP BY COALESCE(native_post_id, provider_post_id), platform
     ORDER BY MAX(sent_at) DESC
     LIMIT ${history ? 3000 : 400}`,
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
  type Queued = { postId: string; internal: string; ayr: string; signature: string; rank: number; age: number };
  const queue: Queued[] = [];
  for (const row of posts) {
    const p = { ...row, platform: internalOf(row.platform) };
    const ayr = ayrsharePlatform(p.platform);
    const st = stateOf.get(`ayrshare:${ayr}|${p.provider_post_id}`);
    const signature = commentsOf(p.metrics_json);
    const age = st?.synced_at ? now - Date.parse(st.synced_at) : Infinity;
    let rank: number | null = null;
    if (!st?.synced_at) rank = 0;
    else if (signature && signature !== st.signature) rank = 1;
    else if (unreplied.has(`${ayr}|${p.provider_post_id}`) && age > (history ? 7 * DAY : AYRSHARE_RECHECK_MS)) rank = 2;
    else if (age > (history ? AYRSHARE_ROTATE_OLD_MS : AYRSHARE_ROTATE_MS)) rank = 3;
    else if (report.mode === 'full' && age > 30 * 60_000) rank = 3;
    if (rank === null) continue;
    queue.push({ postId: p.provider_post_id, internal: p.platform, ayr, signature, rank, age });
  }

  /* ما أعلنه الخطّاف أوّلاً — ولو لم يُعرف منشورُه بعد في لقطات التحليلات:
     منشورٌ نُشر للتوّ من تطبيق إنستغرام لا يصل لقطاتِه إلا بعد سحبها. */
  const pending = history ? [] : await readPendingPosts(env);
  for (const pp of pending) {
    const acc = accounts.find((a) => ayrsharePlatform(a.platform) === pp.platform && byInternal.has(a.platform));
    if (!acc) continue;
    const existing = queue.find((q) => q.ayr === pp.platform && q.postId === pp.postId);
    if (existing) existing.rank = -1;
    else queue.push({ postId: pp.postId, internal: acc.platform, ayr: pp.platform, signature: '', rank: -1, age: Infinity });
  }
  // في الرتبة الواحدة: الأقدمُ قراءةً أوّلاً — فتدور الحصّة على المنشورات كلّها
  queue.sort((a, b) => a.rank - b.rank || b.age - a.age);

  let cut = false;
  /* أوّلُ رفضٍ لكل منصة، ومنصّاتٌ قُرئ منها منشورٌ واحد على الأقل. فرفضُ
     منشورٍ بعينه — إنستغرام يرفض بعض منشوراته — لا يجعل الوارد كلَّه «تعذّر
     السحب» ما دامت بقيّتها تُقرأ. ويُقال حين ترفض المنصة كل ما طُلب منها. */
  const refused = new Map<string, string>();
  const reached = new Set<string>();
  /* منصّةٌ رفضت ما يخصّ الحساب كلَّه — تمهّلٌ، أو رصيد إكس، أو مفتاحاه — تُترك
     بقيّةُ منشوراتها في هذه الدورة، ولا يُختم منها شيءٌ مقروءاً: كان يُختم فلا
     يُعاد ما لم يتغيّر عدد تعليقاته، وما رُفض منه لم يُقرأ أصلاً. */
  const blocked = new Set<string>();
  const done: PendingPost[] = [];
  for (const q of queue) {
    if (blocked.has(q.internal)) continue;
    if (budget.left <= reserve) {
      cut = true;
      break;
    }
    let data: any;
    let outcome: 'ok' | 'not_found' | 'rejected' = 'ok';
    try {
      data = await ayrshareComments(auth, q.ayr, q.postId, budget);
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        cut = true;
        break;
      }
      if (!(err instanceof AyrshareError && err.status >= 400 && err.status < 500)) throw err;
      /* وكان الرفض كلُّه يُبتلع: إكس رفض طلب التعليقات لكل منشور فلم يظهر تعليقٌ
         واحد منه، ولا سطرٌ يقول لماذا. فيُحفظ الرفض لكل منصة بسببه، إلا
         «لا يوجد» (404 و186): منشورٌ حُذف لا عطلَ فيه. */
      const notFound = err.status === 404 || errorCodes(err.body).includes(186);
      if (notFound) {
        report.notFound ??= {};
        report.notFound[q.internal] = (report.notFound[q.internal] ?? 0) + 1;
      }
      if (!notFound && !refused.has(q.internal)) refused.set(q.internal, err.message);
      if (!postSpecificRejection(err)) {
        blocked.add(q.internal);
        continue;
      }
      outcome = notFound ? 'not_found' : 'rejected';
      if (!notFound) {
        report.rejected ??= {};
        report.rejected[q.internal] = (report.rejected[q.internal] ?? 0) + 1;
      }
      data = null;
    }
    if (data) {
      reached.add(q.internal);
      const keys = byInternal.get(q.internal)?.ownerKeys ?? [];
      const items = mapAyrshareComments(q.ayr, q.postId, data, keys).map((it) => ({ ...it, platform: q.internal }));
      report.kinds.comment.items += items.length;
      if (q.ayr === 'twitter') await dropAbsorbedReplies(env, q.postId, items);
      const checked = q.ayr === 'linkedin' ? await linkedInThreads(env, auth, budget, reserve, items, keys) : [];
      const res = await writeItems(env, items);
      report.added += res.added;
      report.externalReplies += res.externalReplies;
      if (checked.length) {
        await runBatch(env, checked.map((id) => env.DB.prepare(
          "UPDATE platform_comments SET reply_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE provider_comment_id = ?",
        ).bind(id)));
      }
    }
    /* والنتيجة تُحفظ مع الختم: منشورٌ رُفض يُختم كي لا يُطلب في كل دورة، لكن
       تقرير التغطية يعدّه مرفوضاً لا «قُرئ بلا تعليقات» (0049). */
    await env.DB.prepare(
      `INSERT INTO inbox_post_state (inbox_post_id, account_id, platform, signature, seen_at, synced_at, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(inbox_post_id, account_id) DO UPDATE SET signature = excluded.signature, synced_at = excluded.synced_at, outcome = excluded.outcome`,
    ).bind(q.postId, `ayrshare:${q.ayr}`, q.internal, q.signature, nowIso(), nowIso(), outcome).run();
    if (q.rank === -1) done.push({ platform: q.ayr, postId: q.postId });
  }
  for (const [p, message] of refused) {
    if (!reached.has(p) || blocked.has(p)) report.errors.push(`تعليقات ${platformName(p)}: ${message}`);
  }
  if (blocked.size) report.complete = false;
  if (pending.length) {
    // ما قُرئ يخرج من القائمة، وما لم يُعرف حسابُه أو لم يبلغه الدور يبقى
    const left = (await readPendingPosts(env)).filter((p) => !done.some((d) => d.platform === p.platform && d.postId === p.postId));
    await setSetting(env, PENDING_POSTS_KEY, JSON.stringify(left));
  }
  if (cut) report.complete = false;
  // السجلّ اكتمل حين لا يبقى منشورٌ قديم لم يُقرأ
  if (history && !cut && !blocked.size && posts.length < 3000) await setSetting(env, HISTORY_DONE_KEY, nowIso());
}

/**
 * إكس: ردُّ العميل على ردّنا كان عنصراً مستقلاً قبل أن تُبنى المحادثة شجرة —
 * وصار اليوم في سلسلة تعليقه. فيبقى صفُّه القديم مكرّراً: يظهر الردّ مرّتين،
 * وتحت «بلا رد» أبداً. فيُرفع ما صار من السلسلة، ولا يُمسّ غيره: معرّفُه معرّفُ
 * تغريدةٍ في محادثة هذا المنشور بعينه.
 */
async function dropAbsorbedReplies(env: Env, postId: string, items: InboxItem[]): Promise<void> {
  const ids = items.flatMap((it) => (it.thread ?? []).filter((e) => !e.own && e.id).map((e) => encodeAyrshareComment('twitter', postId, e.id)));
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    stmts.push(env.DB.prepare(`DELETE FROM platform_comments WHERE provider_comment_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk));
  }
  await runBatch(env, stmts);
}

/**
 * سلاسل تعليقات لينكدإن — لينكدإن لا يُعشّش الردود في التعليق، فتُطلب لكل
 * تعليقٍ بطلبه. وكانت تُطلب لما لا ردّ عليه وحده، وتقف عند أوّل ردٍّ منّا: فلا
 * يُرى ما كتبه العميل بعد ردّنا. فتُطلب لكل تعليقٍ تدوّراً — ما لا ردّ عليه
 * أوّلاً، ثم الأقدمُ فحصاً — في حدود الحصّة. وما لم يبلغه الدور لا تُمسّ سلسلته.
 * يعود بمعرّفات ما فُحص.
 */
async function linkedInThreads(
  env: Env,
  auth: AyrshareAuth,
  budget: CallBudget,
  reserve: number,
  items: InboxItem[],
  ownerKeys: string[],
): Promise<string[]> {
  if (!items.length) return [];
  const rows = await rowsByIds(env, items.map((it) => it.id));
  const order = [...items].sort((a, b) => {
    const ra = rows.get(a.id);
    const rb = rows.get(b.id);
    return (ra?.reply_body ? 1 : 0) - (rb?.reply_body ? 1 : 0)
      || String(ra?.reply_checked_at ?? '').localeCompare(String(rb?.reply_checked_at ?? ''));
  });
  const checked: string[] = [];
  for (const it of order) {
    if (budget.left <= reserve) break;
    const d = decodeAyrshareId(it.id);
    if (d?.type !== 'comment') continue;
    try {
      const thread = await ayrshareLinkedInReplies(auth, d.urn || d.commentId, ownerKeys, budget);
      it.thread = thread;
      const answer = threadAnswer(thread);
      it.repliedBody = answer?.body ?? null;
      it.repliedAt = answer?.at ?? null;
      checked.push(it.id);
    } catch (err) {
      if (err instanceof BudgetExhausted) break;
      // تعليقٌ لا تُقرأ ردوده (حُذف) — يبقى كما هو ويُعاد في الدورة التالية
      if (!(err instanceof AyrshareError)) throw err;
    }
  }
  return checked;
}

/** اسمُ من ردّ من هنا على العنصر — لردٍّ أعادته المنصة قبل أن يُحفظ في سجلّه. */
async function replierName(env: Env, rowId: string): Promise<string> {
  const r = await env.DB.prepare(
    'SELECT u.name FROM platform_comments pc JOIN users u ON u.id = pc.replied_by WHERE pc.id = ?',
  )
    .bind(rowId)
    .first<{ name: string }>();
  return r?.name || '';
}

/**
 * محادثات منصةٍ من رسائلها — عنصرٌ لكل محادثة: نصُّه آخرُ ما
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
  type Conv = { lastIn: AyrshareMessage | null; lastOut: AyrshareMessage | null; all: AyrshareMessage[] };
  const convs = new Map<string, Conv>();
  // الأحدث أوّلاً — فأوّلُ ما يُرى من كل اتجاهٍ هو الأخير
  for (const m of messages) {
    const cv = convs.get(m.conversationId) ?? { lastIn: null, lastOut: null, all: [] };
    if (m.direction === 'in' && !cv.lastIn) cv.lastIn = m;
    if (m.direction === 'out' && !cv.lastOut) cv.lastOut = m;
    cv.all.push(m);
    convs.set(m.conversationId, cv);
  }
  /* سجلّ المحادثة: رسائلها في الصفحة المقروءة بالاتجاهين — تحت العنصر كما تُعرض
     سلسلة التعليق، ويُضمّ إلى ما حُفظ منها (`mergeDmThread`). */
  const entries = (cv: Conv): ThreadEntry[] =>
    cv.all.map((m) => ({
      id: m.id,
      author: m.senderName || (m.direction === 'in' ? 'مستخدم' : ''),
      own: m.direction === 'out',
      body: m.text,
      at: m.created,
      ...(m.attachments.length ? { attachments: m.attachments } : {}),
    }));

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
    items.push({
      id: key, platform: internal, kind: 'dm', authorName: cv.lastIn.senderName || 'مستخدم', body: lastIn.text, createdAt: lastIn.at,
      // الصفّ الجديد يُكتب بسجلّه؛ والقائم يُضمّ سجلُّه بعد الكتابة — لا بقاعدة سلسلة التعليق
      ...(row ? {} : { thread: entries(cv) }),
    });
    const out = cv.lastOut?.created && cv.lastOut.created >= lastIn.at ? cv.lastOut : null;
    if (out) {
      if (!row || row.reply_body === null) replies.push({ key, reply: { text: out.text, at: out.created, id: null } });
    } else if (row && row.reply_body !== null && (!row.replied_at || row.replied_at < lastIn.at)) {
      reopen.push({ key, text: lastIn.text, at: lastIn.at });
    }
  }

  const written = await writeItems(env, items, existing);
  report.added += written.added;

  const threads: D1PreparedStatement[] = [];
  for (const [id, cv] of convs) {
    const row = existing.get(keyOf(id, cv));
    if (!row) continue;
    const hereIds = row.reply_source === 'platform' && row.reply_provider_id ? [row.reply_provider_id] : [];
    const author = hereIds.length ? await replierName(env, row.id) : '';
    const merged = JSON.stringify(mergeDmThread(parseThread(row.thread_json), entries(cv), hereIds, author));
    if (merged !== (row.thread_json || '[]')) {
      threads.push(env.DB.prepare('UPDATE platform_comments SET thread_json = ? WHERE id = ?').bind(merged, row.id));
    }
  }
  await runBatch(env, threads);

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

/**
 * سلسلةُ التعليق بعد ردٍّ من هنا — ما يُكتب في `thread_json` قبل أن تعيده
 * المنصة. ولتعليقات Ayrshare وحدها: ما سواها لا سلسلة له.
 * `replace` معرّفُ ردٍّ سابقٍ يُرفع منها (التعديل استبدالٌ والحذف رفع).
 */
async function threadAfterReply(
  env: Env,
  row: { provider_comment_id: string; kind: string; thread_json: string | null },
  change: { add?: { id: string; body: string; userId: string; attachments?: { type: string; url: string }[] }; replace?: string | null },
): Promise<string | null> {
  // سلسلة التعليق وسجلّ المحادثة الخاصة كلاهما من Ayrshare — وما سواهما بلا سلسلة
  const ayrComment = row.kind === 'comment' && row.provider_comment_id.startsWith('ayc|');
  const ayrDm = row.kind === 'dm' && row.provider_comment_id.startsWith('ayd|');
  if (!ayrComment && !ayrDm) return row.thread_json;
  let thread = parseThread(row.thread_json);
  if (change.replace) thread = thread.filter((e) => e.id !== change.replace);
  if (change.add) {
    const user = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(change.add.userId).first<{ name: string }>();
    thread = sortThread([
      ...thread,
      {
        id: change.add.id, author: user?.name || '', own: true, here: true, body: change.add.body, at: nowIso(),
        ...(change.add.attachments ? { attachments: change.add.attachments } : {}),
      },
    ]);
  }
  return JSON.stringify(thread);
}

/**
 * إلى أين يُرسل الردّ. إكس محادثةٌ لا شجرة ردودٍ تحت تعليق: من ردّ على ردّنا
 * يُجاب في تغريدته، لا في أوّل المحادثة — وإلا ظهر ردُّنا جواباً لسؤالٍ قديم.
 * وما سواه يُرسل إلى التعليق نفسه: فيسبوك يجمع الردود تحته، وإنستغرام وتيك توك
 * ويوتيوب لا ردَّ عندها على الردّ.
 */
function replyTarget(row: { provider_comment_id: string; thread_json: string | null }): string {
  const d = decodeAyrshareId(row.provider_comment_id);
  if (d?.type !== 'comment' || d.platform !== 'twitter') return row.provider_comment_id;
  const last = [...parseThread(row.thread_json)].reverse().find((e) => !e.own && e.id);
  return last ? encodeAyrshareComment('twitter', d.postId, last.id) : row.provider_comment_id;
}

/** نوع المرفق في سجلّ المحادثة من نوع الملف — كما تردّه المنصات (`attachmentLabel`). */
function attachmentType(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export async function replyToComment(env: Env, commentId: string, text: string, userId: string, mediaId?: string): Promise<void> {
  // LEFT JOIN كي يعمل الرد حتى لتعليقات الصندوق غير المرتبطة بجدول نشر (schedule_id = NULL)
  const comment = await env.DB.prepare(
    `SELECT pc.provider_comment_id, pc.kind, pc.thread_json, s.provider_post_id
     FROM platform_comments pc LEFT JOIN schedules s ON s.id = pc.schedule_id
     WHERE pc.id = ?`,
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; kind: string; thread_json: string | null; provider_post_id: string | null }>();
  if (!comment) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.replyComment) throw new Error('المزوّد الحالي لا يدعم الرد على التعليقات');
  // المرفق من مكتبة الوسائط — وفي السجلّ رابطُه عندنا لا عند المنصة
  const [media] = mediaId ? await loadMedia(env, [mediaId]) : [];
  const replyId = await provider.replyComment(comment.provider_post_id || '', replyTarget(comment), text, media ? { media } : undefined);
  const attachments = media ? [{ type: attachmentType(media.mimeType), url: `/api/media/${mediaId}` }] : undefined;
  const body = text || (attachments ? attachmentLabel(attachments[0].type) : '');

  const thread = await threadAfterReply(env, comment, { add: { id: replyId || '', body, userId, attachments } });
  await env.DB.prepare(
    `UPDATE platform_comments
     SET reply_body = ?, reply_provider_id = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ?, reply_source = 'platform',
         thread_json = ?
     WHERE id = ?`,
  )
    .bind(body, replyId || null, userId, thread, commentId)
    .run();
}

// تعديل ردّي على المنصة (يحدّثه فعلياً للتقييمات؛ ولغيرها يستبدله)
export async function editReply(env: Env, commentId: string, text: string, userId: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT provider_comment_id, kind, thread_json, reply_provider_id, reply_body FROM platform_comments WHERE id = ?',
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; kind: string; thread_json: string | null; reply_provider_id: string | null; reply_body: string | null }>();
  if (!row) throw new Error('التعليق غير موجود');
  if (!row.reply_body) throw new Error('لا يوجد ردّ لتعديله');

  const provider = await getProvider(env);
  if (!provider.editReply) throw new Error('المزوّد الحالي لا يدعم تعديل الرد');
  const newReplyId = await provider.editReply(row.provider_comment_id, row.reply_provider_id, text);

  const id = newReplyId || row.reply_provider_id || null;
  const thread = await threadAfterReply(env, row, { replace: row.reply_provider_id, add: { id: id || '', body: text, userId } });
  await env.DB.prepare(
    `UPDATE platform_comments
     SET reply_body = ?, reply_provider_id = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ?, reply_source = 'platform',
         thread_json = ?
     WHERE id = ?`,
  )
    .bind(text, id, userId, thread, commentId)
    .run();
}

// حذف ردّي من المنصة، وإرجاع العنصر إلى حالة «بلا رد» محلياً
export async function deleteReply(env: Env, commentId: string): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT provider_comment_id, kind, thread_json, reply_provider_id FROM platform_comments WHERE id = ?',
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; kind: string; thread_json: string | null; reply_provider_id: string | null }>();
  if (!row) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.deleteReply) throw new Error('المزوّد الحالي لا يدعم حذف الرد');
  await provider.deleteReply(row.provider_comment_id, row.reply_provider_id);

  const thread = row.reply_provider_id ? await threadAfterReply(env, row, { replace: row.reply_provider_id }) : row.thread_json;
  await env.DB.prepare(
    'UPDATE platform_comments SET reply_body = NULL, reply_provider_id = NULL, replied_at = NULL, replied_by = NULL, reply_source = NULL, thread_json = ? WHERE id = ?',
  )
    .bind(thread, commentId)
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

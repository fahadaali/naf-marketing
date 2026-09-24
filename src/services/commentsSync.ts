import type { Env } from '../types';
import type { ModerateAction } from '../adapters/provider';
import { getProvider, providerKey } from '../adapters';
import {
  BudgetExhausted, CallBudget, conversationLatest, isNotFound, isOwnAuthor, isUnsupported, listCommentReplies,
  listConversations, listInboxPosts, listMentions, listPostComments, listReviews,
  listSocialApiAccountsDetailed, ownReply, supportsDirectInbox,
  type InboxItem, type InboxPost, type MentionsPath, type RepliesPath, type SocialApiOwnedAccount,
} from '../adapters/socialapi';
import { newId, nowIso } from '../util';
import { notifyUsers, usersWithPermission } from './notify';

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

export type SyncMode = 'incremental' | 'full';
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
};

/** ميزانيات النداءات — دون الخمسين بهامشٍ لما يسبق المزامنة في الاستدعاء نفسه. */
export const INBOX_BUDGET = { cron: 40, webhook: 30, manual: 45 } as const;

const REPORT_KEY = 'inbox_sync_report';
const LOCK_KEY = 'inbox_sync_lock';

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

export async function readInboxReport(env: Env): Promise<InboxSyncReport | null> {
  const raw = await getSetting(env, REPORT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InboxSyncReport;
  } catch {
    return null;
  }
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
    repliesPath: prev?.repliesPath ?? null,
    mentionsPath: prev?.mentionsPath ?? null,
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
async function takeLock(env: Env, withinMs: number): Promise<boolean> {
  const last = await getSetting(env, LOCK_KEY);
  if (last && Date.now() - Date.parse(last) < withinMs) return false;
  await setSetting(env, LOCK_KEY, nowIso());
  return true;
}

/**
 * يجلب التعليقات/الرسائل الجديدة ويخزّنها — يختار المسار حسب المزوّد.
 *
 * `full` للجلب اليدوي: يقرأ صفحاتٍ أكثر ويبدأ كل منشورٍ من أوّله. و`incremental`
 * للدورة الآلية والخطّاف. ويعود بتقرير الدورة، أو `null` إن تخطّاها القفل.
 */
export async function syncComments(
  env: Env,
  opts: { mode?: SyncMode; budget?: number; skipIfRunningWithinMs?: number } = {},
): Promise<InboxSyncReport | null> {
  const mode = opts.mode ?? 'incremental';
  if (opts.skipIfRunningWithinMs) {
    if (!(await takeLock(env, opts.skipIfRunningWithinMs))) return null;
  } else {
    await setSetting(env, LOCK_KEY, nowIso());
  }

  const provider = await providerName(env);
  const prev = await readInboxReport(env);
  const budget = opts.budget ?? INBOX_BUDGET.cron;
  const report = newReport(mode, provider, budget, prev);

  try {
    if (provider === 'socialapi') await syncSocialApiInbox(env, report);
    else await syncPerPost(env, report);
  } catch (err) {
    report.errors.push(errorText(err));
  }

  report.ok = report.errors.length === 0;
  if (report.ok) report.lastOkAt = report.at;
  await setSetting(env, REPORT_KEY, JSON.stringify(report));
  return report;
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

async function syncSocialApiInbox(env: Env, report: InboxSyncReport): Promise<void> {
  const token = providerKey(env, 'socialapi');
  if (!token) {
    report.errors.push('مفتاح SocialAPI غير مضبوط. اضبط SOCIALAPI_API_KEY.');
    return;
  }
  const budget = new CallBudget(report.budget);

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
  const reserve = Math.min(1 + (direct ? 3 : 0) + direct, 12);

  try {
    await syncCommentThreads(env, token, budget, report, owners, reserve);
  } catch (err) {
    fail('comment', err);
  }

  const fresh: InboxItem[] = [];
  try {
    fresh.push(...(await syncReviews(env, token, budget, report)));
  } catch (err) {
    fail('review', err);
  }

  try {
    await syncConversations(env, token, budget, report, accounts);
  } catch (err) {
    fail('dm', err);
  }

  try {
    await syncMentions(env, token, budget, report, accounts);
  } catch (err) {
    fail('mention', err);
  }

  report.calls = budget.used;
  const negative = fresh.filter((it) => it.rating != null && it.rating <= 2);
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
  created_at: string;
};

const ROW_COLUMNS =
  'id, provider_comment_id, platform, kind, author_name, body, is_hidden, capabilities_json, rating, reply_body, replied_at, reply_source, reply_checked_at, created_at';

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
              capabilities_json, is_hidden, rating, reply_body, replied_at, reply_source)
           VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(platform, provider_comment_id) DO NOTHING`,
        ).bind(
          newId('cm'), it.platform, it.id, it.kind, it.authorName, it.body, it.createdAt,
          caps, it.isHidden ? 1 : 0, it.rating ?? null,
          replied ? it.repliedBody : null, replied ? it.repliedAt ?? null : null, replied ? 'external' : null,
        ),
      });
      if (replied) result.externalReplies++;
      continue;
    }

    const changed =
      row.body !== it.body || row.author_name !== it.authorName || row.kind !== it.kind ||
      (row.is_hidden ? 1 : 0) !== (it.isHidden ? 1 : 0) || (row.capabilities_json ?? null) !== caps ||
      (row.rating ?? null) !== (it.rating ?? null);
    if (changed) {
      updates.push(
        env.DB.prepare(
          `UPDATE platform_comments
           SET kind = ?, body = ?, author_name = ?, capabilities_json = ?, is_hidden = ?, rating = ?
           WHERE id = ?`,
        ).bind(it.kind, it.body, it.authorName, caps, it.isHidden ? 1 : 0, it.rating ?? null, row.id),
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
  const full = report.mode === 'full';
  const listing = await listInboxPosts(token, { budget, maxPages: full ? 5 : 2 });
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

  for (const { p, st } of ranked) {
    // يُترك للردود ثلاثةُ نداءاتٍ على الأقل، وللأنواع الأخرى حصّتها
    if (budget.left <= reserve + 3) {
      report.complete = false;
      break;
    }
    const r = await syncOnePost(env, token, budget, report, owners, p, st, replyQueue);
    seen += r.seen;
    stateWrites.push(
      env.DB.prepare(
        `INSERT INTO inbox_post_state (inbox_post_id, account_id, platform, signature, seen_at, synced_at, tail_cursor, needs_more)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(inbox_post_id, account_id) DO UPDATE SET
           platform = excluded.platform, signature = excluded.signature, seen_at = excluded.seen_at,
           synced_at = excluded.synced_at, tail_cursor = excluded.tail_cursor, needs_more = excluded.needs_more`,
      ).bind(p.postId, p.accountId, p.platform, p.signature, stamp, stamp, r.resume, r.complete ? 0 : 1),
    );
    if (r.exhausted) {
      report.complete = false;
      break;
    }
  }
  await runBatch(env, stateWrites);
  report.kinds.comment.items = seen;

  await checkReplies(env, token, budget, report, owners, replyQueue, reserve);
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
  const full = report.mode === 'full';
  const startCursor = full ? null : st?.tail_cursor ?? null;
  const maxPages = full ? 5 : 3;
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
): Promise<void> {
  const cutoff = Date.now() - 14 * DAY;
  const eligible = queue
    .filter((q) => q.known || Date.parse(q.createdAt) >= cutoff)
    .sort((a, b) =>
      Number(b.known) - Number(a.known) ||
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
      throw err;
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

/* ─── المراجعات ─── */

async function syncReviews(env: Env, token: string, budget: CallBudget, report: InboxSyncReport): Promise<InboxItem[]> {
  if (budget.left <= 0) {
    report.complete = false;
    return [];
  }
  let r;
  try {
    r = await listReviews(token, { budget, maxPages: 2 });
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
): Promise<void> {
  if (!accounts.some((a) => supportsDirectInbox(a.platform))) return;
  if (budget.left <= 0) {
    report.complete = false;
    return;
  }
  const r = await listConversations(token, accounts, { budget });
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
               reply_provider_id = NULL, reply_source = NULL
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
      const r = await listMentions(token, acc, { budget, prefer: path });
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

// يُشعِر مسؤولي التعليقات بالتفاعلات السلبية الجديدة فور رصدها
async function notifyNegative(
  env: Env,
  items: { platform: string; authorName: string; body: string; rating?: number | null }[],
): Promise<void> {
  try {
    const userIds = await usersWithPermission(env, 'comments.manage');
    if (!userIds.length) return;
    for (const it of items) {
      await notifyUsers(env, userIds, {
        type: 'negative_feedback',
        title: `تقييم سلبي (${it.rating} من 5) على ${it.platform}`,
        body: `${it.authorName}: ${String(it.body).slice(0, 160)}`,
        link: '/comments',
      });
    }
  } catch { /* التنبيه أفضل جهد — لا يُعطّل المزامنة */ }
}

// مزوّدون يعتمدون getComments لكل منشور نُشر عبر المنصة (Ayrshare/Mock)
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

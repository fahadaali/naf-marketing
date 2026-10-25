import type { Env } from '../types';
import { newId } from '../util';
import {
  isConfigured, setting, getMgmtProjectId, getCardTableId, getColumns, createColumn,
  getProjectPeopleIds, createCard, updateCard, moveCard, trashRecording, createAttachment, getComments, listCards,
  getProjectPeople, createComment, lastActor, type CardSnapshot, type BcCard,
} from './basecamp';
import { escapeHtml } from './inline';
import { notifyStageReached, notifyUsers, usersWithPermission } from './notify';
import { isIdeaRow } from './planning';
import { snapshotVersion } from './versions';
import { normalizeBody, nowIso } from '../util';

// مزامنة المنشور مع مشروع «إدارة التسويق» في بيسكامب كبطاقة (Card) تتحرك عبر أعمدة مراحل الاعتماد.

// المرحلة (حالة المنشور) → اسم عمود جدول البطاقات في بيسكامب
const STAGE_LIST: Record<string, string> = {
  draft: 'المسودات',
  pending_marketing: 'بانتظار اعتماد قسم التسويق',
  pending_gm: 'بانتظار اعتماد المدير العام',
  approved: 'معتمد',
  scheduled: 'مجدول للنشر',
  published: 'منشور',
  rejected: 'مرفوض',
  archived: 'مؤرشف',
};

function riyadhDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return '';
  }
}

// استبدال بطاقات الوسائط المدمجة بمرفقات بيسكامب (مع مراعاة التداخل في <div>)
type MediaBlock = { id: string; name: string; token: string; raw: string };
function scanMediaEmbeds(html: string): { text: string; blocks: MediaBlock[] } {
  let out = '';
  let i = 0;
  const blocks: MediaBlock[] = [];
  while (true) {
    const start = html.indexOf('<div class="media-embed', i);
    if (start < 0) { out += html.slice(i); break; }
    out += html.slice(i, start);
    let depth = 0;
    let j = start;
    while (j < html.length) {
      if (html.startsWith('<div', j)) { depth++; j += 4; }
      else if (html.startsWith('</div>', j)) { depth--; j += 6; if (depth === 0) break; }
      else j++;
    }
    const block = html.slice(start, j);
    const id = (block.match(/data-media-id="([^"]*)"/) || [])[1] || '';
    const name = (block.match(/data-media-name="([^"]*)"/) || [])[1] || '';
    const token = `@@MEDIA_${blocks.length}@@`;
    blocks.push({ id, name, token, raw: block });
    out += token;
    i = j;
  }
  return { text: out, blocks };
}

async function ensureMediaSgid(env: Env, mediaId: string): Promise<string | null> {
  const a = await env.DB.prepare(
    'SELECT r2_key, mime_type, filename, basecamp_sgid FROM media_assets WHERE id = ?',
  ).bind(mediaId).first<{ r2_key: string; mime_type: string | null; filename: string | null; basecamp_sgid: string | null }>();
  if (!a) return null;
  if (a.basecamp_sgid) return a.basecamp_sgid;
  try {
    const obj = await env.MEDIA.get(a.r2_key);
    if (!obj) return null;
    const sgid = await createAttachment(env, a.filename || mediaId, a.mime_type || 'application/octet-stream', await obj.arrayBuffer());
    await env.DB.prepare('UPDATE media_assets SET basecamp_sgid = ? WHERE id = ?').bind(sgid, mediaId).run();
    return sgid;
  } catch {
    return null;
  }
}

// وصف المهمة: نص المحتوى مع الوسائط مضمّنة كمرفقات بيسكامب
async function buildDescription(env: Env, body: string): Promise<string> {
  const { text, blocks } = scanMediaEmbeds(body || '');
  let html = text
    .replace(/<\/?(u|ins)>/gi, '')
    .replace(/<h2(\s[^>]*)?>/gi, '<h1>').replace(/<\/h2>/gi, '</h1>')
    .replace(/<p(\s[^>]*)?>/gi, '<div>').replace(/<\/p>/gi, '</div>');
  for (const b of blocks) {
    let replacement: string;
    const sgid = b.id ? await ensureMediaSgid(env, b.id) : null;
    if (sgid) replacement = `<bc-attachment sgid="${sgid}" caption="${b.name}"></bc-attachment>`;
    else replacement = `<div>مرفق: ${b.name || ''}</div>`;
    html = html.replace(b.token, replacement);
  }
  return html || '<div></div>';
}

async function computeDue(env: Env, postId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT MIN(scheduled_at) AS mn FROM schedules WHERE post_id = ? AND status IN ('pending','failed','published')",
  ).bind(postId).first<{ mn: string | null }>();
  return row?.mn ? riyadhDate(row.mn) : null;
}

// عمود المرحلة: يُطابق بالاسم عمود جدول البطاقات الذي جهّزه المدير، أو يُنشئه إن غاب.
async function ensureStageColumn(env: Env, projectId: string, stage: string): Promise<string> {
  const cache = JSON.parse((await setting(env, 'basecamp_stage_cols')) || '{}');
  if (cache[stage]) return cache[stage];
  const cardTableId = await getCardTableId(env, projectId);
  const cols = await getColumns(env, projectId, cardTableId);
  const wanted = STAGE_LIST[stage] || stage;
  const found = cols.find((c) => c.title.trim() === wanted.trim());
  const id = found ? found.id : await createColumn(env, projectId, cardTableId, wanted);
  cache[stage] = id;
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('basecamp_stage_cols', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(JSON.stringify(cache)).run();
  return id;
}

// المزامنة الأساسية — تُستدعى بعد أي إنشاء/انتقال/جدولة
/** `announce: false` في إعادة المزامنة الشاملة: مئات البطاقات تُنشأ من جديد، وذكرُ
 *  الأعضاء في كلٍّ منها مئاتُ إشعارٍ لا خبر فيها. */
export type SyncOpts = { announce?: boolean };

export async function syncPost(env: Env, postId: string, opts: SyncOpts = {}): Promise<void> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return;

  const post = await env.DB.prepare('SELECT id, title, body, status, planned_on, updated_at FROM content_posts WHERE id = ?')
    .bind(postId).first<SyncRow>();
  if (!post || !STAGE_LIST[post.status]) return;

  // (نعيد استخدام أعمدة الجدول: todo_id = معرّف البطاقة، list_id = معرّف العمود)
  const map = await env.DB.prepare('SELECT todo_id, stage FROM basecamp_tasks WHERE post_id = ?')
    .bind(postId).first<{ todo_id: string | null; stage: string }>();

  /* الفكرة لا بطاقة لها حتى يُكتب نصّها. خطةُ ربعٍ تسعون فكرة، وتسعون بطاقةً
     مسندةً لكل أعضاء المشروع تُغرق عمود المسودات قبل أن يُكتب منها حرف.
     وأوّلُ نصٍّ يُحفظ يجعلها مسودةً فتُنشأ بطاقتها حينئذٍ. ومن له بطاقةٌ
     — مسودةٌ مُسح نصّها — تبقى بطاقته تُحدَّث. */
  if (!map && isIdeaRow(post)) return;

  /* البطاقة تُحجز قبل أن تُنشأ. كانت مزامنتان تجريان معاً — حفظٌ ثم إرسالٌ
     للمراجعة في اللحظة نفسها — فلا تجد أيٌّ منهما بطاقةً فتُنشئ كلٌّ بطاقتها،
     ويُرفض ربطُ الثانية فتبقى بطاقتها يتيمةً في عمودها لا تتحرك أبداً، وهي
     «نسخة المسودة» التي تبقى. فالحجزُ صفٌّ بلا بطاقة: من أدرجه يُنشئها، ومن
     وجده محجوزاً يتركها له. والحجزُ الذي طال (عاملٌ قُطع قبل أن يُتمّ) يُؤخذ. */
  if (!map || !map.todo_id) {
    if (!(await claimCard(env, postId, !!map))) return;
    try {
      await createTrackedCard(env, projectId, post, opts);
    } catch (err) {
      await env.DB.prepare('DELETE FROM basecamp_tasks WHERE post_id = ? AND todo_id IS NULL').bind(postId).run();
      throw err;
    }
    return;
  }

  const columnId = await ensureStageColumn(env, projectId, post.status);
  const input = await cardInput(env, projectId, post);
  // تغيّرت المرحلة: انقل البطاقة إلى العمود الجديد (يحافظ على البطاقة وسجلها)
  if (map.stage !== post.status) {
    await moveCard(env, projectId, map.todo_id, columnId);
    await env.DB.prepare(
      "UPDATE basecamp_tasks SET list_id = ?, stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?",
    ).bind(columnId, post.status, postId).run();
    if (opts.announce !== false) await announceStage(env, projectId, map.todo_id, postId, post.status, false);
  }
  // حدّث محتوى البطاقة وتاريخها ومسؤوليها
  await touchTask(env, postId);
  await saveSnapshot(env, postId, await updateCard(env, projectId, map.todo_id, input));
}

/* الكتابةُ في البطاقة تُعلَّم قبل أن تبدأ ثم يُحفظ ما ردّه بيسكامب بعدها. وبينهما
   يكون نصُّ البطاقة جديداً والمحفوظُ قديماً، فلو سحب السحبُ العكسي حينئذٍ لظنّ
   كتابةَ المنصة تعديلاً من بيسكامب. فالسحب يترك النصّ ما دام العَلَم حديثاً. */
async function touchTask(env: Env, postId: string): Promise<void> {
  await env.DB.prepare("UPDATE basecamp_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?")
    .bind(postId).run();
}
async function saveSnapshot(env: Env, postId: string, snap: CardSnapshot | void): Promise<void> {
  if (!snap) return;
  await env.DB.prepare(
    "UPDATE basecamp_tasks SET card_title = ?, card_content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?",
  ).bind(snap.title, snap.content, postId).run();
}

type SyncRow = { id: string; title: string; body: string; status: string; planned_on: string | null; updated_at?: string | null };

async function cardInput(env: Env, projectId: string, post: SyncRow) {
  const content = await buildDescription(env, post.body);
  // الاستحقاق أقرب موعد نشر، وما لم يُجدول بعدُ فيومُه المستهدف
  const due_on = (await computeDue(env, post.id)) || post.planned_on || null;
  const assignee_ids = await getProjectPeopleIds(env, projectId);
  return { title: post.title || 'منشور بدون عنوان', content, due_on, assignee_ids };
}

/** مهلةُ الحجز: إنشاءُ بطاقةٍ برفع وسائطها لا يطول أكثر منها. */
const CLAIM_STALE_MS = 10 * 60_000;

async function claimCard(env: Env, postId: string, held: boolean): Promise<boolean> {
  if (!held) {
    const res = await env.DB.prepare(
      `INSERT INTO basecamp_tasks (post_id, todo_id, list_id, stage, updated_at)
       VALUES (?, NULL, NULL, 'creating', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(post_id) DO NOTHING`,
    ).bind(postId).run();
    return (res.meta?.changes ?? 0) > 0;
  }
  const cutoff = new Date(Date.now() - CLAIM_STALE_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const res = await env.DB.prepare(
    `UPDATE basecamp_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE post_id = ? AND todo_id IS NULL AND (updated_at IS NULL OR updated_at < ?)`,
  ).bind(postId, cutoff).run();
  return (res.meta?.changes ?? 0) > 0;
}

/* تُنشأ البطاقة في عمود مرحلتها، ثم يُعاد قراءة المنشور: ما تغيّر أثناء الإنشاء —
   إرسالٌ للمراجعة لحق الحفظ، أو نصٌّ عُدّل — تركته المزامنة الأخرى لمن حجز،
   فيُطبَّق هنا. */
async function createTrackedCard(env: Env, projectId: string, post: SyncRow, opts: SyncOpts): Promise<void> {
  const columnId = await ensureStageColumn(env, projectId, post.status);
  const input = await cardInput(env, projectId, post);
  const card = await createCard(env, projectId, columnId, input);
  const cardId = card.id;
  await env.DB.prepare(
    `UPDATE basecamp_tasks SET todo_id = ?, list_id = ?, stage = ?, card_title = ?, card_content = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?`,
  ).bind(cardId, columnId, post.status, card.title, card.content, post.id).run();

  const now = await env.DB.prepare('SELECT id, title, body, status, planned_on, updated_at FROM content_posts WHERE id = ?')
    .bind(post.id).first<SyncRow>();
  const announce = opts.announce !== false;
  if (!now || !STAGE_LIST[now.status]) {
    if (announce) await announceStage(env, projectId, cardId, post.id, post.status, true);
    return;
  }
  // يُعلن مرةً واحدة بالمرحلة التي استقرت عليها البطاقة
  if (announce) await announceStage(env, projectId, cardId, post.id, now.status, now.status === post.status);
  if (now.status !== post.status) {
    const col = await ensureStageColumn(env, projectId, now.status);
    await moveCard(env, projectId, cardId, col);
    await env.DB.prepare(
      "UPDATE basecamp_tasks SET list_id = ?, stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?",
    ).bind(col, now.status, post.id).run();
  }
  if (now.updated_at !== post.updated_at || now.title !== post.title || now.body !== post.body) {
    await touchTask(env, post.id);
    await saveSnapshot(env, post.id, await updateCard(env, projectId, cardId, await cardInput(env, projectId, now)));
  }
}

/* إعلان المرحلة في البطاقة. نقلُ البطاقة بين الأعمدة لا يُشعر أحداً في بيسكامب،
   وإنشاؤها كان بلا إشعار — فلم يكن يصل أحداً خبرُ مسودةٍ ولا اعتمادٍ ولا جدولة.
   فيُكتب تعليقٌ يذكر كل أعضاء المشروع وقت كتابته (يتغيّرون، فلا قائمة ثابتة)،
   والذكر يصل كلاً منهم إشعاراً. إلا صاحب الحساب المربوط: بيسكامب لا يُشعر
   أحداً بما كتبه هو. والتعليق يُحفظ معرّفه ليُستثنى من سحب التعليقات العكسي. */
async function announceStage(env: Env, projectId: string, cardId: string, postId: string, status: string, created: boolean): Promise<void> {
  try {
    const label = STAGE_LIST[status] || status;
    const row = await env.DB.prepare(
      created
        ? 'SELECT u.name FROM content_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?'
        : `SELECT u.name FROM approvals a JOIN users u ON u.id = a.actor_id
           WHERE a.post_id = ? AND a.to_status = ? ORDER BY a.created_at DESC LIMIT 1`,
    ).bind(...(created ? [postId] : [postId, status])).first<{ name: string }>();
    const people = await getProjectPeople(env, projectId);
    const what = created ? `أُنشئ في «${label}»` : `انتقل إلى «${label}»`;
    const by = row?.name ? ` — بواسطة ${escapeHtml(row.name)}` : '';
    const mentions = people.map((p) => `<bc-attachment sgid="${escapeHtml(p.sgid)}"></bc-attachment>`).join(' ');
    const id = await createComment(env, projectId, cardId, `<div>${what}${by}</div>${mentions ? `<div>${mentions}</div>` : ''}`);
    await env.DB.prepare('INSERT INTO basecamp_own_comments (comment_id, post_id) VALUES (?, ?) ON CONFLICT(comment_id) DO NOTHING')
      .bind(id, postId).run();
  } catch { /* الإعلان زيادة: تعذّره لا يعطّل نقل البطاقة */ }
}

/* تصحيحٌ دوري: بطاقةٌ مرحلتُها غير حالة منشورها تُزامَن. فالنشر في موعده يجعل
   المنشور «منشوراً» من المهمة المجدولة لا من طلبٍ يزامن، فكانت بطاقته تبقى في
   «مجدول للنشر» حتى يُعدَّل المنشور. وكل مزامنةٍ فاتت لأي سبب تُدرَك هنا. */
export async function reconcileStages(env: Env, limit = 10): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT p.id FROM content_posts p JOIN basecamp_tasks t ON t.post_id = p.id
     WHERE t.todo_id IS NOT NULL AND t.stage IS NOT p.status
     ORDER BY p.updated_at DESC LIMIT ?`,
  ).bind(limit).all<{ id: string }>();
  for (const r of results) await syncPostSafe(env, r.id);
  return results.length;
}

/* ═══ السحب العكسي: ما جرى في بيسكامب يصل المنصة ═══

   كانت المزامنة باتجاهٍ واحد — المنصة تكتب البطاقة وتنقلها، ولا يُقرأ منها
   إلا تعليقاتها. فبطاقةٌ تُنقل بين الأعمدة أو يُعدَّل نصّها في بيسكامب لا
   يتغيّر منشورها، ثم تعيدها المنصة إلى عمودها عند أوّل انتقالٍ تالٍ.

   والنقلُ يُطبَّق كما هو، أيّاً كان العمود ومن نقل — قرار المالك. ويُسجَّل
   في سجلّ الاعتماد باسم من نقل إن طابق بريدُه حساباً في المنصة. والرفضُ
   وحده يحتاج سبباً: آخرُ تعليقٍ لمن نقلها، وبلا تعليقٍ تعود البطاقة إلى
   عمودها مع تعليقٍ يطلب السبب. */

/** مهلةُ ما بعد كتابة المنصة في البطاقة: لا يُسحب النصّ قبلها (انظر touchTask). */
const WRITE_SETTLE_MS = 2 * 60_000;

type TrackedRow = {
  post_id: string; todo_id: string; list_id: string | null; stage: string | null; task_updated_at: string | null;
  card_title: string | null; card_content: string | null; status: string; title: string; body: string;
};

export async function pullCardChanges(env: Env): Promise<{ moved: number; edited: number }> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return { moved: 0, edited: 0 };
  const rows = (await env.DB.prepare(
    `SELECT t.post_id, t.todo_id, t.list_id, t.stage, t.updated_at AS task_updated_at, t.card_title, t.card_content,
            p.status, p.title, p.body
     FROM basecamp_tasks t JOIN content_posts p ON p.id = t.post_id WHERE t.todo_id IS NOT NULL`,
  ).all<TrackedRow>()).results;
  if (!rows.length) return { moved: 0, edited: 0 };
  const byCard = new Map(rows.map((r) => [String(r.todo_id), r]));

  // العمود ← مرحلته: باسمه أولاً، ثم بالمعرّف المحفوظ لمن أُعيدت تسميته
  const cardTableId = await getCardTableId(env, projectId);
  const cols = await getColumns(env, projectId, cardTableId);
  const cache: Record<string, string> = JSON.parse((await setting(env, 'basecamp_stage_cols')) || '{}');
  const stageOf = new Map<string, string>();
  for (const [stage, colId] of Object.entries(cache)) stageOf.set(String(colId), stage);
  for (const c of cols) {
    const stage = Object.keys(STAGE_LIST).find((s) => STAGE_LIST[s].trim() === c.title.trim());
    if (stage) stageOf.set(c.id, stage);
  }

  const settled = new Date(Date.now() - WRITE_SETTLE_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  let moved = 0;
  let edited = 0;
  for (const col of cols) {
    for (const card of await listCards(env, projectId, col.id)) {
      const row = byCard.get(card.id);
      if (!row) continue;
      try {
        if (await pullText(env, projectId, row, card, settled)) edited++;
        if (await pullStage(env, projectId, row, card.column_id || col.id, stageOf)) moved++;
      } catch { /* بطاقةٌ تتعذّر لا توقف غيرها */ }
    }
  }
  return { moved, edited };
}

async function userByEmail(env: Env, email: string): Promise<{ id: string; name: string } | null> {
  if (!email) return null;
  return env.DB.prepare('SELECT id, name FROM users WHERE lower(email) = lower(?)')
    .bind(email.trim()).first<{ id: string; name: string }>();
}

// نصّ البطاقة غيرُ ما كتبته المنصة آخرَ مرة: عُدِّل في بيسكامب، فيُسحب إلى المنشور
async function pullText(env: Env, projectId: string, row: TrackedRow, card: BcCard, settled: string): Promise<boolean> {
  const title = card.title;
  const content = card.content ?? '';
  // صفٌّ قبل حفظ النصّ: ما في البطاقة الآن أساسُ المقارنة، لا تعديل
  if (row.card_title === null && row.card_content === null) {
    await saveSnapshot(env, row.post_id, { title, content });
    return false;
  }
  if (title === row.card_title && content === row.card_content) return false;
  if (row.task_updated_at && row.task_updated_at > settled) return false;

  const actor = await lastActor(env, projectId, card.id).catch(() => null);
  const user = actor ? await userByEmail(env, actor.email) : null;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (title !== row.card_title && title.trim()) { sets.push('title = ?'); binds.push(title); }
  if (content !== row.card_content) { sets.push('body = ?'); binds.push(await cardContentToBody(env, content, row.body)); }
  if (sets.length) {
    // لقطةٌ قبل التعديل كما يفعل الحفظ من المحرر، فيُسترجع ما كان
    await snapshotVersion(env, row.post_id, user?.id ?? null);
    await env.DB.prepare(`UPDATE content_posts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds, nowIso(), row.post_id).run();
  }
  await saveSnapshot(env, row.post_id, { title, content });
  return sets.length > 0;
}

// البطاقة في عمودٍ غير الذي وضعتها فيه المنصة: نُقلت في بيسكامب، فتتبعها المرحلة
async function pullStage(env: Env, projectId: string, row: TrackedRow, columnId: string, stageOf: Map<string, string>): Promise<boolean> {
  const to = stageOf.get(columnId);
  if (!to) return false; // عمودٌ ليس لمرحلة (أُضيف يدوياً): لا معنى له في المنصة
  if (to === row.status) {
    // المنصة نقلتها ولم تُسجّل النقل بعد، أو سجّلته بعمودٍ آخر للمرحلة نفسها
    if (row.list_id !== columnId || row.stage !== to) {
      await env.DB.prepare(
        "UPDATE basecamp_tasks SET list_id = ?, stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?",
      ).bind(columnId, to, row.post_id).run();
    }
    return false;
  }
  // لم تُنقل من عمودها: المنصة سبقتها بمرحلةٍ لم تنقلها إليها بعد — للتصحيح الدوري
  if (columnId === row.list_id) return false;

  const actor = await lastActor(env, projectId, row.todo_id, /mov/i).catch(() => null);
  const user = actor ? await userByEmail(env, actor.email) : null;

  let reason: string | null = null;
  if (to === 'rejected') {
    reason = actor ? await rejectReason(env, projectId, row, actor.id) : null;
    if (!reason) {
      await bounceRejection(env, projectId, row);
      return false;
    }
  }

  const now = nowIso();
  await env.DB.prepare('UPDATE content_posts SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?')
    .bind(to, reason, now, row.post_id).run();
  // سجلّ الاعتماد يشترط فاعلاً من المنصة: من لا حساب له يُنقل منشوره بلا سطرٍ فيه
  if (user) {
    await env.DB.prepare(
      'INSERT INTO approvals (id, post_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(newId('appr'), row.post_id, row.status, to, user.id, reason).run();
  }
  await env.DB.prepare(
    "UPDATE basecamp_tasks SET list_id = ?, stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?",
  ).bind(columnId, to, row.post_id).run();
  row.status = to;
  row.stage = to;
  row.list_id = columnId;
  try { await notifyStageReached(env, row.post_id, to); } catch { /* الإشعار زيادة */ }
  await announceStage(env, projectId, row.todo_id, row.post_id, to, false);
  return true;
}

// سببُ الرفض: آخرُ تعليقٍ كتبه من نقلها — لا تعليقات المنصة نفسها
async function rejectReason(env: Env, projectId: string, row: TrackedRow, actorId: string): Promise<string | null> {
  const own = new Set(
    (await env.DB.prepare('SELECT comment_id FROM basecamp_own_comments WHERE post_id = ?').bind(row.post_id).all<{ comment_id: string }>())
      .results.map((r) => String(r.comment_id)),
  );
  const mine = (await getComments(env, projectId, row.todo_id))
    .filter((c) => c.creator_id === actorId && !own.has(String(c.id)) && c.content.trim())
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return mine[0]?.content.trim() || null;
}

// رفضٌ بلا سبب: تعود البطاقة إلى عمودها، ويُطلب السبب في تعليق
async function bounceRejection(env: Env, projectId: string, row: TrackedRow): Promise<void> {
  if (row.list_id) await moveCard(env, projectId, row.todo_id, row.list_id);
  try {
    const id = await createComment(env, projectId, row.todo_id,
      `<div>أُعيدت البطاقة إلى «${STAGE_LIST[row.status] || row.status}»: الرفض يحتاج سبباً. اكتب السبب تعليقاً على البطاقة، ثم انقلها إلى «${STAGE_LIST.rejected}».</div>`);
    await env.DB.prepare('INSERT INTO basecamp_own_comments (comment_id, post_id) VALUES (?, ?) ON CONFLICT(comment_id) DO NOTHING')
      .bind(id, row.post_id).run();
  } catch { /* التعليق زيادة */ }
}

/* نصّ البطاقة ← نصّ المنشور: عكسُ buildDescription. والوسائط المدمجة تعود
   كتلتَها الأصلية من نصّ المنشور بمرجعها في بيسكامب (sgid)؛ وذِكرُ شخصٍ لا
   مقابل له في المحرر فيُحذف؛ ومرفقٌ أُضيف في بيسكامب لا يُنزَّل — يبقى اسمه
   سطراً كما يكتب buildDescription ما تعذّر رفعه. والتسطير يضيع: بيسكامب لا
   يعرفه فيُحذف عند الإرسال، فلا يعود. */
export async function cardContentToBody(env: Env, content: string, currentBody: string): Promise<string> {
  const originals = new Map(scanMediaEmbeds(currentBody || '').blocks.map((b) => [b.id, b.raw]));
  const kept: string[] = [];
  const re = /<bc-attachment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi;
  let out = '';
  let last = 0;
  for (const m of (content || '').matchAll(re)) {
    out += content.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    const attrs = m[1] || '';
    const attr = (name: string) => (attrs.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '';
    if (/mention/i.test(attr('content-type'))) continue;
    const sgid = attr('sgid');
    const media = sgid
      ? await env.DB.prepare('SELECT id FROM media_assets WHERE basecamp_sgid = ?').bind(sgid).first<{ id: string }>()
      : null;
    const raw = media ? originals.get(media.id) : undefined;
    if (raw) {
      out += `@@KEEP_${kept.length}@@`;
      kept.push(raw);
    } else {
      const name = attr('caption') || attr('filename');
      if (name) out += `<div>مرفق: ${name}</div>`;
    }
  }
  out += (content || '').slice(last);
  let html = out
    .replace(/<div(\s[^>]*)?>/gi, '<p>').replace(/<\/div>/gi, '</p>')
    .replace(/<h1(\s[^>]*)?>/gi, '<h2>').replace(/<\/h1>/gi, '</h2>');
  kept.forEach((raw, i) => {
    const token = `@@KEEP_${i}@@`;
    // الكتلة في سطرها وحدها: لا تُلفّ بفقرة
    html = html.replace(new RegExp(`<p>\\s*${token}\\s*</p>`), token).replace(token, raw);
  });
  return normalizeBody(html);
}

// إعادة مزامنة شاملة: تنظّف الربط القديم (بما فيه بطاقات/مهام سابقة) وتُعيد إنشاء البطاقات.
export async function resyncAll(env: Env): Promise<void> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return;
  const olds = (await env.DB.prepare('SELECT todo_id FROM basecamp_tasks').all<{ todo_id: string }>()).results;
  for (const o of olds) { if (o.todo_id) try { await trashRecording(env, projectId, o.todo_id); } catch { /* */ } }
  await env.DB.prepare('DELETE FROM basecamp_tasks').run();
  const posts = (await env.DB.prepare(
    "SELECT id FROM content_posts WHERE status != 'archived' ORDER BY created_at ASC LIMIT 300",
  ).all<{ id: string }>()).results;
  for (const p of posts) await syncPostSafe(env, p.id, { announce: false });
}

/* البطاقات اليتيمة: بطاقةٌ في جدول البطاقات لا يربطها النظام بمنشور، فلا تتحرك
   مع مراحله أبداً — وأكثرها نسخةٌ ثانية لمنشورٍ أنشأتها مزامنتان معاً.
   قراءةٌ فقط: يُعرض ما وُجد ليُقرَّر فيه، ولا يُحذف شيء. */
export type OrphanCard = { id: string; title: string; column: string; url: string; created_at: string; post_id: string | null };
export async function findOrphanCards(env: Env): Promise<OrphanCard[]> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return [];
  const tracked = new Set(
    (await env.DB.prepare('SELECT todo_id FROM basecamp_tasks WHERE todo_id IS NOT NULL').all<{ todo_id: string }>())
      .results.map((r) => String(r.todo_id)),
  );
  const cardTableId = await getCardTableId(env, projectId);
  const cols = await getColumns(env, projectId, cardTableId);
  const out: OrphanCard[] = [];
  for (const col of cols) {
    for (const card of await listCards(env, projectId, col.id)) {
      if (tracked.has(card.id)) continue;
      // المنشور الذي تبدو نسخةً منه: بعنوانه نفسه، وله بطاقةٌ أخرى مربوطة
      const twin = await env.DB.prepare(
        `SELECT p.id FROM content_posts p JOIN basecamp_tasks t ON t.post_id = p.id
         WHERE p.title = ? AND t.todo_id IS NOT NULL LIMIT 1`,
      ).bind(card.title).first<{ id: string }>();
      out.push({ id: card.id, title: card.title, column: col.title, url: card.app_url, created_at: card.created_at, post_id: twin?.id ?? null });
    }
  }
  return out;
}

/* نقلُ البطاقات اليتيمة إلى سلّة بيسكامب — بمعرّفاتٍ يسمّيها المدير من التقرير،
   لا بقرارٍ من النظام. ويُعاد التحقق من كلٍّ منها: ما ليس يتيماً الآن، أو لا
   منشور له بعنوانه نفسه وبطاقةٌ مربوطة (فليس نسخةً مكرّرة)، يُترك. والسلّة
   تُسترجع منها البطاقة ثلاثين يوماً. */
export async function trashOrphanCards(env: Env, ids: string[]): Promise<{ trashed: string[]; skipped: string[] }> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return { trashed: [], skipped: ids };
  const orphans = new Map((await findOrphanCards(env)).map((o) => [o.id, o]));
  const trashed: string[] = [];
  const skipped: string[] = [];
  for (const id of [...new Set(ids.map(String))]) {
    const o = orphans.get(id);
    if (!o || !o.post_id) { skipped.push(id); continue; }
    await trashRecording(env, projectId, id);
    trashed.push(id);
  }
  return { trashed, skipped };
}

export async function trashPostTask(env: Env, postId: string): Promise<void> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return;
  const map = await env.DB.prepare('SELECT todo_id FROM basecamp_tasks WHERE post_id = ?')
    .bind(postId).first<{ todo_id: string }>();
  if (map?.todo_id) {
    try { await trashRecording(env, projectId, map.todo_id); } catch { /* */ }
  }
  await env.DB.prepare('DELETE FROM basecamp_tasks WHERE post_id = ?').bind(postId).run();
}

// إشعار كاتب المحتوى والمراجعين عند وصول تعليق جديد من بيسكامب
async function notifyPostComment(env: Env, postId: string, author: string, body: string): Promise<void> {
  const post = await env.DB.prepare('SELECT title, author_id FROM content_posts WHERE id = ?')
    .bind(postId)
    .first<{ title: string; author_id: string }>();
  if (!post) return;
  const reviewers = await usersWithPermission(env, 'content.review');
  const ids = Array.from(new Set([post.author_id, ...reviewers].filter(Boolean)));
  const excerpt = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  await notifyUsers(env, ids, {
    type: 'basecamp_comment',
    title: 'تعليق جديد من بيسكامب',
    body: `${author} علّق على «${post.title}»: ${excerpt}`,
    link: `/editor/${postId}`,
  });
}

// يزامن تعليقات بطاقة واحدة → ملاحظات على المنشور (بدون تكرار)، ويُشعر عند كل تعليق جديد فعلياً.
// يُرجِع عدد التعليقات الجديدة المُضافة.
async function syncCommentsForCard(env: Env, projectId: string, postId: string, cardId: string): Promise<number> {
  let comments;
  try {
    comments = await getComments(env, projectId, cardId);
  } catch {
    return 0;
  }
  let added = 0;
  const own = new Set(
    (await env.DB.prepare('SELECT comment_id FROM basecamp_own_comments WHERE post_id = ?').bind(postId).all<{ comment_id: string }>())
      .results.map((r) => String(r.comment_id)),
  );
  for (const cm of comments) {
    if (!cm.content || own.has(String(cm.id))) continue;
    const res = await env.DB.prepare(
      `INSERT INTO post_notes (id, post_id, source, external_id, author_name, body, created_at)
       VALUES (?, ?, 'basecamp', ?, ?, ?, ?)
       ON CONFLICT(source, external_id) DO NOTHING`,
    )
      .bind(newId('note'), postId, String(cm.id), cm.creator_name, cm.content, cm.created_at || new Date().toISOString())
      .run();
    // changes > 0 يعني أنه أُدرج فعلاً (تعليق جديد وليس مكرراً) → أرسل إشعاراً
    if ((res.meta?.changes ?? 0) > 0) {
      added++;
      try { await notifyPostComment(env, postId, cm.creator_name, cm.content); } catch { /* لا تعطّل المزامنة */ }
    }
  }
  return added;
}

// ربط عكسي: يجلب تعليقات كل بطاقة مرتبطة بمحتوى (مزامنة دورية شاملة)
export async function syncCardComments(env: Env): Promise<void> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return;
  const tasks = (await env.DB.prepare('SELECT post_id, todo_id FROM basecamp_tasks WHERE todo_id IS NOT NULL').all<{ post_id: string; todo_id: string }>()).results;
  for (const t of tasks) {
    await syncCommentsForCard(env, projectId, t.post_id, t.todo_id);
  }
}
export async function syncCardCommentsSafe(env: Env): Promise<void> {
  try {
    if (await isConfigured(env)) {
      // ما جرى في بيسكامب أولاً: التصحيح الدوري بعده يقرأ المراحل وقد استقرت
      try { await pullCardChanges(env); } catch { /* لا يعطّل ما بعده */ }
      await reconcileStages(env);
      await syncCardComments(env);
    }
  } catch { /* */ }
}

// مزامنة يدوية فورية لتعليقات منشور واحد — تُرجِع عدد التعليقات الجديدة (0 إن لم تكن مرتبطة ببطاقة).
export async function syncCardCommentsForPost(env: Env, postId: string): Promise<number> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return 0;
  const task = await env.DB.prepare('SELECT todo_id FROM basecamp_tasks WHERE post_id = ? AND todo_id IS NOT NULL')
    .bind(postId)
    .first<{ todo_id: string }>();
  if (!task) return 0;
  return syncCommentsForCard(env, projectId, postId, task.todo_id);
}

// غلاف آمن للتشغيل في الخلفية (لا يعطّل عملية المستخدم مهما حدث)
export async function syncPostSafe(env: Env, postId: string, opts: SyncOpts = {}): Promise<void> {
  try {
    if (await isConfigured(env)) await syncPost(env, postId, opts);
  } catch { /* تُتجاهل أخطاء المزامنة */ }
}
export async function trashPostTaskSafe(env: Env, postId: string): Promise<void> {
  try {
    if (await isConfigured(env)) await trashPostTask(env, postId);
  } catch { /* */ }
}

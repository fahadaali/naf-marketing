import type { Env } from '../types';
import { newId } from '../util';
import {
  isConfigured, setting, getMgmtProjectId, getCardTableId, getColumns, createColumn,
  getProjectPeopleIds, createCard, updateCard, moveCard, trashRecording, createAttachment, getComments, listCards,
} from './basecamp';
import { notifyUsers, usersWithPermission } from './notify';
import { isIdeaRow } from './planning';

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
function scanMediaEmbeds(html: string): { text: string; blocks: { id: string; name: string; token: string }[] } {
  let out = '';
  let i = 0;
  const blocks: { id: string; name: string; token: string }[] = [];
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
    blocks.push({ id, name, token });
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
export async function syncPost(env: Env, postId: string): Promise<void> {
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
      await createTrackedCard(env, projectId, post);
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
  }
  // حدّث محتوى البطاقة وتاريخها ومسؤوليها
  await updateCard(env, projectId, map.todo_id, input);
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
async function createTrackedCard(env: Env, projectId: string, post: SyncRow): Promise<void> {
  const columnId = await ensureStageColumn(env, projectId, post.status);
  const input = await cardInput(env, projectId, post);
  const cardId = await createCard(env, projectId, columnId, input);
  await env.DB.prepare(
    "UPDATE basecamp_tasks SET todo_id = ?, list_id = ?, stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?",
  ).bind(cardId, columnId, post.status, post.id).run();

  const now = await env.DB.prepare('SELECT id, title, body, status, planned_on, updated_at FROM content_posts WHERE id = ?')
    .bind(post.id).first<SyncRow>();
  if (!now || !STAGE_LIST[now.status]) return;
  if (now.status !== post.status) {
    const col = await ensureStageColumn(env, projectId, now.status);
    await moveCard(env, projectId, cardId, col);
    await env.DB.prepare(
      "UPDATE basecamp_tasks SET list_id = ?, stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = ?",
    ).bind(col, now.status, post.id).run();
  }
  if (now.updated_at !== post.updated_at || now.title !== post.title || now.body !== post.body) {
    await updateCard(env, projectId, cardId, await cardInput(env, projectId, now));
  }
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
  for (const p of posts) await syncPostSafe(env, p.id);
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
  for (const cm of comments) {
    if (!cm.content) continue;
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
export async function syncPostSafe(env: Env, postId: string): Promise<void> {
  try {
    if (await isConfigured(env)) await syncPost(env, postId);
  } catch { /* تُتجاهل أخطاء المزامنة */ }
}
export async function trashPostTaskSafe(env: Env, postId: string): Promise<void> {
  try {
    if (await isConfigured(env)) await trashPostTask(env, postId);
  } catch { /* */ }
}

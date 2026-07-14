import type { Env } from '../types';
import {
  isConfigured, setting, getMgmtProjectId, getCardTableId, getColumns, createColumn,
  getProjectPeopleIds, createCard, updateCard, moveCard, trashRecording, createAttachment,
} from './basecamp';

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
    else replacement = `<div>📎 وسيط مرفق: ${b.name || ''}</div>`;
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

  const post = await env.DB.prepare('SELECT id, title, body, status FROM content_posts WHERE id = ?')
    .bind(postId).first<{ id: string; title: string; body: string; status: string }>();
  if (!post || !STAGE_LIST[post.status]) return;

  const columnId = await ensureStageColumn(env, projectId, post.status);
  const content = await buildDescription(env, post.body);
  const due_on = await computeDue(env, postId);
  const assignee_ids = await getProjectPeopleIds(env, projectId);
  const input = { title: post.title || 'منشور بدون عنوان', content, due_on, assignee_ids };

  // (نعيد استخدام أعمدة الجدول: todo_id = معرّف البطاقة، list_id = معرّف العمود)
  const map = await env.DB.prepare('SELECT todo_id, stage FROM basecamp_tasks WHERE post_id = ?')
    .bind(postId).first<{ todo_id: string; stage: string }>();

  if (!map) {
    const cardId = await createCard(env, projectId, columnId, input);
    await env.DB.prepare(
      "INSERT INTO basecamp_tasks (post_id, todo_id, list_id, stage, updated_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
    ).bind(postId, cardId, columnId, post.status).run();
    return;
  }

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

// إعادة مزامنة شاملة: تنظّف الربط القديم (بما فيه بطاقات/مهام سابقة) وتُعيد إنشاء البطاقات.
export async function resyncAll(env: Env): Promise<void> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return;
  const olds = (await env.DB.prepare('SELECT todo_id FROM basecamp_tasks').all<{ todo_id: string }>()).results;
  for (const o of olds) { try { await trashRecording(env, projectId, o.todo_id); } catch { /* */ } }
  await env.DB.prepare('DELETE FROM basecamp_tasks').run();
  const posts = (await env.DB.prepare(
    "SELECT id FROM content_posts WHERE status != 'archived' ORDER BY created_at ASC LIMIT 300",
  ).all<{ id: string }>()).results;
  for (const p of posts) await syncPostSafe(env, p.id);
}

export async function trashPostTask(env: Env, postId: string): Promise<void> {
  const projectId = await getMgmtProjectId(env);
  if (!projectId) return;
  const map = await env.DB.prepare('SELECT todo_id FROM basecamp_tasks WHERE post_id = ?')
    .bind(postId).first<{ todo_id: string }>();
  if (map?.todo_id) {
    try { await trashRecording(env, projectId, map.todo_id); } catch { /* */ }
    await env.DB.prepare('DELETE FROM basecamp_tasks WHERE post_id = ?').bind(postId).run();
  }
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

import type { Env } from '../types';
import { newId } from '../util';

// يأخذ لقطة من الحالة الحالية للمنشور قبل تعديله — يبني سجل نسخ رجعي.
export async function snapshotVersion(env: Env, postId: string, editedBy: string): Promise<void> {
  const post = await env.DB.prepare('SELECT title, body, content_type FROM content_posts WHERE id = ?')
    .bind(postId)
    .first<{ title: string; body: string; content_type: string }>();
  if (!post) return;
  await env.DB.prepare(
    'INSERT INTO content_versions (id, post_id, title, body, content_type, edited_by) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(newId('ver'), postId, post.title, post.body, post.content_type, editedBy)
    .run();
}

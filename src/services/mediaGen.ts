import type { Env } from '../types';
import { newId } from '../util';
import { getImageProvider } from '../adapters/imageGen';
import { getVideoProvider } from '../adapters/videoGen';

// توليد صورة فوراً (متزامن): يستدعي المزوّد، يخزّن الناتج في R2 وجدول media_assets، ويعيد بيانات الوسيط.
export async function generateImageAsset(
  env: Env,
  prompt: string,
  userId: string,
): Promise<{ id: string; url: string; filename: string; mime_type: string }> {
  const provider = await getImageProvider(env);
  const { bytes, mimeType } = await provider.generate(prompt);

  const id = newId('media');
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const key = `${id}.${ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mimeType } });

  const filename = `صورة-${prompt.slice(0, 24).trim() || 'مولّدة'}.${ext}`;
  await env.DB.prepare(
    'INSERT INTO media_assets (id, r2_key, mime_type, size, uploaded_by, filename) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, key, mimeType, bytes.length, userId, filename)
    .run();

  return { id, url: `/api/media/${id}`, filename, mime_type: mimeType };
}

// بدء مهمة توليد فيديو (غير متزامنة)
export async function startVideoJob(env: Env, prompt: string, userId: string): Promise<string> {
  const providerRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'video_provider'").first<{ value: string }>();
  const providerName = providerRow?.value || 'mock';
  const provider = await getVideoProvider(env);
  const jobId = newId('vjob');

  try {
    const { externalJobId } = await provider.start(prompt);
    await env.DB.prepare(
      `INSERT INTO media_gen_jobs (id, kind, provider, prompt, status, external_job_id, requested_by)
       VALUES (?, 'video', ?, ?, 'processing', ?, ?)`,
    )
      .bind(jobId, providerName, prompt, externalJobId, userId)
      .run();
  } catch (e: any) {
    await env.DB.prepare(
      `INSERT INTO media_gen_jobs (id, kind, provider, prompt, status, error, requested_by)
       VALUES (?, 'video', ?, ?, 'failed', ?, ?)`,
    )
      .bind(jobId, providerName, prompt, String(e?.message || e), userId)
      .run();
  }
  return jobId;
}

// استقصاء حالة مهمة الفيديو؛ عند الاكتمال يُنزَّل الفيديو ويُخزَّن في R2/media_assets
export async function pollVideoJob(env: Env, jobId: string): Promise<any> {
  const job = await env.DB.prepare('SELECT * FROM media_gen_jobs WHERE id = ?').bind(jobId).first<any>();
  if (!job) return null;
  if (job.status !== 'processing' || !job.external_job_id) return job;

  const provider = await getVideoProvider(env);
  const result = await provider.check(job.external_job_id);

  if (result.status === 'processing') return job;

  if (result.status === 'failed') {
    await env.DB.prepare("UPDATE media_gen_jobs SET status = 'failed', error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
      .bind(result.error || 'فشل التوليد', jobId)
      .run();
    return env.DB.prepare('SELECT * FROM media_gen_jobs WHERE id = ?').bind(jobId).first<any>();
  }

  // اكتمل: نزّل الفيديو وخزّنه
  try {
    if (!result.url) throw new Error('لم يُعِد المزوّد رابط الفيديو');
    const res = await fetch(result.url);
    if (!res.ok) throw new Error(`فشل تنزيل الفيديو (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mediaId = newId('media');
    const key = `${mediaId}.mp4`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'video/mp4' } });
    const filename = `فيديو-${(job.prompt || '').slice(0, 24).trim() || 'مولّد'}.mp4`;
    await env.DB.prepare(
      'INSERT INTO media_assets (id, r2_key, mime_type, size, uploaded_by, filename) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(mediaId, key, 'video/mp4', bytes.length, job.requested_by, filename)
      .run();
    await env.DB.prepare(
      "UPDATE media_gen_jobs SET status = 'completed', media_asset_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
    )
      .bind(mediaId, jobId)
      .run();
  } catch (e: any) {
    await env.DB.prepare("UPDATE media_gen_jobs SET status = 'failed', error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
      .bind(String(e?.message || e), jobId)
      .run();
  }
  return env.DB.prepare('SELECT * FROM media_gen_jobs WHERE id = ?').bind(jobId).first<any>();
}

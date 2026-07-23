import type { Env } from '../types';
import { getProvider } from '../adapters';
import { listSentPostMetrics } from '../adapters/buffer';
import { newId } from '../util';

type MetricRow = {
  providerPostId: string;
  platform: string;
  title: string | null;
  postId: string | null;
  viaPlatform: number;
  reach: number;
  impressions: number;
  engagement: number;
  sentAt: string | null;
};

// upsert لقطة مقاييس واحدة لكل منشور (مفتاح: provider_post_id)
async function upsertMetric(env: Env, row: MetricRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO analytics_snapshots
       (id, provider_post_id, platform, title, post_id, via_platform, reach, impressions, engagement, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_post_id) DO UPDATE SET
       platform = excluded.platform, title = excluded.title, post_id = excluded.post_id,
       via_platform = excluded.via_platform, reach = excluded.reach, impressions = excluded.impressions,
       engagement = excluded.engagement, sent_at = excluded.sent_at,
       captured_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  )
    .bind(
      newId('an'), row.providerPostId, row.platform, row.title, row.postId, row.viaPlatform,
      row.reach, row.impressions, row.engagement, row.sentAt,
    )
    .run();
}

// سحب التحليلات دورياً — يختار المسار حسب المزوّد.
export async function pullAnalytics(env: Env): Promise<number> {
  const providerName = (
    await env.DB.prepare("SELECT value FROM settings WHERE key = 'provider_name'").first<{ value: string }>()
  )?.value?.toLowerCase() || (env.PROVIDER_NAME || 'mock').toLowerCase();

  if (providerName === 'buffer') return pullAllBuffer(env);
  return pullViaSchedules(env);
}

// مزوّدون يعتمدون getAnalytics لكل منشور نُشر عبر المنصة (Mock/Ayrshare)
async function pullViaSchedules(env: Env): Promise<number> {
  const provider = await getProvider(env);
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.post_id, s.platform, s.provider_post_id, s.published_at, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.status = 'published' AND s.provider_post_id IS NOT NULL`,
  ).all<{ post_id: string; platform: string; provider_post_id: string; published_at: string | null; title: string }>();

  let captured = 0;
  for (const row of results) {
    try {
      const a = await provider.getAnalytics(row.provider_post_id);
      await upsertMetric(env, {
        providerPostId: row.provider_post_id,
        platform: row.platform,
        title: row.title,
        postId: row.post_id,
        viaPlatform: 1,
        reach: a.reach,
        impressions: a.impressions,
        engagement: a.engagement,
        sentAt: row.published_at,
      });
      captured++;
    } catch {
      continue;
    }
  }
  return captured;
}

// Buffer: يسحب مقاييس كل المنشورات المُرسَلة في المؤسسة (لا فقط ما نُشر عبر المنصة)
async function pullAllBuffer(env: Env): Promise<number> {
  const token = (env.PROVIDER_API_KEY || '').trim();
  if (!token) return 0;

  // خريطة عكسية: معرّف قناة Buffer → مفتاح منصة المنصة
  const bpRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'buffer_profiles'").first<{ value: string }>();
  const channelToPlatform: Record<string, string> = {};
  try {
    const map = bpRow?.value ? JSON.parse(bpRow.value) : {};
    for (const [platform, channelId] of Object.entries(map)) {
      if (channelId) channelToPlatform[String(channelId)] = platform;
    }
  } catch { /* خريطة فارغة */ }

  // ما نُشر عبر المنصة: provider_post_id → {post_id, title}
  const schedMap = new Map<string, { postId: string; title: string }>();
  const sched = await env.DB.prepare(
    `SELECT s.provider_post_id, s.post_id, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.provider_post_id IS NOT NULL`,
  ).all<{ provider_post_id: string; post_id: string; title: string }>();
  for (const r of sched.results) schedMap.set(r.provider_post_id, { postId: r.post_id, title: r.title });

  const posts = await listSentPostMetrics(token);
  let captured = 0;
  for (const post of posts) {
    const via = schedMap.get(post.id);
    await upsertMetric(env, {
      providerPostId: post.id,
      platform: channelToPlatform[post.channelId] || post.service || 'unknown',
      title: via?.title || post.title || null,
      postId: via?.postId || null,
      viaPlatform: via ? 1 : 0,
      reach: post.reach,
      impressions: post.impressions,
      engagement: post.engagement,
      sentAt: post.sentAt,
    });
    captured++;
  }
  return captured;
}

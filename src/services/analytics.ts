import type { Env } from '../types';
import { getProvider } from '../adapters';
import { newId } from '../util';

// سحب التحليلات دورياً لكل منشور منشور، وتخزين لقطة في analytics_snapshots.
export async function pullAnalytics(env: Env): Promise<number> {
  const provider = await getProvider(env);
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.post_id, s.platform, s.provider_post_id
     FROM schedules s
     WHERE s.status = 'published' AND s.provider_post_id IS NOT NULL`,
  ).all<{ post_id: string; platform: string; provider_post_id: string }>();

  let captured = 0;
  for (const row of results) {
    try {
      const a = await provider.getAnalytics(row.provider_post_id);
      await env.DB.prepare(
        `INSERT INTO analytics_snapshots (id, platform, post_id, reach, impressions, engagement)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(newId('an'), row.platform, row.post_id, a.reach, a.impressions, a.engagement)
        .run();
      captured++;
    } catch {
      continue;
    }
  }
  return captured;
}

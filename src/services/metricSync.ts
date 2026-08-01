/* ============================================================
   سحب المصادر الخارجية وكتابة نقاطها في `metric_values`.

   ومصدرٌ يفشل لا يُسقط البقيّة: كل واحد يُحاط بمحاولةٍ وحده، وتُسجَّل حالتُه
   في `integrations` بسببها ووقتها. فلوحةٌ فيها سبعة مصادر لا تصير فارغةً
   لأن واحداً انتهت صلاحية مفتاحه.
   ============================================================ */

import type { Env } from '../types';
import { SOURCES, type MetricPoint } from '../adapters/sources';
import { upsertValue } from './metrics';
import { nowIso } from '../util';
import type { Period } from './period';

export type SourceSyncResult = { key: string; ok: boolean; points: number; error?: string };

type IntegrationRow = { key: string; is_enabled: number; config_json: string };

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function markSync(env: Env, key: string, ok: boolean, error?: string): Promise<void> {
  const at = nowIso();
  await env.DB.prepare(
    `UPDATE integrations
     SET last_sync_at = ?, last_sync_status = ?, last_error = ?,
         last_ok_at = CASE WHEN ? = 1 THEN ? ELSE last_ok_at END,
         updated_at = ?
     WHERE key = ?`,
  )
    .bind(at, ok ? 'ok' : 'sync_failed', ok ? null : (error ?? 'سبب غير معروف'), ok ? 1 : 0, at, at, key)
    .run();
}

/**
 * يكتب نقاط مصدرٍ واحد.
 *
 * والمفتاح غير المسجَّل يُطرح صامتاً: مصدرٌ يرسل مؤشراً لا نعرفه لا يُسقط
 * السحب كلَّه، ولا يُنشئ تعريفاً من نفسه — التعريف يمرّ من السجلّ أوّلاً.
 */
async function writePoints(env: Env, p: Period, key: string, points: MetricPoint[]): Promise<number> {
  if (!points.length) return 0;

  const { results: known } = await env.DB.prepare('SELECT key FROM metric_definitions').all<{ key: string }>();
  const valid = new Set(known.map((r) => r.key));

  let written = 0;
  for (const pt of points) {
    if (!valid.has(pt.metricKey)) continue;
    await upsertValue(env, p, {
      metricKey: pt.metricKey,
      dimKey: pt.dimKey ?? '',
      dimValue: pt.dimValue ?? '',
      value: pt.value,
      sample: pt.sample ?? null,
      source: 'integration',
      integrationKey: key,
    });
    written++;
  }
  return written;
}

/** يسحب مصدراً بعينه — يرمي خطأه للمنادي بعد تسجيل الحالة. */
export async function syncSource(env: Env, key: string, p: Period): Promise<number> {
  const source = SOURCES[key];
  if (!source) throw new Error(`مصدر غير معروف: ${key}`);

  const row = await env.DB.prepare('SELECT key, is_enabled, config_json FROM integrations WHERE key = ?')
    .bind(key)
    .first<IntegrationRow>();
  if (!row) throw new Error(`مصدر غير مسجَّل: ${key}`);
  if (!row.is_enabled) throw new Error('المصدر غير مربوط. اربطه من التكاملات أوّلاً.');

  try {
    const points = await source.fetch(env, parseConfig(row.config_json), { start: p.start, end: p.end });
    const written = await writePoints(env, p, key, points);
    await markSync(env, key, true);
    return written;
  } catch (err) {
    const message = String((err as Error)?.message || err);
    await markSync(env, key, false, message);
    throw err;
  }
}

/** يسحب كل مصدر مربوط — ويعيد نتيجةَ كلٍّ منها ناجحاً كان أو فاشلاً. */
export async function syncAllSources(env: Env, p: Period): Promise<SourceSyncResult[]> {
  const { results } = await env.DB.prepare(
    'SELECT key, is_enabled, config_json FROM integrations WHERE is_enabled = 1',
  ).all<IntegrationRow>();

  const out: SourceSyncResult[] = [];
  for (const row of results) {
    if (!SOURCES[row.key]) continue; // منصة إدارة الشركة مسارها الخاص
    try {
      const points = await syncSource(env, row.key, p);
      out.push({ key: row.key, ok: true, points });
    } catch (err) {
      out.push({ key: row.key, ok: false, points: 0, error: String((err as Error)?.message || err) });
    }
  }
  return out;
}

export { markSync };

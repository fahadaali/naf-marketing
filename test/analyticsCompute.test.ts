// الاحتساب من لقطات المنشورات، ومطابقة منشور السجلّ على لقطةٍ قائمة — على
// قاعدةٍ حقيقية. وسحبُ Ayrshare نفسه في `ayrshareAnalytics.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { matchSnapshot } from '../src/services/analytics';
import { computeAuto } from '../src/services/metrics';
import { periodOf } from '../src/services/period';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...binds);
      return { meta: { changes: r.changes } };
    },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: any[]) => stmts.map((s) => ({ meta: { changes: db.prepare(s.sql).run(...s.binds).changes } })),
  };
}

function build(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return db;
}

let db: any;
let env: any;

const RECENT = new Date(Date.now() - 3 * 86_400_000).toISOString();
const PERIOD = periodOf('monthly', RECENT);

beforeEach(() => {
  db = build();
  env = { DB: d1(db) };
});

function metric(key: string): number | undefined {
  const row = db.prepare(
    "SELECT value FROM metric_values WHERE metric_key = ? AND period = 'monthly' AND period_start = ? AND dim_value = ''",
  ).get(key, PERIOD.start) as { value: number } | undefined;
  return row?.value;
}

describe('مطابقة منشور السجلّ على لقطةٍ قائمة', () => {
  it('يطابق بوقت النشر وأوّل العنوان حين يختلف المعرّف والرابط', () => {
    const cands = [{ provider_post_id: 'a', platform: 'tiktok', title: 'نصيحة قانونية', sent_at: '2026-09-01T10:00:00Z', external_url: null } as any];
    const h = { id: 'b', platform: 'tiktok', accountId: 'x', title: 'نصيحة قانونية', sentAt: '2026-09-01T10:04:00Z', externalUrl: null, metrics: {} as any };
    expect(matchSnapshot(h, 'tiktok', cands)?.provider_post_id).toBe('a');
    expect(matchSnapshot({ ...h, sentAt: '2026-09-01T11:00:00Z' }, 'tiktok', cands)).toBeNull();
  });

  it('يطابق رابطين بصيغتين لمنشورٍ واحد بالمعرّف الذي يحملانه', () => {
    const cands = [{ provider_post_id: '5f8d0d55b54764421b7156c9', platform: 'youtube', title: 'قديم', sent_at: '2025-11-23T14:01:36Z', external_url: 'https://youtu.be/dQw4w9WgXcQ' } as any];
    const h = { id: 'dQw4w9WgXcQ', platform: 'youtube', accountId: 'y', title: 'عنوانٌ آخر', sentAt: '2025-11-24T09:00:00Z', externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', metrics: {} as any };
    expect(matchSnapshot(h, 'youtube', cands)?.provider_post_id).toBe('5f8d0d55b54764421b7156c9');
    // وبلا رابطٍ في السجلّ: معرّفه نفسه هو معرّف الفيديو
    expect(matchSnapshot({ ...h, externalUrl: null }, 'youtube', cands)?.provider_post_id).toBe('5f8d0d55b54764421b7156c9');
    expect(matchSnapshot({ ...h, id: 'aaaaaaaaaaa', externalUrl: 'https://youtu.be/aaaaaaaaaaa' }, 'youtube', cands)).toBeNull();
  });
});

describe('الاحتساب بعد السحب', () => {
  it('لا يكتب الوصول صفراً حين لم يُعلنه أيُّ منشور، ويرفع الصفر القديم', async () => {
    // صفرٌ قديم كُتب يوم كانت الأرقام تُقرأ أصفاراً
    db.prepare(
      `INSERT INTO metric_values (id, metric_key, period, period_start, period_end, value, source)
       VALUES ('mv0', 'reach', 'monthly', ?, ?, 0, 'auto')`,
    ).run(PERIOD.start, PERIOD.end);
    db.prepare(
      `INSERT INTO analytics_snapshots (id, provider_post_id, platform, reach, impressions, engagement, sent_at, metrics_json, via_platform)
       VALUES ('a1', 'p1', 'linkedin', NULL, 1000, 40, ?, '[{"type":"likes","value":40}]', 0)`,
    ).run(RECENT);

    await computeAuto(env, PERIOD);
    expect(metric('reach')).toBeUndefined();
    expect(metric('impressions')).toBe(1000);
    expect(metric('engagement')).toBe(40);
    // لا نسبةَ إلى وصولٍ لم يُعلَن
    expect(metric('engagement_rate_reach')).toBeUndefined();
  });

  it('لا يُدخل النشرة البريدية في وصول منصّات التواصل', async () => {
    db.prepare(
      `INSERT INTO analytics_snapshots (id, provider_post_id, platform, reach, impressions, engagement, sent_at, metrics_json, via_platform, source)
       VALUES ('n1', 'nl:1', 'email', 5000, 2000, 300, ?, '[{"type":"clicks","value":300}]', 1, 'newsletter'),
              ('a1', 'p1', 'linkedin', 700, 1500, 60, ?, '[{"type":"likes","value":60}]', 0, 'posts')`,
    ).run(RECENT, RECENT);

    await computeAuto(env, PERIOD);
    expect(metric('reach')).toBe(700);
    expect(metric('ctr')).toBeUndefined();
  });

  it('لا يمسّ ما سُجّل باليد', async () => {
    db.prepare(
      `INSERT INTO metric_values (id, metric_key, period, period_start, period_end, value, source)
       VALUES ('mv1', 'team_cost', 'monthly', ?, ?, 30000, 'manual')`,
    ).run(PERIOD.start, PERIOD.end);
    await computeAuto(env, PERIOD);
    expect(metric('team_cost')).toBe(30000);
  });
});

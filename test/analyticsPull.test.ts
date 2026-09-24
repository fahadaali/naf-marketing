// سحب لقطات المنشورات من SocialAPI على قاعدةٍ حقيقية ومزوّدٍ مخنوق.
//
// يُثبَّت هنا ما جعل التحليلات أصفاراً في الغالب: الأرقام الحيّة تُطلب،
// وما نُشر من خارج المنصة يُقرأ ولا يُعدّ مرّتين، والغياب لا يُكتب صفراً ولا
// يمحو رقماً، ولا تُحذف لقطةٌ لأنها خرجت من الصفحة.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { pullAnalytics, readAnalyticsReport, acceptStored, matchSnapshot } from '../src/services/analytics';
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
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'socialapi')").run();
  return db;
}

type Handler = (url: URL, method: string) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
let calls: string[] = [];

function route(method: string, path: string | RegExp, respond: (url: URL) => { status?: number; body: unknown }): void {
  handlers.unshift((url, m) => {
    if (m !== method) return undefined;
    const p = url.pathname.replace(/^\/v1/, '');
    return (typeof path === 'string' ? p === path : path.test(p)) ? respond(url) : undefined;
  });
}

let db: any;
let env: any;

// أوائل الشهر الجاري — داخل نافذة الأرقام الحيّة (خمسةٌ وأربعون يوماً)
const RECENT = new Date(Date.now() - 3 * 86_400_000).toISOString();
const PERIOD = periodOf('monthly', RECENT);

beforeEach(() => {
  db = build();
  env = { DB: d1(db), SOCIALAPI_API_KEY: 'sapi_key_test' };
  handlers = [];
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname.replace(/^\/v1/, '')}${url.search}`);
    for (const h of handlers) {
      const r = h(url, method);
      if (r) {
        const status = r.status ?? 200;
        return { ok: status < 400, status, text: async () => JSON.stringify(r.body) } as unknown as Response;
      }
    }
    return { ok: false, status: 404, text: async () => '{}' } as unknown as Response;
  });
  route('GET', '/accounts', () => ({ body: { data: [{ id: 'acc_li', platform: 'linkedin', name: 'NAF' }] } }));
  route('GET', /^\/accounts\/[^/]+\/posts$/, () => ({ body: { data: [] } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function snaps(): any[] {
  return db.prepare('SELECT * FROM analytics_snapshots ORDER BY provider_post_id').all();
}

function metric(key: string): number | undefined {
  const row = db.prepare(
    "SELECT value FROM metric_values WHERE metric_key = ? AND period = 'monthly' AND period_start = ? AND dim_value = ''",
  ).get(key, PERIOD.start) as { value: number } | undefined;
  return row?.value;
}

const publishedPost = (metrics: unknown) => ({
  id: 'sp_1',
  text: 'مقال عن نظام الشركات',
  targets: [{ platform: 'linkedin', account_id: 'acc_li', platform_post_id: 'urn:li:share:1', published_at: RECENT, metrics }],
});

describe('الأرقام الحيّة', () => {
  it('يطلب أرقام المنشور من المنصّة بدل أرقام لحظة نشره', async () => {
    route('GET', '/posts', () => ({ body: { data: [publishedPost({ likes: 0, comments: 0, shares: 0, saves: 0, metrics_synced_at: null })] } }));
    route('GET', '/posts/sp_1/metrics', () => ({
      body: { data: [{ platform: 'linkedin', account_id: 'acc_li', platform_post_id: 'urn:li:share:1',
        likes: 40, comments: 6, shares: 4, saves: 0, metrics_synced_at: '2026-09-20T08:00:00Z', extra: { impressionCount: 2400 } }] },
    }));

    await pullAnalytics(env);
    const [s] = snaps();
    expect(s.engagement).toBe(50);
    expect(s.impressions).toBe(2400);
    expect(s.provider_uuid).toBe('sp_1');
    expect(calls).toContain('GET /posts/sp_1/metrics');

    const report = await readAnalyticsReport(env);
    expect(report?.refreshed).toBe(1);
    expect(report?.ok).toBe(true);
  });

  it('لا يمحو رقماً صحيحاً بردٍّ فارغ', async () => {
    route('GET', '/posts', () => ({ body: { data: [publishedPost({})] } }));
    db.prepare(
      `INSERT INTO analytics_snapshots (id, provider_post_id, platform, reach, impressions, engagement, sent_at, metrics_json, metrics_at, via_platform)
       VALUES ('a1', 'urn:li:share:1', 'linkedin', 800, 2000, 90, ?, '[{"type":"likes","value":90}]', ?, 0)`,
    ).run(RECENT, new Date().toISOString());

    await pullAnalytics(env);
    const [s] = snaps();
    expect(s.reach).toBe(800);
    expect(s.engagement).toBe(90);
  });

  it('لا تنقص الأرقام المحفوظة ما قيس أحدثَ منها', () => {
    const existing = { metrics_at: '2026-09-20T00:00:00Z', reach: 500, impressions: 900, engagement: 60 } as any;
    expect(acceptStored(existing, { hasMetrics: true, metricsSyncedAt: null, reach: 300, impressions: 900, engagement: 60 })).toBe(false);
    expect(acceptStored(existing, { hasMetrics: true, metricsSyncedAt: null, reach: 520, impressions: 950, engagement: 61 })).toBe(true);
    expect(acceptStored(existing, { hasMetrics: true, metricsSyncedAt: '2026-09-21T00:00:00Z', reach: 1, impressions: 1, engagement: 1 })).toBe(true);
    expect(acceptStored(undefined, { hasMetrics: false, metricsSyncedAt: null, reach: null, impressions: null, engagement: null })).toBe(false);
  });
});

describe('لا تُحذف لقطةٌ خرجت من الصفحة', () => {
  it('يُبقي منشوراً قديماً لم يرد في الصفحات المقروءة', async () => {
    db.prepare(
      `INSERT INTO analytics_snapshots (id, provider_post_id, platform, reach, impressions, engagement, sent_at, metrics_json, metrics_at, via_platform, source)
       VALUES ('old', 'urn:li:share:old', 'linkedin', 100, 300, 20, '2026-01-10T10:00:00Z', '[]', '2026-01-11T00:00:00Z', 0, 'posts')`,
    ).run();
    route('GET', '/posts', () => ({ body: { data: [publishedPost({ likes: 3 })] } }));

    await pullAnalytics(env);
    expect(snaps().map((s) => s.provider_post_id)).toContain('urn:li:share:old');
  });

  it('يطوي الصفّ المؤقّت حين يُعرف معرّف المنشور على المنصة', async () => {
    db.prepare(
      `INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, via_platform, source)
       VALUES ('tmp', 'sp_1:linkedin', 'linkedin', ?, 0, 'posts')`,
    ).run(RECENT);
    route('GET', '/posts', () => ({ body: { data: [publishedPost({ likes: 3 })] } }));

    await pullAnalytics(env);
    expect(snaps().map((s) => s.provider_post_id)).toEqual(['urn:li:share:1']);
  });
});

describe('ما نُشر من خارج المنصة', () => {
  it('يقرأ سجلّ الحساب ويضيف ما لم يُنشر عبر المزوّد', async () => {
    route('GET', '/posts', () => ({ body: { data: [] } }));
    route('GET', '/accounts/acc_li/posts', () => ({
      body: { data: [{ id: 'urn:li:activity:77', text: 'تهنئة باليوم الوطني', timestamp: RECENT, like_count: 120, comments_count: 8, permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:77' }] },
    }));

    await pullAnalytics(env);
    const [s] = snaps();
    expect(s.provider_post_id).toBe('urn:li:activity:77');
    expect(s.engagement).toBe(128);
    expect(s.via_platform).toBe(0);
    expect(s.source).toBe('account');
    expect((await readAnalyticsReport(env))?.newNative).toBe(1);
  });

  it('لا يعدّ مرّتين منشوراً نُشر عبر المزوّد وظهر في السجلّ بمعرّفٍ آخر', async () => {
    route('GET', '/posts', () => ({ body: { data: [{ ...publishedPost({ likes: 5 }), targets: [{ ...publishedPost({ likes: 5 }).targets[0], permalink: 'https://www.linkedin.com/feed/update/urn:li:share:1' }] }] } }));
    route('GET', '/accounts/acc_li/posts', () => ({
      body: { data: [{ id: 'urn:li:activity:9', text: 'مقال عن نظام الشركات', timestamp: RECENT, like_count: 9, permalink: 'https://www.linkedin.com/feed/update/urn:li:share:1' }] },
    }));

    await pullAnalytics(env);
    const all = snaps();
    expect(all).toHaveLength(1);
    expect(all[0].provider_post_id).toBe('urn:li:share:1');
    expect(all[0].engagement).toBe(9);
  });

  it('يطابق بوقت النشر وأوّل العنوان حين يختلف المعرّف والرابط', () => {
    const cands = [{ provider_post_id: 'a', platform: 'tiktok', title: 'نصيحة قانونية', sent_at: '2026-09-01T10:00:00Z', external_url: null } as any];
    const h = { id: 'b', platform: 'tiktok', accountId: 'x', title: 'نصيحة قانونية', sentAt: '2026-09-01T10:04:00Z', externalUrl: null, metrics: {} as any };
    expect(matchSnapshot(h, 'tiktok', cands)?.provider_post_id).toBe('a');
    expect(matchSnapshot({ ...h, sentAt: '2026-09-01T11:00:00Z' }, 'tiktok', cands)).toBeNull();
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

describe('الميزانية', () => {
  it('يقف عند حدّه بلا خطأ، ويحفظ ما قرأ', async () => {
    route('GET', '/posts', () => ({
      body: { data: Array.from({ length: 5 }, (_, i) => ({ ...publishedPost({}), id: `sp_${i}`, targets: [{ ...publishedPost({}).targets[0], platform_post_id: `urn:li:share:${i}` }] })) },
    }));
    route('GET', /^\/posts\/sp_\d+\/metrics$/, () => ({ body: { data: [{ platform: 'linkedin', likes: 1, metrics_synced_at: '2026-09-20T08:00:00Z' }] } }));

    const n = await pullAnalytics(env, { budget: 5 });
    const report = await readAnalyticsReport(env);
    expect(n).toBe(5);
    expect(report?.ok).toBe(true);
    expect(report?.complete).toBe(false);
    expect(report?.calls).toBeLessThanOrEqual(5);
  });
});

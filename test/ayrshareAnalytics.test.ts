// سحب التحليلات والسجلّ من Ayrshare على قاعدةٍ حقيقية ومزوّدٍ مخنوق.
//
// الأشكال من صفحات التوثيق (Get post history for a social platform، وAnalytics
// on a Post بمعرّف المنصة، وAnalytics on a Social Network، وGet All Reviews).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { pullAnalytics, readAnalyticsReport, readAnalyticsHistoryReport } from '../src/services/analytics';
import { ayrshareMetrics, ayrshareMapped } from '../src/adapters/ayrshare';
import { SOURCES } from '../src/adapters/sources';
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
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'ayrshare')").run();
  db.prepare("INSERT INTO users (id, name, email, password_hash, role_name) VALUES ('u1', 'فهد', 'f@naf.sa', 'h', 'general_manager')").run();
  return db;
}

type Reply = { status?: number; body: unknown };
let routes: Record<string, (url: URL, body: any) => Reply>;
let calls: { key: string; url: URL; body: any }[];
let db: any;
let env: any;

const RECENT = new Date(Date.now() - 3 * 86_400_000).toISOString();

beforeEach(() => {
  db = build();
  env = { DB: d1(db), AYRSHARE_API_KEY: 'ayr_key', AYRSHARE_X_API_KEY: 'xk', AYRSHARE_X_API_SECRET: 'xs' };
  routes = {};
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${(init?.method || 'GET').toUpperCase()} ${url.pathname.replace(/^\/api/, '')}`;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ key, url, body });
    const r = routes[key]?.(url, body) ?? { status: 404, body: { status: 'error', code: 101, message: 'not found' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  routes['GET /user'] = () => ({
    body: {
      activeSocialAccounts: ['instagram', 'linkedin'],
      displayNames: [
        { id: 'ig1', platform: 'instagram', username: 'naf' },
        { id: 'li1', platform: 'linkedin', type: 'corporate', displayName: 'NAF' },
      ],
    },
  });
  routes['GET /history'] = () => ({ status: 400, body: { status: 'error', code: 221, message: 'History not found for the past 30 days.' } });
  routes['GET /history/instagram'] = () => ({ body: { status: 'success', posts: [] } });
  routes['GET /history/linkedin'] = () => ({ body: { status: 'success', posts: [] } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const snaps = (): any[] => db.prepare('SELECT * FROM analytics_snapshots ORDER BY provider_post_id').all();

describe('أرقام Ayrshare بأسمائنا', () => {
  it('فيسبوك: الظهور mediaView والوصول totalMediaViewUnique، والتفاعلات بلا إعجابٍ مكرّر', () => {
    const m = ayrshareMapped('facebook', { mediaView: 900, totalMediaViewUnique: 600, likeCount: 10, reactions: { like: 10, love: 2, total: 12 }, commentsCount: 3, sharesCount: 1 });
    expect(m).toMatchObject({ impressions: 900, reach: 600, engagement: 16, present: true });
  });

  it('إنستغرام: الوصول reachCount والحفظ savedCount، والظهور غائبٌ فيُؤخذ من المشاهدات', () => {
    const m = ayrshareMapped('instagram', { reachCount: 500, viewsCount: 800, likeCount: 40, commentsCount: 5, sharesCount: 2, savedCount: 3 });
    expect(m).toMatchObject({ reach: 500, impressions: 800, engagement: 50 });
  });

  it('إكس تحت publicMetrics، وتيك توك بنسبة إكمالٍ مئوية ومدّةٍ بالدقائق', () => {
    const x = ayrshareMapped('twitter', { publicMetrics: { impressionCount: 2000, likeCount: 30, replyCount: 4, retweetCount: 5, quoteCount: 1, bookmarkCount: 2 } });
    expect(x).toMatchObject({ impressions: 2000, engagement: 42 });
    const tt = ayrshareMetrics('tiktok', { videoViews: 1000, reach: 700, fullVideoWatchedRate: 0.25, totalTimeWatched: 1200 });
    expect(tt).toContainEqual({ type: 'completionrate', name: 'fullVideoWatchedRate', value: 25, unit: 'percentage' });
    expect(tt).toContainEqual({ type: 'totaltimewatched', name: 'totalTimeWatched', value: 20, unit: 'minutes' });
  });

  it('منشورٌ بلا أرقام — يوتيوب في السجلّ — لا يُعدّ مقيساً', () => {
    expect(ayrshareMapped('youtube', { id: 'v1', post: 'وصف', privacyStatus: 'public' }).present).toBe(false);
  });
});

describe('السحب من Ayrshare', () => {
  it('يربط وجهة المنشور بجدول النشر بمعرّفها، ويقرأ ما نُشر من خارج المنصة، ويطلب الأرقام الحيّة', async () => {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES ('p1', 'نظام الشركات', 'x', 'published', 'u1')").run();
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status, provider_post_id) VALUES ('s1', 'p1', 'instagram', ?, 'published', 'AYR_1')").run(RECENT);

    routes['GET /history'] = () => ({
      body: { history: [{ id: 'AYR_1', created: RECENT, post: 'نظام الشركات', postIds: [{ platform: 'instagram', id: 'ig_100', postUrl: 'https://www.instagram.com/p/A/', status: 'success' }] }] },
    });
    routes['GET /history/instagram'] = () => ({
      body: {
        status: 'success',
        posts: [
          { id: 'ig_100', post: 'نظام الشركات', created: RECENT, postUrl: 'https://www.instagram.com/p/A/', likeCount: 10, commentsCount: 1 },
          // نُشر من تطبيق إنستغرام مباشرةً
          { id: 'ig_200', post: 'منشور من التطبيق', created: RECENT, postUrl: 'https://www.instagram.com/p/B/', likeCount: 4, commentsCount: 0 },
        ],
      },
    });
    routes['POST /analytics/post'] = (_u, body) => ({
      body: {
        status: 'success',
        [body.platforms[0]]: body.postIds.map((id: string) => ({ id, analytics: { reachCount: id === 'ig_100' ? 900 : 120, likeCount: 12, commentsCount: 2, savedCount: 1 } })),
      },
    });

    await pullAnalytics(env);
    const [a, b] = snaps();
    expect(a).toMatchObject({ provider_post_id: 'ig_100', platform: 'instagram', post_id: 'p1', via_platform: 1, provider_uuid: 'AYR_1', reach: 900, engagement: 15 });
    expect(b).toMatchObject({ provider_post_id: 'ig_200', post_id: null, via_platform: 0, reach: 120 });

    const live = calls.find((c) => c.key === 'POST /analytics/post')!;
    expect(live.body).toMatchObject({ platforms: ['instagram'], searchPlatformId: true });
    expect(live.body.postIds.sort()).toEqual(['ig_100', 'ig_200']);

    const report = await readAnalyticsReport(env);
    expect(report).toMatchObject({ ok: true, provider: 'ayrshare', posts: 1, newNative: 1, refreshed: 2 });
  });

  it('لا يطلب أرقام منشورٍ طُلبت قبل ساعات', async () => {
    routes['GET /history/instagram'] = () => ({ body: { status: 'success', posts: [{ id: 'ig_1', post: 'x', created: RECENT, likeCount: 1 }] } });
    routes['POST /analytics/post'] = (_u, body) => ({ body: { instagram: body.postIds.map((id: string) => ({ id, analytics: { reachCount: 5 } })) } });
    await pullAnalytics(env);
    await pullAnalytics(env);
    expect(calls.filter((c) => c.key === 'POST /analytics/post')).toHaveLength(1);
  });

  it('السجلّ يمضي بمؤشّر إكس من دورةٍ إلى دورة ثم يُختم مقروءاً', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'x1', platform: 'twitter', username: 'naf' }] } });
    routes['GET /history/twitter'] = (url) => {
      const next = url.searchParams.get('next');
      const page = next === 'c2' ? 2 : next === 'c3' ? 3 : next === 'c4' ? 4 : next === 'c5' ? 5 : 1;
      return {
        body: {
          status: 'success',
          posts: [{ id: `t${page}`, post: `تغريدة ${page}`, created: `2025-0${page}-01T00:00:00Z`, publicMetrics: { likeCount: 1 } }],
          meta: { pagination: page < 5 ? { hasMore: true, next: `c${page + 1}`, limit: 100 } : { hasMore: false, limit: 100 } },
        },
      };
    };

    await pullAnalytics(env, { mode: 'history' });
    // أربع صفحاتٍ في الدورة، والمؤشّر محفوظ
    expect(calls.filter((c) => c.key === 'GET /history/twitter')).toHaveLength(4);
    expect((await readAnalyticsHistoryReport(env))).toMatchObject({ historyAccounts: 1, historyDone: 0 });

    await pullAnalytics(env, { mode: 'history' });
    const twitter = calls.filter((c) => c.key === 'GET /history/twitter');
    expect(twitter[4].url.searchParams.get('next')).toBe('c5');
    expect((await readAnalyticsHistoryReport(env))).toMatchObject({ historyDone: 1 });
    expect(snaps().map((s) => s.provider_post_id)).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('إكس بلا مفتاحَي التطبيق يُترك ويُقال — وبقية المنصات تُسحب', async () => {
    delete env.AYRSHARE_X_API_SECRET;
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'x1', platform: 'twitter' }, { id: 'ig1', platform: 'instagram' }] } });
    routes['GET /history/instagram'] = () => ({ body: { status: 'success', posts: [{ id: 'ig_1', post: 'x', created: RECENT, likeCount: 1 }] } });
    await pullAnalytics(env);
    expect(calls.some((c) => c.key === 'GET /history/twitter')).toBe(false);
    expect(calls.some((c) => c.key === 'GET /history/instagram')).toBe(true);
    expect((await readAnalyticsReport(env))?.errors[0]).toMatch(/AYRSHARE_X_API_KEY/);
  });
});

describe('سجلٌّ بأرقامٍ ناقصة', () => {
  it('٤٠٠ مع posts تُكتب منه المنشورات السليمة ولا يُعدّ السحب فاشلاً', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'fb', platform: 'facebook', pageName: 'ناف' }] } });
    routes['GET /history/facebook'] = () => ({
      status: 400,
      body: {
        status: 'error',
        posts: [
          { id: 'fb_1', post: 'منشور سليم', created: RECENT, likeCount: 3, commentsCount: 1 },
          { id: 'fb_2', action: 'analytics', code: 187, message: 'Error getting analytics.', status: 'error', created: RECENT },
        ],
      },
    });
    await pullAnalytics(env);
    expect(snaps().map((s) => s.provider_post_id)).toEqual(['fb_1']);
    expect((await readAnalyticsReport(env))?.errors).toEqual([]);
  });

  it('رفضٌ بلا رسالة يُذكر بمساره ورمزه', async () => {
    routes['GET /history/instagram'] = () => ({ status: 400, body: { status: 'error', code: 999 } });
    await pullAnalytics(env).catch(() => {});
    expect((await readAnalyticsReport(env))?.errors[0]).toBe('خطأ من Ayrshare (400) في GET /history/instagram — رمز 999');
  });
});

describe('مصدر مزوّد النشر عبر Ayrshare', () => {
  it('المتابعون من analytics/social بأسماء كل منصة، والمراجعات من reviews', async () => {
    routes['GET /user'] = () => ({
      body: { displayNames: [{ id: 'tt', platform: 'tiktok' }, { id: 'yt', platform: 'youtube' }, { id: 'li', platform: 'linkedin', type: 'corporate' }, { platform: 'gmb' }] },
    });
    routes['POST /analytics/social'] = (_u, body) => {
      expect(body.platforms.sort()).toEqual(['linkedin', 'tiktok', 'youtube']);
      return {
        body: {
          status: 'success',
          tiktok: { analytics: { followerCount: 300 } },
          youtube: { analytics: { subscriberCount: '67' } },
          linkedin: { analytics: { followers: { totalFollowerCount: 1500 } } },
        },
      };
    };
    routes['GET /reviews'] = () => ({ body: { averageRating: 4.6, totalReviewCount: 52, gmb: [] } });

    const current = periodOf('monthly');
    const points = await SOURCES.social.fetch(env, {}, { start: current.start, end: current.end });
    const followers = Object.fromEntries(points.filter((p) => p.metricKey === 'followers_total').map((p) => [p.dimValue, p.value]));
    expect(followers).toEqual({ tiktok: 300, youtube: 67, linkedin_page: 1500 });
    expect(points.find((p) => p.metricKey === 'gbp_reviews')?.value).toBe(52);
    expect(points.find((p) => p.metricKey === 'gbp_rating')?.value).toBe(4.6);
  });
});

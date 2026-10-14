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
import { ayrshareMetrics, ayrshareMapped, parseYouTubeFeed } from '../src/adapters/ayrshare';
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
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
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

  it('لقطةٌ قديمة يطابقها سجلّ المنصة تبقى بمفتاحها، ويُحفظ معرّفها الأصلي بجانبه', async () => {
    // من حقبة SocialAPI: مفتاحها نائبٌ لا يعرفه Ayrshare
    db.prepare(
      "INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, external_url) VALUES ('old', 'uuid-1:instagram', 'instagram', ?, 'https://www.instagram.com/p/A/')",
    ).run(RECENT);
    routes['GET /history/instagram'] = () => ({
      body: { status: 'success', posts: [{ id: 'ig_100', post: 'قديم', created: RECENT, postUrl: 'https://www.instagram.com/p/A/', likeCount: 1 }] },
    });
    routes['POST /analytics/post'] = (_u, body) => ({ body: { instagram: body.postIds.map((id: string) => ({ id, analytics: { reachCount: 5 } })) } });
    await pullAnalytics(env);
    expect(snaps()).toHaveLength(1);
    expect(snaps()[0]).toMatchObject({ provider_post_id: 'uuid-1:instagram', native_post_id: 'ig_100' });
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

  it('الريتويت في سجلّ إكس لا يُكتب', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'x1', platform: 'twitter', username: 'naf' }] } });
    routes['GET /history/twitter'] = () => ({ body: { status: 'success', posts: [
      { id: 't1', post: 'RT @KingSalman: نص', created: RECENT, publicMetrics: { likeCount: 90000 } },
      { id: 't2', post: 'منشورنا', created: RECENT, publicMetrics: { likeCount: 12 } },
    ] } });
    await pullAnalytics(env);
    expect(snaps().map((s) => s.provider_post_id)).toEqual(['t2']);
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

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>ناف القانونية</title>
 <entry>
  <id>yt:video:SHORT1</id><yt:videoId>SHORT1</yt:videoId>
  <title>حقوق العامل &amp; صاحب العمل</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/SHORT1"/>
  <published>${RECENT}</published>
 </entry>
 <entry>
  <id>yt:video:LONG1</id><yt:videoId>LONG1</yt:videoId>
  <title>شرح نظام الشركات</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=LONG1"/>
  <published>${RECENT}</published>
 </entry>
</feed>`;

describe('مقاطع يوتيوب القصيرة', () => {
  it('تُقرأ من قائمة القناة: المعرّف والعنوان والرابط', () => {
    expect(parseYouTubeFeed(FEED)).toEqual([
      { id: 'SHORT1', title: 'حقوق العامل & صاحب العمل', published: new Date(RECENT).toISOString(), url: 'https://www.youtube.com/shorts/SHORT1' },
      { id: 'LONG1', title: 'شرح نظام الشركات', published: new Date(RECENT).toISOString(), url: 'https://www.youtube.com/watch?v=LONG1' },
    ]);
  });

  it('سجلُّ Ayrshare لا يردّها — فتُكتب من القائمة وأرقامُها بمعرّفها', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'g1', platform: 'youtube', channelId: 'UCzfTY8z4', channelTitle: 'ناف' }] } });
    routes['GET /history/youtube'] = () => ({ body: { status: 'success', posts: [{ id: 'LONG1', post: 'شرح', created: RECENT }] } });
    routes['GET /feeds/videos.xml'] = (url) => {
      expect(url.searchParams.get('channel_id')).toBe('UCzfTY8z4');
      return { body: FEED };
    };
    routes['POST /analytics/post'] = (_u, body) => ({
      body: { youtube: body.postIds.map((id: string) => ({ id, analytics: { views: id === 'SHORT1' ? 1200 : 300, likes: 10 } })) },
    });
    await pullAnalytics(env);
    const rows = snaps();
    expect(rows.map((r) => r.provider_post_id)).toEqual(['LONG1', 'SHORT1']);
    expect(rows[1]).toMatchObject({ platform: 'youtube', impressions: 1200, external_url: 'https://www.youtube.com/shorts/SHORT1' });
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

  it('سجلٌّ فارغ لما نُشر عبر Ayrshare — خطؤه داخل history — ليس فشلاً', async () => {
    routes['GET /history'] = () => ({ status: 400, body: { history: { status: 'error', code: 221 } } });
    routes['GET /history/instagram'] = () => ({ body: { status: 'success', posts: [{ id: 'ig_1', post: 'x', created: RECENT, likeCount: 1 }] } });
    await pullAnalytics(env);
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
      // اليومي يُطلب لما يردّه يوماً بيوم وحده — ولينكدإن ليس منه، والملف التجاري منه
      if (body.daily) {
        expect(body.platforms.sort()).toEqual(['gmb', 'tiktok', 'youtube']);
        return { body: { status: 'success' } };
      }
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

describe('السجلّ لا يمحو الأرقام الحيّة', () => {
  it('ظهور فيسبوك ووصوله يبقيان بعد سحب السجلّ، والإعجاب لا يُعدّ مع التفاعلات مرّتين', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'fb', platform: 'facebook', pageName: 'ناف' }] } });
    let likes = 10;
    // السجلّ: بلا ظهور، ومشاهدات المقطع صفر — وقصّةٌ بلا تفاعلات فيُكتب إعجابها وحده
    routes['GET /history/facebook'] = () => ({
      body: { status: 'success', posts: [{ id: 'fb_1', post: 'منشور', created: RECENT, likeCount: likes, commentsCount: 3, videoViews: 0, reactions: {} }] },
    });
    routes['POST /analytics/post'] = (_u, body) => ({
      body: {
        facebook: body.postIds.map((id: string) => ({
          id, analytics: { mediaView: 2000, totalMediaViewUnique: 1500, reactions: { like: 20, love: 5, total: 25 }, commentsCount: 3, sharesCount: 2 },
        })),
      },
    });

    await pullAnalytics(env);
    expect(snaps()[0]).toMatchObject({ impressions: 2000, reach: 1500, engagement: 30 });

    // بعد ساعة: السجلّ وحده — والحيّ لم يحن
    likes = 12;
    routes['GET /history/facebook'] = () => ({
      body: { status: 'success', posts: [{ id: 'fb_1', post: 'منشور', created: RECENT, likeCount: likes, commentsCount: 4, videoViews: 0, reactions: {} }] },
    });
    await pullAnalytics(env);
    expect(calls.filter((c) => c.key === 'POST /analytics/post')).toHaveLength(1);
    const row = snaps()[0];
    expect(row).toMatchObject({ impressions: 2000, reach: 1500 });
    // التفاعلات ٢٥ من الحيّ + التعليقات ٤ من السجلّ + المشاركة ٢ — والإعجاب داخل التفاعلات
    expect(row.engagement).toBe(31);
    const types = JSON.parse(row.metrics_json).map((m: any) => m.type).sort();
    expect(types).toEqual(['comments', 'impressions', 'reach', 'reactions', 'shares', 'views']);
  });

  it('إنستغرام: الحفظ والمشاركة والوصول من الحيّ تبقى، والإعجاب والتعليق من السجلّ أحدث', async () => {
    routes['GET /history/instagram'] = () => ({ body: { status: 'success', posts: [{ id: 'ig_1', post: 'x', created: RECENT, likeCount: 40, commentsCount: 5 }] } });
    routes['POST /analytics/post'] = (_u, body) => ({
      body: { instagram: body.postIds.map((id: string) => ({ id, analytics: { reachCount: 500, viewsCount: 800, likeCount: 40, commentsCount: 5, sharesCount: 2, savedCount: 3 } })) },
    });
    await pullAnalytics(env);
    routes['GET /history/instagram'] = () => ({ body: { status: 'success', posts: [{ id: 'ig_1', post: 'x', created: RECENT, likeCount: 41, commentsCount: 6 }] } });
    await pullAnalytics(env);
    expect(snaps()[0]).toMatchObject({ reach: 500, impressions: 800, engagement: 41 + 6 + 2 + 3 });
  });
});

describe('سناب بمعرّف Ayrshare', () => {
  it('أرقام منشور سناب تُطلب بمعرّف Ayrshare وتُجمع وسائطه', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'sc', platform: 'snapchat', displayName: 'ناف' }] } });
    routes['GET /history'] = () => ({
      body: { history: [{ id: 'AYR_S', created: RECENT, post: 'قصة', postIds: [{ platform: 'snapchat', id: 'snap_1', status: 'success' }] }] },
    });
    routes['GET /history/snapchat'] = () => ({ body: { status: 'success', posts: [] } });
    routes['POST /analytics/post'] = (_u, body) => {
      expect(body).toEqual({ id: 'AYR_S', platforms: ['snapchat'] });
      return {
        body: {
          snapchat: {
            id: 'snap_1',
            analytics: [
              { views: 700, viewers: 600, storyFavorites: 20, replies: 3, shares: 2, viewTime: 120000 },
              { views: 100, viewers: 90, storyFavorites: 5, replies: 1, shares: 0, viewTime: 60000 },
            ],
          },
        },
      };
    };
    await pullAnalytics(env);
    const [row] = snaps();
    expect(row).toMatchObject({ provider_post_id: 'snap_1', platform: 'snapchat', reach: 690, impressions: 800, engagement: 25 + 4 + 2 });
    const watch = JSON.parse(row.metrics_json).find((m: any) => m.type === 'totaltimewatched');
    expect(watch).toMatchObject({ value: 3, unit: 'minutes' });
  });
});

describe('ما يخصّ الحساب لا يُختم ولا يوقف غيره', () => {
  it('تمهّل صفحة فيسبوك (444) يُقال لها وحدها، وإنستغرام يُسحب، ومنشورات فيسبوك تُطلب في السحب التالي', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'fb', platform: 'facebook', pageName: 'ناف' }, { id: 'ig1', platform: 'instagram', username: 'naf' }] } });
    routes['GET /history/facebook'] = () => ({ body: { status: 'success', posts: [{ id: 'fb_1', post: 'منشور', created: RECENT, likeCount: 1 }] } });
    routes['GET /history/instagram'] = () => ({ body: { status: 'success', posts: [{ id: 'ig_1', post: 'x', created: RECENT, likeCount: 1 }] } });
    let throttle = true;
    routes['POST /analytics/post'] = (_u, body) => {
      if (body.platforms[0] === 'facebook' && throttle) {
        return { status: 429, body: { status: 'error', facebook: { action: 'rate limit', status: 'error', code: 444, errCode: 80001 }, httpErrorCode: 444 } };
      }
      return { body: { [body.platforms[0]]: body.postIds.map((id: string) => ({ id, analytics: { reachCount: 9, mediaView: 9 } })) } };
    };

    await pullAnalytics(env);
    const report = await readAnalyticsReport(env);
    expect(report?.errors).toEqual(['فيسبوك: طلبت المنصة التمهّل. يُستأنف في السحب التالي']);
    expect(report?.stoppedBy ?? null).toBeNull();
    expect(snaps().find((s) => s.provider_post_id === 'ig_1')).toMatchObject({ reach: 9 });

    throttle = false;
    await pullAnalytics(env);
    expect(snaps().find((s) => s.provider_post_id === 'fb_1')).toMatchObject({ impressions: 9 });
  });

  it('لينكدإن يحتاج إعادة ربط (475) — يُقال سببه لا «رفض المفتاح»', async () => {
    routes['POST /analytics/post'] = (_u, body) => (body.platforms[0] === 'linkedin'
      ? { status: 403, body: { action: 'authorization', status: 'error', code: 475, message: 'Your LinkedIn profile is missing the analytics permissions.' } }
      : { body: { instagram: [] } });
    routes['GET /history/linkedin'] = () => ({ body: { status: 'success', posts: [{ id: 'li_1', post: 'x', created: RECENT, likeCount: 1 }] } });
    await pullAnalytics(env);
    expect((await readAnalyticsReport(env))?.errors[0]).toMatch(/إعادة ربط/);
  });
});

describe('أرقامٌ كانت تُترك', () => {
  it('مشاهدات مقطع إكس من وسائطه في السجلّ', () => {
    const m = ayrshareMapped('twitter', { publicMetrics: { likeCount: 2 }, media: [{ type: 'video', publicMetrics: { viewCount: 27 } }] });
    expect(m.raw).toContainEqual({ type: 'views', name: 'media.viewCount', value: 27, unit: 'count' });
  });

  it('يوتيوب: المشاهدات بتعريفها الجديد، والقديمة محفوظة معها', () => {
    const m = ayrshareMetrics('youtube', { views: 300, engagedViews: 148 });
    expect(m).toContainEqual({ type: 'views', name: 'views', value: 300, unit: 'count' });
    expect(m).toContainEqual({ type: 'engagedviews', name: 'engagedViews', value: 148, unit: 'count' });
  });

  it('المدّة تُحفظ بالدقائق وباسم المنصة لا «count»', () => {
    const m = ayrshareMapped('tiktok', { totalTimeWatched: 600 });
    expect(m.raw).toContainEqual({ type: 'totaltimewatched', name: 'totalTimeWatched', value: 10, unit: 'minutes' });
  });
});

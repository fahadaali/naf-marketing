// أرقام الحسابات من `POST /analytics/social` في Ayrshare — يوماً بيوم تُجمع أيامُ
// كل فترة، والجمهور لقطةُ اليوم. والأشكال من صفحة «Analytics on a Social
// Network» في توثيقه: `{period: 'day', values: [{value, endTime}], total}`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { SOURCES } from '../src/adapters/sources';
import { ayrshareAudiencePoints, ayrshareDailyPoints, dailyDay, linkedInNewFollowers } from '../src/adapters/ayrshare';
import { syncSource } from '../src/services/metricSync';
import { periodOf, previousPeriod, riyadhToday } from '../src/services/period';

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

function build(provider = 'ayrshare'): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  // الإعداد قبل الهجرات: 0039 يربط المصدر حين يكون Ayrshare هو المزوّد
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider_name', provider);
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return db;
}

type Reply = { status?: number; body: unknown };
let routes: Record<string, (url: URL, body: any) => Reply>;
let calls: { key: string; body: any }[];
let db: any;
let env: any;

const DAY = 86_400_000;
const today = riyadhToday();
/** سلسلةٌ يومية لآخر `days` يوماً — قيمةٌ ثابتة لكل يوم، ونهايةُ اليوم بشكل المنصة. */
function series(days: number, value: number, meta = false) {
  const values = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) - i * DAY);
    // ميتا تُعلن نهاية اليوم بتوقيت المحيط الهادئ: الساعة السابعة من اليوم التالي
    const end = meta ? new Date(day.getTime() + DAY + 7 * 3_600_000) : day;
    values.push({ value, endTime: end.toISOString() });
  }
  return { period: 'day', values, total: value * days };
}
const daysIn = (start: string, end: string) => {
  const last = end < today ? end : today;
  return Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
};

beforeEach(() => {
  db = build();
  env = { DB: d1(db), AYRSHARE_API_KEY: 'ayr_key' };
  routes = {};
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${(init?.method || 'GET').toUpperCase()} ${url.pathname.replace(/^\/api/, '')}`;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const r = routes[key]?.(url, body) ?? { status: 404, body: { status: 'error', code: 101 } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  routes['GET /user'] = () => ({
    body: { displayNames: [
      { id: 'fb', platform: 'facebook', pageName: 'ناف' },
      { id: 'ig', platform: 'instagram', username: 'naf' },
      { id: 'yt', platform: 'youtube', channelTitle: 'ناف' },
      { id: 'tt', platform: 'tiktok', username: 'naf' },
      { id: 'sc', platform: 'snapchat', displayName: 'ناف' },
      { platform: 'gmb', displayName: 'NAF Law' },
    ] },
  });
  routes['GET /reviews'] = () => ({ status: 400, body: { status: 'error', code: 350 } });
  routes['POST /analytics/social'] = (_u, body) => {
    if (!body.daily) {
      return { body: {
        instagram: { analytics: {
          followersCount: 2000,
          audienceCountry: { SA: 1500, AE: 300, US: 10 },
          audienceGenderAge: { 'F.25-34': 400, 'M.25-34': 900, 'M.55-64': 50, 'M.65+': 20, 'U.18-24': 30 },
        } },
        tiktok: { analytics: {
          followerCount: 1000,
          audienceCountries: [{ country: 'SA', percentage: 0.8 }, { country: 'EG', percentage: 0.2 }],
          audienceAges: [{ age: '25-34', percentage: 0.5 }, { age: '55+', percentage: 0.1 }],
          audienceGenders: [{ gender: 'Male', percentage: 0.6 }, { gender: 'Female', percentage: 0.3 }, { gender: 'Other', percentage: 0.1 }],
        } },
        youtube: { analytics: { subscriberCount: '67' } },
        facebook: { analytics: { followersCount: 500 } },
        snapchat: { analytics: [{ subscribers: 40 }] },
      } };
    }
    return { body: {
      facebook: { analytics: { pageMediaView: series(170, 10, true), pageVideoViewTime: series(170, 99, true) } },
      instagram: { analytics: { followersCount: 2000, reach: { period: 'day', values: series(170, 4).values } } },
      youtube: { analytics: {
        views: series(170, 20), subscribersGained: series(170, 2), subscribersLost: series(170, 1), estimatedMinutesWatched: series(170, 30),
      } },
      tiktok: { analytics: { viewCountTotal: series(60, 100), profileViews: series(60, 5), bioLinkClicks: series(60, 1), followerCount: series(60, 1000) } },
      snapchat: { analytics: [{ views: series(90, 7), viewers: series(90, 3), viewTime: series(90, 120_000), subscribes: series(90, 1), unsubscribes: series(90, 0) }] },
      gmb: { analytics: {
        businessImpressionsDesktopMaps: series(170, 1), businessImpressionsDesktopSearch: series(170, 2),
        businessImpressionsMobileMaps: series(170, 3), businessImpressionsMobileSearch: series(170, 4),
        callClicks: series(170, 1), businessDirectionRequests: series(170, 2), websiteClicks: series(170, 3),
      } },
    } };
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const values = (key: string, p: { kind: string; start: string }) =>
  Object.fromEntries(
    (db.prepare('SELECT dim_value, value FROM metric_values WHERE metric_key = ? AND period = ? AND period_start = ?').all(key, p.kind, p.start) as any[])
      .map((r) => [r.dim_value, r.value]),
  );

describe('يومٌ بيوم', () => {
  it('ميتا تُعلن نهاية اليوم فالقيمة لليوم قبله، وما سواها اليوم نفسه', () => {
    expect(dailyDay('2025-08-12T07:00:00.000Z')).toBe('2025-08-11');
    expect(dailyDay('2026-09-05T00:00:00.000Z')).toBe('2026-09-05');
    expect(dailyDay('غير تاريخ')).toBeNull();
  });

  it('فترةٌ لا تغطّي النافذةُ أوّلَها لا يُكتب لها رقم — وسلسلةٌ غائبة لا تُكتب صفراً', () => {
    const a = { views: { period: 'day', values: [{ value: 5, endTime: '2026-09-02T00:00:00.000Z' }] } };
    expect(ayrshareDailyPoints('youtube', 'youtube', a, { start: '2026-09-01', end: '2026-09-30' }, '2026-09-02')).toEqual([]);
    expect(ayrshareDailyPoints('youtube', 'youtube', a, { start: '2026-09-01', end: '2026-09-30' }, '2026-08-01'))
      .toEqual([{ metricKey: 'account_views', dimKey: 'platform', dimValue: 'youtube', value: 5 }]);
  });
});

describe('الجمهور', () => {
  it('إنستغرام أعداداً وتيك توك نسباً من متابعيه — يُجمعان، و٥٥ فما فوق فئةٌ واحدة', () => {
    const pts = ayrshareAudiencePoints({
      instagram: { analytics: { audienceCountry: { SA: 10 }, audienceGenderAge: { 'F.25-34': 4, 'M.55-64': 1, 'M.65+': 2, 'U.18-24': 3 } } },
      tiktok: { analytics: { followerCount: 100, audienceCountries: [{ country: 'sa', percentage: 0.5 }], audienceAges: [{ age: '55+', percentage: 0.1 }], audienceGenders: [{ gender: 'Other', percentage: 0.2 }] } },
    });
    const of = (k: string) => Object.fromEntries(pts.filter((p) => p.metricKey === k).map((p) => [p.dimValue, p.value]));
    expect(of('followers_country')).toEqual({ SA: 60 });
    expect(of('followers_age')).toEqual({ '25-34': 4, '55+': 13, '18-24': 3 });
    expect(of('followers_gender')).toEqual({ female: 4, male: 3, unknown: 23 });
  });

  it('لينكدإن الشخصي: المتابعون الجدد من followersDaily في الفترة', () => {
    const d = (day: string, n: number) => {
      const [y, m, dd] = day.split('-').map(Number);
      return { memberFollowersCount: n, dateRange: { start: { year: y, month: m, day: dd } } };
    };
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
    const p = periodOf('weekly');
    const n = linkedInNewFollowers({ followersDaily: [d(today, 3), d(yesterday, 2), d('2020-01-01', 99)] }, p, today);
    expect(n).toBe((p.start <= yesterday ? 2 : 0) + 3);
    // نافذةُ ثلاثين يوماً لا تغطّي سنة
    expect(linkedInNewFollowers({ followersDaily: [d(today, 3)] }, periodOf('annual'), today)).toBeNull();
  });
});

describe('مصدر مزوّد النشر يكتب أرقام الحسابات', () => {
  it('يُربط وحده حين يكون Ayrshare هو المزوّد', () => {
    expect(db.prepare("SELECT is_enabled FROM integrations WHERE key = 'social'").get().is_enabled).toBe(1);
    expect(build('mock').prepare("SELECT is_enabled FROM integrations WHERE key = 'social'").get().is_enabled).toBe(0);
  });

  it('الشهر الجاري: مجاميع الأيام لكل منصة، وأداء الملف التجاري، واللقطات', async () => {
    const p = periodOf('monthly');
    await syncSource(env, 'social', p);
    const n = daysIn(p.start, p.end);
    expect(values('account_views', p)).toEqual({ facebook: 10 * n, youtube: 20 * n, tiktok: 100 * n, snapchat: 7 * n });
    expect(values('account_reach', p)).toEqual({ instagram: 4 * n, snapchat: 3 * n });
    expect(values('profile_views', p)).toEqual({ tiktok: 5 * n });
    expect(values('new_followers', p)).toEqual({ youtube: 2 * n, snapchat: 1 * n });
    expect(values('unfollows', p)).toEqual({ youtube: 1 * n, snapchat: 0 });
    // سناب بالأجزاء من الألف: دقيقتان لكل يوم
    expect(values('watch_time', p)).toEqual({ youtube: 30 * n, snapchat: 2 * n });
    expect(values('profile_website_clicks', p)).toEqual({ google: 3 * n, tiktok: 1 * n });
    expect(values('gbp_views', p)).toEqual({ '': 10 * n });
    expect(values('gbp_calls', p)).toEqual({ '': 1 * n });
    expect(values('gbp_directions', p)).toEqual({ '': 2 * n });
    expect(values('followers_total', p)).toMatchObject({ instagram: 2000, tiktok: 1000, youtube: 67, facebook: 500, snapchat: 40 });
    expect(values('followers_country', p)).toEqual({ SA: 2300, AE: 300, US: 10, EG: 200 });
    // وقت مشاهدة فيسبوك لا يُكتب: وحدته غير مؤكّدة في التوثيق
    expect(values('watch_time', p).facebook).toBeUndefined();
    // ربعٌ واحد يكفي الشهر
    expect(calls.find((c) => c.key === 'POST /analytics/social' && c.body.daily)?.body.quarters).toBe(1);
  });

  it('الشهر الماضي: مجاميع أيامه وحدها، ولا لقطات — وتيك توك يُكتب ما دامت ستّون يوماً تغطّيه', async () => {
    const p = previousPeriod(periodOf('monthly'));
    await syncSource(env, 'social', p);
    const n = daysIn(p.start, p.end);
    const covered = Date.parse(`${p.start}T00:00:00Z`) >= Date.parse(`${today}T00:00:00Z`) - 59 * DAY;
    expect(values('account_views', p)).toEqual({ facebook: 10 * n, youtube: 20 * n, snapchat: 7 * n, ...(covered ? { tiktok: 100 * n } : {}) });
    expect(values('followers_total', p)).toEqual({});
    expect(values('followers_country', p)).toEqual({});
  });

  it('السنة الماضية أبعدُ من أربعة أرباع — لا يُطلب يوميٌّ لها', async () => {
    await syncSource(env, 'social', previousPeriod(periodOf('annual')));
    expect(calls.some((c) => c.key === 'POST /analytics/social' && c.body.daily)).toBe(false);
  });
});

describe('مصدرٌ لا يكتب إلا ما سُجّل له', () => {
  it('«الملف التجاري» إن بقي مربوطاً لا يكتب أداءه بعد نقله إلى مزوّد النشر', async () => {
    const p = periodOf('monthly');
    db.prepare("UPDATE integrations SET is_enabled = 1 WHERE key = 'business_profile'").run();
    const original = SOURCES.business_profile.fetch;
    SOURCES.business_profile.fetch = async () => [{ metricKey: 'gbp_views', value: 999 }, { metricKey: 'sessions', value: 5 }];
    try {
      expect(await syncSource(env, 'business_profile', p)).toBe(0);
    } finally {
      SOURCES.business_profile.fetch = original;
    }
    expect(values('gbp_views', p)).toEqual({});
    expect(values('sessions', p)).toEqual({});
  });
});

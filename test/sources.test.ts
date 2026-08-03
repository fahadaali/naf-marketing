import { describe, it, expect, afterEach, vi } from 'vitest';
import { SOURCES, type MetricPoint } from '../src/adapters/sources';
import type { Env } from '../src/types';
import { periodOf, previousPeriod, riyadhToday } from '../src/services/period';

/* مصدر مزوّد النشر — أرقام الحساب لا أرقام المنشور.
   الاختبار يخنق `fetch` ولا يبلغ الشبكة: ما يُتحقّق منه هو التخريط والترجيح
   وقاعدةُ «اللقطة لا تُكتب في فترةٍ منقضية». */

const env = { SOCIALAPI_API_KEY: 'sapi_key_test' } as unknown as Env;

function stubFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(String(url)).pathname;
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, text: async () => '{}' } as unknown as Response;
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
  });
}

function pull(points: MetricPoint[], key: string): MetricPoint[] {
  return points.filter((p) => p.metricKey === key);
}

const current = periodOf('monthly');
const closed = previousPeriod(current);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('مصدر مزوّد النشر', () => {
  it('يكتب المتابعين لكل منصّة، ويطرح منصّةً لا تُعلن عددها', async () => {
    stubFetch({
      '/v1/accounts': {
        accounts: [
          { id: 'a1', platform: 'linkedin', followers: 1200 },
          { id: 'a2', platform: 'instagram', stats: { followers_count: 800 } },
          { id: 'a3', platform: 'tiktok' },
        ],
      },
      '/v1/inbox/reviews': { data: [] },
    });

    const points = await SOURCES.social.fetch(env, {}, { start: current.start, end: current.end });
    const followers = pull(points, 'followers_total');

    expect(followers).toHaveLength(2);
    expect(followers.every((p) => p.dimKey === 'platform')).toBe(true);
    expect(followers.find((p) => p.dimValue === 'linkedin')?.value).toBe(1200);
    expect(followers.find((p) => p.dimValue === 'instagram')?.value).toBe(800);
    // منصّةٌ بلا عدد تبقى بلا قيمة — الغياب ليس صفراً
    expect(followers.find((p) => p.dimValue === 'tiktok')).toBeUndefined();
  });

  it('يجمع المراجعات ويرجّح المتوسط بعدد مراجعات كل حساب', async () => {
    stubFetch({
      '/v1/accounts': { accounts: [] },
      '/v1/inbox/reviews': {
        data: [
          { account_id: 'g1', platform: 'google', total: 200, average: 4.5 },
          { account_id: 'g2', platform: 'facebook', total: 2, average: 1 },
        ],
      },
    });

    const points = await SOURCES.social.fetch(env, {}, { start: current.start, end: current.end });

    expect(pull(points, 'gbp_reviews')[0].value).toBe(202);
    // المرجَّح ‎(200×4.5 + 2×1) ÷ 202 = 4.47 — ومتوسّطُ المتوسّطات كان 2.75
    expect(pull(points, 'gbp_rating')[0].value).toBe(4.47);
    expect(pull(points, 'gbp_rating')[0].sample).toBe(202);
  });

  it('لا يكتب شيئاً في فترةٍ منقضية — اللقطة لا تُستدرك', async () => {
    stubFetch({
      '/v1/accounts': { accounts: [{ id: 'a1', platform: 'linkedin', followers: 1200 }] },
      '/v1/inbox/reviews': { data: [{ account_id: 'g1', total: 10, average: 5 }] },
    });

    const points = await SOURCES.social.fetch(env, {}, { start: closed.start, end: closed.end });
    expect(points).toEqual([]);
    // والفترة الجارية تنتهي اليوم أو بعده، فتُكتب
    expect(current.end >= riyadhToday()).toBe(true);
  });

  it('يرفض السحب بلا مفتاح — ولا يكتب صفراً مكانه', async () => {
    stubFetch({ '/v1/accounts': { accounts: [] } });
    await expect(
      SOURCES.social.fetch({} as Env, {}, { start: current.start, end: current.end }),
    ).rejects.toThrow();
  });
});

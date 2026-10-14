// الفحص عند الجدولة عبر Ayrshare، وعدّاد الطول في «نسخة كل منصة».
//
// الأشكال من صفحة «Check Post Length» في توثيقه: `POST /post/checkPostWeight`
// يردّ `<منصة>WeightedLength` و`<منصة>Valid` بحالة أحرف كل منصة (`linkedIn`،
// `tikTok`) و`maxCharLimits` بأسمائها الصغيرة.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { preflightSchedules } from '../src/services/publish';
import { mapPostWeight, isXPremium, forgetXPremium } from '../src/adapters/ayrshare';
import { ayrshareRoutes } from '../src/routes/ayrshare';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** المثال الموثّق كما هو. */
const DOC_EXAMPLE = {
  twitterWeightedLength: 2932, blueskyWeightedLength: 199, instagramWeightedLength: 3015, tikTokWeightedLength: 3017,
  linkedInWeightedLength: 3015, facebookWeightedLength: 3015, pinterestWeightedLength: 3015, youtubeWeightedLength: 3015,
  gmbWeightedLength: 3015,
  twitterValid: false, twitterLongValid: true, facebookValid: true, gmbValid: false, instagramValid: false, linkedInValid: false,
  pinterestValid: false, redditValid: true, tikTokValid: false, youtubeValid: true,
  maxCharLimits: {
    bluesky: 300, facebook: 63206, gmb: 1500, instagram: 2200, linkedin: 3000, pinterest: 500, reddit: 10000,
    tiktok: 2200, twitter: 280, twitterLong: 25000, youtube: 5000,
  },
};

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) };
}

let db: any;
let env: any;
let replies: Record<string, (body: any) => { status?: number; body: unknown }>;
let calls: { key: string; body: any }[];

beforeEach(() => {
  forgetXPremium();
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'ayrshare')").run();
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('gm','فهد','f@naf.sa','h','general_manager',1)").run();
  env = { DB: d1(db), AYRSHARE_API_KEY: 'ayr_key_test' };
  replies = {};
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${(init?.method || 'GET').toUpperCase()} ${url.pathname.replace(/^\/api/, '')}`;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ key, body });
    const r = replies[key]?.(body) ?? { status: 404, body: { status: 'error', code: 101, message: 'not found' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('طول النص كما تعدّه المنصات', () => {
  it('يقرأ المثال الموثّق بأسماء Ayrshare، ولا يخترع طولاً لما لم يُعلن', () => {
    const w = mapPostWeight(DOC_EXAMPLE);
    expect(w.twitter).toEqual({ length: 2932, max: 280, valid: false });
    expect(w.linkedin).toEqual({ length: 3015, max: 3000, valid: false });
    expect(w.tiktok).toEqual({ length: 3017, max: 2200, valid: false });
    expect(w.facebook).toEqual({ length: 3015, max: 63206, valid: true });
    expect(w.gmb).toEqual({ length: 3015, max: 1500, valid: false });
    // ريديت بلا طولٍ موزون في المثال، وبلوسكاي بلا حكم صحّة، وثريدز وسناب غائبان
    expect(Object.keys(w).sort()).toEqual(['facebook', 'gmb', 'instagram', 'linkedin', 'pinterest', 'tiktok', 'twitter', 'youtube']);
  });
});

describe('حساب إكس المشترك في Premium', () => {
  it('يُقاس بالحدّ الطويل وحكمه، وغيرُ المشترك بحدّ ٢٨٠', () => {
    expect(mapPostWeight(DOC_EXAMPLE, { xPremium: true }).twitter).toEqual({ length: 2932, max: 25000, valid: true });
    expect(mapPostWeight(DOC_EXAMPLE, { xPremium: false }).twitter).toEqual({ length: 2932, max: 280, valid: false });
    // ولينكدإن لا يمسّه اشتراك إكس
    expect(mapPostWeight(DOC_EXAMPLE, { xPremium: true }).linkedin).toEqual({ length: 3015, max: 3000, valid: false });
  });

  it('الاشتراك من subscriptionType أو verifiedType كما في توثيق Get User', () => {
    expect(isXPremium({ platform: 'twitter', subscriptionType: 'Premium' })).toBe(true);
    expect(isXPremium({ platform: 'twitter', subscriptionType: 'PremiumPlus' })).toBe(true);
    expect(isXPremium({ platform: 'twitter', subscriptionType: 'None', verifiedType: 'business' })).toBe(true);
    expect(isXPremium({ platform: 'twitter', subscriptionType: 'None', verifiedType: 'none' })).toBe(false);
    expect(isXPremium({ platform: 'linkedin', subscriptionType: 'Premium' })).toBe(false);
  });
});

describe('الفحص عند الجدولة', () => {
  function post(id: string, text: string, platforms: string[]): void {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'ع', ?, 'scheduled', 'gm')").run(id, `<p>${text}</p>`);
    for (const p of platforms) {
      db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, ?, ?, '2026-12-01T09:00:00Z', 'pending')")
        .run(`sch_${id}_${p}`, id, p);
    }
  }
  const error = (id: string) => db.prepare('SELECT error FROM schedules WHERE id = ?').get(id).error;
  const linked = (platforms: string[]) => () => ({
    body: { displayNames: platforms.map((p) => ({ platform: p, id: `${p}_1`, displayName: 'ناف' })) },
  });

  it('النص الأطول من حدّ المنصة يُكتب على موعدها بطوله وحدّه، والقصير لا', async () => {
    post('p1', 'نص', ['x', 'linkedin']);
    replies['POST /post/checkPostWeight'] = () => ({
      body: { twitterWeightedLength: 312, twitterValid: false, linkedInWeightedLength: 312, linkedInValid: true, maxCharLimits: { twitter: 280, linkedin: 3000 } },
    });
    replies['GET /user'] = linked(['twitter', 'linkedin']);
    await preflightSchedules(env, 'p1', ['x', 'linkedin']);
    expect(error('sch_p1_x')).toBe('النص أطول من حدّ إكس (\u2068312\u2069 من \u2068280\u2069). اكتب له نصّاً أقصر في «نسخة كل منصة»');
    expect(error('sch_p1_linkedin')).toBeNull();
    expect(calls.find((c) => c.key === 'POST /post/checkPostWeight')!.body).toEqual({ post: 'نص' });
  });

  it('نصٌّ أطول من ٢٨٠ على حسابٍ مشتركٍ في Premium ليس عيباً', async () => {
    post('p4', 'نص', ['x']);
    replies['POST /post/checkPostWeight'] = () => ({
      body: { twitterWeightedLength: 312, twitterValid: false, twitterLongValid: true, maxCharLimits: { twitter: 280, twitterLong: 25000 } },
    });
    replies['GET /user'] = () => ({ body: { displayNames: [{ platform: 'twitter', id: 'x_1', displayName: 'ناف', subscriptionType: 'Premium' }] } });
    await preflightSchedules(env, 'p4', ['x']);
    expect(error('sch_p4_x')).toBeNull();
  });

  it('منصةٌ غير مربوطة في Ayrshare تُقال قبل الموعد', async () => {
    post('p2', 'نص', ['linkedin_page', 'facebook']);
    replies['POST /post/checkPostWeight'] = () => ({ body: {} });
    replies['GET /user'] = linked(['linkedin']);
    await preflightSchedules(env, 'p2', ['linkedin_page', 'facebook']);
    expect(error('sch_p2_linkedin_page')).toBeNull();
    expect(error('sch_p2_facebook')).toBe('فيسبوك غير مربوط في Ayrshare: اربطه من Social Accounts قبل الموعد، وإلا لم يُنشر');
  });

  it('تعذّر السؤال لا يُعدّ عيباً في المنشور', async () => {
    post('p3', 'نص', ['x']);
    replies['POST /post/checkPostWeight'] = () => ({ status: 500, body: { status: 'error', message: 'boom' } });
    replies['GET /user'] = () => ({ status: 502, body: {} });
    const out = await preflightSchedules(env, 'p3', ['x']);
    expect(out).toEqual([]);
    expect(error('sch_p3_x')).toBeNull();
  });
});

describe('عدّاد الطول في «نسخة كل منصة»', () => {
  async function ask(payload: unknown) {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('sub', 'gm'); await next(); });
    app.route('/ayrshare', ayrshareRoutes);
    const res = await app.request('http://localhost/ayrshare/post-length', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }, env, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    return (await res.json()) as any;
  }

  it('النصّ كما يُرسل لكل منصة، وطلبٌ واحد لكل نصٍّ مختلف', async () => {
    replies['POST /post/checkPostWeight'] = (b) => ({
      body: {
        twitterWeightedLength: b.post.length, twitterValid: b.post.length <= 280,
        linkedInWeightedLength: b.post.length, linkedInValid: true,
        facebookWeightedLength: b.post.length, facebookValid: true,
        maxCharLimits: { twitter: 280, linkedin: 3000, facebook: 63206 },
      },
    });
    const d = await ask({
      body: '<p>متن المنشور</p><img src="/api/media/m1">',
      overrides: { x: 'نسخة إكس القصيرة', linkedin: '' },
      platforms: ['x', 'linkedin', 'facebook', 'snapchat'],
    });
    // المتن مجرّداً من الوسوم يُسأل مرّةً للينكدإن وفيسبوك، ونسخة إكس مرّة
    // (واشتراكُ إكس يُسأل عنه مرةً من «/user» — ليس طلبَ طول)
    expect(calls.filter((c) => c.key === 'POST /post/checkPostWeight').map((c) => c.body.post).sort()).toEqual(['متن المنشور', 'نسخة إكس القصيرة'].sort());
    expect(d.lengths).toEqual({
      x: { length: 16, max: 280, valid: true },
      linkedin: { length: 11, max: 3000, valid: true },
      facebook: { length: 11, max: 63206, valid: true },
    });
  });

  it('بلا Ayrshare لا عدّاد', async () => {
    db.prepare("UPDATE settings SET value = 'socialapi' WHERE key = 'provider_name'").run();
    expect(await ask({ body: 'نص', platforms: ['x'] })).toEqual({ lengths: {} });
    expect(calls).toEqual([]);
  });
});

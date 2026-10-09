// صندوق Ayrshare على قاعدةٍ حقيقية ومزوّدٍ مخنوق — التعليقات والرسائل
// والمراجعات، والردّ عليها. والأشكال من صفحات التوثيق (Get Comments، وReply to
// a Comment، وGet Messages، وGet All Reviews).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({
  notifyUsers: vi.fn(async () => {}),
  usersWithPermission: vi.fn(async () => ['u1']),
  notifyPublishFailed: vi.fn(async () => {}),
}));

import { syncComments, replyToComment, moderateComment, deleteReply } from '../src/services/commentsSync';
import { mapAyrshareComments, encodeAyrshareComment } from '../src/adapters/ayrshare';
import { notifyUsers } from '../src/services/notify';

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

const RECENT = new Date(Date.now() - 2 * 86_400_000).toISOString();
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeEach(() => {
  db = build();
  env = { DB: d1(db), AYRSHARE_API_KEY: 'ayr_key', AYRSHARE_X_API_KEY: 'xk', AYRSHARE_X_API_SECRET: 'xs' };
  routes = {};
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${(init?.method || 'GET').toUpperCase()} ${decodeURIComponent(url.pathname).replace(/^\/api/, '')}`;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ key, url, body });
    const r = routes[key]?.(url, body) ?? { status: 404, body: { status: 'error', code: 101, message: 'not found' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  routes['GET /user'] = () => ({
    body: {
      messagingEnabled: true,
      displayNames: [
        { id: 'fb_page', platform: 'facebook', pageName: 'ناف', messagingActive: true },
        { platform: 'gmb', displayName: 'NAF Law' },
      ],
    },
  });
  routes['GET /reviews'] = () => ({ status: 400, body: { status: 'error', code: 350, message: 'Reviews not found' } });
  routes['GET /messages/facebook'] = () => ({ body: { status: 'success', messages: [] } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const rows = (): any[] => db.prepare('SELECT * FROM platform_comments ORDER BY created_at').all();

describe('تعليقات Ayrshare', () => {
  it('ما كتبه العملاء وحده، ومعه ردُّنا من ردوده — فيسبوك بـ company', () => {
    const items = mapAyrshareComments('facebook', 'P1', {
      facebook: [
        { comment: 'كم رسوم الاستشارة؟', commentId: 'P1_1', created: '2026-10-01T10:00:00Z', from: { name: 'سارة', id: '9' },
          replies: [{ comment: 'نرسلها لك خاصاً', commentId: 'P1_2', created: '2026-10-01T11:00:00Z', company: true, from: { name: 'ناف', id: 'fb_page' } }] },
        // تعليقنا الأول على المنشور — ليس من الصندوق
        { comment: 'الرابط في التعليق', commentId: 'P1_3', created: '2026-10-01T09:00:00Z', from: { name: 'ناف', id: 'fb_page' } },
      ],
    }, ['fb_page']);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'ayc|facebook|P1|P1_1|', authorName: 'سارة', body: 'كم رسوم الاستشارة؟',
      repliedBody: 'نرسلها لك خاصاً', repliedAt: '2026-10-01T11:00:00.000Z',
      capabilities: { can_hide: false, can_delete: true },
    });
  });

  it('إكس يُسطّح الردود: ردُّنا يُعرف بأنه من حسابنا ويُشير إلى التعليق', () => {
    const items = mapAyrshareComments('twitter', 'T0', {
      twitter: [
        { comment: 'سؤال', commentId: 'T1', created: '2026-10-01T10:00:00Z', userName: 'client', name: 'عميل' },
        { comment: 'جواب', commentId: 'T2', created: '2026-10-01T10:30:00Z', userName: 'NAF', referencedTweets: [{ type: 'replied_to', id: 'T1' }] },
      ],
    }, ['naf']);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ authorName: 'عميل', repliedBody: 'جواب' });
  });

  it('لينكدإن يحفظ commentUrn في المعرّف — يشترطه الردّ', () => {
    const [it] = mapAyrshareComments('linkedin', 'urn:li:share:1', {
      linkedin: [{ comment: 'شكراً', commentId: '7', commentUrn: 'urn:li:comment:(urn:li:activity:1,7)', created: '2026-10-01T10:00:00Z', from: { name: 'خالد' } }],
    }, []);
    expect(it.id).toBe('ayc|linkedin|urn:li:share:1|7|urn:li:comment:(urn:li:activity:1,7)');
  });
});

describe('مزامنة صندوق Ayrshare', () => {
  beforeEach(() => {
    db.prepare(
      "INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, metrics_json) VALUES ('a1', 'P1', 'facebook', ?, ?)",
    ).run(RECENT, JSON.stringify([{ type: 'comments', value: 1 }]));
    routes['GET /comments/P1'] = () => ({
      body: { status: 'success', facebook: [{ comment: 'متى تفتحون؟', commentId: 'P1_1', created: RECENT, from: { name: 'سارة' } }] },
    });
  });

  it('يقرأ تعليقات المنشور بمعرّفه على منصته، ولا يعيدها ما لم يتغيّر عددها', async () => {
    await syncComments(env);
    const get = calls.find((c) => c.key === 'GET /comments/P1')!;
    expect(get.url.searchParams.get('searchPlatformId')).toBe('true');
    expect(get.url.searchParams.get('platform')).toBe('facebook');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ platform: 'facebook', kind: 'comment', author_name: 'سارة', reply_body: null });

    calls = [];
    // عليه تعليقٌ بلا ردّ، لكن قُرئ للتوّ: لا يُعاد قبل ست ساعات
    await syncComments(env);
    expect(calls.some((c) => c.key === 'GET /comments/P1')).toBe(false);

    // تغيّر عدد التعليقات في أرقامه: يُقرأ
    db.prepare("UPDATE analytics_snapshots SET metrics_json = ? WHERE id = 'a1'").run(JSON.stringify([{ type: 'comments', value: 2 }]));
    await syncComments(env);
    expect(calls.some((c) => c.key === 'GET /comments/P1')).toBe(true);
  });

  it('مراجعات الملف التجاري بنجومها وردّها، وتنبيهٌ للسلبية الحديثة', async () => {
    routes['GET /reviews'] = (url) => (url.searchParams.get('platform') === 'gmb'
      ? { body: { gmb: [
        { id: 'R1', rating: 'ONE', review: 'تأخّر الردّ', created: RECENT, reviewer: { name: 'محمد' }, reviewReply: {} },
        { id: 'R2', rating: 'FIVE', review: 'ممتاز', created: RECENT, reviewer: { name: 'نورة' }, reviewReply: { reply: 'شكراً لك', updated: RECENT } },
      ], averageRating: 3, totalReviewCount: 2 } }
      : { status: 400, body: { status: 'error', code: 350 } });

    const report = await syncComments(env);
    const reviews = db.prepare("SELECT * FROM platform_comments WHERE kind = 'review' ORDER BY provider_comment_id").all();
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({ provider_comment_id: 'ayr|gmb|R1', platform: 'google', rating: 1, reply_body: null });
    expect(reviews[1]).toMatchObject({ rating: 5, reply_body: 'شكراً لك', reply_source: 'external' });
    expect(report?.kinds.review).toMatchObject({ ok: true, items: 2 });
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it('الرسائل محادثةً محادثة: آخرُ ما كتبه العميل، وردُّنا بعده، ويعود «بلا رد» إن كتب بعده', async () => {
    routes['GET /messages/facebook'] = () => ({ body: { status: 'success', messages: [
      { id: 'm3', conversationId: 'c1', senderId: 'fb_page', recipientId: 'psid_1', action: 'sent', message: 'أهلاً، كيف نخدمك؟', created: ago(1) },
      { id: 'm2', conversationId: 'c1', senderId: 'psid_1', recipientId: 'fb_page', action: 'received', message: 'أريد موعداً', created: ago(2), senderDetails: { name: 'ريم' } },
    ] } });
    await syncComments(env);
    const [dm] = db.prepare("SELECT * FROM platform_comments WHERE kind = 'dm'").all();
    expect(dm).toMatchObject({ provider_comment_id: 'ayd|facebook|c1|psid_1', author_name: 'ريم', body: 'أريد موعداً', reply_body: 'أهلاً، كيف نخدمك؟', reply_source: 'external' });

    routes['GET /messages/facebook'] = () => ({ body: { status: 'success', messages: [
      { id: 'm4', conversationId: 'c1', senderId: 'psid_1', recipientId: 'fb_page', action: 'received', message: 'هل غداً متاح؟', created: ago(0.5), senderDetails: { name: 'ريم' } },
      { id: 'm3', conversationId: 'c1', senderId: 'fb_page', recipientId: 'psid_1', action: 'sent', message: 'أهلاً، كيف نخدمك؟', created: ago(1) },
    ] } });
    // تجوهلت قبل أن يكتب صاحبها — والجديد يعيدها إلى «بلا رد»
    db.prepare("UPDATE platform_comments SET ignored_at = '2026-10-08T00:00:00Z' WHERE kind = 'dm'").run();
    await syncComments(env);
    const [again] = db.prepare("SELECT * FROM platform_comments WHERE kind = 'dm'").all();
    expect(again).toMatchObject({ body: 'هل غداً متاح؟', reply_body: null, ignored_at: null });
  });

  it('بلا تفعيل الرسائل في الحساب لا يُطلب منها شيء', async () => {
    routes['GET /user'] = () => ({ body: { messagingEnabled: false, displayNames: [{ id: 'fb_page', platform: 'facebook', messagingActive: true }] } });
    await syncComments(env);
    expect(calls.some((c) => c.key.startsWith('GET /messages'))).toBe(false);
  });
});

describe('ردود لينكدإن', () => {
  it('تُطلب لكل تعليقٍ بلا ردّ — فما رددنا به من تطبيق لينكدإن يُعرف', async () => {
    const URN = 'urn:li:comment:(urn:li:activity:71,74)';
    db.prepare(
      "INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, metrics_json) VALUES ('a1', 'urn:li:share:7', 'linkedin_page', ?, '[]')",
    ).run(RECENT);
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: '107440355', platform: 'linkedin', type: 'corporate', displayName: 'شركة ناف القانونية' }] } });
    routes['GET /comments/urn:li:share:7'] = () => ({ body: { status: 'success', linkedin: [
      { comment: 'هل تقدّمون استشارة؟', commentId: URN, commentUrn: URN, created: RECENT, from: { name: 'ريم', id: 'rz_1' }, userName: 'reem' },
    ] } });
    routes[`GET /comments/${URN}`] = (url) => {
      expect(url.searchParams.get('commentId')).toBe('true');
      expect(url.searchParams.get('platform')).toBe('linkedin');
      return { body: { linkedin: [
        { comment: 'هل تقدّمون استشارة؟', commentId: URN, from: { name: 'ريم' } },
        { comment: 'نعم، راسلنا', commentId: '75', created: RECENT, from: { name: 'شركة ناف القانونية', id: 'org' } },
      ] } };
    };
    await syncComments(env);
    expect(rows()[0]).toMatchObject({ platform: 'linkedin_page', reply_body: 'نعم، راسلنا', reply_source: 'external' });
  });
});

describe('ما سُحب أيام SocialAPI', () => {
  beforeEach(() => {
    db.prepare(
      "INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, metrics_json) VALUES ('a1', 'T0', 'x', ?, '[]')",
    ).run(RECENT);
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'x1', platform: 'twitter', username: 'naf' }] } });
    routes['GET /comments/T0'] = () => ({ body: { twitter: [
      { comment: 'سؤال قديم', commentId: 'T1', created: RECENT, userName: 'client', name: 'عميل' },
      { comment: 'جواب من تطبيق إكس', commentId: 'T2', created: RECENT, userName: 'naf', referencedTweets: [{ type: 'replied_to', id: 'T1' }] },
      { comment: 'سؤال ثانٍ', commentId: 'T3', created: RECENT, userName: 'client2', name: 'عميل ٢' },
    ] } });
    const ins = db.prepare("INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at, reply_body, reply_source) VALUES (?, ?, ?, 'comment', 'عميل', ?, ?, ?, ?)");
    // بمعرّفات SocialAPI: «منشور|حساب|تعليق»
    ins.run('old1', 'twitter', 'sp_post|acc_x|T1', 'سؤال قديم', RECENT, null, null);
    ins.run('old3', 'x', 'sp_post|acc_x|T3', 'سؤال ثانٍ', RECENT, 'رددنا من المنصة', 'platform');
    // وصفٌّ جديد كُتب بمعرّف Ayrshare قبل الضمّ — التعليق نفسه مرّتين
    ins.run('new3', 'x', 'ayc|twitter|T0|T3|', 'سؤال ثانٍ', RECENT, null, null);
  });

  it('يُنقل القديم إلى معرّف Ayrshare بردّه، ويُضمّ المكرّر ويُحذف قديمه', async () => {
    await syncComments(env);
    const all = db.prepare('SELECT id, platform, provider_comment_id, reply_body, reply_source FROM platform_comments ORDER BY provider_comment_id').all();
    expect(all).toEqual([
      // القديم نفسه بمعرّفه الجديد — وعرف ردَّنا من تطبيق إكس
      { id: 'old1', platform: 'x', provider_comment_id: 'ayc|twitter|T0|T1|', reply_body: 'جواب من تطبيق إكس', reply_source: 'external' },
      // المكرّر: بقي الجديد بردّ القديم
      { id: 'new3', platform: 'x', provider_comment_id: 'ayc|twitter|T0|T3|', reply_body: 'رددنا من المنصة', reply_source: 'platform' },
    ]);
  });
});

describe('الردّ عبر Ayrshare', () => {
  const insert = (id: string, providerId: string, platform: string, kind = 'comment') =>
    db.prepare("INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at) VALUES (?, ?, ?, ?, 'عميل', 'نص', ?)")
      .run(id, platform, providerId, kind, RECENT);

  it('تعليق تيك توك: بمعرّف المنصة ومعرّف المقطع، ويُحفظ معرّف الردّ', async () => {
    insert('c1', encodeAyrshareComment('tiktok', 'V9', 'C5'), 'tiktok');
    routes['POST /comments/reply/C5'] = () => ({ body: { status: 'success', tiktok: { status: 'success', commentId: 'C6', sourceCommentId: 'C5' } } });
    await replyToComment(env, 'c1', 'شكراً', 'u1');
    expect(calls.at(-1)!.body).toEqual({ platforms: ['tiktok'], comment: 'شكراً', searchPlatformId: true, videoId: 'V9' });
    expect(rows()[0]).toMatchObject({ reply_body: 'شكراً', reply_provider_id: 'C6', reply_source: 'platform' });
  });

  it('لينكدإن بـ commentUrn، والرسالة إلى المُراسِل، والمراجعة بـ reviewId', async () => {
    insert('c1', 'ayc|linkedin|urn:li:share:1|7|urn:li:comment:(urn:li:activity:1,7)', 'linkedin_page');
    insert('c2', 'ayd|instagram|conv1|igsid_9', 'instagram', 'dm');
    insert('c3', 'ayr|gmb|R1', 'google', 'review');
    routes['POST /comments/reply/7'] = () => ({ body: { linkedin: { commentId: '8' } } });
    routes['POST /messages/instagram'] = () => ({ body: { status: 'success', messageId: 'aWd1' } });
    routes['POST /reviews'] = () => ({ body: { gmb: { action: 'reply', status: 'success', id: 'R1' } } });

    await replyToComment(env, 'c1', 'أهلاً', 'u1');
    await replyToComment(env, 'c2', 'مرحباً', 'u1');
    await replyToComment(env, 'c3', 'نعتذر', 'u1');
    expect(calls.find((c) => c.key === 'POST /comments/reply/7')!.body.commentUrn).toBe('urn:li:comment:(urn:li:activity:1,7)');
    expect(calls.find((c) => c.key === 'POST /messages/instagram')!.body).toEqual({ recipientId: 'igsid_9', message: 'مرحباً' });
    expect(calls.find((c) => c.key === 'POST /reviews')!.body).toEqual({ platform: 'gmb', reviewId: 'R1', reply: 'نعتذر' });
  });

  it('ما لا تتيحه المنصة يُقال قبل أيّ طلب — والمتاح يُنفَّذ بمعرّف المنصة', async () => {
    insert('c1', encodeAyrshareComment('instagram', 'M1', 'C1'), 'instagram');
    insert('c2', encodeAyrshareComment('youtube', 'Y1', 'C2'), 'youtube');
    await expect(moderateComment(env, 'c1', 'hide')).rejects.toThrow(/إخفاء التعليق على إنستغرام غير متاح/);
    await expect(replyToComment(env, 'c2', 'شكراً', 'u1')).rejects.toThrow(/الردّ على التعليقات على يوتيوب غير متاح/);
    expect(calls).toEqual([]);

    routes['DELETE /comments/C1'] = () => ({ body: { status: 'success' } });
    await moderateComment(env, 'c1', 'delete');
    expect(calls.at(-1)!.body).toEqual({ searchPlatformId: true, platform: 'instagram' });
    expect(rows().map((r) => r.id)).toEqual(['c2']);
  });

  it('حذف ردّنا بمعرّفه على المنصة', async () => {
    insert('c1', encodeAyrshareComment('facebook', 'P1', 'P1_1'), 'facebook');
    db.prepare("UPDATE platform_comments SET reply_body = 'رد', reply_provider_id = 'P1_9' WHERE id = 'c1'").run();
    routes['DELETE /comments/P1_9'] = () => ({ body: { status: 'success' } });
    await deleteReply(env, 'c1');
    expect(calls.at(-1)!.body).toEqual({ searchPlatformId: true, platform: 'facebook' });
    expect(rows()[0].reply_body).toBeNull();
  });
});

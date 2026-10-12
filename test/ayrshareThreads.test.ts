// سلسلة الردود تحت التعليق — ما كُتب من تطبيق المنصة ومن هنا ومن العملاء —
// على قاعدةٍ حقيقية ومزوّدٍ مخنوق. والأشكال من صفحة «Get Comments» في توثيق
// Ayrshare: ردود فيسبوك وإنستغرام وتيك توك ويوتيوب وثريدز في `replies`،
// وإكس قائمةٌ مسطّحة بآبائها في `referencedTweets`، ولينكدإن بطلبٍ لكل تعليق.

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

import { syncComments, replyToComment, queuePendingPost } from '../src/services/commentsSync';
import { mapAyrshareComments, encodeAyrshareComment } from '../src/adapters/ayrshare';
import { mergeThread, sortThread, threadDecision, type ThreadEntry } from '../src/services/inboxThread';
import { commentEventPost } from '../src/routes/webhooks';

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

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const RECENT = ago(48);

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
  routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'fb_page', platform: 'facebook', pageName: 'ناف' }] } });
  routes['GET /reviews'] = () => ({ status: 400, body: { status: 'error', code: 350 } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const row = (id = 'ayc|facebook|P1|P1_1|'): any => db.prepare('SELECT * FROM platform_comments WHERE provider_comment_id = ?').get(id);
const threadOf = (r: any): ThreadEntry[] => JSON.parse(r.thread_json);
const snapshot = (postId: string, platform: string, comments = 1) =>
  db.prepare("INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, metrics_json) VALUES (?, ?, ?, ?, ?)")
    .run(`a_${postId}`, postId, platform, RECENT, JSON.stringify([{ type: 'comments', value: comments }]));

describe('السلسلة من ردّ Ayrshare', () => {
  it('فيسبوك: ردُّنا وردُّ العميل بعده كلاهما في السلسلة — والتعليق «بلا رد» لأن العميل كتب آخراً', () => {
    const [item] = mapAyrshareComments('facebook', 'P1', {
      facebook: [{
        comment: 'كم الرسوم؟', commentId: 'P1_1', created: ago(5), from: { name: 'سارة', id: '9' },
        replies: [
          { comment: 'وما المدة؟', commentId: 'P1_3', created: ago(1), from: { name: 'سارة', id: '9' } },
          { comment: 'نرسلها خاصاً', commentId: 'P1_2', created: ago(3), company: true, from: { name: 'ناف', id: 'fb_page' } },
        ],
      }],
    }, ['fb_page']);
    expect(item.thread!.map((e) => [e.id, e.own])).toEqual([['P1_2', true], ['P1_3', false]]);
    expect(item.repliedBody).toBeNull();
    expect(item.capabilities).toMatchObject({ can_reply: true });
  });

  it('إنستغرام: معرّف الردّ في `id`، ويوتيوب وثريدز لا يُردّ عليهما من هنا', () => {
    const at = '2026-10-10T08:00:00.000Z';
    const [ig] = mapAyrshareComments('instagram', 'M1', {
      instagram: [{ comment: 'سؤال', commentId: 'C1', created: ago(5), from: { id: '7', name: 'نورة' },
        replies: [{ comment: '@nora أهلاً', id: 'C2', created: at, from: { id: 'ig1', username: 'naf' }, username: 'naf' }] }],
    }, ['ig1', 'naf']);
    expect(ig.thread).toEqual([{ id: 'C2', author: 'naf', own: true, body: '@nora أهلاً', at }]);
    expect(ig.repliedBody).toBe('@nora أهلاً');

    for (const p of ['youtube', 'threads']) {
      const [it] = mapAyrshareComments(p, 'V1', { [p]: [{ comment: 'شكراً', commentId: 'Y1', created: ago(2), userName: 'client' }] }, []);
      expect(it.capabilities).toMatchObject({ can_reply: false });
    }
  });

  it('تعليقُنا الذي ردّ عليه عميل: عنصرٌ كاتبُه العميل، ومعرّفه تعليقُنا فيقع الردّ تحته، ولا يُحذف من بطاقته', () => {
    const items = mapAyrshareComments('facebook', 'P1', {
      facebook: [
        { comment: 'الرابط في التعليق', commentId: 'P1_9', created: ago(6), from: { id: 'fb_page' },
          replies: [{ comment: 'الرابط لا يفتح', commentId: 'P1_10', created: ago(2), from: { name: 'خالد', id: '5' } }] },
        { comment: 'تعليقنا بلا ردود', commentId: 'P1_11', created: ago(6), from: { id: 'fb_page' } },
      ],
    }, ['fb_page']);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'ayc|facebook|P1|P1_9|', authorName: 'خالد', body: 'الرابط لا يفتح', thread: [],
      capabilities: { can_hide: false, can_delete: false, can_reply: true },
    });
  });

  it('إكس: المحادثة شجرة — ردُّ العميل على ردّنا في سلسلة تعليقه، وتكملةُ منشورنا ليست محادثة', () => {
    const items = mapAyrshareComments('twitter', 'POST', {
      twitter: [
        { comment: 'سؤال', commentId: 'A', created: ago(6), userName: 'client', name: 'عميل', referencedTweets: [{ type: 'replied_to', id: 'POST' }] },
        { comment: 'جواب', commentId: 'R1', created: ago(5), userName: 'naf', referencedTweets: [{ type: 'replied_to', id: 'A' }] },
        { comment: 'وماذا بعد؟', commentId: 'A2', created: ago(4), userName: 'client', name: 'عميل', referencedTweets: [{ type: 'replied_to', id: 'R1' }] },
        { comment: 'تكملة المنشور', commentId: 'T2', created: ago(7), userName: 'naf', referencedTweets: [{ type: 'replied_to', id: 'POST' }] },
        { comment: 'على التكملة', commentId: 'B', created: ago(3), userName: 'other', name: 'آخر', referencedTweets: [{ type: 'replied_to', id: 'T2' }] },
        { comment: 'رأي', commentId: 'C', created: ago(3), userName: 'c3', name: 'ثالث', referencedTweets: [{ type: 'replied_to', id: 'POST' }] },
        { comment: 'أوافق', commentId: 'D', created: ago(2), userName: 'c4', name: 'رابع', referencedTweets: [{ type: 'replied_to', id: 'C' }] },
      ],
    }, ['naf']);
    const byId = Object.fromEntries(items.map((i) => [i.id.split('|')[3], i]));
    expect(Object.keys(byId).sort()).toEqual(['A', 'B', 'C']);
    expect(byId.A.thread!.map((e) => e.id)).toEqual(['R1', 'A2']);
    expect(byId.A.repliedBody).toBeNull();
    expect(byId.B.thread).toEqual([]);
    expect(byId.C.thread!.map((e) => e.id)).toEqual(['D']);
  });

  it('لينكدإن بلا ردودٍ في القائمة لا يحمل سلسلة — تُطلب لكل تعليقٍ ولا تُمحى المحفوظة', () => {
    const [li] = mapAyrshareComments('linkedin', 'urn:li:share:1', {
      linkedin: [{ comment: 'شكراً', commentId: '7', created: ago(2), from: { name: 'خالد' } }],
    }, []);
    expect('thread' in li).toBe(false);
  });
});

describe('حال التعليق من سلسلته', () => {
  const e = (id: string, own: boolean, h: number, here = false): ThreadEntry => ({ id, author: '', own, body: id, at: ago(h), ...(here ? { here } : {}) });

  it('ردٌّ محفوظ لا يُعرف وقته لا يُعاد به التعليق «بلا رد»', () => {
    expect(threadDecision([e('x', false, 1)], { reply_body: 'قديم', replied_at: null, ignored_at: null })).toEqual({ action: 'none' });
    expect(threadDecision([e('x', false, 1)], { reply_body: 'رد', replied_at: ago(2), ignored_at: null })).toEqual({ action: 'reopen' });
  });

  it('ردٌّ من هنا لم تُعده المنصة بعد يبقى يوماً، وما عاد منها يحمل علامته', () => {
    const merged = mergeThread([e('mine', true, 0.1, true)], [e('c', false, 2)]);
    expect(merged.map((x) => x.id)).toEqual(['c', 'mine']);
    expect(mergeThread([e('old', true, 30, true)], [])).toEqual([]);
    expect(mergeThread([], [{ ...e('r9', false, 1) }], ['r9'])[0]).toMatchObject({ own: true, here: true });
  });

  it('ما لا وقت له يبقى بعد سابقه', () => {
    expect(sortThread([e('b', false, 1), { ...e('n', false, 0), at: null }, e('a', false, 3)]).map((x) => x.id)).toEqual(['a', 'b', 'n']);
  });
});

describe('المزامنة بالسلسلة', () => {
  beforeEach(() => snapshot('P1', 'facebook'));

  it('ردُّنا من التطبيق يجيبه، وردُّ العميل بعده يعيده «بلا رد» وتبقى السلسلة كلّها', async () => {
    const base = { comment: 'كم الرسوم؟', commentId: 'P1_1', created: ago(5), from: { name: 'سارة', id: '9' } };
    const ours = { comment: 'نرسلها خاصاً', commentId: 'P1_2', created: ago(3), company: true, from: { name: 'ناف', id: 'fb_page' } };
    routes['GET /comments/P1'] = () => ({ body: { facebook: [{ ...base, replies: [ours] }] } });
    await syncComments(env);
    expect(row()).toMatchObject({ reply_body: 'نرسلها خاصاً', reply_source: 'external' });

    routes['GET /comments/P1'] = () => ({ body: { facebook: [{ ...base, replies: [ours,
      { comment: 'لم تصلني', commentId: 'P1_3', created: ago(1), from: { name: 'سارة', id: '9' } }] }] } });
    db.prepare("UPDATE analytics_snapshots SET metrics_json = ? WHERE provider_post_id = 'P1'").run(JSON.stringify([{ type: 'comments', value: 3 }]));
    await syncComments(env);
    const r = row();
    expect(r).toMatchObject({ reply_body: null, reply_source: null });
    expect(threadOf(r).map((x) => [x.id, x.own])).toEqual([['P1_2', true], ['P1_3', false]]);
  });

  it('ردٌّ من هنا يُكتب في السلسلة باسم كاتبه، ولا يُعاد «بلا رد» قبل أن تعيده المنصة', async () => {
    routes['GET /comments/P1'] = () => ({ body: { facebook: [{ comment: 'متى تفتحون؟', commentId: 'P1_1', created: ago(5), from: { name: 'سارة', id: '9' } }] } });
    await syncComments(env);
    routes['POST /comments/reply/P1_1'] = () => ({ body: { facebook: { commentId: 'P1_7' } } });
    await replyToComment(env, row().id, 'الساعة التاسعة', 'u1');
    expect(threadOf(row())).toEqual([expect.objectContaining({ id: 'P1_7', author: 'فهد', own: true, here: true, body: 'الساعة التاسعة' })]);

    // Ayrshare لم يحدّث تعليقاته بعد: ردُّنا ليس فيها
    db.prepare("UPDATE inbox_post_state SET synced_at = NULL").run();
    await syncComments(env);
    expect(row()).toMatchObject({ reply_body: 'الساعة التاسعة', reply_source: 'platform' });

    // ثم عاد ردُّنا منها بمعرّفه — يبقى «من هنا»
    routes['GET /comments/P1'] = () => ({ body: { facebook: [{ comment: 'متى تفتحون؟', commentId: 'P1_1', created: ago(5), from: { name: 'سارة', id: '9' },
      replies: [{ comment: 'الساعة التاسعة', commentId: 'P1_7', created: ago(0), company: true, from: { name: 'ناف', id: 'fb_page' } }] }] } });
    db.prepare("UPDATE inbox_post_state SET synced_at = NULL").run();
    await syncComments(env);
    expect(threadOf(row())).toEqual([expect.objectContaining({ id: 'P1_7', here: true, own: true })]);
    expect(row()).toMatchObject({ reply_body: 'الساعة التاسعة', reply_source: 'platform' });
  });

  it('المتجاهَل يعود «بلا رد» إن كتب صاحبه في سلسلته بعد التجاهل', async () => {
    const base = { comment: 'شكراً', commentId: 'P1_1', created: ago(10), from: { name: 'سارة', id: '9' } };
    routes['GET /comments/P1'] = () => ({ body: { facebook: [base] } });
    await syncComments(env);
    db.prepare('UPDATE platform_comments SET ignored_at = ?, ignored_by = ?').run(ago(5), 'u1');
    routes['GET /comments/P1'] = () => ({ body: { facebook: [{ ...base, replies: [{ comment: 'وعندي سؤال', commentId: 'P1_4', created: ago(1), from: { name: 'سارة', id: '9' } }] }] } });
    db.prepare("UPDATE inbox_post_state SET synced_at = NULL").run();
    await syncComments(env);
    expect(row()).toMatchObject({ ignored_at: null, reply_body: null });
  });

  it('المنشور يُعاد كل ستّ ساعات ولو لم يتغيّر عدد تعليقاته', async () => {
    routes['GET /comments/P1'] = () => ({ body: { facebook: [] } });
    await syncComments(env);
    calls = [];
    await syncComments(env);
    expect(calls.some((c) => c.key === 'GET /comments/P1')).toBe(false);
    db.prepare('UPDATE inbox_post_state SET synced_at = ?').run(ago(7));
    await syncComments(env);
    expect(calls.some((c) => c.key === 'GET /comments/P1')).toBe(true);
  });
});

describe('ما يخصّ الحساب لا يُختم المنشور مقروءاً', () => {
  it('رصيد إكس نفد: يُقال، ولا يُطلب باقي منشورات إكس، وتُعاد في الدورة التالية', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'x1', platform: 'twitter', username: 'naf' }, { id: 'fb_page', platform: 'facebook' }] } });
    snapshot('T1', 'x');
    snapshot('T2', 'x');
    snapshot('P1', 'facebook');
    let credits = false;
    const xRoute = () => (credits ? { body: { twitter: [] } } : { status: 402, body: { status: 'error', code: 416, message: 'X credits depleted' } });
    routes['GET /comments/T1'] = xRoute;
    routes['GET /comments/T2'] = xRoute;
    routes['GET /comments/P1'] = () => ({ body: { facebook: [] } });

    const report = await syncComments(env);
    expect(calls.filter((c) => c.key.startsWith('GET /comments/T'))).toHaveLength(1);
    expect(calls.some((c) => c.key === 'GET /comments/P1')).toBe(true);
    expect(report?.errors[0]).toMatch(/^تعليقات إكس: .*credits/);

    credits = true;
    calls = [];
    await syncComments(env);
    expect(calls.filter((c) => c.key.startsWith('GET /comments/T'))).toHaveLength(2);
  });
});

describe('الخطّاف يُقرئ منشورَ التعليق أوّلاً', () => {
  it('منشور إنستغرام لم يصل لقطاتِه بعد يُقرأ من الخطّاف ثم يخرج من القائمة', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'ig1', platform: 'instagram', username: 'naf' }] } });
    routes['GET /comments/M9'] = (url) => {
      expect(url.searchParams.get('platform')).toBe('instagram');
      return { body: { instagram: [{ comment: 'جميل', commentId: 'C1', created: ago(0.1), from: { id: '5', name: 'ريم' } }] } };
    };
    const post = commentEventPost({ action: 'comments', platform: 'instagram', id: 'C1', media: { id: 'M9' }, postId: 'AYR' });
    expect(post).toEqual({ platform: 'instagram', postId: 'M9' });
    await queuePendingPost(env, post!);
    await syncComments(env, { trigger: 'webhook' });
    expect(row('ayc|instagram|M9|C1|')).toMatchObject({ author_name: 'ريم', platform: 'instagram' });
    expect(db.prepare("SELECT value FROM settings WHERE key = 'inbox_pending_posts'").get().value).toBe('[]');
  });

  it('فيسبوك بشكل ميتا: معرّف المنشور من post_id', () => {
    expect(commentEventPost({ platform: 'facebook', entry: [{ changes: [{ value: { post_id: '10_20', comment_id: '20_30' } }] }] }))
      .toEqual({ platform: 'facebook', postId: '10_20' });
    expect(commentEventPost({ platform: 'facebook', post_id: '10_21' })).toEqual({ platform: 'facebook', postId: '10_21' });
    expect(commentEventPost({ platform: 'tiktok' })).toBeNull();
  });
});

describe('الردّ على محادثة إكس', () => {
  it('يُرسل إلى آخر ما كتبه العميل فيها لا إلى أوّلها', async () => {
    db.prepare(
      "INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at, thread_json) VALUES ('c1', 'x', ?, 'comment', 'عميل', 'سؤال', ?, ?)",
    ).run(encodeAyrshareComment('twitter', 'POST', 'A'), RECENT, JSON.stringify([
      { id: 'R1', author: 'naf', own: true, body: 'جواب', at: ago(5) },
      { id: 'A2', author: 'عميل', own: false, body: 'وماذا بعد؟', at: ago(4) },
    ]));
    routes['POST /comments/reply/A2'] = () => ({ body: { twitter: { commentId: 'R2' } } });
    await replyToComment(env, 'c1', 'نتواصل معك', 'u1');
    expect(calls.at(-1)!.body).toMatchObject({ platforms: ['twitter'], comment: 'نتواصل معك', searchPlatformId: true });
    expect(threadOf(row(encodeAyrshareComment('twitter', 'POST', 'A'))).map((e) => e.id)).toEqual(['R1', 'A2', 'R2']);
  });
});

describe('سلاسل لينكدإن', () => {
  it('تُطلب لما رُدّ عليه أيضاً — فردُّ العميل بعد ردّنا من التطبيق يعيده «بلا رد»', async () => {
    const URN = 'urn:li:comment:(urn:li:activity:71,74)';
    snapshot('urn:li:share:7', 'linkedin_page');
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: '1074', platform: 'linkedin', type: 'corporate', displayName: 'ناف' }] } });
    routes['GET /comments/urn:li:share:7'] = () => ({ body: { linkedin: [
      { comment: 'هل تقدّمون استشارة؟', commentId: URN, commentUrn: URN, created: ago(6), from: { name: 'ريم', id: 'rz' } },
    ] } });
    let replies: any[] = [{ comment: 'نعم، راسلنا', commentId: '75', created: ago(5), from: { name: 'ناف', id: '1074' } }];
    routes[`GET /comments/${URN}`] = () => ({ body: { linkedin: [{ comment: 'هل تقدّمون استشارة؟', commentId: URN, from: { name: 'ريم' } }, ...replies] } });

    await syncComments(env);
    const id = `ayc|linkedin|urn:li:share:7|${URN}|${URN}`;
    expect(row(id)).toMatchObject({ platform: 'linkedin_page', reply_body: 'نعم، راسلنا', reply_source: 'external' });

    replies = [...replies, { comment: 'أرسلت لكم', commentId: '76', created: ago(1), from: { name: 'ريم', id: 'rz' } }];
    db.prepare('UPDATE inbox_post_state SET synced_at = NULL').run();
    await syncComments(env);
    expect(row(id)).toMatchObject({ reply_body: null });
    expect(threadOf(row(id)).map((e) => e.id)).toEqual(['75', '76']);
    expect(row(id).reply_checked_at).not.toBeNull();
  });
});

describe('صفوف إكس القديمة', () => {
  it('ردُّ العميل على ردّنا كان عنصراً مستقلاً — يُرفع صفُّه حين يصير في سلسلة تعليقه', async () => {
    routes['GET /user'] = () => ({ body: { displayNames: [{ id: 'x1', platform: 'twitter', username: 'naf' }] } });
    snapshot('POST', 'x');
    // كُتب قبل السلسلة: ردُّ العميل على ردّنا عنصرٌ «بلا رد» وحده
    db.prepare("INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at) VALUES ('old', 'x', 'ayc|twitter|POST|A2|', 'comment', 'عميل', 'وماذا بعد؟', ?)").run(RECENT);
    routes['GET /comments/POST'] = () => ({ body: { twitter: [
      { comment: 'سؤال', commentId: 'A', created: ago(6), userName: 'client', referencedTweets: [{ type: 'replied_to', id: 'POST' }] },
      { comment: 'جواب', commentId: 'R1', created: ago(5), userName: 'naf', referencedTweets: [{ type: 'replied_to', id: 'A' }] },
      { comment: 'وماذا بعد؟', commentId: 'A2', created: ago(4), userName: 'client', referencedTweets: [{ type: 'replied_to', id: 'R1' }] },
    ] } });
    await syncComments(env);
    const all = db.prepare('SELECT provider_comment_id, reply_body FROM platform_comments').all();
    expect(all).toEqual([{ provider_comment_id: 'ayc|twitter|POST|A|', reply_body: null }]);
  });
});

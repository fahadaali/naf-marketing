// تغطية الصندوق: لماذا لا تظهر تعليقات منشورٍ قديم أو منشورٍ من خارج المنصة.
// قاعدةٌ حقيقية من الهجرات، والتقرير قراءةٌ منها وحدها.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { commentsCoverage } from '../src/services/commentsCoverage';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const norm = (a: unknown) => (a === undefined ? null : a as any);
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a.map(norm); return stmt; },
        async first<T>() { return (db.prepare(sql).get(...args) ?? null) as T; },
        async all<T>() { return { results: db.prepare(sql).all(...args) as T[] }; },
        async run() { db.prepare(sql).run(...args); return { success: true }; },
      };
      return stmt;
    },
  };
}

let db: any;
let env: any;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  env = { DB: d1(db) };
});

function snap(id: string, platform: string, sentAt: string | null) {
  db.prepare('INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at) VALUES (?, ?, ?, ?)')
    .run(`an_${id}`, id, platform, sentAt);
}

describe('تغطية الصندوق', () => {
  it('يعدّ لكل منصة ما لم يُقرأ، وما قُرئ بلا تعليق، وما بمعرّف مزوّدٍ سابق، وما باسمٍ لا يعرفه السحب', async () => {
    const recent = new Date().toISOString();
    snap('1790000000000000001', 'x', recent); // قُرئ وعليه تعليق
    snap('1790000000000000002', 'x', '2025-01-01T00:00:00Z'); // قديم، قُرئ بلا تعليق
    snap('5f8d0d55b54764421b7156c9', 'x', '2024-06-01T00:00:00Z'); // معرّف Buffer، لم يُقرأ
    snap('9b1c-uuid:linkedin_page', 'linkedin_page', null); // نائب SocialAPI بلا تاريخ
    snap('1700', 'twitter', '2024-01-01T00:00:00Z'); // اسمٌ قديم
    db.prepare("INSERT INTO inbox_post_state (inbox_post_id, account_id, synced_at) VALUES ('1790000000000000001','ayrshare:twitter','2026-10-01')").run();
    db.prepare("INSERT INTO inbox_post_state (inbox_post_id, account_id, synced_at) VALUES ('1790000000000000002','ayrshare:twitter','2026-10-01')").run();
    db.prepare("INSERT INTO platform_comments (id, platform, provider_comment_id, kind) VALUES ('c1','x','ayc|twitter|1790000000000000001|c9|','comment')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('account_history:acc_x', '{\"cursor\":null,\"doneAt\":\"2026-09-20T00:00:00Z\"}')").run();

    const out = await commentsCoverage(env);
    const by = Object.fromEntries(out.platforms.map((p) => [p.platform, p]));
    expect(by.x).toMatchObject({
      recognised: true, posts: 3, no_date: 0, older_than_30d: 2, legacy_id: 1,
      never_read: 1, read_without_comments: 1, with_comments: 1,
    });
    expect(by.linkedin_page).toMatchObject({ recognised: true, posts: 1, no_date: 1, legacy_id: 1, never_read: 1 });
    expect(by.twitter).toMatchObject({ recognised: false, posts: 1 });
    expect(out.comments).toEqual([{ platform: 'x', count: 1, oldest: expect.any(String) }]);
    expect(out.history).toEqual([{ account: 'acc_x', state: '{"cursor":null,"doneAt":"2026-09-20T00:00:00Z"}' }]);
    // قُرئ قبل أن تُحفظ نتيجة الطلب
    expect(by.x).toMatchObject({ outcome_unknown: 1, read_empty: 0, not_found: 0, rejected: 0 });
    expect(out.last_sync).toBeNull();
  });

  it('يفرّق «قُرئ بلا تعليقات» بنتيجة الطلب، ويقابل ما وصل بما تعلنه التحليلات', async () => {
    const recent = new Date().toISOString();
    const add = db.prepare('INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, metrics_json) VALUES (?, ?, ?, ?, ?)');
    const comments = (n: number) => JSON.stringify([{ type: 'likes', name: 'likeCount', value: 4, unit: 'count' }, { type: 'comments', name: 'commentsCount', value: n, unit: 'count' }]);
    add.run('an_1', 'I1', 'instagram', recent, comments(3)); // تعلن ثلاثاً، قُرئ فارغاً
    add.run('an_2', 'I2', 'instagram', recent, comments(0)); // لا تعليق، قُرئ فارغاً
    add.run('an_3', 'I3', 'instagram', recent, comments(2)); // تعلن اثنين، «غير موجود»
    add.run('an_4', 'I4', 'instagram', recent, comments(1)); // تعلن واحداً، رُفض
    add.run('an_5', 'I5', 'instagram', recent, comments(5)); // تعلن خمساً، ووصل منها
    add.run('an_6', 'I6', 'instagram', recent, '{"comments":"x"}'); // صيغةٌ أخرى لا تُكسر القراءة
    const state = db.prepare("INSERT INTO inbox_post_state (inbox_post_id, account_id, synced_at, outcome) VALUES (?, 'ayrshare:instagram', ?, ?)");
    state.run('I1', recent, 'ok');
    state.run('I2', recent, 'ok');
    state.run('I3', recent, 'not_found');
    state.run('I4', recent, 'rejected');
    state.run('I5', recent, 'ok');
    state.run('I6', null, null); // أُعيد للطلب بعد الهجرة
    db.prepare("INSERT INTO platform_comments (id, platform, provider_comment_id, kind) VALUES ('c1','instagram','ayc|instagram|I5|c9|','comment')").run();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('inbox_sync_report', JSON.stringify({
      at: recent, complete: true, errors: [], notFound: { instagram: 1 }, rejected: { instagram: 1 },
    }));

    const out = await commentsCoverage(env);
    expect(out.platforms[0]).toMatchObject({
      platform: 'instagram', posts: 6, never_read: 0,
      read_without_comments: 5, read_empty: 2, not_found: 1, rejected: 1, outcome_unknown: 1, with_comments: 1,
      analytics_with_comments: 4, analytics_comments_missing: 3,
    });
    expect(out.last_sync).toEqual({ at: recent, complete: true, not_found: { instagram: 1 }, rejected: { instagram: 1 }, errors: [] });
    // وكلُّ منشورٍ يستحق النظر بعينه: لماذا، وماذا تعلن المنصة
    expect(out.details.map((d) => [d.key, d.reason, d.outcome, d.announced])).toEqual([
      ['I1', 'comments_missing', 'ok', 3],
      ['I3', 'not_found', 'not_found', 2],
      ['I4', 'rejected', 'rejected', 1],
    ]);
  });

  it('«عُرف معرّفه الأصلي» من لقطات المزوّد السابق وحدها', async () => {
    db.prepare("INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, native_post_id) VALUES ('an_1', '7420000000000000001', 'tiktok', ?, '7420000000000000002')").run(new Date().toISOString());
    db.prepare("INSERT INTO analytics_snapshots (id, provider_post_id, platform, sent_at, native_post_id) VALUES ('an_2', '5f8d0d55b54764421b7156c9', 'youtube', ?, 'dQw4w9WgXcQ')").run(new Date().toISOString());
    const out = await commentsCoverage(env);
    const by = Object.fromEntries(out.platforms.map((p) => [p.platform, p]));
    expect(by.tiktok).toMatchObject({ legacy_id: 0, legacy_resolved: 0 });
    expect(by.youtube).toMatchObject({ legacy_id: 1, legacy_resolved: 1 });
  });
});

describe('أسماء المنصات القديمة في اللقطات (0046)', () => {
  it('تُردّ إلى مفاتيحنا بالخريطة المسجّلة، ولا يُمسّ لينكدإن', () => {
    const fresh = new DatabaseSync(':memory:');
    fresh.exec('PRAGMA foreign_keys = OFF');
    const files = readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort();
    const at = files.indexOf('0046_snapshot_platform_keys.sql');
    for (const f of files.slice(0, at)) fresh.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    const ins = fresh.prepare('INSERT INTO analytics_snapshots (id, provider_post_id, platform) VALUES (?, ?, ?)');
    ins.run('a', 'p_a', 'twitter');
    ins.run('b', 'p_b', 'Instagram');
    ins.run('c', 'p_c', 'linkedin');
    ins.run('d', 'p_d', 'googlebusiness');
    ins.run('e', 'p_e', 'unknown');
    fresh.exec(readFileSync(join(MIGRATIONS, files[at]), 'utf8'));
    const got = Object.fromEntries(fresh.prepare('SELECT id, platform FROM analytics_snapshots').all().map((r: any) => [r.id, r.platform]));
    expect(got).toEqual({ a: 'x', b: 'instagram', c: 'linkedin', d: 'google', e: 'unknown' });
  });
});

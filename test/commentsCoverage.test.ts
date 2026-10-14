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

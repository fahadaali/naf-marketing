// تنبيه المحتوى العالق: تنبيهٌ واحد كل عشرين ساعة لكل منشور.
//
// وكان الحدّ `datetime('now', '-20 hours')` يُقارَن نصّاً بـ `created_at` المكتوب
// بصيغة `…T…Z`: المسافة قبل `T` في الترتيب، فكل تنبيهٍ في يوم الحدّ يُعدّ «حديثاً»
// أيّاً كانت ساعته، فيسقط تنبيه يومٍ كامل عن منشورٍ ما زال عالقاً.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { checkStaleContent } from '../src/services/alerts';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: any[]) => stmts.map((s) => ({ meta: { changes: db.prepare(s.sql).run(...s.binds).changes } })),
  };
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

let db: any;
let env: any;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('gm','فهد','f@naf.sa','h','general_manager',1)").run();
  // عالقٌ عند الاعتماد النهائي خمسة أيام — والحدّ ثلاثة
  db.prepare("INSERT INTO content_posts (id, title, body, status, author_id, updated_at) VALUES ('p1', 'عنوان', '<p>نص</p>', 'pending_gm', 'gm', ?)")
    .run(iso(Date.now() - 5 * 86_400_000));
  env = { DB: d1(db) };
});

const alerts = () => db.prepare("SELECT created_at FROM notifications WHERE type = 'stale_alert' AND link = '/editor/p1'").all();
const priorAlert = (at: string) =>
  db.prepare("INSERT INTO notifications (id, user_id, type, title, link, created_at) VALUES ('n0', 'gm', 'stale_alert', 'قديم', '/editor/p1', ?)").run(at);

describe('تنبيه المحتوى العالق', () => {
  it('تنبيهٌ قبل أكثر من عشرين ساعة في يوم الحدّ نفسه لا يمنع تنبيه اليوم', async () => {
    // بداية اليوم الذي يقع فيه الحدّ: أقدم من عشرين ساعة دائماً، وتاريخه تاريخ الحدّ
    const cutoff = new Date(Date.now() - 20 * 3_600_000 - 60_000);
    priorAlert(iso(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate())));
    await checkStaleContent(env);
    expect(alerts()).toHaveLength(2);
  });

  it('وتنبيهٌ قبل ساعة يمنعه — لا يتكرّر', async () => {
    priorAlert(iso(Date.now() - 3_600_000));
    await checkStaleContent(env);
    expect(alerts()).toHaveLength(1);
  });
});

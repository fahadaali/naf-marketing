// هجرة خطة المحتوى (0033) على SQLite حقيقية، فوق قاعدةٍ فيها محتوى قائم.
//
// ما يُثبَّت: أن الأعمدة تُضاف ولا يُعاد بناء الجدول — فلا يُمسّ صفٌّ قائم
// ولا ابنٌ له ولا فهرس FTS — وأن الشكل يُملأ من النوع، وأن مسؤول التنفيذ
// مفتاحٌ أجنبيّ حقيقيّ إلى users كما تفترض قائمة USER_REFERENCES.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort();
const TARGET = FILES.find((f) => f.startsWith('0033_'))!;

/** القاعدة كما هي في الإنتاج قبل 0033، وفيها محتوى بأنواعه الثلاثة وموعد. */
function before() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of FILES.filter((f) => f < TARGET)) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name) VALUES ('usr_1','فهد','f@naf.sa','h','general_manager')").run();
  const post = db.prepare('INSERT INTO content_posts (id,title,body,content_type,status,author_id) VALUES (?,?,?,?,?,?)');
  post.run('post_t', 'نص', 'alphaword', 'text', 'draft', 'usr_1');
  post.run('post_i', 'صورة', 'betaword', 'image', 'approved', 'usr_1');
  post.run('post_v', 'فيديو', 'gammaword', 'video', 'scheduled', 'usr_1');
  db.prepare("INSERT INTO schedules (id,post_id,platform,scheduled_at) VALUES ('sch_1','post_v','x','2026-11-01T09:00:00.000Z')").run();
  return db;
}

/** يطبّق 0033 كما يطبّقها D1: والمفاتيح مفعّلة. */
function migrate(db: any) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(MIGRATIONS, TARGET), 'utf8'));
  return db;
}

const columns = (db: any) => db.prepare('PRAGMA table_info(content_posts)').all() as any[];

describe('هجرة خطة المحتوى 0033', () => {
  it('تضيف الأعمدة الستة، وكلُّها اختياري إلا الشكل وافتراضه نص', () => {
    const db = migrate(before());
    const cols = Object.fromEntries(columns(db).map((c) => [c.name, c]));
    for (const name of ['planned_on', 'planned_platforms', 'assignee_id', 'pillar', 'brief']) {
      expect(cols[name], name).toBeDefined();
      expect(cols[name].notnull, name).toBe(0);
    }
    expect(cols.format.notnull).toBe(1);
    expect(cols.format.dflt_value).toBe("'text'");
  });

  it('الشكل يُملأ من النوع، وما عداه فارغ', () => {
    const db = migrate(before());
    const rows = db.prepare('SELECT id, format, planned_on, assignee_id FROM content_posts ORDER BY id').all() as any[];
    expect(rows.map((r) => [r.id, r.format])).toEqual([
      ['post_i', 'image'], ['post_t', 'text'], ['post_v', 'video'],
    ]);
    expect(rows.every((r) => r.planned_on === null && r.assignee_id === null)).toBe(true);
  });

  it('لا تمسّ الحالة ولا الأبناء: الموعد باقٍ والحالات كما كانت', () => {
    const db = migrate(before());
    const status = db.prepare('SELECT id, status FROM content_posts ORDER BY id').all() as any[];
    expect(status.map((r) => r.status)).toEqual(['approved', 'draft', 'scheduled']);
    expect((db.prepare('SELECT COUNT(*) n FROM schedules').get() as any).n).toBe(1);
  });

  it('البحث النصّي ما زال يجد كل صفّ مرةً واحدة', () => {
    const db = migrate(before());
    const find = (w: string) =>
      (db.prepare('SELECT p.id FROM content_search s JOIN content_posts p ON p.rowid = s.rowid WHERE content_search MATCH ?').all(w) as any[]).map((r) => r.id);
    expect(find('alphaword')).toEqual(['post_t']);
    expect(find('betaword')).toEqual(['post_i']);
    expect(find('gammaword')).toEqual(['post_v']);
  });

  it('تنشئ فهرسَي اليوم المستهدف والمواعيد بالمحتوى', () => {
    const db = migrate(before());
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as any[]).map((r) => r.name);
    expect(idx).toContain('idx_posts_planned');
    expect(idx).toContain('idx_schedules_post');
  });

  it('مسؤول التنفيذ مفتاحٌ أجنبيّ إلى users، والقاعدة سليمة بعد الهجرة', () => {
    const db = migrate(before());
    const fks = db.prepare('PRAGMA foreign_key_list(content_posts)').all() as any[];
    expect(fks.some((f) => f.from === 'assignee_id' && f.table === 'users' && f.to === 'id')).toBe(true);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    db.prepare("UPDATE content_posts SET assignee_id = 'usr_1' WHERE id = 'post_t'").run();
    expect(() => db.prepare("UPDATE content_posts SET assignee_id = 'usr_ghost' WHERE id = 'post_t'").run())
      .toThrow(/FOREIGN KEY/i);
  });

  it('الشكل بلا قيد: شكلٌ جديد يُخزَّن، والتحقق في الكود', () => {
    const db = migrate(before());
    db.prepare(
      "INSERT INTO content_posts (id,title,content_type,format,author_id,planned_on,planned_platforms) VALUES ('post_c','كاروسيل','image','carousel','usr_1','2026-11-12','[\"linkedin\"]')",
    ).run();
    const row = db.prepare("SELECT format, planned_on, body FROM content_posts WHERE id = 'post_c'").get() as any;
    expect(row).toEqual({ format: 'carousel', planned_on: '2026-11-12', body: '' });
  });
});

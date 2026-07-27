// اختبار الترحيل الكسول على SQLite **حقيقية** بالمخطّط الفعلي.
//
// الاختبار الآخر (sso.test.ts) يتحقّق من العبارات المبنيّة على بديل في
// الذاكرة — يثبت أن كل عمود ذُكر ولا واحد نُسي. وهذا يثبت ما لا يثبته ذاك:
// أن العبارات تعمل فعلاً على محرّك بمفاتيح أجنبية مفعّلة، وأن
// defer_foreign_keys حاملة لا زينة.
//
// node:sqlite مدمج في Node 22 — لا حزمة جديدة، والمحرّك هو محرّك D1 نفسه.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// استيراد عند التشغيل لا بالتحليل الساكن: node:sqlite أحدث من قائمة
// الوحدات المدمجة التي يعرفها vite، فيحاول حلّها كحزمة ويفشل.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};
type DatabaseSync = any;
import { USER_REFERENCES } from '../src/sso';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');
const OLD = 'usr_old01';
const SUB = 'sub-from-naf-id-9f2c';

/** يبني القاعدة من ملفات الهجرة نفسها — لا من مخطّط مكتوب في الاختبار. */
function build(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  // node:sqlite يفعّل المفاتيح افتراضياً. تُطفأ للبناء والزرع، وتُفعّل
  // في migrate() — فالمقصود اختبار الترحيل لا واقعيّة بيانات الزرع.
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return db;
}

/** أول قيمة يقبلها قيد CHECK على العمود، إن وُجد قيد. */
function allowedValue(db: DatabaseSync, table: string, column: string): string | null {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as { sql: string };
  const m = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i').exec(row.sql);
  return m ? (/'([^']*)'/.exec(m[1])?.[1] ?? null) : null;
}

/**
 * يزرع صفّاً في كل جدول من الأحد عشر، بأعمدة مستنبطة من المخطّط.
 * المفاتيح مطفأة أثناء الزرع، فالمقصود وجود صفوف مرتبطة لا واقعيّتها.
 */
function seed(db: DatabaseSync): number {
  db.prepare('INSERT INTO users (id,name,email,password_hash,role_name) VALUES (?,?,?,?,?)')
    .run(OLD, 'فهد', 'fahad@naf.sa', 'hash', 'general_manager');
  db.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES ('sess_legacy',?,'2030-01-01T00:00:00Z')")
    .run(OLD);

  USER_REFERENCES.forEach(([table, column], i) => {
    const cols: string[] = [];
    const vals: (string | number)[] = [];
    for (const c of db.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
      const isInt = String(c.type || '').toUpperCase().includes('INT');
      if (c.name === column) {
        cols.push(c.name); vals.push(OLD);
      } else if (c.pk && isInt) {
        continue; // rowid يتولّى نفسه
      } else if (c.pk || (c.notnull && c.dflt_value === null)) {
        cols.push(c.name);
        vals.push(allowedValue(db, table, c.name) ?? (isInt ? i + 1 : `${table.slice(0, 6)}_${i}`));
      }
    }
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  });

  return USER_REFERENCES.length;
}

/** عبارات linkOrCreateUser حرفياً، في معاملة واحدة كما يفعلها DB.batch. */
function migrate(db: DatabaseSync, { defer }: { defer: boolean }) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('BEGIN');
  if (defer) db.exec('PRAGMA defer_foreign_keys = ON');
  db.prepare('UPDATE users SET id = ? WHERE id = ?').run(SUB, OLD);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(OLD);
  for (const [t, c] of USER_REFERENCES) {
    db.prepare(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`).run(SUB, OLD);
  }
  db.exec('COMMIT');
}

const countOld = (db: DatabaseSync, t: string, c: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${c} = ?`).get(OLD) as { n: number }).n;

describe('الترحيل الكسول على SQLite حقيقية', () => {
  it('ينقل كل عمود مرتبط ولا يترك صفّاً على المعرّف القديم', () => {
    const db = build();
    const seeded = seed(db);
    migrate(db, { defer: true });

    expect((db.prepare('SELECT COUNT(*) n FROM users WHERE id=?').get(SUB) as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM users WHERE id=?').get(OLD) as any).n).toBe(0);

    for (const [t, c] of USER_REFERENCES) {
      expect(countOld(db, t, c), `${t}.${c} بقي على المعرّف القديم`).toBe(0);
    }
    const moved = USER_REFERENCES.reduce(
      (n, [t, c]) => n + (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${c}=?`).get(SUB) as any).n,
      0,
    );
    expect(moved).toBe(seeded);
  });

  it('لا يترك مرجعاً معلّقاً إلى users', () => {
    const db = build();
    seed(db);
    migrate(db, { defer: true });

    // ما يمسّه الترحيل وحده. وما عداه من الزرع — صفوف يتيمة أُدرجت
    // والمفاتيح مطفأة، وعدّها فشلاً يقيس الاختبار لا المُختبَر.
    const dangling = (db.prepare('PRAGMA foreign_key_check').all() as any[]).filter(
      (v) => v.parent === 'users',
    );
    expect(dangling).toEqual([]);
  });

  it('defer_foreign_keys حاملة لا زينة — بدونها يفشل', () => {
    const db = build();
    seed(db);
    // لولا التأجيل لفشل تغيير المفتاح الأساسي عند أول عبارة، لأن أبناءه
    // يشيرون إليه ولا ON UPDATE CASCADE على أيٍّ منها.
    expect(() => migrate(db, { defer: false })).toThrow(/FOREIGN KEY/i);
  });

  it('التراجع لا يترك القاعدة نصف مُرحَّلة', () => {
    const db = build();
    seed(db);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('BEGIN');
    db.exec('PRAGMA defer_foreign_keys = ON');
    db.prepare('UPDATE users SET id = ? WHERE id = ?').run(SUB, OLD);
    db.prepare('UPDATE content_posts SET author_id = ? WHERE author_id = ?').run(SUB, OLD);
    db.exec('ROLLBACK'); // يحاكي انقطاعاً في منتصف الدفعة

    expect((db.prepare('SELECT COUNT(*) n FROM users WHERE id=?').get(OLD) as any).n).toBe(1);
    expect(countOld(db, 'content_posts', 'author_id')).toBe(1);
  });

  it('الدور وحالة التفعيل لا يُمسّان', () => {
    const db = build();
    seed(db);
    migrate(db, { defer: true });
    const row = db.prepare('SELECT role_name, is_active FROM users WHERE id=?').get(SUB) as any;
    expect(row.role_name).toBe('general_manager');
    expect(row.is_active).toBe(1);
  });

  it('الجلسة القديمة تُطرح لا تُرحَّل', () => {
    const db = build();
    seed(db);
    migrate(db, { defer: true });
    // ترحيلها يبقي باباً مفتوحاً بمصادقة النظام القديم.
    expect((db.prepare('SELECT COUNT(*) n FROM sessions').get() as any).n).toBe(0);
  });
});

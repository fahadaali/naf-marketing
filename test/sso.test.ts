// اختبارات الترحيل الكسول — أخطر ما في الربط: يمسّ أحد عشر عموداً
// في معاملة واحدة. يُختبر على بديل بسيط لـ D1 يسجّل ما نُفّذ.

import { describe, it, expect } from 'vitest';
import { linkOrCreateUser, USER_REFERENCES, DEFAULT_ROLE } from '../src/sso';
import type { Env } from '../src/types';

type Recorded = { sql: string; args: unknown[] };

function fakeDb(rows: Record<string, unknown> | null | ((sql: string, args: unknown[]) => unknown)) {
  const run: Recorded[] = [];
  const batched: Recorded[][] = [];

  const db = {
    prepare(sql: string) {
      const stmt: any = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args;
          return stmt;
        },
        async first() {
          run.push({ sql, args: stmt.args });
          return typeof rows === 'function' ? rows(sql, stmt.args) : rows;
        },
        async run() {
          run.push({ sql, args: stmt.args });
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(statements: any[]) {
      batched.push(statements.map((s) => ({ sql: s.sql, args: s.args })));
      return statements.map(() => ({ success: true }));
    },
  };

  return { db, run, batched };
}

const env = (db: unknown) => ({ DB: db } as unknown as Env);

describe('الترحيل الكسول', () => {
  it('عضو مُرحَّل سلفاً لا يُكتب له شيء', async () => {
    const { db, batched, run } = fakeDb((sql) => (sql.includes('WHERE id = ?') ? { id: 'sub-1' } : null));
    await linkOrCreateUser(env(db), { sub: 'sub-1', email: 'f@example.com' });

    expect(batched).toHaveLength(0);
    expect(run.filter((r) => r.sql.includes('INSERT'))).toHaveLength(0);
  });

  it('عضو جديد تماماً يُنشأ بكلمة مرور فارغة وبأقلّ الأدوار', async () => {
    const { db, run, batched } = fakeDb(null);
    await linkOrCreateUser(env(db), { sub: 'sub-9', email: 'New@Example.com', name: 'فهد' });

    const insert = run.find((r) => r.sql.includes('INSERT INTO users'));
    expect(insert).toBeDefined();
    // password_hash هنا NOT NULL ومستخدم الدخول الموحّد بلا كلمة مرور.
    expect(insert!.sql).toContain("''");
    expect(insert!.args).toEqual(['sub-9', 'فهد', 'new@example.com', DEFAULT_ROLE]);
    // إنشاء لا ترحيل — لا معاملة.
    expect(batched).toHaveLength(0);
  });

  it('عضو قائم يُطابَق بالبريد ويُرحَّل في معاملة واحدة', async () => {
    const { db, batched } = fakeDb((sql) =>
      sql.includes('lower(email)') ? { id: 'usr_old' } : null,
    );
    await linkOrCreateUser(env(db), { sub: 'sub-2', email: 'f@example.com' });

    expect(batched).toHaveLength(1);
    const tx = batched[0];

    // تأجيل المفاتيح أولاً: تغيير المفتاح الأساسي يترك أبناءه معلّقين لحظة.
    expect(tx[0].sql).toContain('defer_foreign_keys');
    expect(tx[1].sql).toContain('UPDATE users SET id');
    expect(tx[1].args).toEqual(['sub-2', 'usr_old']);

    // الجلسات القديمة تُطرح لا تُرحَّل.
    expect(tx.some((s) => s.sql.startsWith('DELETE FROM sessions'))).toBe(true);

    // كل عمود مرتبط حُدّث، ولا واحد نُسي.
    for (const [table, column] of USER_REFERENCES) {
      const stmt = tx.find((s) => s.sql === `UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`);
      expect(stmt, `${table}.${column} لم يُرحَّل`).toBeDefined();
      expect(stmt!.args).toEqual(['sub-2', 'usr_old']);
    }

    // مجموع العبارات: تأجيل + users + sessions + الأعمدة المرتبطة.
    expect(tx).toHaveLength(3 + USER_REFERENCES.length);
  });

  it('كل عبارات الترحيل في معاملة واحدة لا متفرّقة', async () => {
    const { db, run, batched } = fakeDb((sql) => (sql.includes('lower(email)') ? { id: 'usr_old' } : null));
    await linkOrCreateUser(env(db), { sub: 'sub-3', email: 'f@example.com' });

    // خارج المعاملة قراءتان فقط؛ ولو خرج تحديث واحد منها لبقيت القاعدة
    // نصف مُرحَّلة عند أي فشل.
    expect(run.every((r) => r.sql.startsWith('SELECT'))).toBe(true);
    expect(batched).toHaveLength(1);
  });

  it('المطابقة بالبريد لا تتأثر بحالة الأحرف', async () => {
    const { db, run } = fakeDb((sql) => (sql.includes('lower(email)') ? { id: 'usr_old' } : null));
    await linkOrCreateUser(env(db), { sub: 'sub-4', email: 'FAHAD@Example.COM' });

    const lookup = run.find((r) => r.sql.includes('lower(email)'));
    expect(lookup!.sql).toContain('lower(email) = lower(?)');
  });

  it('خريطة الأعمدة تطابق المخطّط الحيّ', () => {
    // اثنا عشر عموداً — وsessions.user_id خارجها: يُطرح لا يُرحَّل.
    expect(USER_REFERENCES).toHaveLength(12);
    // platform_comments لا platform_comments_new: أُعيد بناؤه في 0015.
    expect(USER_REFERENCES.map(([t]) => t)).toContain('platform_comments');
    expect(USER_REFERENCES.map(([t]) => t)).not.toContain('platform_comments_new');
    expect(USER_REFERENCES.map(([t]) => t)).not.toContain('sessions');
  });
});

// تشخيص Ayrshare — يُخرج الشكل والمعرّفات، وأسماءَ الكتّاب مقنّعةً، ولا نصَّ تعليق.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { diagnoseAyrshare } from '../src/routes/ayrshare';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) };
}

afterEach(() => vi.unstubAllGlobals());

describe('تشخيص Ayrshare', () => {
  it('يُظهر كيف يُعرف ردُّنا ولا يكشف نصّاً ولا اسم عميل', async () => {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
      db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    }
    db.prepare("INSERT INTO platform_comments (id, platform, provider_comment_id, kind, body, created_at) VALUES ('c1', 'x', 'ayc|twitter|T0|T1|', 'comment', 'نص', '2026-10-08T10:00:00Z')").run();

    vi.stubGlobal('fetch', async (input: string) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/user') return new Response(JSON.stringify({ displayNames: [{ id: 'x1', platform: 'twitter', username: 'naflaw' }] }));
      if (path === '/api/comments/T0') {
        return new Response(JSON.stringify({ status: 'success', twitter: [
          { comment: 'سرّ العميل', commentId: 'T1', userName: 'customer_handle', name: 'اسم العميل' },
          { comment: 'ردّنا', commentId: 'T2', userName: 'NAFLAW', referencedTweets: [{ type: 'replied_to', id: 'T1' }] },
        ] }));
      }
      return new Response('{}', { status: 404 });
    });

    const out = await diagnoseAyrshare({ DB: d1(db) } as any, { key: 'k' });
    const text = JSON.stringify(out);
    expect(text).not.toContain('سرّ العميل');
    expect(text).not.toContain('ردّنا');
    expect(text).not.toContain('customer_handle');
    expect(text).not.toContain('اسم العميل');

    const [post] = out.inbox as any[];
    expect(post).toMatchObject({ platform: 'x', postId: 'T0', waitingCommentIds: ['T1'], count: 2 });
    expect(post.entries[0]).toMatchObject({ commentId: 'T1', isOwn: false, author: { userName: { hint: 'cus…(15)', ours: false } } });
    expect(post.entries[1]).toMatchObject({ commentId: 'T2', isOwn: true, author: { userName: { ours: true } } });
  });
});

// مزامنة المحتوى مع بطاقات بيسكامب — والفكرة بلا بطاقة حتى يُكتب نصّها.
//
// عميل بيسكامب مُستبدَل: ما يُختبر هنا قرارُ المزامنة (تُنشأ البطاقة أم لا،
// وبأيّ استحقاق)، لا الطلبات نفسها.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const STAGES = ['draft', 'pending_marketing', 'pending_gm', 'approved', 'scheduled', 'published', 'rejected', 'archived'];

vi.mock('../src/services/basecamp', () => ({
  isConfigured: vi.fn(async () => true),
  // أعمدة المراحل محفوظة سلفاً، فلا يُسأل بيسكامب عن جدول البطاقات
  setting: vi.fn(async (_env: unknown, key: string) =>
    key === 'basecamp_stage_cols' ? JSON.stringify(Object.fromEntries(STAGES.map((s) => [s, `col_${s}`]))) : null),
  getMgmtProjectId: vi.fn(async () => 'proj_1'),
  getCardTableId: vi.fn(),
  getColumns: vi.fn(),
  createColumn: vi.fn(),
  getProjectPeopleIds: vi.fn(async () => [11, 12]),
  createCard: vi.fn(async () => 'card_new'),
  updateCard: vi.fn(async () => {}),
  moveCard: vi.fn(async () => {}),
  trashRecording: vi.fn(async () => {}),
  createAttachment: vi.fn(),
  getComments: vi.fn(async () => []),
}));
vi.mock('../src/services/notify', () => ({ notifyUsers: vi.fn(), usersWithPermission: vi.fn(async () => []) }));

import { syncPost } from '../src/services/basecampSync';
import * as basecamp from '../src/services/basecamp';

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
  vi.clearAllMocks();
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name) VALUES ('usr_1','فهد','f@naf.sa','h','general_manager')").run();
  env = { DB: d1(db) };
});

function seedPost(id: string, body: string, planned_on: string | null = '2026-11-12') {
  db.prepare(
    "INSERT INTO content_posts (id,title,body,status,author_id,planned_on) VALUES (?,'عنوان',?,'draft','usr_1',?)",
  ).run(id, body, planned_on);
}

describe('الفكرة وبطاقة بيسكامب', () => {
  it('فكرةٌ بلا بطاقة لا تُنشأ لها بطاقة', async () => {
    seedPost('p1', '');
    await syncPost(env, 'p1');
    expect(basecamp.createCard).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) n FROM basecamp_tasks').get().n).toBe(0);
  });

  it('أوّلُ نصٍّ يُكتب يُنشئها، واستحقاقُها اليوم المستهدف ما لم تُجدول', async () => {
    seedPost('p1', '<p>نص</p>');
    await syncPost(env, 'p1');
    expect(basecamp.createCard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(basecamp.createCard).mock.calls[0][3]).toMatchObject({ due_on: '2026-11-12', assignee_ids: [11, 12] });
    expect(db.prepare("SELECT stage FROM basecamp_tasks WHERE post_id = 'p1'").get().stage).toBe('draft');
  });

  it('وموعد النشر يسبق اليوم المستهدف في الاستحقاق', async () => {
    seedPost('p1', '<p>نص</p>');
    // ٢٣:٣٠ بتوقيت غرينتش يومُ ٢٠ في الرياض
    db.prepare("INSERT INTO schedules (id,post_id,platform,scheduled_at,status) VALUES ('s1','p1','x','2026-11-19T23:30:00.000Z','pending')").run();
    await syncPost(env, 'p1');
    expect(vi.mocked(basecamp.createCard).mock.calls[0][3]).toMatchObject({ due_on: '2026-11-20' });
  });

  it('مسودةٌ لها بطاقة ثم مُسح نصّها: تبقى بطاقتها تُحدَّث', async () => {
    seedPost('p1', '');
    db.prepare("INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage,updated_at) VALUES ('p1','card_old','col_draft','draft','2026-10-01T00:00:00Z')").run();
    await syncPost(env, 'p1');
    expect(basecamp.createCard).not.toHaveBeenCalled();
    expect(basecamp.updateCard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(basecamp.updateCard).mock.calls[0][2]).toBe('card_old');
  });

  it('بلا يومٍ مستهدف ولا موعد: لا استحقاق', async () => {
    seedPost('p1', '<p>نص</p>', null);
    await syncPost(env, 'p1');
    expect(vi.mocked(basecamp.createCard).mock.calls[0][3]).toMatchObject({ due_on: null });
  });
});

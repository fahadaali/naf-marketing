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
  listCards: vi.fn(async () => []),
}));
vi.mock('../src/services/notify', () => ({ notifyUsers: vi.fn(), usersWithPermission: vi.fn(async () => []) }));

import { syncPost, reconcileStages, findOrphanCards } from '../src/services/basecampSync';
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
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
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

describe('بطاقةٌ واحدة لكل منشور', () => {
  it('مزامنتان معاً — حفظٌ ثم إرسالٌ للمراجعة — تُنشئان بطاقةً واحدة في مرحلتها الأخيرة', async () => {
    seedPost('p1', '<p>نص</p>');
    // الإنشاء يتأخّر، وفي أثنائه يُرسل المنشور للمراجعة وتبدأ المزامنة الثانية
    let release!: () => void;
    vi.mocked(basecamp.createCard).mockImplementationOnce(
      () => new Promise((r) => { release = () => r('card_1'); }),
    );
    const first = syncPost(env, 'p1');
    await new Promise((r) => setTimeout(r, 0));
    db.prepare("UPDATE content_posts SET status = 'pending_marketing' WHERE id = 'p1'").run();
    await syncPost(env, 'p1');
    release();
    await first;

    expect(basecamp.createCard).toHaveBeenCalledTimes(1);
    const row = db.prepare("SELECT todo_id, stage FROM basecamp_tasks WHERE post_id = 'p1'").get();
    expect(row).toMatchObject({ todo_id: 'card_1', stage: 'pending_marketing' });
    expect(basecamp.moveCard).toHaveBeenCalledWith(env, 'proj_1', 'card_1', 'col_pending_marketing');
  });

  it('فشلُ الإنشاء يُفلت الحجز فتُنشئها المزامنة التالية', async () => {
    seedPost('p1', '<p>نص</p>');
    vi.mocked(basecamp.createCard).mockRejectedValueOnce(new Error('503'));
    await expect(syncPost(env, 'p1')).rejects.toThrow('503');
    expect(db.prepare('SELECT COUNT(*) n FROM basecamp_tasks').get().n).toBe(0);
    await syncPost(env, 'p1');
    expect(db.prepare("SELECT todo_id FROM basecamp_tasks WHERE post_id = 'p1'").get().todo_id).toBe('card_new');
  });

  it('حجزٌ قديمٌ لم يتمّ يُؤخذ، والحديثُ يُترك لصاحبه', async () => {
    seedPost('p1', '<p>نص</p>');
    db.prepare("INSERT INTO basecamp_tasks (post_id,todo_id,stage,updated_at) VALUES ('p1',NULL,'creating',strftime('%Y-%m-%dT%H:%M:%SZ','now'))").run();
    await syncPost(env, 'p1');
    expect(basecamp.createCard).not.toHaveBeenCalled();

    db.prepare("UPDATE basecamp_tasks SET updated_at = '2026-01-01T00:00:00Z' WHERE post_id = 'p1'").run();
    await syncPost(env, 'p1');
    expect(basecamp.createCard).toHaveBeenCalledTimes(1);
  });

  it('النشر في موعده يُدرَك دورياً فتنتقل البطاقة إلى «منشور»', async () => {
    seedPost('p1', '<p>نص</p>');
    db.prepare("INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage,updated_at) VALUES ('p1','card_1','col_scheduled','scheduled','2026-10-01T00:00:00Z')").run();
    db.prepare("UPDATE content_posts SET status = 'published' WHERE id = 'p1'").run();
    expect(await reconcileStages(env)).toBe(1);
    expect(basecamp.moveCard).toHaveBeenCalledWith(env, 'proj_1', 'card_1', 'col_published');
    expect(await reconcileStages(env)).toBe(0);
  });
});

describe('تقرير البطاقات اليتيمة', () => {
  it('يسرد ما لا يربطه النظام بمنشور، ويدلّ على المنشور الذي تبدو نسخةً منه', async () => {
    seedPost('p1', '<p>نص</p>');
    db.prepare("INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage) VALUES ('p1','card_1','col_published','published')").run();
    vi.mocked(basecamp.getCardTableId).mockResolvedValueOnce('ct_1');
    vi.mocked(basecamp.getColumns).mockResolvedValueOnce([
      { id: 'col_draft', title: 'المسودات' }, { id: 'col_published', title: 'منشور' },
    ]);
    vi.mocked(basecamp.listCards).mockImplementation(async (_e, _p, col) => (col === 'col_draft'
      ? [{ id: 'card_2', title: 'عنوان', app_url: 'https://3.basecamp.com/c/2', created_at: '2026-10-01' }]
      : [{ id: 'card_1', title: 'عنوان', app_url: 'https://3.basecamp.com/c/1', created_at: '2026-10-01' }]));
    const orphans = await findOrphanCards(env);
    expect(orphans).toEqual([
      { id: 'card_2', title: 'عنوان', column: 'المسودات', url: 'https://3.basecamp.com/c/2', created_at: '2026-10-01', post_id: 'p1' },
    ]);
    expect(basecamp.trashRecording).not.toHaveBeenCalled();
  });
});

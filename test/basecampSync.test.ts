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
  createCard: vi.fn(async () => ({ id: 'card_new', title: 'عنوان', content: '<div>نص</div>' })),
  updateCard: vi.fn(async () => ({ title: 'عنوان', content: '<div>نص</div>' })),
  moveCard: vi.fn(async () => {}),
  trashRecording: vi.fn(async () => {}),
  createAttachment: vi.fn(),
  getComments: vi.fn(async () => []),
  listCards: vi.fn(async () => []),
  getProjectPeople: vi.fn(async () => [{ id: 11, sgid: 'sg_11', name: 'أ' }, { id: 12, sgid: 'sg_12', name: 'ب' }]),
  createComment: vi.fn(async () => 'cm_1'),
  lastActor: vi.fn(async () => null),
  getCard: vi.fn(),
}));
vi.mock('../src/services/notify', () => ({
  notifyUsers: vi.fn(), usersWithPermission: vi.fn(async () => []), notifyStageReached: vi.fn(async () => {}),
}));

import {
  syncPost, reconcileStages, findOrphanCards, resyncAll, syncCardCommentsForPost, trashOrphanCards, pullCardChanges, cardContentToBody,
  pullCardForPost, refreshCardFormat, CARD_FORMAT,
} from '../src/services/basecampSync';
import * as basecamp from '../src/services/basecamp';
import * as notify from '../src/services/notify';

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
      () => new Promise((r) => { release = () => r({ id: 'card_1', title: 'عنوان', content: '' }); }),
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

describe('إشعار المرحلة في بيسكامب', () => {
  it('إنشاءُ البطاقة يُعلَن بتعليقٍ يذكر كل أعضاء المشروع', async () => {
    seedPost('p1', '<p>نص</p>');
    await syncPost(env, 'p1');
    expect(basecamp.createComment).toHaveBeenCalledTimes(1);
    const [, , card, html] = vi.mocked(basecamp.createComment).mock.calls[0];
    expect(card).toBe('card_new');
    expect(html).toContain('أُنشئ في «المسودات» — بواسطة فهد');
    expect(html).toContain('<bc-attachment sgid="sg_11"></bc-attachment>');
    expect(html).toContain('<bc-attachment sgid="sg_12"></bc-attachment>');
  });

  it('انتقالُ المرحلة يُعلَن باسم من نقلها، والتحديثُ بلا انتقال لا يُعلَن', async () => {
    seedPost('p1', '<p>نص</p>');
    db.prepare("INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage) VALUES ('p1','card_1','col_pending_gm','pending_gm')").run();
    db.prepare("UPDATE content_posts SET status = 'approved' WHERE id = 'p1'").run();
    db.prepare("INSERT INTO approvals (id,post_id,from_status,to_status,actor_id) VALUES ('a1','p1','pending_gm','approved','usr_1')").run();
    await syncPost(env, 'p1');
    expect(vi.mocked(basecamp.createComment).mock.calls[0][3]).toContain('انتقل إلى «معتمد» — بواسطة فهد');
    await syncPost(env, 'p1');
    expect(basecamp.createComment).toHaveBeenCalledTimes(1);
  });

  it('تعليقُ المنصة لا يعود ملاحظةً على المنشور', async () => {
    seedPost('p1', '<p>نص</p>');
    await syncPost(env, 'p1');
    vi.mocked(basecamp.getComments).mockResolvedValueOnce([
      { id: 'cm_1' as any, content: 'أُنشئ في «المسودات»', created_at: '', creator_name: 'ناف' },
      { id: 'cm_2' as any, content: 'راجعوا العنوان', created_at: '', creator_name: 'سارة' },
    ]);
    expect(await syncCardCommentsForPost(env, 'p1')).toBe(1);
    expect(db.prepare("SELECT body FROM post_notes WHERE post_id = 'p1'").all().map((r: any) => r.body)).toEqual(['راجعوا العنوان']);
  });

  it('إعادة المزامنة الشاملة لا تُعلن شيئاً', async () => {
    seedPost('p1', '<p>نص</p>');
    await resyncAll(env);
    expect(basecamp.createCard).toHaveBeenCalledTimes(1);
    expect(basecamp.createComment).not.toHaveBeenCalled();
  });

  it('تعذّرُ الإعلان لا يعطّل نقل البطاقة', async () => {
    seedPost('p1', '<p>نص</p>');
    vi.mocked(basecamp.createComment).mockRejectedValueOnce(new Error('422'));
    await syncPost(env, 'p1');
    expect(db.prepare("SELECT todo_id FROM basecamp_tasks WHERE post_id = 'p1'").get().todo_id).toBe('card_new');
  });
});

describe('نقل البطاقات اليتيمة إلى السلّة', () => {
  it('ما سمّاه المدير ويكون الآن يتيماً مكرّراً وحده — وما سواه يُترك', async () => {
    seedPost('p1', '<p>نص</p>');
    db.prepare("INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage) VALUES ('p1','card_1','col_published','published')").run();
    vi.mocked(basecamp.getCardTableId).mockResolvedValueOnce('ct_1');
    vi.mocked(basecamp.getColumns).mockResolvedValueOnce([{ id: 'col_draft', title: 'المسودات' }]);
    vi.mocked(basecamp.listCards).mockResolvedValueOnce([
      { id: 'card_1', title: 'عنوان', app_url: '', created_at: '' }, // مربوطة
      { id: 'card_2', title: 'عنوان', app_url: '', created_at: '' }, // نسخة مكرّرة
      { id: 'card_3', title: 'بطاقة يدوية', app_url: '', created_at: '' }, // يتيمة بلا منشور
    ]);
    const res = await trashOrphanCards(env, ['card_1', 'card_2', 'card_3', 'card_9']);
    expect(res).toEqual({ trashed: ['card_2'], skipped: ['card_1', 'card_3', 'card_9'] });
    expect(basecamp.trashRecording).toHaveBeenCalledTimes(1);
    expect(basecamp.trashRecording).toHaveBeenCalledWith(env, 'proj_1', 'card_2');
  });
});

describe('السحب العكسي: ما جرى في بيسكامب يصل المنصة', () => {
  const COLS = STAGES.map((s) => ({ id: `col_${s}`, title: s }));
  // بطاقةٌ مربوطة نصُّها المحفوظ كما ردّه بيسكامب، وكتابةُ المنصة فيها قديمة
  function seedTracked(status: string, snap: [string, string] | null = ['عنوان', '<div>نص</div>']) {
    db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p1','عنوان','<p>نص</p>',?,'usr_1')").run(status);
    db.prepare(
      `INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage,updated_at,card_title,card_content)
       VALUES ('p1','card_1',?,?,'2026-01-01T00:00:00Z',?,?)`,
    ).run(`col_${status}`, status, snap?.[0] ?? null, snap?.[1] ?? null);
  }
  function cardIn(col: string, over: Partial<basecamp.BcCard> = {}) {
    vi.mocked(basecamp.getCardTableId).mockResolvedValue('ct_1');
    vi.mocked(basecamp.getColumns).mockResolvedValue(COLS);
    vi.mocked(basecamp.listCards).mockImplementation(async (_e, _p, c) => (c === col
      ? [{ id: 'card_1', title: 'عنوان', app_url: '', created_at: '', content: '<div>نص</div>', column_id: col, ...over }]
      : []));
  }
  const fahad = { id: 'bc_1', name: 'فهد', email: 'F@naf.sa' };
  const post = () => db.prepare("SELECT title, body, status, reject_reason FROM content_posts WHERE id = 'p1'").get();

  it('نقلُ البطاقة إلى عمودٍ آخر يغيّر مرحلة المنشور ويُسجَّل باسم من نقلها', async () => {
    seedTracked('pending_marketing');
    cardIn('col_pending_gm');
    vi.mocked(basecamp.lastActor).mockResolvedValue(fahad);
    expect(await pullCardChanges(env)).toEqual({ moved: 1, edited: 0 });
    expect(post().status).toBe('pending_gm');
    expect(db.prepare("SELECT from_status, to_status, actor_id FROM approvals WHERE post_id = 'p1'").get())
      .toEqual({ from_status: 'pending_marketing', to_status: 'pending_gm', actor_id: 'usr_1' });
    expect(db.prepare("SELECT list_id, stage FROM basecamp_tasks WHERE post_id = 'p1'").get())
      .toEqual({ list_id: 'col_pending_gm', stage: 'pending_gm' });
    expect(notify.notifyStageReached).toHaveBeenCalledWith(env, 'p1', 'pending_gm');
    // ولا يعيدها التصحيح الدوري إلى عمودها القديم
    expect(await reconcileStages(env)).toBe(0);
    expect(basecamp.moveCard).not.toHaveBeenCalled();
  });

  it('أيُّ نقلةٍ تُطبَّق ولو تجاوزت التسلسل، ومن لا حساب له يُنقل منشوره بلا سطرٍ في سجلّ الاعتماد', async () => {
    seedTracked('draft');
    cardIn('col_approved');
    vi.mocked(basecamp.lastActor).mockResolvedValue({ id: 'bc_9', name: 'زائر', email: 'x@other.com' });
    await pullCardChanges(env);
    expect(post().status).toBe('approved');
    expect(db.prepare("SELECT COUNT(*) n FROM approvals").get().n).toBe(0);
  });

  it('بطاقةٌ في عمودها لا تُمسّ، والمنصةُ إذ سبقتها بمرحلةٍ لا تُعاد إلى الوراء', async () => {
    seedTracked('pending_marketing');
    db.prepare("UPDATE content_posts SET status = 'pending_gm' WHERE id = 'p1'").run();
    cardIn('col_pending_marketing');
    expect(await pullCardChanges(env)).toEqual({ moved: 0, edited: 0 });
    expect(post().status).toBe('pending_gm');
  });

  it('عمودٌ ليس لمرحلة لا معنى له في المنصة', async () => {
    seedTracked('draft');
    vi.mocked(basecamp.getCardTableId).mockResolvedValue('ct_1');
    vi.mocked(basecamp.getColumns).mockResolvedValue([...COLS, { id: 'col_x', title: 'أفكار' }]);
    vi.mocked(basecamp.listCards).mockImplementation(async (_e, _p, c) => (c === 'col_x'
      ? [{ id: 'card_1', title: 'عنوان', app_url: '', created_at: '', content: '<div>نص</div>', column_id: 'col_x' }] : []));
    await pullCardChanges(env);
    expect(post().status).toBe('draft');
  });

  it('الرفض يأخذ سببه من آخر تعليقٍ لمن نقلها', async () => {
    seedTracked('pending_gm');
    cardIn('col_rejected');
    vi.mocked(basecamp.lastActor).mockResolvedValue(fahad);
    vi.mocked(basecamp.getComments).mockResolvedValueOnce([
      { id: 1, content: 'سببٌ قديم', created_at: '2026-10-01T00:00:00Z', creator_name: 'فهد', creator_id: 'bc_1' },
      { id: 2, content: 'العنوان طويل', created_at: '2026-10-02T00:00:00Z', creator_name: 'فهد', creator_id: 'bc_1' },
      { id: 3, content: 'تعليق غيره', created_at: '2026-10-03T00:00:00Z', creator_name: 'سارة', creator_id: 'bc_2' },
    ]);
    await pullCardChanges(env);
    expect(post()).toMatchObject({ status: 'rejected', reject_reason: 'العنوان طويل' });
    expect(db.prepare("SELECT note FROM approvals WHERE post_id = 'p1'").get().note).toBe('العنوان طويل');
  });

  it('رفضٌ بلا تعليقٍ ممن نقلها: تعود البطاقة إلى عمودها ويُطلب السبب', async () => {
    seedTracked('pending_gm');
    cardIn('col_rejected');
    vi.mocked(basecamp.lastActor).mockResolvedValue(fahad);
    vi.mocked(basecamp.getComments).mockResolvedValueOnce([
      { id: 3, content: 'تعليق غيره', created_at: '', creator_name: 'سارة', creator_id: 'bc_2' },
    ]);
    expect(await pullCardChanges(env)).toEqual({ moved: 0, edited: 0 });
    expect(post().status).toBe('pending_gm');
    expect(basecamp.moveCard).toHaveBeenCalledWith(env, 'proj_1', 'card_1', 'col_pending_gm');
    expect(vi.mocked(basecamp.createComment).mock.calls[0][3]).toContain('الرفض يحتاج سبباً');
    // وتعليقها لا يعود ملاحظةً على المنشور
    expect(db.prepare("SELECT COUNT(*) n FROM basecamp_own_comments WHERE comment_id = 'cm_1'").get().n).toBe(1);
  });

  it('تعديلُ العنوان والنص في بيسكامب يُسحب إلى المنشور مع لقطة نسخةٍ قبله', async () => {
    seedTracked('draft');
    cardIn('col_draft', { title: 'عنوان جديد', content: '<h1>رأس</h1><div>نص <strong>معدّل</strong></div>' });
    vi.mocked(basecamp.lastActor).mockResolvedValue(fahad);
    expect(await pullCardChanges(env)).toEqual({ moved: 0, edited: 1 });
    expect(post()).toMatchObject({ title: 'عنوان جديد', body: '<h2>رأس</h2><p>نص <strong>معدّل</strong></p>' });
    expect(db.prepare("SELECT title, body, edited_by FROM content_versions WHERE post_id = 'p1'").get())
      .toEqual({ title: 'عنوان', body: '<p>نص</p>', edited_by: 'usr_1' });
    // والتعديل نفسه لا يُسحب مرتين
    expect(await pullCardChanges(env)).toEqual({ moved: 0, edited: 0 });
  });

  it('صفٌّ بلا نصٍّ محفوظ: ما في البطاقة أساسٌ لا تعديل', async () => {
    seedTracked('draft', null);
    cardIn('col_draft', { title: 'شيء آخر' });
    expect(await pullCardChanges(env)).toEqual({ moved: 0, edited: 0 });
    expect(post().title).toBe('عنوان');
    expect(db.prepare("SELECT card_title FROM basecamp_tasks WHERE post_id = 'p1'").get().card_title).toBe('شيء آخر');
  });

  it('ما كتبته المنصة للتوّ لا يُظنّ تعديلاً من بيسكامب', async () => {
    seedTracked('draft');
    db.prepare("UPDATE basecamp_tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE post_id = 'p1'").run();
    cardIn('col_draft', { content: '<div>نص المنصة الجديد</div>' });
    expect(await pullCardChanges(env)).toEqual({ moved: 0, edited: 0 });
    expect(post().body).toBe('<p>نص</p>');
  });

  it('كتابةُ المنصة في البطاقة تحفظ ما ردّه بيسكامب', async () => {
    seedTracked('draft', null);
    vi.mocked(basecamp.updateCard).mockResolvedValueOnce({ title: 'عنوان', content: '<div>كما صاغه بيسكامب</div>' });
    await syncPost(env, 'p1');
    expect(db.prepare("SELECT card_content FROM basecamp_tasks WHERE post_id = 'p1'").get().card_content)
      .toBe('<div>كما صاغه بيسكامب</div>');
  });
});

describe('سحب بطاقة المنشور حين يُفتح', () => {
  function seedTracked(status: string, format = CARD_FORMAT) {
    db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p1','عنوان','<p>نص</p>',?,'usr_1')").run(status);
    db.prepare(
      `INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage,updated_at,card_title,card_content,card_format)
       VALUES ('p1','card_1',?,?,'2026-01-01T00:00:00Z','عنوان','<div>نص</div>',?)`,
    ).run(`col_${status}`, status, format);
  }
  const card = (over: Record<string, unknown> = {}) => ({
    id: 'card_1', title: 'عنوان', app_url: '', created_at: '', content: '<div>نص</div>',
    column_id: 'col_approved', column_title: 'approved', ...over,
  });
  const post = () => db.prepare("SELECT title, body, status FROM content_posts WHERE id = 'p1'").get();

  it('نقلُ البطاقة في بيسكامب يظهر بفتح المنشور — بنداءٍ واحد لا بقراءة الأعمدة', async () => {
    seedTracked('pending_gm');
    vi.mocked(basecamp.getCard).mockResolvedValue(card());
    expect(await pullCardForPost(env, 'p1')).toEqual({ moved: true, edited: false });
    expect(post().status).toBe('approved');
    expect(basecamp.getColumns).not.toHaveBeenCalled();
    expect(basecamp.listCards).not.toHaveBeenCalled();
  });

  it('عمودٌ أنشأه المدير بيده يُعرف باسمه', async () => {
    seedTracked('draft');
    vi.mocked(basecamp.getCard).mockResolvedValue(card({ column_id: 'col_manual', column_title: 'بانتظار اعتماد قسم التسويق' }));
    expect((await pullCardForPost(env, 'p1')).moved).toBe(true);
    expect(post().status).toBe('pending_marketing');
  });

  it('النصّ المعدّل في بيسكامب يعود بأسطره وغامقه', async () => {
    seedTracked('draft');
    vi.mocked(basecamp.getCard).mockResolvedValue(card({
      column_id: 'col_draft', column_title: 'draft', content: '<div><strong>عنوان</strong><br><br>- أولى<br>- ثانية</div><ol><li>أ</li></ol>',
    }));
    expect(await pullCardForPost(env, 'p1')).toEqual({ moved: false, edited: true });
    expect(post().body).toBe('<p><strong>عنوان</strong><br><br>- أولى<br>- ثانية</p><ol><li>أ</li></ol>');
  });

  it('عمودٌ يتعذّر قراءته في السحب الدوري لا يُسقط ما بعده', async () => {
    seedTracked('draft');
    vi.mocked(basecamp.getCardTableId).mockResolvedValue('ct_1');
    vi.mocked(basecamp.getColumns).mockResolvedValue(STAGES.map((s) => ({ id: `col_${s}`, title: s })));
    vi.mocked(basecamp.listCards).mockImplementation(async (_e, _p, c) => {
      if (c === 'col_draft') throw new Error('Too many subrequests');
      return c === 'col_approved' ? [card()] : [];
    });
    expect((await pullCardChanges(env)).moved).toBe(1);
    expect(post().status).toBe('approved');
  });
});

describe('وصف البطاقة بوسوم بيسكامب', () => {
  it('الغامق يُرسل <strong> والأسطر <br> — كان <b> يُحذف فيضيع', async () => {
    seedPost('p1', 'سطر<div><b>غامق</b></div><div><br></div><div>- شرطة</div>');
    await syncPost(env, 'p1');
    expect(vi.mocked(basecamp.createCard).mock.calls[0][3].content).toBe('<div>سطر<br><strong>غامق</strong><br><br>- شرطة</div>');
  });

  it('البطاقات بالصيغة القديمة يُعاد إرسال وصفها — إلا ما عُدّل في بيسكامب ولم يُسحب', async () => {
    db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p1','عنوان','<p><b>غامق</b></p>','draft','usr_1'), ('p2','عنوان','<p>ب</p>','draft','usr_1')").run();
    db.prepare(
      `INSERT INTO basecamp_tasks (post_id,todo_id,list_id,stage,updated_at,card_title,card_content)
       VALUES ('p1','card_1','col_draft','draft','2026-01-01T00:00:00Z','عنوان','<div>غامق</div>'),
              ('p2','card_2','col_draft','draft','2026-01-01T00:00:00Z','عنوان','<div>ب</div>')`,
    ).run();
    vi.mocked(basecamp.getCard).mockImplementation(async (_e, _p, id) => ({
      id, title: 'عنوان', app_url: '', created_at: '', column_id: 'col_draft', column_title: 'draft',
      content: id === 'card_1' ? '<div>غامق</div>' : '<div>ب عُدّل في بيسكامب</div>',
    }));
    expect(await refreshCardFormat(env)).toBe(1);
    expect(basecamp.updateCard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(basecamp.updateCard).mock.calls[0][2]).toBe('card_1');
    expect(vi.mocked(basecamp.updateCard).mock.calls[0][3].content).toBe('<div><strong>غامق</strong></div>');
    expect(db.prepare("SELECT card_format FROM basecamp_tasks WHERE post_id = 'p1'").get().card_format).toBe(CARD_FORMAT);
    expect(db.prepare("SELECT card_format FROM basecamp_tasks WHERE post_id = 'p2'").get().card_format).toBe(0);
  });
});

describe('نصّ البطاقة ← نصّ المنشور', () => {
  it('الوسيط المدمج يعود كتلتَه الأصلية، والذِّكر يُحذف، ومرفقٌ من بيسكامب يبقى اسمه', async () => {
    db.prepare("INSERT INTO media_assets (id,r2_key,filename,basecamp_sgid) VALUES ('m1','k','a.png','sg_m1')").run();
    const block = '<div class="media-embed media-img" data-media-id="m1" data-media-name="a.png"><img src="x"/><div class="media-cap">a.png</div></div>';
    const body = await cardContentToBody(env,
      '<div>قبل</div><bc-attachment sgid="sg_m1" caption="a.png"></bc-attachment><div>بعد <bc-attachment sgid="sg_p" content-type="application/vnd.basecamp.mention"></bc-attachment></div><bc-attachment sgid="sg_new" caption="جديد.pdf"><figure>x</figure></bc-attachment>',
      `<p>قبل</p>${block}<p>بعد</p>`);
    expect(body).toBe(`<p>قبل</p>${block}<p>بعد </p><p>مرفق: جديد.pdf</p>`);
  });
});

/* مسارات المحتوى بحقول الخطة، على SQLite **حقيقية** بالمخطّط الفعلي.

   الحاضنة نفسها في campaigns.test.ts: القاعدة من ملفّات الهجرة، والمصادقة
   تُتجاوز بضبط `sub` قبل الموجّه فيبقى `requireAuth` و`requirePermission`
   عاملَين على مستخدمين وأدوارٍ حقيقية. */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { postRoutes } from '../src/routes/posts';
import { PLANNED_CAP } from '../src/services/planning';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const norm = (a: unknown) =>
    (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a as any);
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a.map(norm); return stmt; },
        async first<T>() { return (db.prepare(sql).get(...args) ?? null) as T; },
        async all<T>() { return { results: db.prepare(sql).all(...args) as T[], success: true }; },
        async run() { db.prepare(sql).run(...args); return { success: true }; },
      };
      return stmt;
    },
    async batch(statements: any[]) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  };
}

function buildDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  const user = db.prepare(
    'INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES (?,?,?,?,?,?)',
  );
  user.run('usr_mgr', 'مدير التسويق', 'm@naf.sa', 'h', 'marketing_manager', 1);
  user.run('usr_wri', 'كاتب', 'w@naf.sa', 'h', 'writer', 1);
  user.run('usr_off', 'موقوف', 'o@naf.sa', 'h', 'writer', 0);
  return db;
}

let db: any;
let actor = 'usr_mgr';

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', actor); await next(); });
  app.route('/posts', postRoutes);
  return app;
}

beforeEach(() => { db = buildDb(); actor = 'usr_mgr'; });

const env = () => ({ DB: d1(db), APP_NAME: 'ناف' } as any);
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} }) as any;

async function call(method: string, path: string, body?: unknown) {
  const res = await makeApp().request(
    `http://localhost${path}`,
    {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    env(),
    ctx(),
  );
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ردٌّ غير JSON */ }
  return { status: res.status, json, text };
}

const row = (id: string) => db.prepare('SELECT * FROM content_posts WHERE id = ?').get(id);

function seedPost(id: string, over: Record<string, unknown> = {}) {
  const r = {
    title: `منشور ${id}`, body: '', status: 'draft', author_id: 'usr_mgr',
    content_type: 'text', format: 'text', planned_on: null, assignee_id: null, ...over,
  };
  db.prepare(
    `INSERT INTO content_posts (id,title,body,status,author_id,content_type,format,planned_on,assignee_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, r.title, r.body, r.status, r.author_id, r.content_type, r.format, r.planned_on, r.assignee_id);
}

describe('الإنشاء بحقول الخطة', () => {
  it('فكرةٌ بيومها ومنصاتها وشكلها ومسؤولها ومحورها وملخّصها', async () => {
    const r = await call('POST', '/posts', {
      title: 'تعديلات نظام العمل',
      planned_on: '2026-11-12',
      planned_platforms: ['linkedin', 'x'],
      format: 'carousel',
      assignee_id: 'usr_wri',
      pillar: ' توعية قانونية ',
      brief: 'خمس نقاط يحتاجها صاحب العمل',
    });
    expect(r.status).toBe(200);
    expect(r.json.idea).toBe(true);
    expect(row(r.json.id)).toMatchObject({
      body: '', status: 'draft', format: 'carousel', content_type: 'image',
      planned_on: '2026-11-12', planned_platforms: '["linkedin","x"]',
      assignee_id: 'usr_wri', pillar: 'توعية قانونية', brief: 'خمس نقاط يحتاجها صاحب العمل',
    });
  });

  it('النصّ الفارغ في المعنى يُخزَّن فارغاً، فهي فكرة', async () => {
    const r = await call('POST', '/posts', { title: 'أ', body: '<div><br></div>' });
    expect(r.json.idea).toBe(true);
    expect(row(r.json.id).body).toBe('');
  });

  it('مسودةٌ بنصّ ليست فكرة، وشكلها من نوعها', async () => {
    const r = await call('POST', '/posts', { title: 'أ', body: '<p>نص</p>', content_type: 'video' });
    expect(r.json.idea).toBe(false);
    expect(row(r.json.id)).toMatchObject({ format: 'video', content_type: 'video' });
  });

  it('غير الصالح يُهمل ولا يُسقط الإنشاء', async () => {
    const r = await call('POST', '/posts', {
      title: 'أ', planned_on: '2026-02-30', assignee_id: 'usr_ghost',
      format: 'reel', content_type: 'gif', planned_platforms: 'linkedin', pillar: 7,
    });
    expect(r.status).toBe(200);
    expect(row(r.json.id)).toMatchObject({
      planned_on: null, assignee_id: null, format: 'text', content_type: 'text', planned_platforms: null, pillar: null,
    });
  });
});

describe('التعديل', () => {
  it('حقلٌ واحد لا يمسّ غيره', async () => {
    seedPost('p1', { planned_on: '2026-11-01', assignee_id: 'usr_wri' });
    const r = await call('PATCH', '/posts/p1', { planned_on: '2026-11-05' });
    expect(r.json).toEqual({ ok: true, idea: true });
    expect(row('p1')).toMatchObject({ planned_on: '2026-11-05', assignee_id: 'usr_wri', title: 'منشور p1' });
  });

  it('null وفارغٌ يمسحان، وغير الصالح يُبقي القائم', async () => {
    seedPost('p1', { planned_on: '2026-11-01', assignee_id: 'usr_wri' });
    await call('PATCH', '/posts/p1', { planned_on: 'غداً', assignee_id: 'usr_ghost' });
    expect(row('p1')).toMatchObject({ planned_on: '2026-11-01', assignee_id: 'usr_wri' });
    await call('PATCH', '/posts/p1', { planned_on: '', assignee_id: null });
    expect(row('p1')).toMatchObject({ planned_on: null, assignee_id: null });
  });

  it('النوع وحده يُبقي الشكل إن وافقه، ويعيده إلى أساسه إن خالفه', async () => {
    seedPost('p1', { format: 'carousel', content_type: 'image' });
    await call('PATCH', '/posts/p1', { content_type: 'image' });
    expect(row('p1')).toMatchObject({ format: 'carousel', content_type: 'image' });
    await call('PATCH', '/posts/p1', { content_type: 'text' });
    expect(row('p1')).toMatchObject({ format: 'text', content_type: 'text' });
  });

  it('كتابة النصّ تجعل الفكرة مسودة، ومسحُه يعيدها فكرة', async () => {
    seedPost('p1');
    expect((await call('PATCH', '/posts/p1', { body: '<p>نص</p>' })).json.idea).toBe(false);
    expect((await call('PATCH', '/posts/p1', { body: '<p><br></p>' })).json.idea).toBe(true);
    expect(row('p1').body).toBe('');
  });

  it('تغيّر الشكل يأخذ لقطة نسخة كتغيّر النصّ', async () => {
    seedPost('p1');
    await call('PATCH', '/posts/p1', { format: 'story' });
    expect(db.prepare("SELECT COUNT(*) n FROM content_versions WHERE post_id = 'p1'").get().n).toBe(1);
    await call('PATCH', '/posts/p1', { pillar: 'أخبار' });
    expect(db.prepare("SELECT COUNT(*) n FROM content_versions WHERE post_id = 'p1'").get().n).toBe(1);
  });

  it('الكاتب لا يعدّل محتوى غيره', async () => {
    seedPost('p1', { author_id: 'usr_mgr' });
    actor = 'usr_wri';
    expect((await call('PATCH', '/posts/p1', { planned_on: '2026-11-05' })).status).toBe(403);
  });
});

describe('الاستيراد بحقول الخطة', () => {
  it('خطةٌ من جدول: الصالح يُحفظ وغير الصالح يُترك فارغاً', async () => {
    const r = await call('POST', '/posts/import', {
      items: [
        { title: 'أ', planned_on: '2026-11-02', planned_platforms: ['x'], format: 'article', assignee_id: 'usr_wri', pillar: 'أخبار' },
        { title: 'ب', planned_on: '02/11/2026', assignee_id: 'usr_ghost', content_type: 'video', body: '<br>' },
      ],
    });
    expect(r.json).toEqual({ ok: true, created: 2 });
    const rows = db.prepare('SELECT * FROM content_posts ORDER BY title').all();
    expect(rows[0]).toMatchObject({
      title: 'أ', planned_on: '2026-11-02', planned_platforms: '["x"]', format: 'article', content_type: 'text',
      assignee_id: 'usr_wri', pillar: 'أخبار', body: '',
    });
    expect(rows[1]).toMatchObject({ title: 'ب', planned_on: null, assignee_id: null, format: 'video', body: '' });
  });

  it('مئتا مسؤولٍ مختلف لا تتجاوز معاملات الاستعلام الواحد', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ title: `ف${i}`, assignee_id: i === 150 ? 'usr_wri' : `usr_x${i}` }));
    const r = await call('POST', '/posts/import', { items });
    expect(r.json.created).toBe(200);
    expect(db.prepare("SELECT COUNT(*) n FROM content_posts WHERE assignee_id = 'usr_wri'").get().n).toBe(1);
  });
});

describe('قائمة الخطة', () => {
  beforeEach(() => {
    seedPost('a', { planned_on: '2026-11-20', assignee_id: 'usr_wri' });
    seedPost('b', { planned_on: '2026-11-03' });
    seedPost('c', { planned_on: '2026-12-01' });
    seedPost('d');
  });

  it('النطاق وحده، مرتّباً باليوم، ومعه اسم المسؤول', async () => {
    const r = await call('GET', '/posts?planned=1&planned_from=2026-11-01&planned_to=2026-11-30');
    expect(r.json.posts.map((p: any) => p.id)).toEqual(['b', 'a']);
    expect(r.json.posts[1].assignee_name).toBe('كاتب');
    expect(r.json.truncated).toBe(false);
  });

  it('حدٌّ غير صالح يُهمل، والمحتوى بلا يومٍ لا يدخل الخطة', async () => {
    const r = await call('GET', '/posts?planned=1&planned_from=nonsense');
    expect(r.json.posts.map((p: any) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('القائمة المعتادة كما كانت: كل المحتوى، بلا علامة سقف', async () => {
    const r = await call('GET', '/posts');
    expect(r.json.posts).toHaveLength(4);
    expect(r.json.truncated).toBeUndefined();
  });

  it('ما زاد على السقف يُقال لا يُسقط صامتاً', async () => {
    db.exec('BEGIN');
    const ins = db.prepare("INSERT INTO content_posts (id,title,author_id,planned_on) VALUES (?,'x','usr_mgr','2026-11-10')");
    for (let i = 0; i < PLANNED_CAP; i++) ins.run(`bulk_${i}`);
    db.exec('COMMIT');
    const r = await call('GET', '/posts?planned=1');
    expect(r.json.posts).toHaveLength(PLANNED_CAP);
    expect(r.json.truncated).toBe(true);
  });
});

describe('/meta/assignees', () => {
  it('النشطون وحدهم، ولا يبتلعها /:id', async () => {
    const r = await call('GET', '/posts/meta/assignees');
    expect(r.status).toBe(200);
    expect(r.json.assignees.map((u: any) => u.id).sort()).toEqual(['usr_mgr', 'usr_wri']);
  });

  it('الكاتب يصلها — هو ممّن يُسند', async () => {
    actor = 'usr_wri';
    expect((await call('GET', '/posts/meta/assignees')).status).toBe(200);
  });

  it('بلا صلاحية تحرير المسودات ٤٠٣', async () => {
    db.prepare("UPDATE roles_permissions SET allowed = 0 WHERE role_name = 'writer' AND permission_key = 'draft.edit'").run();
    actor = 'usr_wri';
    expect((await call('GET', '/posts/meta/assignees')).status).toBe(403);
  });
});

describe('استرجاع نسخة', () => {
  it('نصّ النسخة الفارغ يُطبَّع، والشكل يبقى إن وافق نوعها', async () => {
    seedPost('p1', { body: '<p>الآن</p>', format: 'carousel', content_type: 'image' });
    db.prepare("INSERT INTO content_versions (id,post_id,title,body,content_type,edited_by) VALUES ('v1','p1','قديم','<div><br></div>','image','usr_mgr')").run();
    const r = await call('POST', '/posts/p1/versions/v1/restore');
    expect(r.status).toBe(200);
    expect(row('p1')).toMatchObject({ title: 'قديم', body: '', format: 'carousel', content_type: 'image' });
  });

  it('ونوعٌ مخالف يعيد الشكل إلى أساس النسخة', async () => {
    seedPost('p1', { body: '<p>الآن</p>', format: 'carousel', content_type: 'image' });
    db.prepare("INSERT INTO content_versions (id,post_id,title,body,content_type,edited_by) VALUES ('v1','p1','قديم','<p>نص</p>','video','usr_mgr')").run();
    await call('POST', '/posts/p1/versions/v1/restore');
    expect(row('p1')).toMatchObject({ format: 'video', content_type: 'video' });
  });
});

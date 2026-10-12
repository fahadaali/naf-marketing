// ما تقبله كل منصة من وسائط المحتوى، ومنشور المستند في لينكدإن.
//
// من «LinkedIn Documents» في توثيق Ayrshare: PDF وWord وPowerPoint تُنشر
// منشورَ مستند، ويُعرف المستند بامتداد رابطه، و`linkedInOptions.title` عنوانه.
// وكانت ملفات المحتوى كلها تُرسل إلى كل منصة — فيُرفض المنشور على غير لينكدإن.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({ notifyPublishFailed: vi.fn(async () => {}) }));

import { platformMediaFilter, isDocument } from '../src/services/mediaSpecs';
import { platformMedia, isDocumentAsset } from '../web/src/mediaPlan';
import { runDuePublishes } from '../src/services/publish';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

const m = (mimeType: string, filename = 'f') => ({ mimeType, filename });

describe('ما تقبله كل منصة', () => {
  it('المستند للينكدإن وحده في منشوره، والصورة والمقطع لكل منصة', () => {
    const img = m('image/jpeg', 'a.jpg');
    const pdf = m('application/pdf', 'تقرير.pdf');
    const audio = m('audio/mpeg', 'حلقة.mp3');
    expect(platformMediaFilter('linkedin', [img, pdf])).toEqual([pdf]);
    expect(platformMediaFilter('linkedin_page', [img])).toEqual([img]);
    expect(platformMediaFilter('instagram', [img, pdf, audio])).toEqual([img]);
    expect(platformMediaFilter('x', [m('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'عقد.docx')])).toEqual([]);
    // الامتداد يكفي إن غاب النوع
    expect(isDocument(m('application/octet-stream', 'deck.pptx'))).toBe(true);
  });

  it('المعاينة تصفّي كما يصفّي الخادم — وما لم تُعرف بياناته يبقى', () => {
    const assets = {
      i1: { id: 'i1', mime_type: 'image/png', width: 1080, height: 1080 },
      d1: { id: 'd1', mime_type: 'application/pdf', filename: 'دليل.pdf' },
      a1: { id: 'a1', mime_type: 'audio/mpeg' },
    };
    expect(platformMedia(null, 'linkedin', ['i1', 'd1'], undefined, assets).items.map((i) => i.id)).toEqual(['d1']);
    expect(platformMedia(null, 'facebook', ['i1', 'd1', 'a1'], undefined, assets).items.map((i) => i.id)).toEqual(['i1']);
    expect(platformMedia(null, 'facebook', ['i1', 'x9'], undefined, assets).items.map((i) => i.id)).toEqual(['i1', 'x9']);
    expect(isDocumentAsset(assets.d1)).toBe(true);
    // تيك توك: صورةٌ واحدة بعد التصفية تحتاج مقطعاً — والمستند لا يُعدّ صورةً ثانية
    expect(platformMedia(null, 'tiktok', ['i1', 'd1'], undefined, assets).needsVideo).toBe(true);
  });
});

/* ═══ النشر على قاعدةٍ حقيقية ═══ */

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) };
}

let db: any;
let env: any;
let sent: any[];
let uploads: string[];
const STORAGE = 'https://storage.googleapis.com/ayr/upload-1';

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'ayrshare')").run();
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('gm','فهد','f@naf.sa','h','general_manager',1)").run();
  const stored = new Map<string, ArrayBuffer>();
  env = {
    DB: d1(db),
    AYRSHARE_API_KEY: 'ayr_key_test',
    MEDIA: {
      head: async (k: string) => (stored.has(k) ? { size: stored.get(k)!.byteLength } : null),
      get: async (k: string) => (stored.has(k) ? { body: new Blob([stored.get(k)!]).stream() } : null),
      put: (k: string) => stored.set(k, new TextEncoder().encode('DATA').buffer),
    },
  };
  sent = [];
  uploads = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/media/uploadUrl') {
      const name = url.searchParams.get('fileName')!;
      uploads.push(name);
      return Response.json({ accessUrl: `https://media.ayrshare.com/${name}`, uploadUrl: STORAGE });
    }
    if (url.href.startsWith(STORAGE)) {
      if (init?.body instanceof ReadableStream) await new Response(init.body).text();
      return Response.json({});
    }
    if (url.pathname === '/api/post') {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ status: 'success', errors: [], postIds: [{ status: 'success', id: 'n1' }], id: `A${sent.length}` });
    }
    return Response.json({ status: 'error', message: 'not found' }, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function asset(id: string, mime: string, filename: string): void {
  db.prepare('INSERT INTO media_assets (id, r2_key, mime_type, filename, size) VALUES (?, ?, ?, ?, 4)').run(id, `k/${id}`, mime, filename);
  env.MEDIA.put(`k/${id}`);
}

function post(id: string, body: string, platforms: string[]): void {
  db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'دليل تأسيس الشركات', ?, 'scheduled', 'gm')").run(id, body);
  for (const p of platforms) {
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, ?, ?, '2026-01-01T09:00:00Z', 'pending')")
      .run(`s_${id}_${p}`, id, p);
  }
}

describe('منشور المستند', () => {
  it('لينكدإن ينشر المستند وحده بعنوان المحتوى، وغيره الصورة وحدها', async () => {
    asset('i1', 'image/jpeg', 'cover.jpg');
    // اسمٌ عربيّ بلا امتداد: يُلحق امتداده من نوعه ليعرفه لينكدإن مستنداً
    asset('d1', 'application/pdf', 'دليل التأسيس');
    post('p1', '<p>نص</p><img src="/api/media/i1"><a href="/api/media/d1">دليل</a>', ['linkedin', 'facebook']);
    await runDuePublishes(env);

    const li = sent.find((b) => b.platforms[0] === 'linkedin');
    const fb = sent.find((b) => b.platforms[0] === 'facebook');
    expect(li.mediaUrls).toHaveLength(1);
    expect(li.mediaUrls[0]).toMatch(/\.pdf$/);
    expect(li.linkedInOptions).toEqual({ title: 'دليل تأسيس الشركات' });
    expect(fb.mediaUrls).toEqual(['https://media.ayrshare.com/cover.jpg']);
    expect(uploads.filter((u) => u.endsWith('.pdf'))).toHaveLength(1);
  });

  it('منصةٌ لا تقبل إلا وسيطاً لا يصلها المستند فتقول ما ينقص', async () => {
    asset('d2', 'application/pdf', 'a.pdf');
    post('p2', '<p>نص</p><a href="/api/media/d2">ملف</a>', ['instagram']);
    await runDuePublishes(env);
    expect(sent).toEqual([]);
    expect(db.prepare("SELECT error FROM schedules WHERE id = 's_p2_instagram'").get().error).toMatch(/بلا صورة أو فيديو/);
  });

  it('تيك توك: المقطع المصنوع من الصورة يحلّ محلّها ولو كان مع المحتوى مستند', async () => {
    asset('i3', 'image/jpeg', 'a.jpg');
    asset('d3', 'application/pdf', 'a.pdf');
    asset('v3', 'video/mp4', 'a-tiktok.mp4');
    post('p3', '<img src="/api/media/i3"><a href="/api/media/d3">ملف</a>', ['tiktok']);
    db.prepare("INSERT INTO post_variants (id, post_id, platform, generated_media_id, generated_from_id) VALUES ('v', 'p3', 'tiktok', 'v3', 'i3')").run();
    await runDuePublishes(env);
    expect(sent[0].mediaUrls).toEqual(['https://media.ayrshare.com/a-tiktok.mp4']);
  });
});

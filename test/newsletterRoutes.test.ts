/* اختبار المسارات على قاعدة SQLite **حقيقية** بالمخطّط الفعلي.

   الاختبارات الأخرى تفحص الدوالّ وحدها: التصيير والتحقّق والتحويل.
   وهذا يفحص ما لا تفحصه — أن المسار موجود ويُبلَغ، وأن العبارة تعمل
   على المحرّك، وأن `/meta/templates` لا يبتلعها `/:id`، وأن ما كُتب
   في القاعدة يُقرأ منها كما كُتب.

   والمصادقة تُتجاوز بضبط `sub` قبل الموجّه — وهو ما تقرؤه
   `verifiedSub` أولاً — فيبقى `requireAuth` و`requirePermission`
   عاملَين على بياناتٍ حقيقية: مستخدمٌ بدورٍ، ودورٌ بصلاحية. */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { newsletterRoutes } from '../src/routes/newsletters';
import { TEMPLATE_FILE_KIND } from '../src/services/newsletterTemplates';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** بديل D1 فوق node:sqlite — نفس واجهة `prepare/bind/first/all/run`. */
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
  };
}

function buildDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare('INSERT INTO users (id,name,email,password_hash,role_name) VALUES (?,?,?,?,?)')
    .run('usr_t', 'فهد', 'f@naf.sa', 'h', 'marketing_manager');
  return db;
}

let db: any;
let app: Hono<any>;

beforeEach(() => {
  db = buildDb();
  app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', 'usr_t'); await next(); });
  app.route('/newsletters', newsletterRoutes);
});

const env = () => ({ DB: d1(db), APP_NAME: 'ناف' } as any);

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(
    `http://localhost${path}`,
    {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    env(),
  );
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ردٌّ غير JSON — تصدير مثلاً */ }
  return { status: res.status, json, text, res };
}

describe('الإنشاء من قالب', () => {
  it('بلا قالب يُنشئ نشرةً فارغة بعنوانها', async () => {
    const r = await call('POST', '/newsletters/from-template', { title: 'عدد أغسطس' });
    expect(r.status).toBe(200);
    expect(r.json.blocks).toBe(0);
    const row = db.prepare('SELECT title, slug, blocks_json FROM newsletters WHERE id = ?').get(r.json.id);
    expect(row.title).toBe('عدد أغسطس');
    expect(row.slug).toBeTruthy();
    expect(JSON.parse(row.blocks_json)).toEqual([]);
  });

  it('من قالب جاهز ينسخ الكتل والسمة والعنوان المقترح', async () => {
    const r = await call('POST', '/newsletters/from-template', { template_id: 'builtin:legal-brief' });
    expect(r.status).toBe(200);
    expect(r.json.blocks).toBeGreaterThan(3);
    const row = db.prepare('SELECT title, subject, blocks_json, theme_json FROM newsletters WHERE id = ?').get(r.json.id);
    expect(row.title).toBe('ملخص قانوني');
    expect(row.subject).toBeTruthy();
    expect(JSON.parse(row.blocks_json).length).toBe(r.json.blocks);
    expect(JSON.parse(row.theme_json).width).toBeTruthy();
  });

  it('العنوان الذي يكتبه الكاتب يعلو اسم القالب', async () => {
    const r = await call('POST', '/newsletters/from-template', { template_id: 'builtin:event', title: 'ورشة العقود' });
    expect(db.prepare('SELECT title FROM newsletters WHERE id = ?').get(r.json.id).title).toBe('ورشة العقود');
  });

  it('قالبٌ غير موجود يعود ٤٠٤ ولا يُنشئ شيئاً', async () => {
    const r = await call('POST', '/newsletters/from-template', { template_id: 'builtin:لا-شيء' });
    expect(r.status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM newsletters').get().n).toBe(0);
  });

  it('عنوانان متطابقان لا يتصادمان في الـslug', async () => {
    const a = await call('POST', '/newsletters/from-template', { title: 'نشرة' });
    const b = await call('POST', '/newsletters/from-template', { title: 'نشرة' });
    const s = (id: string) => db.prepare('SELECT slug FROM newsletters WHERE id = ?').get(id).slug;
    expect(s(a.json.id)).not.toBe(s(b.json.id));
  });
});

describe('السمة والتخصيص عبر المسار', () => {
  let id: string;
  beforeEach(async () => {
    id = (await call('POST', '/newsletters/from-template', { title: 'ن' })).json.id;
  });

  it('PATCH يحفظ السمة والكتل، والقراءة تعيدهما', async () => {
    const theme = JSON.stringify({ text: '#0A0A0A', width: 'wide' });
    const blocks = JSON.stringify([{ type: 'text', text: 'فقرة', style: { color: '#112233' } }]);
    const p = await call('PATCH', `/newsletters/${id}`, { theme_json: theme, blocks_json: blocks });
    expect(p.status).toBe(200);
    const g = await call('GET', `/newsletters/${id}`);
    expect(JSON.parse(g.json.newsletter.theme_json).text).toBe('#0A0A0A');
    expect(JSON.parse(g.json.newsletter.blocks_json)[0].style.color).toBe('#112233');
  });

  it('المعاينة تُصيّر ألوان الكاتب وتُعيد السمة معها', async () => {
    await call('PATCH', `/newsletters/${id}`, {
      theme_json: JSON.stringify({ heading: '#0B0B0B' }),
      blocks_json: JSON.stringify([
        { type: 'heading', text: 'ع', level: 2 },
        { type: 'text', text: '{c:#FF0000|كلمة}', style: { background: '#EEEEEE' } },
      ]),
    });
    const r = await call('GET', `/newsletters/${id}/preview`);
    expect(r.status).toBe(200);
    expect(r.json.html).toContain('color:#0B0B0B');
    expect(r.json.html).toContain('background:#EEEEEE');
    expect(r.json.html).toContain('<span style="color:#FF0000">كلمة</span>');
    expect(r.json.theme.heading).toBe('#0B0B0B');
  });

  it('تخصيصٌ ملفَّق يُكتب في القاعدة ولا يصل الرسالة', async () => {
    await call('PATCH', `/newsletters/${id}`, {
      blocks_json: JSON.stringify([{ type: 'text', text: 'ن', style: { color: 'red;position:fixed' } }]),
    });
    const r = await call('GET', `/newsletters/${id}/preview`);
    expect(r.json.html).not.toContain('position:fixed');
  });

  it('سمةٌ تالفة لا تُسقط المعاينة', async () => {
    await call('PATCH', `/newsletters/${id}`, { theme_json: '{ليس JSON' });
    const r = await call('GET', `/newsletters/${id}/preview`);
    expect(r.status).toBe(200);
  });

  it('نسخة الطباعة تُبنى بعد التخصيص', async () => {
    await call('PATCH', `/newsletters/${id}`, {
      blocks_json: JSON.stringify([{ type: 'heading', text: 'ع', level: 2, style: { align: 'center' } }]),
    });
    const r = await call('GET', `/newsletters/${id}/print`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('text-align:center');
  });
});

describe('معرض القوالب', () => {
  let id: string;
  beforeEach(async () => {
    id = (await call('POST', '/newsletters/from-template', { template_id: 'builtin:issue' })).json.id;
  });

  it('المسار الثابت لا يبتلعه /:id', async () => {
    const r = await call('GET', '/newsletters/meta/templates');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.builtin)).toBe(true);
    expect(r.json.builtin.length).toBeGreaterThan(0);
    expect(r.json.saved).toEqual([]);
  });

  it('حفظ النشرة قالباً ثم إظهاره في المعرض', async () => {
    const s = await call('POST', '/newsletters/meta/templates', {
      newsletter_id: id, name: 'قالب الفريق', description: 'وصف',
    });
    expect(s.status).toBe(200);
    const list = await call('GET', '/newsletters/meta/templates');
    expect(list.json.saved).toHaveLength(1);
    expect(list.json.saved[0].name).toBe('قالب الفريق');
    expect(list.json.saved[0].origin).toBe('saved');
    expect(list.json.saved[0].blocks).toBeGreaterThan(0);
    expect(list.json.saved[0].creator_name).toBe('فهد');
  });

  it('قالبٌ بلا اسم يُرفض برسالة القاموس', async () => {
    const r = await call('POST', '/newsletters/meta/templates', { newsletter_id: id, name: '  ' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('أدخل اسماً للقالب');
  });

  it('نشرةٌ بلا كتل لا تُحفظ قالباً فارغاً', async () => {
    const blank = (await call('POST', '/newsletters/from-template', { title: 'فارغة' })).json.id;
    const r = await call('POST', '/newsletters/meta/templates', { newsletter_id: blank, name: 'ق' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('القالب فارغ. أضف كتلاً ثم احفظه.');
  });

  it('الإنشاء من قالبٍ محفوظ ينقل كتله', async () => {
    await call('POST', '/newsletters/meta/templates', { newsletter_id: id, name: 'ق' });
    const tid = db.prepare('SELECT id FROM newsletter_templates').get().id;
    const r = await call('POST', '/newsletters/from-template', { template_id: tid });
    expect(r.status).toBe(200);
    expect(r.json.blocks).toBeGreaterThan(0);
  });

  it('القالب الجاهز لا يُحذف، والمحفوظ يُحذف', async () => {
    const bad = await call('DELETE', '/newsletters/meta/templates/builtin:issue');
    expect(bad.status).toBe(400);

    await call('POST', '/newsletters/meta/templates', { newsletter_id: id, name: 'ق' });
    const tid = db.prepare('SELECT id FROM newsletter_templates').get().id;
    const ok = await call('DELETE', `/newsletters/meta/templates/${tid}`);
    expect(ok.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM newsletter_templates').get().n).toBe(0);
  });

  it('حذف قالبٍ غير موجود يعود ٤٠٤', async () => {
    expect((await call('DELETE', '/newsletters/meta/templates/nlt_none')).status).toBe(404);
  });
});

describe('التصدير والاستيراد', () => {
  let id: string;
  beforeEach(async () => {
    id = (await call('POST', '/newsletters/from-template', { template_id: 'builtin:announcement' })).json.id;
  });

  it('التصدير يُخرج ملف قالبٍ صالحاً باسم ملفٍ مرمَّز', async () => {
    const r = await call('GET', `/newsletters/${id}/export.json`);
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('application/json');
    expect(r.res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    const file = JSON.parse(r.text);
    expect(file.kind).toBe(TEMPLATE_FILE_KIND);
    expect(file.blocks.length).toBeGreaterThan(0);
    expect(file.theme.width).toBeTruthy();
  });

  it('الدورة كاملة: تصدير ثم استيراد ثم إنشاء منه', async () => {
    const file = (await call('GET', `/newsletters/${id}/export.json`)).text;
    const imp = await call('POST', '/newsletters/meta/templates/import', { format: 'naf', payload: file });
    expect(imp.status).toBe(200);
    expect(imp.json.origin).toBe('imported');

    const made = await call('POST', '/newsletters/from-template', { template_id: imp.json.id });
    expect(made.json.blocks).toBe(imp.json.blocks);
  });

  it('ملفٌّ ليس قالباً يُرفض برسالة القاموس', async () => {
    const r = await call('POST', '/newsletters/meta/templates/import', { format: 'naf', payload: '{"kind":"x"}' });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('الملف ليس قالب نشرة');
  });

  it('قالب HTML خارجي يدخل كتلاً ويعود بعددها', async () => {
    const html = `<html><head><title>قالب الشهر</title></head><body>
      <table role="presentation"><tr><td>
        <h1 style="color:#1B4B5A">عنوان</h1>
        <p>فقرة فيها <b>غامق</b>.</p>
        <a href="https://naf.sa" style="background-color:#937133;padding:10px;display:inline-block">تسجيل</a>
      </td></tr></table></body></html>`;
    const r = await call('POST', '/newsletters/meta/templates/import', { format: 'html', payload: html });
    expect(r.status).toBe(200);
    expect(r.json.origin).toBe('imported_html');
    expect(r.json.blocks).toBe(3);

    const row = db.prepare('SELECT name, blocks_json FROM newsletter_templates WHERE id = ?').get(r.json.id);
    expect(row.name).toBe('قالب الشهر');
    const blocks = JSON.parse(row.blocks_json);
    expect(blocks.map((b: any) => b.type)).toEqual(['heading', 'text', 'button']);
    expect(row.blocks_json).not.toContain('<b>');
  });

  it('HTML بلا محتوى يُرفض برسالة تقول ماذا يُتوقّع', async () => {
    const r = await call('POST', '/newsletters/meta/templates/import', {
      format: 'html', payload: '<html><body></body></html>',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('لم يُعثر على محتوى في الملف');
  });

  it('ملفٌ فارغ يُرفض قبل أي معالجة', async () => {
    expect((await call('POST', '/newsletters/meta/templates/import', { payload: '   ' })).status).toBe(400);
  });

  it('المستورَد يُصيَّر بلا وسمٍ منقول', async () => {
    const html = '<p>نصّ <img src="x" onerror="alert(1)"> و<span style="color:#FF0000">ملوّن</span></p>';
    const imp = await call('POST', '/newsletters/meta/templates/import', { format: 'html', payload: html });
    const made = await call('POST', '/newsletters/from-template', { template_id: imp.json.id });
    const prev = await call('GET', `/newsletters/${made.json.id}/preview`);
    expect(prev.json.html).not.toContain('onerror');
    expect(prev.json.html).not.toContain('<img');
    // اللون داخل الفقرة يبقى، والصورة بلا مصدرٍ صالح تسقط بينهما
    expect(prev.json.html).toContain('color:#FF0000');
  });
});

/* الصفحة العامة تُختبر هنا لا في ملفٍ ثانٍ: هي المخرَج الثاني لنفس
   الكتل، وحكمُ اللوحة فيها يعتمد على السمة المحفوظة من هذه المسارات. */
describe('الصفحة العامة', () => {
  let publicApp: Hono<any>;
  beforeEach(async () => {
    const { publicRoutes } = await import('../src/routes/publicPages');
    publicApp = new Hono();
    publicApp.route('/', publicRoutes);
  });

  const publish = (id: string) =>
    db.prepare("UPDATE newsletters SET web_published = 1, published_at = '2026-08-01T00:00:00Z' WHERE id = ?").run(id);

  async function page(slug: string) {
    const res = await publicApp.request(`http://localhost/${slug}`, {}, env());
    return { status: res.status, html: await res.text() };
  }

  it('مقالةٌ بلا تخصيص تبقى على ثيم الموقع بلا لوحة مفروضة', async () => {
    const id = (await call('POST', '/newsletters/from-template', { title: 'عادية' })).json.id;
    await call('PATCH', `/newsletters/${id}`, {
      blocks_json: JSON.stringify([{ type: 'text', text: 'متن' }]),
    });
    publish(id);
    const r = await page(db.prepare('SELECT slug FROM newsletters WHERE id = ?').get(id).slug);
    expect(r.status).toBe(200);
    expect(r.html).not.toContain('article-canvas');
    expect(r.html).toContain('متن');
  });

  it('مقالةٌ بسمةٍ مخصّصة تأخذ لوحتها كاملةً — لا نصف اختيار الكاتب', async () => {
    const id = (await call('POST', '/newsletters/from-template', { title: 'مخصّصة' })).json.id;
    await call('PATCH', `/newsletters/${id}`, {
      theme_json: JSON.stringify({ cardBackground: '#101010', text: '#F5F5F5', heading: '#FFFFFF', width: 'narrow' }),
      blocks_json: JSON.stringify([{ type: 'text', text: 'متن فاتح على سطح داكن' }]),
    });
    publish(id);
    const r = await page(db.prepare('SELECT slug FROM newsletters WHERE id = ?').get(id).slug);
    expect(r.status).toBe(200);
    expect(r.html).toContain('article-canvas');
    expect(r.html).toContain('background:#101010');
    expect(r.html).toContain('color:#F5F5F5');
    // العنوان يأخذ لون العناوين من السمة، واللوحة تثبّت المخطط فاتحاً
    expect(r.html).toContain('color:#FFFFFF');
    expect(r.html).toContain('color-scheme:light');
    expect(r.html).toContain('max-width:520px');
  });

  it('نشرةٌ غير منشورة لا تظهر عامةً', async () => {
    const id = (await call('POST', '/newsletters/from-template', { title: 'مسودة' })).json.id;
    const r = await page(db.prepare('SELECT slug FROM newsletters WHERE id = ?').get(id).slug);
    expect(r.status).toBe(404);
  });
});

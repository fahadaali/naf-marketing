// عقد الواجهة مع الخادم — يُفحص من الملفات لا بالتشغيل.
//
// سببه عطلٌ وقع: زرّ «مستخدم جديد» بقي ينادي `POST /api/users` بعد حذف
// المسار من الخادم. والطلب لم يكن يفشل ظاهراً — كان يسقط إلى طبقة
// الأصول فيصل الواجهةَ HTML بحالة ٢٠٠، فيسقط `JSON.parse` في
// `web/src/api.ts` وتصير البيانات `{}`، و`res.ok` صحيحة. فتُغلق النافذة
// كأنّ العضو أُنشئ. لا خطأ في الشاشة ولا سطر في اللوغ.
//
// وهذا الملف يمنع تكرارها: كل نداء في `web/src` يجب أن يجد مساراً
// يطابقه في `src/routes`، وإلا سقط الاختبار باسم الملف والمسار.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PERMISSION_LABELS } from '../src/permissions';

// استيراد عند التشغيل لا بالتحليل الساكن — كما في `migration.real.test.ts`:
// ‏`node:sqlite` أحدث من قائمة الوحدات المدمجة التي يعرفها vite.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const ROOT = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/** مسارات الخادم: "GET /posts/:id" — الاسم من الملف والباقي من التعريف. */
function serverRoutes(): string[] {
  const out: string[] = [];
  for (const file of walk(join(ROOT, 'src', 'routes'))) {
    const src = readFileSync(file, 'utf8');
    // اسم الملف هو بادئة التركيب في `src/index.ts` عدا ثلاثة تُسمّى صراحةً
    const stem = file.split('/').pop()!.replace(/\.ts$/, '');
    const base = { publicPages: null, siteApi: '/public', siteMedia: '/public-media', emailTracking: null }[
      stem as 'publicPages' | 'siteApi' | 'siteMedia' | 'emailTracking'
    ];
    if (base === null) continue; // ليست تحت /api
    const prefix = base ?? `/${stem}`;
    for (const m of src.matchAll(/\w+Routes\.(get|post|patch|put|delete|all)\(\s*'([^']*)'/g)) {
      const path = m[2] === '/' ? '' : m[2];
      out.push(`${m[1].toUpperCase()} ${prefix}${path}`);
    }
  }
  return out;
}

/** نداءات الواجهة: يُستبدل كل `${…}` بمقطعٍ نائب. */
function clientCalls(): { file: string; call: string }[] {
  const out: { file: string; call: string }[] = [];
  for (const file of walk(join(ROOT, 'web', 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bapi\.(get|post|patch|put|del|upload)<[^>]*>?\s*\(|\bapi\.(get|post|patch|put|del|upload)\s*\(/g)) {
      // نقرأ الوسيط الأول نصّاً حرفياً فقط — النداءات المبنيّة بمتغيّر تُتخطّى
      const rest = src.slice(m.index! + m[0].length);
      const lit = /^\s*[`'"]([^`'"]*)[`'"]/.exec(rest);
      if (!lit) continue;
      const method = (m[1] || m[2])!;
      const verb = method === 'del' ? 'DELETE' : method === 'upload' ? 'POST' : method.toUpperCase();

      // ‏`${…}` مقطعُ مسارٍ حين يسبقه `/` — وإلا فهو لصيقٌ بنصّ، وأشيع
      // صوره سلسلة استعلام (`/comments${q}`). فيُقطع ما بعده لا يُترجم
      // مقطعاً، وإلا صار المسار `/comments:x` ولا يطابق شيئاً.
      const path = lit[1]
        .split('?')[0]
        .replace(/([^/])\$\{[^}]*\}[\s\S]*$/, '$1')
        .replace(/\$\{[^}]*\}/g, ':x');

      out.push({ file: file.replace(`${ROOT}/`, ''), call: `${verb} ${path}` });
    }
  }
  return out;
}

function matches(route: string, call: string): boolean {
  const [rm, rp] = route.split(' ');
  const [cm, cp] = call.split(' ');
  if (rm !== 'ALL' && rm !== cm) return false;
  const a = rp.split('/').filter(Boolean);
  const b = cp.split('/').filter(Boolean);
  if (rp === '/*' || rp === '*') return true;
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(':') || b[i] === ':x' || seg === b[i]);
}

describe('عقد الواجهة مع الخادم', () => {
  it('كل نداء في الواجهة يجد مساراً يطابقه', () => {
    const routes = serverRoutes();
    expect(routes.length).toBeGreaterThan(50); // الاستخراج نفسه سليم

    const orphans = clientCalls().filter(
      ({ call }) => !routes.some((r) => matches(r, call)),
    );
    expect(
      orphans.map((o) => `${o.file}  →  ${o.call}`),
      'نداءٌ بلا مسار في الخادم — سيصل الواجهةَ ٤٠٤',
    ).toEqual([]);
  });

  it('ما لا يطابق مساراً تحت /api يردّ ٤٠٤ بجسم JSON لا صفحةَ الواجهة', async () => {
    // نعيد بناء تركيب `src/index.ts`: مسارات، ثم `all('*')`، ثم الأصول
    const app = new Hono();
    const api = new Hono();
    const sub = new Hono();
    sub.use('*', async (_c, next) => { await next(); });
    sub.get('/', (c) => c.json({ users: [] }));
    api.route('/users', sub);
    api.all('*', (c) => c.json({ error: 'مسار غير معروف' }, 404));
    app.route('/api', api);
    app.all('*', (c) => c.html('<!doctype html><html><body>SPA</body></html>'));

    const known = await app.request('http://x/api/users');
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({ users: [] });

    // فعلٌ غير موجود على مسارٍ موجود — وهي حال `POST /api/users` بالضبط
    const wrongVerb = await app.request('http://x/api/users', { method: 'POST', body: '{}' });
    expect(wrongVerb.status).toBe(404);
    expect(await wrongVerb.json()).toEqual({ error: 'مسار غير معروف' });

    const unknown = await app.request('http://x/api/لا-وجود-له');
    expect(unknown.status).toBe(404);

    // وما خرج عن `/api` يبقى للواجهة
    const spa = await app.request('http://x/posts');
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('SPA');
  });

  it('كل صلاحية مزروعة لها تسمية عربية', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = OFF');
    const dir = join(ROOT, 'migrations');
    for (const f of readdirSync(dir).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
      db.exec(readFileSync(join(dir, f), 'utf8'));
    }
    const seeded = (
      db.prepare('SELECT DISTINCT permission_key AS k FROM roles_permissions ORDER BY k').all() as { k: string }[]
    ).map((r) => r.k);

    expect(seeded.length).toBeGreaterThan(10);
    // مفتاحٌ بلا تسمية يظهر في مصفوفة الصلاحيات بالإنجليزية الخام
    expect(seeded.filter((k) => !PERMISSION_LABELS[k])).toEqual([]);
    // وتسميةٌ بلا مفتاح صفٌّ لا يُعرض أبداً
    expect(Object.keys(PERMISSION_LABELS).filter((k) => !seeded.includes(k))).toEqual([]);
  });
});

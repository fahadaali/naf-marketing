/* اختبار مسارات الحملات على SQLite **حقيقية** بالمخطّط الفعلي.
 
   لم يكن للحملات اختبارٌ واحد، وهي الميزة التي بقيت فيها نقطةُ PATCH
   معطّلةً لا ينادِيها أحد دون أن يلاحظ ذلك شيء.
 
   والقاعدة تُبنى من ملفّات الهجرة نفسها لا من مخطّطٍ مكتوبٍ هنا، فيتحقّق
   0028 ضمناً مع كل تشغيل. والمصادقة تُتجاوز بضبط `sub` قبل الموجّه — وهو
   ما يقرؤه `verifiedSub` أولاً — فيبقى `requireAuth` و`requirePermission`
   عاملَين على بياناتٍ حقيقية: مستخدمٌ بدورٍ، ودورٌ بصلاحية من جدولها. */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { campaignRoutes } from '../src/routes/campaigns';
import { CAMPAIGN_TRANSITIONS } from '../src/types';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** بديل D1 فوق node:sqlite — ومعه `batch` الذي يستعمله ربط المحتوى. */
function d1(db: any) {
  const norm = (a: unknown) =>
    (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a as any);
  const api = {
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
  return api;
}

function buildDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  const user = db.prepare(
    'INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES (?,?,?,?,?,1)',
  );
  user.run('usr_mgr', 'مدير التسويق', 'm@naf.sa', 'h', 'marketing_manager');
  user.run('usr_wri', 'كاتب', 'w@naf.sa', 'h', 'writer');
  return db;
}

let db: any;
let actor = 'usr_mgr';

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', actor); await next(); });
  app.route('/campaigns', campaignRoutes);
  return app;
}

beforeEach(() => { db = buildDb(); actor = 'usr_mgr'; });

const env = () => ({ DB: d1(db), APP_NAME: 'ناف' } as any);
// waitUntil ينفّذ فوراً: تسجيل التدقيق يُكتب قبل أن يُفحص.
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

const newCampaign = (over: Record<string, unknown> = {}) =>
  call('POST', '/campaigns', { name: 'حملة الصيف', ...over });

function seedPost(id: string, status = 'draft', campaign: string | null = null) {
  db.prepare(
    'INSERT INTO content_posts (id,title,body,status,campaign_id,author_id) VALUES (?,?,?,?,?,?)',
  ).run(id, `منشور ${id}`, '', status, campaign, 'usr_mgr');
}

function seedSnapshot(postId: string, platform: string, impressions: number, engagement: number, reach = 0) {
  db.prepare(
    'INSERT INTO analytics_snapshots (id,platform,post_id,reach,impressions,engagement) VALUES (?,?,?,?,?,?)',
  ).run(`an_${postId}_${platform}`, platform, postId, reach, impressions, engagement);
}

describe('ترتيب المسارات', () => {
  it('‏/meta/owners لا يبتلعها /:id', async () => {
    const r = await call('GET', '/campaigns/meta/owners');
    expect(r.status).toBe(200);
    expect(r.json.owners.map((o: any) => o.id)).toContain('usr_mgr');
    expect(r.json.error).toBeUndefined();
  });

  it('المسؤولون هم النشطون وحدهم', async () => {
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run('usr_wri');
    const r = await call('GET', '/campaigns/meta/owners');
    expect(r.json.owners.map((o: any) => o.id)).toEqual(['usr_mgr']);
  });
});

describe('الإنشاء', () => {
  it('تُولد «مخطّطة» لا «نشطة»', async () => {
    const r = await newCampaign();
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT status FROM campaigns WHERE id = ?').get(r.json.id).status).toBe('planned');
  });

  it('المسؤول الافتراضي هو من أنشأها، وupdated_at يُكتب', async () => {
    const r = await newCampaign();
    const row = db.prepare('SELECT owner_id, updated_at FROM campaigns WHERE id = ?').get(r.json.id);
    expect(row.owner_id).toBe('usr_mgr');
    expect(row.updated_at).toBeTruthy();
  });

  it('بلا اسمٍ يعود ٤٠٠ ولا يُنشئ شيئاً', async () => {
    const r = await call('POST', '/campaigns', { objective: 'بلا اسم' });
    expect(r.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n).toBe(0);
  });

  it('المستهدف الفارغ يبقى فارغاً ولا يصير صفراً', async () => {
    const r = await newCampaign({ budget: '', target_impressions: '', target_engagement: 5000 });
    const row = db.prepare(
      'SELECT budget, target_impressions, target_engagement FROM campaigns WHERE id = ?',
    ).get(r.json.id);
    expect(row.budget).toBeNull();
    expect(row.target_impressions).toBeNull();
    expect(row.target_engagement).toBe(5000);
  });
});

describe('انتقالات الحالة', () => {
  it('كل انتقالٍ مسجَّل في الخريطة مقبول', async () => {
    for (const [from, targets] of Object.entries(CAMPAIGN_TRANSITIONS)) {
      for (const to of targets) {
        const r = await newCampaign();
        db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(from, r.json.id);
        const p = await call('PATCH', `/campaigns/${r.json.id}`, { status: to });
        expect(p.status, `${from} → ${to}`).toBe(200);
        expect(db.prepare('SELECT status FROM campaigns WHERE id = ?').get(r.json.id).status).toBe(to);
      }
    }
  });

  it('«مخطّطة» لا تقفز إلى «مكتملة»', async () => {
    const r = await newCampaign();
    const p = await call('PATCH', `/campaigns/${r.json.id}`, { status: 'completed' });
    expect(p.status).toBe(400);
    expect(db.prepare('SELECT status FROM campaigns WHERE id = ?').get(r.json.id).status).toBe('planned');
  });

  it('«مؤرشفة» لا تعود «نشطة» مباشرةً — تُستعاد «مكتملة»', async () => {
    const r = await newCampaign();
    db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('archived', r.json.id);
    expect((await call('PATCH', `/campaigns/${r.json.id}`, { status: 'active' })).status).toBe(400);
    expect((await call('PATCH', `/campaigns/${r.json.id}`, { status: 'completed' })).status).toBe(200);
  });

  it('‏allowed_transitions يطابق الخريطة لكل حالة', async () => {
    for (const [from, targets] of Object.entries(CAMPAIGN_TRANSITIONS)) {
      const r = await newCampaign();
      db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(from, r.json.id);
      const g = await call('GET', `/campaigns/${r.json.id}`);
      expect(g.json.allowed_transitions, from).toEqual(targets);
    }
  });
});

describe('الصلاحيات', () => {
  it('الكاتب يقرأ ولا يكتب', async () => {
    const r = await newCampaign();
    actor = 'usr_wri';
    expect((await call('GET', '/campaigns')).status).toBe(200);
    expect((await call('GET', `/campaigns/${r.json.id}`)).status).toBe(200);
    expect((await call('POST', '/campaigns', { name: 'ممنوعة' })).status).toBe(403);
    expect((await call('PATCH', `/campaigns/${r.json.id}`, { name: 'س' })).status).toBe(403);
    expect((await call('POST', `/campaigns/${r.json.id}/duplicate`)).status).toBe(403);
    expect((await call('POST', `/campaigns/${r.json.id}/posts`, { post_ids: ['p1'] })).status).toBe(403);
    expect((await call('GET', '/campaigns/meta/owners')).status).toBe(403);
  });

  it('الأداء محجوبٌ عمّن لا يملك عرض التحليلات', async () => {
    const r = await newCampaign();
    actor = 'usr_wri';
    expect((await call('GET', `/campaigns/${r.json.id}/rollup`)).status).toBe(403);
  });
});

describe('تجميع الأداء', () => {
  it('حملةٌ بمنشوراتٍ بلا لقطاتٍ تُرجع أصفاراً ولا تختفي', async () => {
    const r = await newCampaign();
    seedPost('p1', 'published', r.json.id);
    seedPost('p2', 'draft', r.json.id);
    const g = await call('GET', `/campaigns/${r.json.id}/rollup`);
    expect(g.status).toBe(200);
    expect(g.json.totals).toMatchObject({ reach: 0, impressions: 0, engagement: 0, engagement_rate: 0 });
    expect(g.json.byPlatform).toEqual([]);
  });

  it('يجمع عبر المنصات ويحسب معدّل التفاعل', async () => {
    const r = await newCampaign();
    seedPost('p1', 'published', r.json.id);
    seedPost('p2', 'published', r.json.id);
    seedSnapshot('p1', 'linkedin', 600, 60, 500);
    seedSnapshot('p2', 'x', 400, 20, 300);
    const g = await call('GET', `/campaigns/${r.json.id}/rollup`);
    expect(g.json.totals.impressions).toBe(1000);
    expect(g.json.totals.engagement).toBe(80);
    expect(g.json.totals.reach).toBe(800);
    expect(g.json.totals.engagement_rate).toBe(8);
    expect(g.json.byPlatform.map((p: any) => p.platform)).toEqual(['linkedin', 'x']);
  });

  it('لا يحسب منشورات حملةٍ أخرى', async () => {
    const a = await newCampaign({ name: 'أ' });
    const b = await newCampaign({ name: 'ب' });
    seedPost('p1', 'published', a.json.id);
    seedPost('p2', 'published', b.json.id);
    seedSnapshot('p1', 'x', 100, 10);
    seedSnapshot('p2', 'x', 999, 99);
    const g = await call('GET', `/campaigns/${a.json.id}/rollup`);
    expect(g.json.totals.impressions).toBe(100);
  });

  it('خطّ الإنتاج يعدّ كل الحالات لا خمساً منها', async () => {
    const r = await newCampaign();
    const all = ['draft', 'pending_marketing', 'pending_gm', 'approved',
      'scheduled', 'published', 'archived', 'rejected'];
    all.forEach((s, i) => seedPost(`p${i}`, s, r.json.id));
    const g = await call('GET', `/campaigns/${r.json.id}/rollup`);
    expect(g.json.pipeline.map((p: any) => p.status).sort()).toEqual([...all].sort());
  });

  it('يعدّ المجدول المستحقّ متأخراً', async () => {
    const r = await newCampaign();
    seedPost('p1', 'scheduled', r.json.id);
    seedPost('p2', 'scheduled', r.json.id);
    db.prepare('INSERT INTO schedules (id,post_id,platform,scheduled_at,status) VALUES (?,?,?,?,?)')
      .run('s1', 'p1', 'x', '2020-01-01T00:00:00Z', 'pending');
    db.prepare('INSERT INTO schedules (id,post_id,platform,scheduled_at,status) VALUES (?,?,?,?,?)')
      .run('s2', 'p2', 'x', '2999-01-01T00:00:00Z', 'pending');
    const g = await call('GET', `/campaigns/${r.json.id}/rollup`);
    expect(g.json.late).toBe(1);
  });

  it('يُرجع المستهدفات كي تُقارَن بلا نداءٍ ثانٍ', async () => {
    const r = await newCampaign({ target_impressions: 10000 });
    const g = await call('GET', `/campaigns/${r.json.id}/rollup`);
    expect(g.json.targets.target_impressions).toBe(10000);
    expect(g.json.targets.target_leads).toBeNull();
  });
});

describe('تفاصيل الحملة', () => {
  it('يُرجع pending_at فتظهر حالة «متأخر»', async () => {
    const r = await newCampaign();
    seedPost('p1', 'scheduled', r.json.id);
    db.prepare('INSERT INTO schedules (id,post_id,platform,scheduled_at,status) VALUES (?,?,?,?,?)')
      .run('s1', 'p1', 'x', '2020-01-01T00:00:00Z', 'pending');
    const g = await call('GET', `/campaigns/${r.json.id}`);
    expect(g.json.posts[0].pending_at).toBe('2020-01-01T00:00:00Z');
    expect(g.json.posts[0].author_name).toBe('مدير التسويق');
  });

  it('حملةٌ غير موجودة تعود ٤٠٤', async () => {
    expect((await call('GET', '/campaigns/camp_لا-شيء')).status).toBe(404);
  });
});

describe('ربط المحتوى وفصله', () => {
  it('الربط يضمّ، والفصل يفكّ ولا يحذف', async () => {
    const r = await newCampaign();
    seedPost('p1');
    seedPost('p2');
    const link = await call('POST', `/campaigns/${r.json.id}/posts`, { post_ids: ['p1', 'p2'] });
    expect(link.json.linked).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM content_posts WHERE campaign_id = ?').get(r.json.id).n).toBe(2);

    await call('DELETE', `/campaigns/${r.json.id}/posts/p1`);
    expect(db.prepare('SELECT campaign_id FROM content_posts WHERE id = ?').get('p1').campaign_id).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM content_posts WHERE id = ?').get('p1').n).toBe(1);
  });

  it('قائمةٌ فارغة تعود ٤٠٠', async () => {
    const r = await newCampaign();
    expect((await call('POST', `/campaigns/${r.json.id}/posts`, { post_ids: [] })).status).toBe(400);
  });
});

describe('إنشاء نسخة', () => {
  it('تنسخ الخطة لا التنفيذ', async () => {
    const r = await newCampaign({
      objective: 'وعيٌ بالعقود', start_date: '2026-01-01', end_date: '2026-03-01',
      target_platforms: ['linkedin'], budget: 5000, target_impressions: 10000,
    });
    db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('active', r.json.id);
    seedPost('p1', 'published', r.json.id);

    const d = await call('POST', `/campaigns/${r.json.id}/duplicate`);
    const copy = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(d.json.id);
    expect(copy.name).toBe('حملة الصيف (نسخة)');
    expect(copy.objective).toBe('وعيٌ بالعقود');
    expect(copy.budget).toBe(5000);
    expect(copy.target_impressions).toBe(10000);
    expect(JSON.parse(copy.target_platforms)).toEqual(['linkedin']);
    // لا مدّة ولا حالةُ الأصل ولا منشوراته
    expect(copy.start_date).toBeNull();
    expect(copy.end_date).toBeNull();
    expect(copy.status).toBe('planned');
    expect(db.prepare('SELECT COUNT(*) AS n FROM content_posts WHERE campaign_id = ?').get(d.json.id).n).toBe(0);
  });
});

describe('الأرشفة', () => {
  it('تُخفي الحملة ولا تُتلف محتواها', async () => {
    const r = await newCampaign();
    db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('active', r.json.id);
    seedPost('p1', 'published', r.json.id);
    await call('PATCH', `/campaigns/${r.json.id}`, { status: 'archived' });
    expect(db.prepare('SELECT status FROM campaigns WHERE id = ?').get(r.json.id).status).toBe('archived');
    // ON DELETE SET NULL لا يقع لأن شيئاً لم يُحذف — والأثر يبقى في التحليلات.
    expect(db.prepare('SELECT campaign_id FROM content_posts WHERE id = ?').get('p1').campaign_id).toBe(r.json.id);
  });

  it('لا نقطة حذف للحملات', async () => {
    const r = await newCampaign();
    expect((await call('DELETE', `/campaigns/${r.json.id}`)).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n).toBe(1);
  });
});

describe('سجلّ التدقيق', () => {
  const actions = () => db.prepare("SELECT action, entity_id FROM audit_log WHERE entity_type = 'campaign'").all();

  it('كل تغييرٍ يُسجَّل باسمه', async () => {
    const r = await newCampaign();
    await call('PATCH', `/campaigns/${r.json.id}`, { name: 'حملة الشتاء' });
    await call('PATCH', `/campaigns/${r.json.id}`, { status: 'active' });
    await call('POST', `/campaigns/${r.json.id}/duplicate`);
    await call('PATCH', `/campaigns/${r.json.id}`, { status: 'archived' });
    seedPost('p1');
    await call('POST', `/campaigns/${r.json.id}/posts`, { post_ids: ['p1'] });
    await call('DELETE', `/campaigns/${r.json.id}/posts/p1`);

    // مجموعةً لا ترتيباً: التسجيل يمرّ بـ waitUntil فلا يضمن تسلسلاً،
    // والمهمّ أن كل تغييرٍ تَرك أثراً باسمه لا متى كُتب الأثر.
    expect(actions().map((a: any) => a.action).sort()).toEqual([
      'campaign_archive', 'campaign_create', 'campaign_duplicate',
      'campaign_posts_link', 'campaign_posts_unlink',
      'campaign_status', 'campaign_update',
    ]);
  });

  it('تغيير الحالة يسجّل من أين إلى أين', async () => {
    const r = await newCampaign();
    await call('PATCH', `/campaigns/${r.json.id}`, { status: 'active' });
    const row = db.prepare("SELECT details FROM audit_log WHERE action = 'campaign_status'").get();
    expect(row.details).toBe('planned → active');
  });
});

describe('القائمة', () => {
  it('تحمل التقدّم والأداء والمسؤول مع الصف', async () => {
    const r = await newCampaign();
    seedPost('p1', 'published', r.json.id);
    seedPost('p2', 'draft', r.json.id);
    seedSnapshot('p1', 'x', 300, 30);
    const g = await call('GET', '/campaigns');
    const row = g.json.campaigns.find((x: any) => x.id === r.json.id);
    expect(row.posts_count).toBe(2);
    expect(row.published_count).toBe(1);
    expect(row.impressions).toBe(300);
    expect(row.engagement).toBe(30);
    expect(row.owner_name).toBe('مدير التسويق');
  });

  it('حملةٌ بلا منشورات تظهر بأصفارٍ لا أن تختفي', async () => {
    await newCampaign();
    const g = await call('GET', '/campaigns');
    expect(g.json.campaigns).toHaveLength(1);
    expect(g.json.campaigns[0].posts_count).toBe(0);
    expect(g.json.campaigns[0].impressions).toBe(0);
  });
});

// تنبيهات حساب Ayrshare — الأشكال من صفحة «Webhook Actions» في توثيقه:
// `social` بنوعه (link · unlink · refresh) ومصدره (system · user) وتفصيله،
// و`suspended` بنوعه (suspend · unsuspend) وسببه ومنشئه وموعد رفعه.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/commentsSync', () => ({ syncComments: vi.fn(async () => null), queuePendingPost: vi.fn() }));
vi.mock('../src/services/publish', () => ({ reconcilePublishing: vi.fn(async () => ({ published: 0, failed: 0 })) }));

import { onSocialEvent, onSuspendedEvent, suspensionText, suspensionNotice, SUSPENSION_KEY } from '../src/services/ayrshareAlerts';
import { webhookRoutes } from '../src/routes/webhooks';
import { AYRSHARE_WEBHOOK_ACTIONS } from '../src/adapters/ayrshare';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: any[]) => stmts.map((s) => ({ meta: { changes: db.prepare(s.sql).run(...s.binds).changes } })),
  };
}

let db: any;
let env: any;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  // المدير العام يدير الإعدادات، والكاتب لا
  db.prepare("INSERT INTO users (id, name, email, password_hash, role_name) VALUES ('gm', 'فهد', 'gm@naf.sa', 'h', 'general_manager')").run();
  db.prepare("INSERT INTO users (id, name, email, password_hash, role_name) VALUES ('w', 'سارة', 'w@naf.sa', 'h', 'writer')").run();
  env = { DB: d1(db), AYRSHARE_API_KEY: 'k' };
});

const notes = () => db.prepare('SELECT user_id, type, title, body, link FROM notifications ORDER BY rowid').all();

describe('فصلُ حسابٍ وتجديدُ ربطه', () => {
  it('فصلٌ بيد النظام يصل من يدير الإعدادات وحده، بسببه وما يُفعل', async () => {
    await onSocialEvent(env, {
      action: 'social', type: 'unlink', platform: 'facebook', source: 'system',
      details: { status: 'error', code: 349, message: 'Account locked' },
    });
    expect(notes()).toEqual([{
      user_id: 'gm',
      type: 'account_unlinked',
      title: 'حساب فيسبوك لم يعد مربوطاً في Ayrshare',
      body: '\u2068Account locked\u2069. لن يُنشر عليه شيءٌ حتى يُعاد ربطه من Social Accounts في Ayrshare.',
      link: '/settings?tab=platforms',
    }]);
  });

  it('فصلٌ بيد أحدٍ من الحساب يُعلَم ولا يُقرأ عطلاً — واسم إكس لا twitter', async () => {
    await onSocialEvent(env, { action: 'social', type: 'unlink', platform: 'twitter', source: 'user' });
    expect(notes()[0]).toMatchObject({
      title: 'أُلغي ربط حساب إكس في Ayrshare',
      body: 'ألغاه أحدٌ من حساب Ayrshare نفسه. لن يُنشر عليه شيءٌ حتى يُعاد ربطه.',
    });
  });

  it('الحدث المُعاد لا يُكرّر الإشعار — والقديم خارج المهلة لا يمنعه', async () => {
    const evt = { action: 'social', type: 'unlink', platform: 'gmb', source: 'system' };
    await onSocialEvent(env, evt);
    await onSocialEvent(env, evt);
    expect(notes()).toHaveLength(1);
    expect(notes()[0].title).toBe('حساب نشاطي التجاري (\u2068Google\u2069) لم يعد مربوطاً في Ayrshare');

    // إشعارٌ بالنصّ نفسه قبل ساعة — في اليوم نفسه — لا يُعدّ مكرّراً
    db.prepare("UPDATE notifications SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-60 minutes')").run();
    await onSocialEvent(env, evt);
    expect(notes()).toHaveLength(2);
  });

  it('التجديد بموعده، ولا يُكرَّر أسبوعاً؛ والربط لا إشعار له', async () => {
    const evt = { action: 'social', type: 'refresh', platform: 'linkedin', source: 'system', refreshBy: '2026-11-05T12:21:29Z' };
    await onSocialEvent(env, evt);
    await onSocialEvent(env, evt);
    await onSocialEvent(env, { action: 'social', type: 'link', platform: 'instagram' });
    expect(notes()).toEqual([expect.objectContaining({
      type: 'account_refresh',
      title: 'ربط لينكدإن في Ayrshare يحتاج تجديداً',
      body: 'جدّده قبل \u20682026/11/05\u2069 من Social Accounts في Ayrshare، وإلا لم يُنشر عليه شيءٌ بعده.',
    })]);
  });
});

describe('تعطيلُ حساب النشر', () => {
  it('التعطيل يُحفظ ويُنبَّه إليه، والتفعيل يمحوه ويُعلَم', async () => {
    await onSuspendedEvent(env, {
      action: 'suspended', type: 'suspend', platform: 'facebook', origin: 'policy',
      reason: 'Confirm your identity before you can publish as this Page.', suspendedAt: '2026-08-13T20:31:41.128Z', unsuspendAt: null,
    });
    expect(JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(SUSPENSION_KEY).value)).toEqual({
      reason: 'Confirm your identity before you can publish as this Page.', platform: 'facebook', origin: 'policy', unsuspendAt: null,
    });
    expect(await suspensionNotice(env)).toMatch(/^حساب النشر معطّلٌ لدى Ayrshare: /);
    expect(notes()[0]).toMatchObject({
      type: 'account_suspended',
      title: 'عطّل Ayrshare حساب النشر',
      body: 'حساب النشر معطّلٌ لدى Ayrshare: \u2068Confirm your identity before you can publish as this Page.\u2069. '
        + 'حُلّ السبب على فيسبوك نفسها ثم أعد ربطها في Ayrshare. ولا يعمل النشر ولا السحب حتى يُفعَّل.',
    });

    await onSuspendedEvent(env, { action: 'suspended', type: 'unsuspend', reason: null, platform: null, origin: null });
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get(SUSPENSION_KEY)).toBeUndefined();
    expect(await suspensionNotice(env)).toBe('');
    expect(notes()[1]).toMatchObject({ title: 'فعّل Ayrshare حساب النشر من جديد', body: 'عاد النشر والسحب. أعد نشر ما فشل خلال التعطيل.' });
  });

  it('ما يُفعّل الحساب من جديد بحسب منشئ التعطيل', () => {
    const base = { reason: null, platform: null, unsuspendAt: null };
    expect(suspensionText({ ...base, origin: 'payment' }, '')).toBe(
      'حساب النشر معطّلٌ لدى Ayrshare. حدّث الدفع أو الاشتراك في حساب Ayrshare ليُفعَّل من جديد.',
    );
    expect(suspensionText({ ...base, origin: 'rateLimit', unsuspendAt: '2026-03-03T10:00:00.000Z' }, '')).toBe(
      'حساب النشر معطّلٌ لدى Ayrshare. يُفعَّل وحده في \u20682026/03/03\u2069.',
    );
    expect(suspensionText({ ...base, origin: 'policy' }, '')).toMatch(/تواصل مع دعم Ayrshare لتفعيله\.$/);
    expect(suspensionText({ ...base, origin: null }, '')).toMatch(/تواصل مع دعم Ayrshare لتفعيله\.$/);
  });
});

describe('الويب هوك', () => {
  const SECRET = 'ayr_signing_secret';
  const sig = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

  it('الحدثان يُسجَّلان مع ما قبلهما', () => {
    expect(AYRSHARE_WEBHOOK_ACTIONS).toEqual(['comments', 'messages', 'scheduled', 'social', 'suspended']);
  });

  it('حدث الفصل الموقَّع يصل إشعاراً', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('secret:ayrshare_webhook', ?)").run(SECRET);
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException: () => {} } as any;
    const body = JSON.stringify({ action: 'social', type: 'unlink', platform: 'instagram', source: 'system', hookId: 'h' });
    const res = await webhookRoutes.request(
      '/ayrshare', { method: 'POST', body, headers: { 'X-Authorization-Content-SHA256-V2': `v1=${sig(body)}` } }, env, ctx,
    );
    expect(res.status).toBe(200);
    await Promise.all(waits);
    expect(notes()).toEqual([expect.objectContaining({ title: 'حساب إنستغرام لم يعد مربوطاً في Ayrshare' })]);
  });
});

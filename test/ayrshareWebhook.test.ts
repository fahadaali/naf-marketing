// ويب هوك Ayrshare — التوقيع كما في صفحتي Webhooks Overview وRotate Signing
// Secret: HMAC-SHA256 للجسم الخام بصيغة hex، و`-V2` يسرد `v1=` لكل سرٍّ صالح.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const syncComments = vi.fn(async () => null);
const reconcilePublishing = vi.fn(async () => ({ published: 0, failed: 0 }));
vi.mock('../src/services/commentsSync', () => ({ syncComments: (...a: unknown[]) => syncComments(...(a as [])) }));
vi.mock('../src/services/publish', () => ({ reconcilePublishing: (...a: unknown[]) => reconcilePublishing(...(a as [])) }));

import { verifyAyrshareSignature, webhookRoutes } from '../src/routes/webhooks';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');
const SECRET = 'ayr_signing_secret';
const BODY = JSON.stringify({ action: 'comments', subAction: 'commentCreated', platform: 'instagram', hookId: 'h1' });
const sig = (secret: string, body = BODY) => createHmac('sha256', secret).update(body).digest('hex');

describe('توقيع Ayrshare', () => {
  it('يقبل التوقيع من -V2 ومن الترويسة الأصلية حين تغيب', async () => {
    expect(await verifyAyrshareSignature(SECRET, BODY, '', `v1=${sig(SECRET)}`)).toBe(true);
    expect(await verifyAyrshareSignature(SECRET, BODY, sig(SECRET), '')).toBe(true);
  });

  it('خلال يوم التدوير يُقبل أيُّ سرٍّ مسرود — الجديد أو السابق', async () => {
    const v2 = `v1=${sig('new_secret')},v1=${sig(SECRET)}`;
    expect(await verifyAyrshareSignature(SECRET, BODY, sig('new_secret'), v2)).toBe(true);
    expect(await verifyAyrshareSignature('new_secret', BODY, sig('new_secret'), v2)).toBe(true);
  });

  it('يرفض السرّ الخاطئ والجسم المعبوث به وغياب التوقيع', async () => {
    expect(await verifyAyrshareSignature('wrong', BODY, '', `v1=${sig(SECRET)}`)).toBe(false);
    expect(await verifyAyrshareSignature(SECRET, BODY + ' ', '', `v1=${sig(SECRET)}`)).toBe(false);
    expect(await verifyAyrshareSignature(SECRET, BODY, '', '')).toBe(false);
    // بادئةٌ غير v1 لا تُعدّ توقيعاً
    expect(await verifyAyrshareSignature(SECRET, BODY, '', `v2=${sig(SECRET)}`)).toBe(false);
  });
});

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) };
}

describe('نقطة الاستقبال', () => {
  let env: any;
  let waits: Promise<unknown>[];
  const ctx = () => ({ waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException: () => {} }) as any;
  const post = (body: string, headers: Record<string, string>) =>
    webhookRoutes.request('/ayrshare', { method: 'POST', body, headers }, env, ctx());

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
      db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    }
    env = { DB: d1(db), AYRSHARE_API_KEY: 'k' };
    waits = [];
    syncComments.mockClear();
    reconcilePublishing.mockClear();
  });

  it('لا يُقبل شيء قبل التسجيل', async () => {
    const res = await post(BODY, { 'X-Authorization-Content-SHA256-V2': `v1=${sig(SECRET)}` });
    expect(res.status).toBe(401);
    expect(syncComments).not.toHaveBeenCalled();
  });

  it('يُقبل ما وُقّع بالسرّ المحفوظ ويُشغّل دورة الصندوق — ويُرفض ما سواه', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('secret:ayrshare_webhook', ?)").bind(SECRET).run();
    const ok = await post(BODY, { 'X-Authorization-Content-SHA256-V2': `v1=${sig(SECRET)}` });
    expect(ok.status).toBe(200);
    await Promise.all(waits);
    expect(syncComments).toHaveBeenCalledTimes(1);

    const bad = await post(BODY, { 'X-Authorization-Content-SHA256-V2': `v1=${sig('other')}` });
    expect(bad.status).toBe(401);
    expect(syncComments).toHaveBeenCalledTimes(1);
  });

  it('حدث «المجدول» يُشغّل دورة التسوية — به يُحسم منشور تيك توك المنتظر', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('secret:ayrshare_webhook', ?)").bind(SECRET).run();
    const body = JSON.stringify({ action: 'scheduled', subAction: 'tikTokPublished', hookId: 'h2' });
    const res = await post(body, { 'X-Authorization-Content-SHA256-V2': `v1=${sig(SECRET, body)}` });
    expect(res.status).toBe(200);
    await Promise.all(waits);
    expect(reconcilePublishing).toHaveBeenCalledTimes(1);
    expect(syncComments).not.toHaveBeenCalled();
  });
});

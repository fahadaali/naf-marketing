// حذف أرقام المزوّد التجريبي — يُرفع ما كتبه وحده، ولا يُمسّ رقمٌ حقيقي.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { AUTO_SOURCE } from '../src/services/metrics';
import { MockProvider } from '../src/adapters/mock';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');
const PURGE = '0034_purge_mock_numbers.sql';

/** القاعدة بكل هجراتها قبل الحذف — كما هي على الإنتاج يوم يُطبَّق. */
function before(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f) && f < PURGE).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return db;
}

const purge = (db: any) => db.exec(readFileSync(join(MIGRATIONS, PURGE), 'utf8'));
const ids = (db: any, table: string) => (db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[]).map((r) => r.id);

describe('حذف أرقام المزوّد التجريبي', () => {
  it('يرفع لقطات التجريبي وتعليقاته، ويُبقي الحقيقي', () => {
    const db = before();
    const snap = db.prepare('INSERT INTO analytics_snapshots (id, platform, provider_post_id, reach) VALUES (?, ?, ?, ?)');
    snap.run('s-mock', 'linkedin', 'mock_lx2k_ab12cd', 3100);
    snap.run('s-real', 'linkedin', '7351234567890', 820);
    snap.run('s-news', 'email', null, 300); // النشرة البريدية — بلا معرّف مزوّد
    // «mockup» ليس بادئة التجريبي: الشرطة السفلية حرفٌ لا حرفُ بدل
    snap.run('s-like', 'x', 'mockup1', 50);

    const cm = db.prepare('INSERT INTO platform_comments (id, platform, provider_comment_id, kind) VALUES (?, ?, ?, ?)');
    cm.run('c-mock', 'linkedin', 'mock_lx2k_ab12cd_c0', 'comment');
    cm.run('c-mock-dm', 'linkedin', 'mock_lx2k_ab12cd_c1', 'dm');
    cm.run('c-real', 'linkedin', 'urn:li:comment:42', 'comment');

    purge(db);
    expect(ids(db, 'analytics_snapshots')).toEqual(['s-like', 's-news', 's-real']);
    expect(ids(db, 'platform_comments')).toEqual(['c-real']);
  });

  it('يرفع المحتسب من لقطات المزوّد وحده — المسحوب والمُدخَل وبقية المحتسب باقية', () => {
    const db = before();
    const v = db.prepare(
      `INSERT INTO metric_values (id, metric_key, period, period_start, period_end, value, source)
       VALUES (?, ?, 'monthly', '2026-09-01', '2026-09-30', ?, ?)`,
    );
    v.run('v-reach', 'reach', 18400, 'auto');
    v.run('v-dm', 'direct_conversations', 17, 'auto');
    v.run('v-mql', 'mql', 42, 'auto');
    v.run('v-followers', 'followers_total', 900, 'integration');
    v.run('v-nps', 'nps', 30, 'manual');

    purge(db);
    expect(ids(db, 'metric_values')).toEqual(['v-followers', 'v-mql', 'v-nps']);
  });

  it('قائمة المحتسب في الهجرة هي مؤشرات المزوّد في `AUTO_SOURCE` نفسها', () => {
    const sql = readFileSync(join(MIGRATIONS, PURGE), 'utf8');
    const listed = [...sql.slice(sql.indexOf('metric_key IN')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const provider = Object.entries(AUTO_SOURCE).filter(([, s]) => s === 'provider').map(([k]) => k).sort();
    expect(listed).toEqual(provider);
  });
});

describe('المزوّد التجريبي لا يقيس شيئاً', () => {
  it('لا أرقام ولا صندوق', async () => {
    const p = new MockProvider();
    await expect(p.getAnalytics('mock_x')).rejects.toThrow();
    expect((p as any).getComments).toBeUndefined();
    // والنشر نفسه باقٍ يحاكي — للتطوير بلا مزوّد
    expect((await p.publish({ text: 'نص', platforms: ['linkedin'] } as any)).providerPostId).toMatch(/^mock_/);
  });
});

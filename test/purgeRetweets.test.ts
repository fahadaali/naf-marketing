// حذف الريتويت من لقطات إكس — أرقامُه أرقامُ التغريدة الأصلية لا أرقامنا.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { isRetweet } from '../src/adapters/ayrshare';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');
const PURGE = '0035_purge_retweets.sql';

function before(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f) && f < PURGE).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return db;
}

describe('الريتويت', () => {
  it('يُعرف بنوع الإشارة أو بنصّه — والاقتباس ليس منه', () => {
    expect(isRetweet({ post: 'RT @KingSalman: نص التغريدة' })).toBe(true);
    expect(isRetweet({ post: 'نص', referencedTweets: [{ type: 'retweeted', id: '1' }] })).toBe(true);
    expect(isRetweet({ post: 'تعليقنا على التغريدة', referencedTweets: [{ type: 'quoted', id: '1' }] })).toBe(false);
    expect(isRetweet({ post: 'منشورنا' })).toBe(false);
  });

  it('الهجرة ترفع لقطات الريتويت وحدها، وما ارتبط بمحتوى يبقى', () => {
    const db = before();
    const snap = db.prepare('INSERT INTO analytics_snapshots (id, platform, provider_post_id, title, post_id, engagement) VALUES (?, ?, ?, ?, ?, ?)');
    snap.run('s-rt', 'x', '111', 'RT @KingSalman: الحمد لله', null, 104000);
    snap.run('s-own', 'x', '222', 'منشورنا عن نظام الشركات', null, 40);
    snap.run('s-quote', 'x', '333', 'نبارك لخادم الحرمين', null, 90);
    snap.run('s-linked', 'x', '444', 'RT @naflaw: من المنصة', 'p1', 12);
    snap.run('s-li', 'linkedin', '555', 'RT @ ليس من إكس', null, 5);
    db.prepare(
      `INSERT INTO metric_values (id, metric_key, period, period_start, period_end, value, source)
       VALUES ('v1', 'engagement', 'monthly', '2026-10-01', '2026-10-31', 104040, 'auto'),
              ('v2', 'direct_conversations', 'monthly', '2026-10-01', '2026-10-31', 7, 'auto')`,
    ).run();

    db.exec(readFileSync(join(MIGRATIONS, PURGE), 'utf8'));
    const ids = (db.prepare('SELECT id FROM analytics_snapshots ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['s-li', 's-linked', 's-own', 's-quote']);
    // التفاعل يُعاد احتسابه على ما بقي، ومؤشر الصندوق لا يُمسّ
    const keys = (db.prepare('SELECT metric_key FROM metric_values ORDER BY metric_key').all() as { metric_key: string }[]).map((r) => r.metric_key);
    expect(keys).toEqual(['direct_conversations']);
  });
});

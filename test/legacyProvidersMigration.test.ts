// الهجرة 0050: حذف ما لا يعرفه Ayrshare من بيانات SocialAPI وBuffer، وإبقاء ما عرفه.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

describe('حذف بيانات المزوّدَين السابقَين (0050)', () => {
  it('يحذف ما لا يعرفه Ayrshare ويُبقي ما عرفه', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = OFF');
    const files = readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort();
    const target = files.find((f) => f.startsWith('0050_'))!;
    expect(target, 'الهجرة 0050 مفقودة').toBeTruthy();
    for (const f of files.slice(0, files.indexOf(target))) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));

    const snap = db.prepare('INSERT INTO analytics_snapshots (id, provider_post_id, platform, native_post_id) VALUES (?, ?, ?, ?)');
    snap.run('s1', '5f8d0d55b54764421b7156c9', 'youtube', null); // Buffer بلا معرّفٍ أصلي — يُحذف
    snap.run('s2', 'uuid-1:instagram', 'instagram', null); // نائب SocialAPI بلا معرّفٍ أصلي — يُحذف
    snap.run('s3', 'uuid-2:instagram', 'instagram', 'ig_100'); // عرفه Ayrshare — يبقى
    snap.run('s4', '2110395346044002374', 'x', null); // معرّف المنصة نفسه — يبقى
    snap.run('s5', '123456789012345678901234', 'x', null); // أرقامٌ وحدها ليست Buffer — يبقى

    const cm = db.prepare("INSERT INTO platform_comments (id, platform, provider_comment_id, kind) VALUES (?, ?, ?, ?)");
    cm.run('c1', 'google', 'rv:acc_g:accounts/1/locations/2/reviews/R1', 'review');
    cm.run('c2', 'x', 'sp_post|acc_x|T1', 'comment');
    cm.run('c3', 'instagram', 'dm:conv1:acc_ig', 'dm');
    cm.run('c4', 'x', 'ayc|twitter|T0|T3|', 'comment');
    cm.run('c5', 'facebook', 'ayd|facebook|c1|psid_1', 'dm');
    cm.run('c6', 'google', 'ayr|gmb|R1', 'review');

    const st = db.prepare("INSERT INTO inbox_post_state (inbox_post_id, account_id) VALUES (?, ?)");
    st.run('P1', 'acc_01KY92JZA2XEHER834DF20QR1H');
    st.run('P2', 'ayrshare:twitter');

    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const k of ['buffer_profiles', 'socialapi_profiles', 'secret:socialapi_webhook', 'socialapi_webhook_id', 'youtube_sync_at',
      'posts_history_at', 'inbox_history_cursor', 'account_history:acc_01KY92JZA2XEHER834DF20QR1H']) set.run(k, '{}');
    set.run('account_history:ayrshare:twitter', '{"cursor":null}');
    set.run('ayrshare_posts_history_at', '2026-10-01');
    set.run('provider_name', 'socialapi');

    db.exec(readFileSync(join(MIGRATIONS, target), 'utf8'));

    expect(db.prepare('SELECT id FROM analytics_snapshots ORDER BY id').all().map((r: any) => r.id)).toEqual(['s3', 's4', 's5']);
    expect(db.prepare('SELECT id FROM platform_comments ORDER BY id').all().map((r: any) => r.id)).toEqual(['c4', 'c5', 'c6']);
    expect(db.prepare('SELECT inbox_post_id FROM inbox_post_state').all()).toEqual([{ inbox_post_id: 'P2' }]);
    const keys = db.prepare('SELECT key FROM settings').all().map((r: any) => r.key);
    expect(keys).toContain('account_history:ayrshare:twitter');
    expect(keys).toContain('ayrshare_posts_history_at');
    for (const k of ['buffer_profiles', 'socialapi_profiles', 'secret:socialapi_webhook', 'socialapi_webhook_id', 'youtube_sync_at',
      'posts_history_at', 'inbox_history_cursor', 'account_history:acc_01KY92JZA2XEHER834DF20QR1H']) expect(keys).not.toContain(k);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'provider_name'").get()).toEqual({ value: 'ayrshare' });
  });

  it('لا يمسّ التجريبي', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = OFF');
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
      db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    }
    expect(db.prepare("SELECT value FROM settings WHERE key = 'provider_name'").get()).toEqual({ value: 'mock' });
  });
});

// البادئة المحجوزة `secret:` في جدول الإعدادات.
//
// سببه ثغرةٌ وقعت: `GET /api/settings` يردّ الجدول كلَّه ويكتفي
// بـ`requireAuth` بلا صلاحية — وتعليقه كان يقول «لا أسرار هنا». ثم صار
// مسار تسجيل خطّاف SocialAPI يكتب سرّ توقيع HMAC في الجدول نفسه، فقرأه
// كلُّ عضوٍ مسجَّل — والدور الافتراضي لأول داخلٍ من المركز `writer`.
//
// والحارس القديم لم يلتقطه: قائمة `SECRET_KEYS` كانت تفحص `auth_secret`
// لا `webhook_secret`. فالحماية اليوم بالبنية لا بقائمة أسماء.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const ROOT = join(import.meta.dirname, '..');
const PREFIX = 'secret:';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = OFF');
  const dir = join(ROOT, 'migrations');
  for (const f of readdirSync(dir).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    d.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return d;
}

/** استعلام القراءة كما هو حرفياً في `src/routes/settings.ts`. */
function readable(d: any): string[] {
  return (d.prepare('SELECT key FROM settings WHERE key NOT LIKE ?').all(`${PREFIX}%`) as { key: string }[])
    .map((r) => r.key);
}

describe('أسرار جدول الإعدادات', () => {
  it('ما تحت البادئة لا يخرج من مسار القراءة، وما عداه يخرج', () => {
    const d = db();
    // `OR REPLACE` لأن بعض المفاتيح مزروعةٌ في الهجرات أصلاً
    d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('secret:socialapi_webhook', 'whsec_xyz')").run();
    d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email_from', 'no-reply@naflaw.sa')").run();

    const keys = readable(d);
    expect(keys).toContain('email_from');
    expect(keys).not.toContain('secret:socialapi_webhook');
    // ولا تسريب بالقيمة أيضاً
    expect(JSON.stringify(readable(d))).not.toContain('whsec_xyz');
  });

  it('الهجرة تنقل السرّ القائم بقيمته، فلا يُعاد تسجيل الخطّاف', () => {
    // نُنشئ الصفَّ بالاسم القديم قبل الهجرة، ثم نطبّقها وحدها
    const d = new DatabaseSync(':memory:');
    d.exec('PRAGMA foreign_keys = OFF');
    const dir = join(ROOT, 'migrations');
    const files = readdirSync(dir).filter((f) => /^0\d+.*\.sql$/.test(f)).sort();
    const rename = files.find((f) => f.includes('secret_settings'))!;
    expect(rename, 'هجرة نقل السرّ مفقودة').toBeTruthy();

    for (const f of files) {
      if (f === rename) {
        d.prepare("INSERT INTO settings (key, value) VALUES ('socialapi_webhook_secret', 'whsec_old')").run();
      }
      d.exec(readFileSync(join(dir, f), 'utf8'));
    }

    const row = d.prepare("SELECT value FROM settings WHERE key = 'secret:socialapi_webhook'").get() as { value: string };
    expect(row?.value).toBe('whsec_old');
    expect(d.prepare("SELECT COUNT(*) n FROM settings WHERE key = 'socialapi_webhook_secret'").get().n).toBe(0);
  });

  it('لا مفتاح إعدادٍ يستعمله الكود يقع في مصفاة الأسرار', () => {
    // المصفاة تمنع الكتابة، فلو طابقت مفتاحاً مشروعاً عطّلت حفظه
    const SECRET_KEYS = ['secret', 'token', 'api_key', 'password'];
    const src = readFileSync(join(ROOT, 'web', 'src', 'pages', 'Settings.tsx'), 'utf8');
    // مفاتيح تُرسل في `api.put('/settings', { … })`
    const sent = new Set<string>();
    for (const m of src.matchAll(/api\.put\('\/settings',\s*\{([\s\S]*?)\}\s*\)/g)) {
      for (const k of m[1].matchAll(/(^|[,{\s])([a-z_][a-z0-9_]*)\s*:/gi)) sent.add(k[2]);
    }
    expect(sent.size).toBeGreaterThan(5);

    const blocked = [...sent].filter(
      (k) => k.startsWith(PREFIX) || SECRET_KEYS.some((s) => k.toLowerCase().includes(s)),
    );
    expect(blocked, 'مفتاح إعدادٍ مشروع تمنعه مصفاة الأسرار').toEqual([]);
  });
});

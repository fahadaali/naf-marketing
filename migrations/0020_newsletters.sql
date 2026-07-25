-- ===== النشرات البريدية والمقالات =====
-- مصدر واحد يُنشر في عدة وجهات: بريد للمشتركين، صفحة مقالة عامة، وإكس/لينكدإن.

CREATE TABLE IF NOT EXISTS newsletters (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,          -- في رابط المقالة العامة
  subject         TEXT,                          -- عنوان رسالة البريد
  preheader       TEXT,                          -- نص المعاينة في صندوق الوارد
  excerpt         TEXT,                          -- مقتطف للمشاركة والفهرسة
  blocks_json     TEXT NOT NULL DEFAULT '[]',    -- كتل المحرر
  cover_media_id  TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','sending','sent','archived')),
  web_published   INTEGER NOT NULL DEFAULT 0,    -- منشورة كصفحة عامة
  published_at    TEXT,                          -- وقت نشر الصفحة العامة
  scheduled_at    TEXT,                          -- موعد الإرسال البريدي
  sent_at         TEXT,
  author_id       TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_newsletters_status ON newsletters(status);
CREATE INDEX IF NOT EXISTS idx_newsletters_web ON newsletters(web_published, published_at);

-- المشتركون — مع سجل الموافقة (مطلب نظامي: مصدر الاشتراك ووقته)
CREATE TABLE IF NOT EXISTS subscribers (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','active','unsubscribed','bounced')),
  tags            TEXT,                          -- شرائح (JSON array)
  consent_source  TEXT,                          -- من أين اشترك (صفحة مقالة/استيراد/يدوي)
  consent_at      TEXT,
  consent_ip      TEXT,
  token           TEXT NOT NULL UNIQUE,          -- للتأكيد وإلغاء الاشتراك بنقرة
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  unsubscribed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);

-- إرسالة لكل مشترك — أساس تتبّع الفتح والنقر
CREATE TABLE IF NOT EXISTS newsletter_sends (
  id             TEXT PRIMARY KEY,
  newsletter_id  TEXT NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  subscriber_id  TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed')),
  opened_at      TEXT,
  clicked_at     TEXT,
  open_count     INTEGER NOT NULL DEFAULT 0,
  click_count    INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  sent_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (newsletter_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_sends_pending ON newsletter_sends(newsletter_id, status);

-- صلاحية إدارة النشرات والمشتركين
INSERT OR IGNORE INTO roles_permissions (role_name, permission_key, allowed) VALUES
  ('writer','newsletter.manage',0),
  ('marketing_manager','newsletter.manage',1),
  ('general_manager','newsletter.manage',1);

-- إعدادات افتراضية للنشر العام
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('public_site_url', ''),          -- مثال: https://naf.sa (يُستخدم في الروابط المطلقة)
  ('public_article_path', '/articles');

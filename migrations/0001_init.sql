-- منصة ناف للتسويق — مخطط قاعدة البيانات (Cloudflare D1 / SQLite)
-- كل الأوقات تُخزَّن بصيغة ISO 8601 UTC. التوقيت العرضي: آسيا/الرياض (UTC+3).

-- المستخدمون
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_name     TEXT NOT NULL CHECK (role_name IN ('writer','marketing_manager','general_manager')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- الجلسات (مصادقة قائمة على الرموز في جدول مستقل)
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,       -- رمز الجلسة (عشوائي)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- مصفوفة الصلاحيات — تُخزَّن في قاعدة البيانات (لا تُثبَّت في الكود)
CREATE TABLE IF NOT EXISTS roles_permissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name      TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (role_name, permission_key)
);

-- الحملات التسويقية
CREATE TABLE IF NOT EXISTS campaigns (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  objective        TEXT,
  start_date       TEXT,
  end_date         TEXT,
  target_platforms TEXT,              -- JSON: ["linkedin","x",...]
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','completed','archived')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- المنشورات (المحتوى)
CREATE TABLE IF NOT EXISTS content_posts (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text','image','video')),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai','rss')),
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','pending_marketing','pending_gm','approved','scheduled','published','archived','rejected')),
  reject_reason TEXT,
  author_id    TEXT NOT NULL REFERENCES users(id),
  campaign_id  TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON content_posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_campaign ON content_posts(campaign_id);

-- الوسائط (تُخزَّن في R2)
CREATE TABLE IF NOT EXISTS media_assets (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,
  mime_type   TEXT,
  size        INTEGER,
  uploaded_by TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- نسخ المنصات (variants) — نص مخصّص لكل منصة
CREATE TABLE IF NOT EXISTS post_variants (
  id             TEXT PRIMARY KEY,
  post_id        TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  platform       TEXT NOT NULL,
  body_override  TEXT,
  media_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  UNIQUE (post_id, platform)
);

-- جداول النشر المجدول
CREATE TABLE IF NOT EXISTS schedules (
  id               TEXT PRIMARY KEY,
  post_id          TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  scheduled_at     TEXT NOT NULL,     -- UTC ISO 8601
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed')),
  provider_post_id TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  published_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(status, scheduled_at);

-- سجلّ الموافقات (كل انتقال حالة)
CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    TEXT NOT NULL REFERENCES users(id),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_post ON approvals(post_id);

-- خلاصات RSS
CREATE TABLE IF NOT EXISTS rss_feeds (
  id         TEXT PRIMARY KEY,
  url        TEXT NOT NULL UNIQUE,
  title      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  added_by   TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- عناصر الأخبار المجلوبة
CREATE TABLE IF NOT EXISTS news_items (
  id                TEXT PRIMARY KEY,
  feed_id           TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
  title             TEXT,
  link              TEXT UNIQUE,
  summary           TEXT,
  published_at      TEXT,
  converted_post_id TEXT REFERENCES content_posts(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_news_feed ON news_items(feed_id);

-- لقطات التحليلات
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id          TEXT PRIMARY KEY,
  platform    TEXT NOT NULL,
  post_id     TEXT REFERENCES content_posts(id) ON DELETE CASCADE,
  reach       INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  engagement  INTEGER DEFAULT 0,
  followers   INTEGER DEFAULT 0,
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_post ON analytics_snapshots(post_id);
CREATE INDEX IF NOT EXISTS idx_analytics_captured ON analytics_snapshots(captured_at);

-- الإعدادات غير السرية (key/value)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

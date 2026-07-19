-- توليد الوسائط بالذكاء الاصطناعي (صور/فيديو) — مهام غير متزامنة للفيديو
CREATE TABLE IF NOT EXISTS media_gen_jobs (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('image','video')),
  provider        TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  external_job_id TEXT,
  media_asset_id  TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  error           TEXT,
  requested_by    TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('image_provider', 'mock'),
  ('video_provider', 'mock');

-- إدارة التعليقات والرسائل المباشرة على المنصات
CREATE TABLE IF NOT EXISTS platform_comments (
  id                  TEXT PRIMARY KEY,
  post_id             TEXT REFERENCES content_posts(id) ON DELETE CASCADE,
  schedule_id         TEXT REFERENCES schedules(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,
  provider_comment_id TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','dm')),
  author_name         TEXT,
  body                TEXT,
  reply_body          TEXT,
  replied_at          TEXT,
  replied_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (platform, provider_comment_id)
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON platform_comments(post_id);

INSERT OR IGNORE INTO roles_permissions (role_name, permission_key, allowed) VALUES
  ('writer','comments.manage',0),
  ('marketing_manager','comments.manage',1),
  ('general_manager','comments.manage',1);

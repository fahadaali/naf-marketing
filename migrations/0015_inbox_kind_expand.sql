-- توسيع قيم kind في platform_comments لتشمل الإشارات والتقييمات.
-- SQLite لا يسمح بتعديل قيد CHECK مباشرةً، لذا نُعيد بناء الجدول.
-- لا شيء يشير إلى هذا الجدول، فإعادة البناء آمنة.
-- نفّذ العبارات بالترتيب (كلٌّ على حدة في D1 Console).

CREATE TABLE platform_comments_new (
  id                  TEXT PRIMARY KEY,
  post_id             TEXT REFERENCES content_posts(id) ON DELETE CASCADE,
  schedule_id         TEXT REFERENCES schedules(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,
  provider_comment_id TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','dm','mention','review')),
  author_name         TEXT,
  body                TEXT,
  reply_body          TEXT,
  replied_at          TEXT,
  replied_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  capabilities_json   TEXT,
  is_hidden           INTEGER NOT NULL DEFAULT 0,
  UNIQUE (platform, provider_comment_id)
);

INSERT INTO platform_comments_new
  (id, post_id, schedule_id, platform, provider_comment_id, kind, author_name, body, reply_body, replied_at, replied_by, created_at, capabilities_json, is_hidden)
  SELECT id, post_id, schedule_id, platform, provider_comment_id, kind, author_name, body, reply_body, replied_at, replied_by, created_at, capabilities_json, is_hidden
  FROM platform_comments;

DROP TABLE platform_comments;

ALTER TABLE platform_comments_new RENAME TO platform_comments;

CREATE INDEX IF NOT EXISTS idx_comments_post ON platform_comments(post_id);

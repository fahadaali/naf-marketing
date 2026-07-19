-- الإشعارات (داخل التطبيق + بريد اختياري)
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('email_provider', 'mock'),
  ('email_from', '');

-- سجل نسخ المحتوى
CREATE TABLE IF NOT EXISTS content_versions (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  edited_by    TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_versions_post ON content_versions(post_id);

-- قوالب/مقتطفات المحتوى
CREATE TABLE IF NOT EXISTS content_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  body         TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- بحث نصي كامل (FTS5) عبر المحتوى والأخبار
CREATE VIRTUAL TABLE IF NOT EXISTS content_search USING fts5(title, body, content='content_posts', content_rowid='rowid');
INSERT INTO content_search(rowid, title, body) SELECT rowid, title, body FROM content_posts;

CREATE TRIGGER IF NOT EXISTS content_search_ai AFTER INSERT ON content_posts BEGIN
  INSERT INTO content_search(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS content_search_ad AFTER DELETE ON content_posts BEGIN
  INSERT INTO content_search(content_search, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS content_search_au AFTER UPDATE ON content_posts BEGIN
  INSERT INTO content_search(content_search, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO content_search(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS news_search USING fts5(title, summary, content='news_items', content_rowid='rowid');
INSERT INTO news_search(rowid, title, summary) SELECT rowid, title, summary FROM news_items;

CREATE TRIGGER IF NOT EXISTS news_search_ai AFTER INSERT ON news_items BEGIN
  INSERT INTO news_search(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS news_search_ad AFTER DELETE ON news_items BEGIN
  INSERT INTO news_search(news_search, rowid, title, summary) VALUES('delete', old.rowid, old.title, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS news_search_au AFTER UPDATE ON news_items BEGIN
  INSERT INTO news_search(news_search, rowid, title, summary) VALUES('delete', old.rowid, old.title, old.summary);
  INSERT INTO news_search(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
END;

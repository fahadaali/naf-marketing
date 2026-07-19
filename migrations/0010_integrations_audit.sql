-- ملاحظات مستوردة من تعليقات بطاقات بيسكامب (ربط عكسي على تدفّق الاعتماد)
CREATE TABLE IF NOT EXISTS post_notes (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'basecamp',
  external_id TEXT,
  author_name TEXT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_post_notes_post ON post_notes(post_id);

-- سجل تدقيق: من فعل ماذا ومتى
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  actor_name  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

INSERT OR IGNORE INTO roles_permissions (role_name, permission_key, allowed) VALUES
  ('writer','audit.view',0), ('marketing_manager','audit.view',0), ('general_manager','audit.view',1);

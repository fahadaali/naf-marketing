ALTER TABLE analytics_snapshots ADD COLUMN provider_post_id TEXT;
ALTER TABLE analytics_snapshots ADD COLUMN title TEXT;
ALTER TABLE analytics_snapshots ADD COLUMN via_platform INTEGER NOT NULL DEFAULT 1;
ALTER TABLE analytics_snapshots ADD COLUMN sent_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_provider ON analytics_snapshots(provider_post_id);
CREATE INDEX IF NOT EXISTS idx_analytics_platform ON analytics_snapshots(platform);
CREATE INDEX IF NOT EXISTS idx_analytics_via ON analytics_snapshots(via_platform);

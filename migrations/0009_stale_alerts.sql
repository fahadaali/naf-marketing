-- حد الأيام الذي يُعتبر بعده المحتوى العالق في مرحلة مراجعة/اعتماد "متأخراً"
INSERT OR IGNORE INTO settings (key, value) VALUES ('stale_alert_days', '3');

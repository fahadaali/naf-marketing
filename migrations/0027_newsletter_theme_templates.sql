-- ===== سمة النشرة وقوالبها =====
-- التخصيص يعيش في مكانين: `style` على كل كتلة داخل blocks_json القائم،
-- وسمةٌ للرسالة كاملةً في عمودٍ مستقلّ. لا عمود لكل لون: الألوان تتبدّل
-- والأعمدة لا، وسمةٌ في JSON تُقرأ بمحقّق واحد في blockStyle.ts.

ALTER TABLE newsletters ADD COLUMN theme_json TEXT;   -- فارغ يعني السمة الافتراضية

-- قوالب النشرة — تُحفظ من نشرةٍ قائمة أو تُستورد من ملف.
-- منفصلة عن content_templates: تلك تحفظ HTML لمنشورات المحتوى، وهذه
-- تحفظ كتلاً وسمة. جدولٌ واحدٌ بعمودٍ يفرّق بينهما يجعل كل قارئ يسأل
-- أيّ صيغةٍ في `body` قبل أن يقرأها.
CREATE TABLE IF NOT EXISTS newsletter_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  subject      TEXT,                          -- عنوان بريد مقترح
  preheader    TEXT,                          -- نص معاينة مقترح
  blocks_json  TEXT NOT NULL DEFAULT '[]',
  theme_json   TEXT,
  -- من أين جاء: حُفظ من نشرة، أو استُورد من ملف قالب ناف، أو من HTML خارجي.
  -- يُعرض للكاتب في المعرض لأن أصل القالب يفسّر ما قد ينقصه.
  origin       TEXT NOT NULL DEFAULT 'saved'
               CHECK (origin IN ('saved','imported','imported_html')),
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_nl_templates_created ON newsletter_templates(created_at DESC);

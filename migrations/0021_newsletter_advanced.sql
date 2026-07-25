-- ===== تحسينات النشرة: اختبار العنوانين، الشرائح، الترحيب الآلي =====

-- عنوان بديل لاختبار A/B: تُرسَل عيّنة بالعنوانين ثم يُعتمد الأفضل فتحاً
ALTER TABLE newsletters ADD COLUMN subject_b TEXT;
ALTER TABLE newsletters ADD COLUMN ab_percent INTEGER NOT NULL DEFAULT 20;  -- نسبة العيّنة لكل عنوان
ALTER TABLE newsletters ADD COLUMN ab_winner TEXT;                          -- 'a' أو 'b' بعد الحسم
-- شريحة مستهدفة (وسم) — فارغ يعني كل المشتركين النشطين
ALTER TABLE newsletters ADD COLUMN segment_tag TEXT;

-- أي عنوان استُخدم لكل إرسالة (لقياس أداء كل عنوان)
ALTER TABLE newsletter_sends ADD COLUMN variant TEXT NOT NULL DEFAULT 'a';

-- رسالة الترحيب الآلية عند الاشتراك
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('welcome_enabled', '0'),
  ('welcome_subject', 'أهلاً بك في نشرة ناف القانونية'),
  ('welcome_body', 'شكراً لاشتراكك. ستصلك مقالاتنا القانونية أولاً بأول، ويمكنك إلغاء الاشتراك في أي وقت.');

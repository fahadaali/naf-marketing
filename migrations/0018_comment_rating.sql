-- تقييم رقمي للمراجعات (١..٥) — كان مُضمَّناً نصياً داخل author_name فتعذّر تحليله.
-- يُمكّن تحليلات السمعة (المتوسط، توزيع النجوم، الاتجاه) وتنبيهات التقييم السلبي.
ALTER TABLE platform_comments ADD COLUMN rating INTEGER;
CREATE INDEX IF NOT EXISTS idx_comments_rating ON platform_comments(rating);

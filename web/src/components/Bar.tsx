/* شريط نسبة — الأصنافُ في styles.css.
   كان دالّةً خاصة في pages/analytics/panels.tsx، وصفحةُ الحملة تحتاجه
   نفسَه: نسخةٌ ثانية تعني شريطين يفترقان أول ما يُعدَّل أحدهما. */
export default function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${Math.min((value / Math.max(max, 1)) * 100, 100)}%` }} />
    </div>
  );
}

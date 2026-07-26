import { Star } from 'lucide-react';

/* عرض التقييم بالنجوم — تعريف واحد لكل المنصة.
   اللون من رمز --warning، ولا يُكتب لون خام.
   المعنى لا يُنقل باللون وحده: يرافق المقياسَ رقمٌ دائماً. */

const FILL = 'var(--warning)';

/** قيمة تقييم مختصرة: الرقم ونجمة واحدة — «4.4 ★» */
export function StarValue({ value, size = 14 }: { value: number | string; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <bdi>{value}</bdi>
      <Star size={size} fill={FILL} color={FILL} />
    </span>
  );
}

/** مقياس من خمس نجمات، الممتلئ منها بعدد التقييم */
export function StarScale({ value, size = 13 }: { value: number; size?: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
      title={`تقييم ${value} من 5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={size}
          fill={i < filled ? FILL : 'none'}
          color={i < filled ? FILL : 'var(--muted-foreground)'}
        />
      ))}
    </span>
  );
}

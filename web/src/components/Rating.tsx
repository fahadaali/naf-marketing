import * as React from "react"
import { Star } from "lucide-react"

import { cn } from "../lib/utils"

// منسوخ من fahadaali/naf-ui#v1.2.0 (registry/naf/ui/rating.tsx).
// التعديل الوحيد: مسار استيراد cn محلي بدل مسار السجلّ.
//
// التقييم نمط عرض لا أيقونة. صيغتان فقط: قيمة ومقياس.
//
// الممتلئة warning والفارغة muted-foreground — استثناء مقصود لقاعدة
// «الأيقونة ترث لون النص»، لأن التقييم مقياس بصري لا زخرفة.
//
// المعنى لا يُنقل باللون وحده: القيمة رقم ظاهر، والمقياس يحمل نصاً بديلاً.
// النجمة لا تُقلب في الاتجاه من اليمين لليسار.

const MAX = 5

/** قيمة تقييم مختصرة للوحات والجداول: الرقم ونجمة واحدة ممتلئة. */
export interface RatingValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number | string
  /** مقاس النجمة — من سلّم الأيقونات: 16 داخل النصوص، 20 داخل الأزرار */
  size?: number
}

const RatingValue = React.forwardRef<HTMLSpanElement, RatingValueProps>(
  ({ value, size = 16, className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn("inline-flex items-center gap-1 tabular-nums", className)}
      {...props}
    >
      <bdi>{value}</bdi>
      <Star size={size} className="shrink-0 fill-warning text-warning" />
    </span>
  )
)
RatingValue.displayName = "RatingValue"

/** مقياس من خمس نجمات لبطاقة تقييم مفرد. */
export interface RatingScaleProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number
  size?: number
  /** نص بديل مخصّص — الافتراضي «تقييم N من 5» */
  label?: string
}

const RatingScale = React.forwardRef<HTMLSpanElement, RatingScaleProps>(
  ({ value, size = 16, label, className, ...props }, ref) => {
    const filled = Math.max(0, Math.min(MAX, Math.round(value)))
    const text = label ?? `تقييم ${value} من ${MAX}`

    return (
      <span
        ref={ref}
        role="img"
        aria-label={text}
        title={text}
        className={cn("inline-flex items-center gap-0.5", className)}
        {...props}
      >
        {Array.from({ length: MAX }, (_, index) => (
          <Star
            key={index}
            size={size}
            aria-hidden
            className={cn(
              "shrink-0",
              index < filled
                ? "fill-warning text-warning"
                : "fill-transparent text-muted-foreground"
            )}
          />
        ))}
      </span>
    )
  }
)
RatingScale.displayName = "RatingScale"

export { RatingValue, RatingScale }

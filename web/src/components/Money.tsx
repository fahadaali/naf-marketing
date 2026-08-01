import * as React from 'react';

import { cn } from '../lib/utils';
import { formatAmount } from '../lib/format';

/* منقول من سجلّ ناف: `naf-currency`. لا يُعدَّل هنا — أي تغيير يمرّ من
   السجلّ أولاً. والمسارات وحدها هي ما بُدّل ليطابق بنية هذه المنصة. */

/**
 * مبلغ بالريال السعودي.
 *
 * - المبلغ كاملاً داخل bdi فلا ينقلب ترتيبه داخل نص عربي
 * - أرقام متساوية العرض فتتحاذى الأعمدة في الجداول
 * - الرمز U+20C1 بارتفاع النص، وفراغه يتبع اتجاه النص
 * - إن تعذّر تحميل الخط ظهر البديل النصي "ر.س"
 *
 * التنسيق من formatAmount حصراً. لا تنسّق مبلغاً في مكوّن.
 */

const RIYAL = '⃁';
const FALLBACK = 'ر.س';
const PROBE = `1em "Saudi Riyal"`;

export interface MoneyProps extends React.HTMLAttributes<HTMLElement> {
  /** المبلغ رقماً. التنسيق مسؤولية المكوّن لا المستدعي. */
  value: number;
}

const Money = React.forwardRef<HTMLElement, MoneyProps>(({ value, className, ...props }, ref) => {
  // نبدأ بافتراض توفّر الخط: هو مستضاف ذاتياً ويصل مع الصفحة،
  // فالحالة الشائعة ألا يومض شيء. البديل يظهر عند الفشل فقط.
  const [hasFont, setHasFont] = React.useState(true);

  React.useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let alive = true;

    // نمرّر الرمز نفسه: الخط مقيّد بـ unicode-range على U+20C1،
    // والنص الافتراضي لـ check لا يقع داخل النطاق فيعطي نتيجة خاطئة.
    document.fonts
      .load(PROBE, RIYAL)
      .then(() => {
        if (alive) setHasFont(document.fonts.check(PROBE, RIYAL));
      })
      .catch(() => {
        if (alive) setHasFont(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <bdi ref={ref} className={cn('naf-money tabular-nums', className)} {...props}>
      {formatAmount(value)}
      {hasFont ? (
        <span className="naf-riyal" aria-hidden="true">
          {RIYAL}
        </span>
      ) : (
        <span className="naf-riyal-fallback" aria-hidden="true">
          {FALLBACK}
        </span>
      )}
      <span className="sr-only">ريال سعودي</span>
    </bdi>
  );
});
Money.displayName = 'Money';

export { Money };

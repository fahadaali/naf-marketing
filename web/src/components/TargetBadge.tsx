import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TargetStatus } from '../metrics';
import { TARGET_STATUS_BADGE, TARGET_STATUS_LABELS } from '../metrics';

/* شارة موضع الرقم من مستهدفه — naf-icons.md «حالة المؤشر أمام مستهدفه».
   كانت خاصةً داخل MetricCard، وشريطُ أداء الحملة يقيس القياس نفسه:
   «ضمن المستهدف» في شاشتين بمعنيين مختلفين هو الانحراف بعينه. */

const TARGET_ICON: Record<TargetStatus, LucideIcon> = {
  on_target: CircleCheck,
  near_target: TriangleAlert,
  off_target: CircleAlert,
  no_target: CircleHelp,
};

export default function TargetBadge({ status, size = 16 }: { status: TargetStatus; size?: number }) {
  const Icon = TARGET_ICON[status];
  return (
    <span className={`badge ${TARGET_STATUS_BADGE[status]}`}>
      <Icon size={size} />
      {TARGET_STATUS_LABELS[status]}
    </span>
  );
}

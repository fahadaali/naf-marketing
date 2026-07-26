import {
  Archive,
  CalendarClock,
  CircleCheck,
  CircleX,
  Clock,
  FilePen,
  Send,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { STATUS_LABELS, STATUS_BADGE } from '../api';

/* شارة حالة المحتوى — لون وأيقونة ونص معاً، لا لون وحده.
   الأيقونات من جدول «دورة حياة المحتوى» في naf-icons.md#v1.3.0. */

const STATUS_ICON: Record<string, LucideIcon> = {
  draft: FilePen,
  pending_marketing: Clock,
  pending_gm: UserCheck,
  approved: CircleCheck,
  scheduled: CalendarClock,
  late: TriangleAlert,
  published: Send,
  archived: Archive,
  rejected: CircleX,
};

export default function StatusBadge({
  status,
  size = 13,
  iconOnly = false,
}: {
  status: string;
  size?: number;
  iconOnly?: boolean;
}) {
  const Icon = STATUS_ICON[status];
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`badge ${STATUS_BADGE[status] || 'gray'}`} title={iconOnly ? label : undefined}>
      {Icon && <Icon size={size} />}
      {!iconOnly && label}
    </span>
  );
}

import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  Link2,
  Link2Off,
  Loader,
  MailCheck,
  MailX,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* شارات الحالات المسجّلة في naf-icons.md#v1.4.0 — لون وأيقونة ونص معاً.
   ثلاث مجموعات: الاشتراك البريدي، والإرسال البريدي، والربط والتفعيل. */

type State = { label: string; badge: string; icon: LucideIcon };

const SUBSCRIPTION: Record<string, State> = {
  active: { label: 'نشط', badge: 'green', icon: CircleCheck },
  pending: { label: 'بانتظار التأكيد', badge: 'amber', icon: Clock },
  unsubscribed: { label: 'ألغى الاشتراك', badge: 'gray', icon: UserMinus },
  bounced: { label: 'مرتدّ', badge: 'red', icon: MailX },
};

const DELIVERY: Record<string, State> = {
  draft: { label: 'مسودة', badge: 'gray', icon: CircleSlash },
  scheduled: { label: 'مجدولة', badge: 'blue', icon: Clock },
  sending: { label: 'قيد الإرسال', badge: 'blue', icon: Loader },
  sent: { label: 'أُرسلت', badge: 'green', icon: MailCheck },
  archived: { label: 'مؤرشفة', badge: 'gray', icon: CircleSlash },
  failed: { label: 'فاشل', badge: 'red', icon: CircleX },
};

/** ثنائيات الربط والتفعيل — النوع يحدّد المصطلح، والقيمة تحدّد الجهة. */
const CONNECTION: Record<string, [State, State]> = {
  enabled: [
    { label: 'مفعّل', badge: 'green', icon: CircleCheck },
    { label: 'معطّل', badge: 'gray', icon: CircleSlash },
  ],
  configured: [
    { label: 'مضبوط', badge: 'green', icon: ShieldCheck },
    { label: 'غير مضبوط', badge: 'red', icon: ShieldAlert },
  ],
  linked: [
    { label: 'مربوط', badge: 'green', icon: Link2 },
    { label: 'غير مربوط', badge: 'gray', icon: Link2Off },
  ],
};

function render(state: State | undefined, fallback: string, size: number) {
  if (!state) return <span className="badge gray">{fallback}</span>;
  const Icon = state.icon;
  return (
    <span className={`badge ${state.badge}`}>
      <Icon size={size} />
      {state.label}
    </span>
  );
}

/** حالة مشترك في النشرة البريدية. */
export function SubscriptionBadge({ state, size = 13 }: { state: string; size?: number }) {
  return render(SUBSCRIPTION[state], state, size);
}

/** حالة نشرة بريدية من حيث الإرسال. */
export function DeliveryBadge({ state, size = 13 }: { state: string; size?: number }) {
  return render(DELIVERY[state], state, size);
}

/** ثنائية ربط أو تفعيل: `on` تختار الجهة، و`kind` يختار المصطلح. */
export function ConnectionBadge({
  kind,
  on,
  size = 13,
}: {
  kind: keyof typeof CONNECTION;
  on: boolean;
  size?: number;
}) {
  const [yes, no] = CONNECTION[kind];
  return render(on ? yes : no, '—', size);
}

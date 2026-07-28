import { CircleAlert, CircleSlash, ShieldX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* شاشة الرفض — تُفتح بلا جلسة، فهي مسار عام في حارس الدخول الموحّد.

   النصوص والأيقونات والألوان من naf-terms.md §١٠ «منع الدخول إلى منصة»
   حرفياً. أربعة رموز لا خامس لها، والصفحة تترجم الرمز إلى المصطلح
   المسجَّل — الحزمة تمرّر رمزاً لا جملة، ولو حملت الجملة لصارت مصدر نصّ
   ثانياً خارج السجلّ.

   وكانت هذه الشاشة بلا أيقونة وبنصوص لا تطابق السجلّ: صيغت حين كان
   المثبَّت v1.11.0، وسُجّلت هذه الحالات الأربع بأيقوناتها وألوانها بعده.
   والحالة لا تُبلَّغ باللون وحده — أيقونة ونصّ معها في كل حال.

   والعنوان «تعذّر الدخول» لا «رفض الدخول»: اثنتان من الأربع عطل تقني في
   المحاولة نفسها لا حكمٌ على القارئ.

   ولا رمز خطأ تقنياً يُعرض، ولا تلميح إلى أنّ للمنصة أعضاء غيره. */

type DeniedCase = { text: string; Icon: LucideIcon; tone: string };

const DENIED_CASES: Record<string, DeniedCase> = {
  inactive: {
    text: 'عضويتك في هذه المنصة معطّلة. راجع مسؤول المنصة.',
    Icon: CircleSlash,
    tone: 'text-muted-foreground',
  },
  not_member: {
    text: 'لا تملك صلاحية الوصول لهذه المنصة',
    Icon: ShieldX,
    tone: 'text-destructive',
  },
  bad_state: {
    text: 'انتهت جلسة دخولك. سجّل الدخول من جديد',
    Icon: CircleAlert,
    tone: 'text-destructive',
  },
  auth_failed: {
    text: 'تعذّر التحقق من دخولك. أعد المحاولة.',
    Icon: CircleAlert,
    tone: 'text-destructive',
  },
};

/** رمز مسجَّل يُترجَم من السجلّ؛ وسبب نصّي قادم من المركز يُعرض كما هو. */
function resolve(raw: string): DeniedCase {
  if (!raw) return DENIED_CASES.not_member;
  if (DENIED_CASES[raw]) return DENIED_CASES[raw];
  // رمز غير معروف لا يُعرض للمستخدم كما هو — قد يكون رمزاً تقنياً.
  if (/^[a-z_]+$/.test(raw)) return DENIED_CASES.not_member;
  return { ...DENIED_CASES.not_member, text: raw };
}

export default function Denied() {
  const raw = new URLSearchParams(window.location.search).get('r') || '';
  const { text, Icon, tone } = resolve(raw);

  return (
    <main className="min-h-full grid place-items-center p-6">
      <div className="grid justify-items-center gap-4 max-w-prose text-center">
        <Icon className={tone} size={40} aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">تعذّر الدخول</h1>
        <p className="text-base text-muted-foreground">{text}</p>
      </div>
    </main>
  );
}

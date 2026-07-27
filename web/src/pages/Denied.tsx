// شاشة الرفض — تُفتح بلا جلسة، فهي مسار عام في حارس الدخول الموحّد.
//
// النصوص من naf-terms.md حصراً. وبلا أيقونة عمداً: السجلّ يسجّل لـ«بلا
// صلاحية» و«الوصول منتهٍ» أيقونةً `—`، وينصّ على أن «حرمان المستخدم
// وانتهاء وصوله لا شارة لهما… ومعه السبب نصاً». فالسبب هنا نصّ وحده،
// والحالة غير مبلَّغة باللون.

// المصطلحات كما وردت في naf-terms.md — لا تُصَغ محلياً.
const DENIED_TERMS: Record<string, string> = {
  inactive: 'معطّل',
  not_member: 'لا تملك صلاحية الوصول لهذه المنصة',
  bad_state: 'لا تملك صلاحية الوصول لهذه المنصة',
  auth_failed: 'لا تملك صلاحية الوصول لهذه المنصة',
  expired: 'انتهت صلاحية وصولك',
};

/** رمز مسجَّل يُترجَم من السجلّ؛ وسبب نصّي قادم من المركز يُعرض كما هو. */
function reasonText(raw: string): string {
  if (!raw) return DENIED_TERMS.not_member;
  if (DENIED_TERMS[raw]) return DENIED_TERMS[raw];
  // رمز غير معروف لا يُعرض للمستخدم كما هو — قد يكون رمزاً تقنياً.
  if (/^[a-z_]+$/.test(raw)) return DENIED_TERMS.not_member;
  return raw;
}

export default function Denied() {
  const raw = new URLSearchParams(window.location.search).get('r') || '';

  return (
    <main className="min-h-full grid place-items-center p-6">
      <div className="max-w-prose text-center">
        <h1 className="text-xl font-semibold text-foreground leading-relaxed">
          {reasonText(raw)}
        </h1>
        <p className="mt-3 text-muted-foreground leading-loose">راجع مسؤول المنصة.</p>
      </div>
    </main>
  );
}

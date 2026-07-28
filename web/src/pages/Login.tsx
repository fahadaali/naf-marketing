import { useEffect } from 'react';
import { NafLogo } from '../components/brand/NafLogo';

/* شاشة الدخول لم تعد تسأل عن بريد ولا كلمة مرور: المصادقة كلها في المركز.
   وما كان هنا — نموذجُ كلمة مرور و«التهيئة الأولى» — كان طريق دخول ثانياً
   لا يمرّ بالمركز، وقد أُغلقت مساراته في الخادم.

   والباب يُفتح بتحميلٍ كامل للجذر لا بتنقّل داخل React: الحارس في الـWorker
   هو من يقرأ الجلسة ويحوّل إلى المركز، وتنقّلُ الموجّه لا يغادر الصفحة
   فلا يمرّ به أصلاً.

   والنصّ «جارٍ الدخول» من naf-terms.md §١٠ — انتظار الدخول. */

export default function Login() {
  useEffect(() => {
    window.location.replace('/');
  }, []);

  return (
    <main className="min-h-full grid place-items-center p-6">
      <div className="grid justify-items-center gap-4 text-center">
        <NafLogo variant="mark" className="h-20" />
        <p className="text-base text-muted-foreground">جارٍ الدخول</p>
      </div>
    </main>
  );
}

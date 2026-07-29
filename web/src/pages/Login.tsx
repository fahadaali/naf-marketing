import { useEffect } from 'react';
import { NafLogo } from '../components/brand/NafLogo';

/* شاشة الدخول لم تعد تسأل عن بريد ولا كلمة مرور: المصادقة كلها في المركز.
   وما كان هنا — نموذجُ كلمة مرور و«التهيئة الأولى» — كان طريق دخول ثانياً
   لا يمرّ بالمركز، وقد أُغلقت مساراته في الخادم.

   والباب يُفتح بتحميلٍ كامل للجذر لا بتنقّل داخل React: الحارس في الـWorker
   هو من يقرأ الجلسة ويحوّل إلى المركز، وتنقّلُ الموجّه لا يغادر الصفحة
   فلا يمرّ به أصلاً.

   والنصّ «جارٍ الدخول» من naf-terms.md §١٠ — انتظار الدخول. */

/* أثرُ محاولةٍ واحدة، عمرُه عمر التبويب. */
const RETRY_KEY = 'naf-login-retry';

export default function Login() {
  useEffect(() => {
    /* ═══ محاولةٌ واحدة، ثم يُقال السبب ═══

       التحميل الكامل هو الفعل الصحيح لمن لا جلسة له: الحارس يقرأ ولا يجد
       فيحوّل إلى المركز. أمّا من وصل هذه الشاشة وجلستُه صحيحة عند الحارس
       فالتحميل لا يغيّر شيئاً — يمرّ، وتُقلع اللوحة، وتسأل عن العضو،
       وتُردّ بما رُدّت به، فتعود إلى هنا. دورةٌ لا تنتهي ولا تعرض شيئاً،
       وقد وقعت فعلاً حين افترق قارئ المستخدم عن الحارس.

       فتُعلَّم المحاولة، ويُقرأ الأثر عند الوصول الثاني: بلوغُ هذه الشاشة
       بعد تحميلٍ تمّ يعني أن العلّة ليست في غياب الجلسة، فيُحوَّل صاحبها
       إلى شاشة الرفض المسجَّلة برمز «تعذّر التحقق من دخولك» بدل أن يُدار.

       والأثر يُقرأ ويُمحى معاً عند كل وصول، فلا يتراكم: كل وصولين
       متتاليين لهما محاولةٌ واحدة، والثالث يبدأ من جديد. */
    let tried = false;
    try {
      tried = sessionStorage.getItem(RETRY_KEY) === '1';
      sessionStorage.removeItem(RETRY_KEY);
      if (!tried) sessionStorage.setItem(RETRY_KEY, '1');
    } catch {
      /* تخزينٌ محجوب: تبقى محاولةٌ واحدة بلا أثر — والحلقة تقطعها
         خوادمُ الردّ نفسها بعد أن صار `‎/api/auth/me` يردّ رفضاً لا فراغاً. */
    }

    if (tried) window.location.replace('/denied?r=auth_failed');
    else window.location.replace('/');
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

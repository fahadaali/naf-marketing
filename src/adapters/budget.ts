/* ═══ ميزانيةُ النداءات ═══

   عاملُ كلاودفلير يُحدّ بعدد الطلبات الخارجية في الاستدعاء الواحد: خمسون
   في الخطة المجانية. والمزامنة كانت تنادي منشوراً منشوراً بلا حدّ، فإذا
   بلغ الاستدعاء حدّه سقط كل نداءٍ بعده بخطأ «Too many subrequests» —
   وكلُّها محاطةٌ بـ`catch` صامت. فيصل من الصندوق ما سبق الحدّ ويغيب ما بعده،
   ويتبدّل الغائب من ساعةٍ إلى ساعة بحسب ما سبقه من مهام: تعليقاتٌ لا تظهر
   أبداً، وأرقامٌ تظهر مرّةً وتغيب أخرى.

   فكل دورة تحمل ميزانيةً معلومة، وتقف عندها واقفةً لا ساقطة: تحفظ ما جمعت
   وتقول إنها لم تكمل، وتُكمل الدورةُ التالية من حيث بلغت. */

/** نفدت ميزانية الدورة — ليس عطلاً في المزوّد، فلا يُعرض خطأً. */
export class BudgetExhausted extends Error {
  constructor() {
    super('budget_exhausted');
    this.name = 'BudgetExhausted';
  }
}

/**
 * عدّادُ نداءات الدورة الواحدة، ومعه سقفُ وقتها. وتقف كذلك حين يطلب المزوّد
 * التمهّل أو يبلغ الاستدعاء حدّ طلباته — وقفاً تُكمله الدورة التالية، لا عطلاً.
 */
export class CallBudget {
  used = 0;
  /** سببُ الوقف قبل الحصّة — `null` ما دامت الحصّة وحدها تحكم. */
  stoppedBy: 'rate_limit' | 'platform_cap' | null = null;
  constructor(readonly max: number, private readonly deadline: number = Number.POSITIVE_INFINITY) {}
  get left(): number {
    if (this.stoppedBy || Date.now() >= this.deadline) return 0;
    return Math.max(this.max - this.used, 0);
  }
  spend(): void {
    if (this.left <= 0) throw new BudgetExhausted();
    this.used++;
  }
  stop(reason: 'rate_limit' | 'platform_cap'): void {
    this.stoppedBy = reason;
  }
}

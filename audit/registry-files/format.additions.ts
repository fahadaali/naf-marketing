/* ============================================================
   إضافات naf-format — الدفعة ٥
   تُدمج في مكتبة التنسيق المشتركة داخل مستودع naf-ui.
   مصدرها: جلسة /check-drift على naf-marketing
   ============================================================ */

/**
 * يعزل قيمة اتجاهياً داخل نص عربي.
 *
 * للسلاسل الخام التي لا يصلح فيها <bdi>: رسائل confirm ونصوص الحالة
 * والتنبيهات. في JSX استعمل <bdi> لا هذه.
 *
 * المحرفان U+2068 (عزل أول) و U+2069 (إنهاء العزل).
 *
 * CLAUDE.md §8 يوجب عزل كل رقم وتاريخ ومبلغ، و<bdi> يغطّي JSX وحده.
 * بدون هذه الدالة تبقى كل رسالة فيها رقم منحرفة — وهي أكثر من نصف
 * الرسائل عملياً (١٩ رسالة في naf-marketing وحدها).
 *
 * @example
 *   setMsg(`تم حذف ${isolate(count)} عنصراً`)
 *   confirm(`حذف ${isolate(n)} عنصراً نهائياً؟`)
 */
export function isolate(value: string | number): string {
  return `⁨${value}⁩`
}

/**
 * الشهر والسنة لعناوين التقويم ومنتقي التاريخ: "2026/07".
 *
 * مشتقّة من الصيغة الميلادية المسجّلة بحذف اليوم — ليست صيغة جديدة.
 * أسماء الأشهر العربية ليست صيغة مسجّلة ولا تُستعمل لعرض قيمة تاريخ.
 */
export function formatMonth(value: Date | string | number): string {
  const date = toDate(value)
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}`
}

/**
 * الميلادي مع الوقت بنظام ٢٤ ساعة: "2026/07/26 14:30".
 * لقيمة تاريخ+وقت مختارة في حقل أو معروضة في جدول.
 */
export function formatDateTime(value: Date | string | number): string {
  return `${formatDate(value)} ${formatTime(value)}`
}

/* ملاحظة للمُدمِج: toDate و pad و formatDate و formatTime موجودة أصلاً
   في المكتبة. هذه الثلاث تُضاف إليها ولا تستبدل شيئاً. */

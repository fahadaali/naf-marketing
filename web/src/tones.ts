// نبرات الذكاء الاصطناعي (قابلة للتخصيص من الإعدادات). تُطابق الافتراضي في الخادم.
export type Tone = { key: string; label: string; prompt: string };

export const DEFAULT_TONES: Tone[] = [
  { key: 'formal', label: 'رسمي', prompt: 'اكتب بأسلوب رسمي خبري محايد يليق ببيان صادر عن شركة استشارات قانونية، بصياغة قريبة من الخبر أو الإعلان الرسمي، دون ترويج مباشر للخدمات.' },
  { key: 'marketing', label: 'تسويقي', prompt: 'اكتب بأسلوب تسويقي جذّاب يربط الموضوع بخدمات شركة ناف للاستشارات القانونية، ويبرز كيف تساعد ناف العميل في هذا الجانب، ويحثّ على التواصل معها.' },
  { key: 'knowledge', label: 'معرفي', prompt: 'انقل معرفة قانونية متخصصة من المصدر: إن كان المصدر طويلاً فاختر جزئية دقيقة ومفيدة واعرضها كمعلومة قانونية متخصصة؛ وإن كان قصيراً فلخّص المعرفة الواردة فيه واكتبها بوضوح وإيجاز.' },
];

export function tonesFrom(settings: any): Tone[] {
  const t = settings?.ai_tones;
  return Array.isArray(t) && t.length ? t : DEFAULT_TONES;
}

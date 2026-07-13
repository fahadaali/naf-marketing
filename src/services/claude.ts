import type { Env } from '../types';

// تكامل Claude API لتوليد النص — يُستدعى من الخادم فقط (المفتاح لا يصل المتصفح).
const MODEL = 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';

export type GenerateOptions = {
  platform?: string;
  tone?: 'formal' | 'educational' | 'teaser';
  length?: 'short' | 'medium' | 'long';
  adStyle?: string;
  language?: string; // عربي افتراضياً
  topic: string;
  sourceText?: string; // للصياغة من خبر
  mode?: 'generate' | 'rewrite';
};

const TONE_AR: Record<string, string> = {
  formal: 'رسمي ومهني يليق بشركة استشارات قانونية',
  educational: 'تعليمي يشرح المفاهيم القانونية ببساطة',
  teaser: 'تشويقي جذّاب يحث على التفاعل',
};

const LENGTH_AR: Record<string, string> = {
  short: 'قصير (حتى ٥٠ كلمة)',
  medium: 'متوسط (٨٠–١٢٠ كلمة)',
  long: 'مطوّل (١٥٠–٢٥٠ كلمة)',
};

function buildPrompt(o: GenerateOptions): string {
  const lang = o.language || 'العربية';
  const tone = TONE_AR[o.tone || 'formal'];
  const length = LENGTH_AR[o.length || 'medium'];
  const platform = o.platform || 'وسائل التواصل الاجتماعي';

  if (o.mode === 'rewrite' && o.sourceText) {
    return [
      `أعد صياغة وتلخيص الخبر التالي كمنشور تسويقي لشركة «ناف» للاستشارات القانونية في الرياض.`,
      `النص المصدر:\n"""${o.sourceText}"""`,
      `المنصة المستهدفة: ${platform}. النبرة: ${tone}. الطول: ${length}. اللغة: ${lang}.`,
      o.adStyle ? `أسلوب الإعلان: ${o.adStyle}.` : '',
      `اكتب المنشور النهائي فقط دون مقدمات أو شرح.`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return [
    `اكتب منشوراً تسويقياً لشركة «ناف» للاستشارات القانونية في الرياض.`,
    `الموضوع: ${o.topic}.`,
    `المنصة المستهدفة: ${platform}. النبرة: ${tone}. الطول: ${length}. اللغة: ${lang}.`,
    o.adStyle ? `أسلوب الإعلان: ${o.adStyle}.` : '',
    `اكتب المنشور النهائي فقط دون مقدمات أو شرح، بصياغة احترافية ملائمة للقطاع القانوني.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function generateText(env: Env, options: GenerateOptions): Promise<string> {
  if (!env.CLAUDE_API_KEY) {
    // وضع بديل للتطوير عندما لا يوجد مفتاح
    return `[مسودة تجريبية — لم يُضبط مفتاح Claude]\n\nموضوع: ${options.topic || 'خبر'}\nالمنصة: ${
      options.platform || '—'
    }\n\nهذا نص تجريبي يُستبدل بمخرجات Claude عند ضبط CLAUDE_API_KEY.`;
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(options) }],
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`خطأ من Claude API: ${data?.error?.message || res.status}`);
  const text = (data.content || []).map((b: any) => b.text || '').join('').trim();
  return text || '(لم يُرجِع النموذج نصاً)';
}

// توليد محتوى من وسيط: الصور وPDF عبر رؤية Claude؛ الأنواع الأخرى (صوت/فيديو/وورد/إكسل)
// تعتمد على اسم الملف كموضوع لعدم دعم Claude لقراءة محتواها مباشرةً.
export async function generateFromMedia(
  env: Env,
  input: { base64?: string; mimeType: string; filename: string; options: GenerateOptions },
): Promise<string> {
  const { base64, mimeType, filename, options } = input;
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  // الأنواع غير المرئية: استخدم الاسم كموضوع
  if (!base64 || (!isImage && !isPdf)) {
    return generateText(env, { ...options, topic: options.topic || `محتوى مستوحى من الملف: ${filename}` });
  }

  if (!env.CLAUDE_API_KEY) {
    return `[مسودة تجريبية من وسيط — لم يُضبط مفتاح Claude]\n\nالملف: ${filename}\n\nيُستبدل هذا النص بتحليل Claude للوسيط عند ضبط المفتاح.`;
  }

  const instruction = [
    `اكتب منشوراً تسويقياً لشركة «ناف» للاستشارات القانونية في الرياض مستنداً إلى ${isPdf ? 'المستند' : 'الصورة'} المرفق.`,
    `المنصة: ${options.platform || 'وسائل التواصل'}. النبرة: ${TONE_AR[options.tone || 'formal']}. الطول: ${LENGTH_AR[options.length || 'medium']}. اللغة: العربية.`,
    `استخرج الأفكار الرئيسية من ${isPdf ? 'المستند' : 'الصورة'} وحوّلها إلى منشور احترافي. اكتب المنشور النهائي فقط.`,
  ].join('\n\n');

  const mediaBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: instruction }] }],
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`خطأ من Claude API: ${data?.error?.message || res.status}`);
  const out = (data.content || []).map((b: any) => b.text || '').join('').trim();
  return out || '(لم يُرجِع النموذج نصاً)';
}

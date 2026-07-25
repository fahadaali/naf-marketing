import type { Env } from '../types';

// تكامل Claude API لتوليد النص — يُستدعى من الخادم فقط (المفتاح لا يصل المتصفح).
const MODEL = 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';

export type GenerateOptions = {
  platform?: string;
  tone?: string; // مفتاح النبرة (قابل للتخصيص من الإعدادات)
  length?: 'short' | 'medium' | 'long';
  adStyle?: string;
  language?: string; // عربي افتراضياً
  topic: string;
  sourceText?: string; // للصياغة من خبر أو مرجع
  mode?: 'generate' | 'rewrite';
};

export type ToneDef = { key: string; label: string; prompt: string };

// النبرات الافتراضية (تُستخدم إن لم يضبط المدير نبرات مخصّصة في الإعدادات)
export const DEFAULT_TONES: ToneDef[] = [
  { key: 'formal', label: 'رسمي', prompt: 'اكتب بأسلوب رسمي خبري محايد يليق ببيان صادر عن شركة استشارات قانونية، بصياغة قريبة من الخبر أو الإعلان الرسمي، دون ترويج مباشر للخدمات.' },
  { key: 'marketing', label: 'تسويقي', prompt: 'اكتب بأسلوب تسويقي جذّاب يربط الموضوع بخدمات شركة ناف للاستشارات القانونية، ويبرز كيف تساعد ناف العميل في هذا الجانب، ويحثّ على التواصل معها.' },
  { key: 'knowledge', label: 'معرفي', prompt: 'انقل معرفة قانونية متخصصة من المصدر: إن كان المصدر طويلاً فاختر جزئية دقيقة ومفيدة واعرضها كمعلومة قانونية متخصصة؛ وإن كان قصيراً فلخّص المعرفة الواردة فيه واكتبها بوضوح وإيجاز.' },
];

const LENGTH_AR: Record<string, string> = {
  short: 'قصير (حتى ٥٠ كلمة)',
  medium: 'متوسط (٨٠–١٢٠ كلمة)',
  long: 'مطوّل (١٥٠–٢٥٠ كلمة)',
};

// توجيهات افتراضية لكل منصة (قابلة للتخصيص من الإعدادات: platform_prompts)
export const DEFAULT_PLATFORM_PROMPTS: Record<string, string> = {
  linkedin: 'محتوى مهني رصين يناسب لينكدإن والقطاع القانوني، بفقرات قصيرة ولغة موثوقة.',
  linkedin_page: 'محتوى مهني رصين لصفحة منظمة على لينكدإن، بلغة مؤسسية موثوقة وفقرات قصيرة.',
  x: 'منشور موجز جداً يناسب منصة إكس (لا يتجاوز ٢٨٠ حرفاً)، مباشر وجذّاب، ويمكن إضافة وسم واحد أو اثنين.',
  instagram: 'أسلوب جذّاب بصرياً بسطور قصيرة وإيموجي مناسب باعتدال، مع وسوم (hashtags) ملائمة في النهاية.',
  snapchat: 'رسالة قصيرة عفوية ومباشرة تناسب سناب شات.',
  tiktok: 'نص قصير حيوي يناسب تيك توك مع دعوة واضحة للتفاعل.',
  facebook: 'منشور ودّي متوسط الطول يناسب فيسبوك.',
  youtube: 'وصف مناسب ليوتيوب مع نقاط رئيسية موجزة.',
  threads: 'منشور محادثاتي قصير يناسب ثريدز.',
};

async function platformPrompt(env: Env, key?: string): Promise<string> {
  if (!key) return '';
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'platform_prompts'").first<{ value: string }>();
    const map = row?.value ? JSON.parse(row.value) : {};
    if (map && typeof map[key] === 'string') return map[key];
  } catch { /* استخدم الافتراضي */ }
  return DEFAULT_PLATFORM_PROMPTS[key] || '';
}

async function tonePrompt(env: Env, key?: string): Promise<string> {
  let tones = DEFAULT_TONES;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ai_tones'").first<{ value: string }>();
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.length) tones = parsed;
    }
  } catch { /* استخدم الافتراضي */ }
  const t = tones.find((x) => x.key === key) || tones[0];
  return t?.prompt || DEFAULT_TONES[0].prompt;
}

function buildPrompt(o: GenerateOptions, toneInstruction: string, platformInstruction = ''): string {
  const lang = o.language || 'العربية';
  const length = LENGTH_AR[o.length || 'medium'];
  const platform = o.platform || 'وسائل التواصل الاجتماعي';
  const settings = `المنصة المستهدفة: ${platform}. الطول: ${length}. اللغة: ${lang}.`;
  const platLine = platformInstruction ? `توجيه المنصة: ${platformInstruction}` : '';

  if (o.mode === 'rewrite' && o.sourceText) {
    return [
      `أنت كاتب محتوى لشركة «ناف» للاستشارات القانونية في الرياض. المطلوب إنشاء منشور من المصدر التالي.`,
      `النص المصدر:\n"""${o.sourceText}"""`,
      `توجيه النبرة: ${toneInstruction}`,
      settings,
      platLine,
      o.adStyle ? `أسلوب الإعلان: ${o.adStyle}.` : '',
      `اكتب المنشور النهائي فقط دون مقدمات أو شرح.`,
    ].filter(Boolean).join('\n\n');
  }

  return [
    `أنت كاتب محتوى لشركة «ناف» للاستشارات القانونية في الرياض.`,
    `الموضوع: ${o.topic}.`,
    `توجيه النبرة: ${toneInstruction}`,
    settings,
    platLine,
    o.adStyle ? `أسلوب الإعلان: ${o.adStyle}.` : '',
    `اكتب المنشور النهائي فقط دون مقدمات أو شرح، بصياغة احترافية ملائمة للقطاع القانوني.`,
  ].filter(Boolean).join('\n\n');
}

export async function generateText(env: Env, options: GenerateOptions): Promise<string> {
  if (!env.CLAUDE_API_KEY) {
    // وضع بديل للتطوير عندما لا يوجد مفتاح
    return `[مسودة تجريبية — لم يُضبط مفتاح Claude]\n\nموضوع: ${options.topic || 'خبر'}\nالمنصة: ${
      options.platform || '—'
    }\n\nهذا نص تجريبي يُستبدل بمخرجات Claude عند ضبط CLAUDE_API_KEY.`;
  }

  const instruction = await tonePrompt(env, options.tone);
  const platInstruction = await platformPrompt(env, options.platform);
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
      messages: [{ role: 'user', content: buildPrompt(options, instruction, platInstruction) }],
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`خطأ من Claude API: ${data?.error?.message || res.status}`);
  const text = (data.content || []).map((b: any) => b.text || '').join('').trim();
  return text || '(لم يُرجِع النموذج نصاً)';
}

// اقتراح ردود على تعليق/تقييم/رسالة — ٣ مقترحات متنوّعة وقصيرة بصيغة الجمع (نحن)
// وفق أفضل ممارسات خدمة العملاء، مع مراعاة المنشور الأساسي (إن وُجد) ونص التعليق.
export type SuggestInput = {
  commentBody: string;
  authorName?: string;
  platform?: string;
  kind?: string; // comment | review | dm | mention
  rating?: number | null; // للتقييمات
  postText?: string | null; // المنشور الأساسي إن كان الرد على منشور
};

const DEV_SUGGESTIONS = [
  'نشكرك على تواصلك معنا، وسعدنا بملاحظتك — نحن دائماً في خدمتك.',
  'نقدّر لك وقتك، ويسعدنا أن نوضّح لك أي تفصيل؛ تواصل معنا وسنكون بجانبك.',
  'شكراً لثقتك بنا، ونعمل باستمرار على تقديم الأفضل. نرحّب بأي استفسار.',
];

export async function suggestReplies(env: Env, input: SuggestInput): Promise<string[]> {
  if (!env.CLAUDE_API_KEY) return DEV_SUGGESTIONS;

  const kindAr = input.kind === 'review' ? 'تقييم' : input.kind === 'dm' ? 'رسالة خاصة' : input.kind === 'mention' ? 'إشارة' : 'تعليق';
  const lines = [
    'أنت مسؤول خدمة العملاء في شركة «ناف» للاستشارات القانونية بالرياض، وتردّ على تفاعلات العملاء على منصات التواصل.',
    input.postText ? `المنشور الأساسي الذي يعلّق عليه العميل:\n"""${String(input.postText).slice(0, 800)}"""` : '',
    `نوع التفاعل: ${kindAr}${input.platform ? ` على منصة ${input.platform}` : ''}.`,
    input.rating != null ? `تقييم العميل: ${input.rating} من ٥ نجوم.` : '',
    `${kindAr} العميل${input.authorName ? ` (${input.authorName})` : ''}:\n"""${String(input.commentBody).slice(0, 800)}"""`,
    'اكتب ٣ ردود مقترحة متنوّعة (كل واحد بأسلوب مختلف قليلاً) وفق هذه القواعد:',
    '- قصيرة جداً (جملة إلى جملتين).',
    '- بصيغة الجمع للمتكلّم (نحن، سعدنا، نشكرك، نعتذر...) نيابةً عن الشركة.',
    '- عربية فصيحة مهذّبة واحترافية تليق بقطاع قانوني.',
    '- وفق أفضل ممارسات خدمة العملاء: اشكر الإيجابي، وتعاطف واعتذر باحتراف مع السلبي واعرض المتابعة، دون وعود قانونية ملزمة.',
    '- لا تُكرّر نفس الصياغة، ولا تضع أرقاماً أو ترويسات.',
    'أعِد الناتج حصراً بصيغة JSON: مصفوفة من ٣ نصوص فقط، دون أي شرح أو أسطر إضافية.',
  ].filter(Boolean);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: lines.join('\n\n') }],
    }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`خطأ من Claude API: ${data?.error?.message || res.status}`);
  const text = (data.content || []).map((b: any) => b.text || '').join('').trim();
  return parseSuggestions(text);
}

// يستخرج ٣ مقترحات من ناتج النموذج (JSON مصفوفة، أو أسطر مرقّمة كخطة بديلة)
function parseSuggestions(text: string): string[] {
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const arr = JSON.parse(clean.slice(start, end + 1));
      if (Array.isArray(arr)) {
        const out = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
        if (out.length) return out;
      }
    }
  } catch { /* نتراجع للتقسيم بالأسطر */ }
  const byLine = clean
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)-])\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
  return byLine.slice(0, 3);
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

  const toneText = await tonePrompt(env, options.tone);
  const platText = await platformPrompt(env, options.platform);
  const instruction = [
    `أنت كاتب محتوى لشركة «ناف» للاستشارات القانونية في الرياض. أنشئ منشوراً مستنداً إلى ${isPdf ? 'المستند' : 'الصورة'} المرفق.`,
    `توجيه النبرة: ${toneText}`,
    `المنصة: ${options.platform || 'وسائل التواصل'}. الطول: ${LENGTH_AR[options.length || 'medium']}. اللغة: العربية.`,
    platText ? `توجيه المنصة: ${platText}` : '',
    `استند إلى محتوى ${isPdf ? 'المستند' : 'الصورة'} فعلاً. اكتب المنشور النهائي فقط.`,
  ].filter(Boolean).join('\n\n');

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

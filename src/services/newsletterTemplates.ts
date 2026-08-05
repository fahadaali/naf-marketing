import type { Block } from './newsletter';
import { parseBlocks } from './newsletter';
import { parseStyle, parseTheme, DEFAULT_THEME } from './blockStyle';
import type { NewsletterTheme } from './blockStyle';
import { EMAIL } from './emailTheme';

/* ============================================================
   قوالب النشرة.

   صنفان يظهران في معرضٍ واحد ولا يختلطان — كما في `naf-terms.md`:

     • **قالب جاهز** يُشحن مع المنصة، معرّفه يبدأ بـ`builtin:`، ولا
       يُحذف ولا يُعدَّل في مكانه. يعيش هنا في الشيفرة لا في قاعدة
       البيانات: قاعدةٌ فارغة في بيئةٍ جديدة تعني معرضاً فارغاً، وأولُ
       ما يحتاجه من يفتح المحرر أول مرة هو نقطةُ بداية.

     • **قالب محفوظ** يكتبه الفريق ويحذفه صاحبه، ويعيش في
       `newsletter_templates`.

   ونصوص القوالب الجاهزة محتوىً يُحرَّر لا تسميةً في واجهة: الكاتب
   يفتحها ويكتب فوقها. ولهذا هي جملٌ مكتملة تُري الشكل، لا «نصّ هنا».
   ============================================================ */

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  origin: 'builtin' | 'saved' | 'imported' | 'imported_html';
  blocks: number;
  creator_name?: string | null;
  created_at?: string | null;
};

export type TemplateBody = {
  name: string;
  description: string;
  subject: string;
  preheader: string;
  blocks: Block[];
  theme: NewsletterTheme;
};

/** صيغة ملف القالب المصدَّر — رقم النسخة أولُ ما يُقرأ عند الاستيراد. */
export const TEMPLATE_FILE_KIND = 'naf.newsletter.template';
export const TEMPLATE_FILE_VERSION = 1;

export type TemplateFile = {
  kind: typeof TEMPLATE_FILE_KIND;
  version: number;
  name: string;
  description?: string;
  subject?: string;
  preheader?: string;
  blocks: Block[];
  theme?: Partial<NewsletterTheme>;
};

/* ===== القوالب الجاهزة =====

   خمسة تغطّي ما تُرسله شركة محاماة فعلاً: نشرةٌ دورية، وإعلان، وملخّص
   حكمٍ أو نظام، ودعوةُ فعالية، ومقالةٌ مطوّلة. ولا سادسٌ لمجرّد العدد —
   قالبٌ لا يوفّر خطوةً حقيقية يزيد الاختيار ولا يختصر العمل. */
const BUILTIN: (TemplateBody & { id: string; description: string })[] = [
  {
    id: 'builtin:issue',
    name: 'نشرة دورية',
    description: 'عددٌ شهريّ: افتتاحية، ثم موضوعان، ثم دعوة للتواصل.',
    subject: 'نشرة ناف القانونية — العدد الجديد',
    preheader: 'أبرز ما يهمّ منشأتك هذا الشهر',
    theme: { ...DEFAULT_THEME },
    blocks: [
      { type: 'heading', text: 'في هذا العدد', level: 2 },
      { type: 'text', text: 'نعرض في هذا العدد مستجدّين نظاميّين يمسّان العقود التجارية، وما تحتاج المنشأة لفعله قبل نهاية الربع.' },
      { type: 'divider' },
      { type: 'heading', text: 'الموضوع الأول', level: 3 },
      { type: 'text', text: 'اكتب هنا خلاصة الموضوع في فقرةٍ أو فقرتين، وأنهِها بما على القارئ فعله.' },
      { type: 'heading', text: 'الموضوع الثاني', level: 3 },
      { type: 'text', text: 'اكتب هنا الموضوع الثاني. وللإحالة إلى مصدرٍ نظامي استعمل حاشية.' },
      { type: 'divider' },
      { type: 'text', text: 'لأي استفسارٍ عن أثر هذه المستجدّات على عقودك، فريقنا جاهز.' },
      { type: 'button', text: 'حجز استشارة', url: 'https://naf.sa' },
    ],
  },
  {
    id: 'builtin:announcement',
    name: 'إعلان',
    description: 'خبرٌ واحد بارز: بطاقة تمييز، ثم التفاصيل، ثم زر.',
    subject: 'إعلان من ناف القانونية',
    preheader: 'خبرٌ يهمّك',
    theme: { ...DEFAULT_THEME, width: 'narrow' },
    blocks: [
      { type: 'callout', text: 'اكتب هنا الجملة التي تختصر الخبر كلَّه. سطرٌ واحد يكفي.', tone: 'primary' },
      { type: 'heading', text: 'عنوان الإعلان', level: 2 },
      { type: 'text', text: 'اشرح هنا الخبر: ما الذي تغيّر، ومتى يبدأ، ومن يعنيه.' },
      { type: 'button', text: 'التفاصيل', url: 'https://naf.sa', style: parseStyle({ full: true }) },
    ],
  },
  {
    id: 'builtin:legal-brief',
    name: 'ملخص قانوني',
    description: 'ملخّص حكمٍ أو نظام: النصّ، ثم مقارنة، ثم الحواشي.',
    subject: 'ملخص قانوني — ناف',
    preheader: 'خلاصة ما صدر وما يترتّب عليه',
    theme: { ...DEFAULT_THEME },
    blocks: [
      { type: 'heading', text: 'موضوع الملخص', level: 2 },
      { type: 'text', text: 'اذكر هنا ما صدر، وتاريخ نفاذه، والجهة التي أصدرته.' },
      { type: 'quote', text: 'اقتبس هنا نصّ المادة أو مبدأ الحكم كما ورد حرفياً.', cite: 'المصدر' },
      { type: 'footnote', text: 'اكتب هنا الإحالة الكاملة: رقم النظام أو القضية وتاريخه.' },
      { type: 'heading', text: 'ما الذي تغيّر', level: 3 },
      {
        type: 'table',
        header: true,
        rows: [['الموضع', 'قبل', 'بعد'], ['', '', ''], ['', '', '']],
        style: parseStyle({ background: EMAIL.muted }),
      },
      { type: 'text', text: 'اختم بما على المنشأة فعله، ومهلة فعله إن وُجدت.' },
      { type: 'callout', text: 'اكتب هنا الأثر الذي يستوجب انتباهاً عاجلاً، أو احذف هذه البطاقة.', tone: 'warning' },
    ],
  },
  {
    id: 'builtin:event',
    name: 'دعوة فعالية',
    description: 'دعوة بموعدٍ ومكان: التفاصيل في جدول، ثم زر تسجيل.',
    subject: 'دعوة — ورشة ناف القانونية',
    preheader: 'الموعد والمكان ورابط التسجيل',
    theme: { ...DEFAULT_THEME },
    blocks: [
      { type: 'heading', text: 'عنوان الفعالية', level: 2, style: parseStyle({ align: 'center' }) },
      { type: 'text', text: 'اكتب هنا وصفاً قصيراً: لمن هذه الورشة، وماذا يخرج به الحاضر منها.', style: parseStyle({ align: 'center' }) },
      {
        type: 'table',
        header: false,
        rows: [['الموعد', ''], ['المكان', ''], ['المدة', '']],
      },
      { type: 'button', text: 'تسجيل الحضور', url: 'https://naf.sa', style: parseStyle({ align: 'center' }) },
      { type: 'text', text: 'المقاعد محدودة، ويُغلق التسجيل قبل الموعد بيومين.', style: parseStyle({ align: 'center', size: 'sm', color: EMAIL.mutedForeground }) },
    ],
  },
  {
    id: 'builtin:article',
    name: 'مقالة مطوّلة',
    description: 'مقالٌ بفهرسٍ وعناوين وصورة وحواشي — للنشر على الموقع أيضاً.',
    subject: 'مقالة جديدة من ناف',
    preheader: 'اقرأ المقالة كاملة',
    theme: { ...DEFAULT_THEME, width: 'wide' },
    blocks: [
      { type: 'toc' },
      { type: 'heading', text: 'المقدّمة', level: 2 },
      { type: 'text', text: 'ابدأ بالمسألة التي يواجهها القارئ، لا بتعريفٍ نظريّ. الفقرة الأولى تقرّر إن كان سيُكمل.' },
      { type: 'image', url: '', alt: '' },
      { type: 'heading', text: 'المحور الأول', level: 2 },
      { type: 'text', text: 'اكتب هنا المحور الأول. وللإحالة إلى مادةٍ نظامية استعمل حاشية بدل إقحام الرقم في الجملة.' },
      { type: 'footnote', text: 'اكتب هنا نصّ الحاشية ومرجعها.' },
      { type: 'heading', text: 'المحور الثاني', level: 2 },
      { type: 'text', text: 'اكتب هنا المحور الثاني.' },
      { type: 'heading', text: 'الخلاصة', level: 2 },
      { type: 'text', text: 'اجمع ما سبق في ثلاث جملٍ يقرؤها المستعجل وحدها.' },
      { type: 'button', text: 'حجز استشارة', url: 'https://naf.sa' },
    ],
  },
];

export function builtinSummaries(): TemplateSummary[] {
  return BUILTIN.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    origin: 'builtin' as const,
    blocks: t.blocks.length,
  }));
}

export function builtinById(id: string): TemplateBody | null {
  const t = BUILTIN.find((x) => x.id === id);
  return t ? { ...t, blocks: JSON.parse(JSON.stringify(t.blocks)) } : null;
}

export function isBuiltinId(id: string): boolean {
  return id.startsWith('builtin:');
}

/* ===== ملف القالب =====

   يُقرأ بنفس المحقّقات التي تقرأ ما يكتبه الكاتب: `parseBlocks` للكتل
   و`parseTheme` للسمة و`parseStyle` لكل تخصيص. فملفٌّ حُرّر بيدٍ خارجية
   لا يُدخل قيمةً لم تُفحص، ولو حمل حقلاً لا نعرفه سقط بلا ضجّة. */
export function readTemplateFile(raw: string): { ok: true; file: TemplateFile } | { ok: false; error: string } {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'الملف ليس قالب نشرة. اختر ملف قالب ناف بصيغة JSON أو ملف HTML.' };
  }
  if (!data || typeof data !== 'object' || data.kind !== TEMPLATE_FILE_KIND) {
    return { ok: false, error: 'الملف ليس قالب نشرة. اختر ملف قالب ناف بصيغة JSON أو ملف HTML.' };
  }
  const blocks = sanitizeBlocks(Array.isArray(data.blocks) ? data.blocks : []);
  if (!blocks.length) return { ok: false, error: 'القالب فارغ. أضف كتلاً ثم احفظه.' };
  return {
    ok: true,
    file: {
      kind: TEMPLATE_FILE_KIND,
      version: Number(data.version) || TEMPLATE_FILE_VERSION,
      name: String(data.name || '').slice(0, 120),
      description: String(data.description || '').slice(0, 300),
      subject: String(data.subject || '').slice(0, 200),
      preheader: String(data.preheader || '').slice(0, 200),
      blocks,
      theme: parseTheme(JSON.stringify(data.theme || {})),
    },
  };
}

/** أنواع الكتل المعروفة — ما عداها يسقط بدل أن يصل المصيّر. */
const KNOWN = new Set(['heading', 'text', 'image', 'button', 'quote', 'divider', 'callout',
  'table', 'code', 'footnote', 'toc', 'audio', 'file', 'video', 'embed', 'columns', 'checklist']);

/** يمرّ على كتلٍ واردة فيُسقط المجهول ويُنظّف تخصيص كلّ باقية. */
export function sanitizeBlocks(input: unknown): Block[] {
  const arr = Array.isArray(input) ? input : parseBlocks(String(input || ''));
  const out: Block[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const b = { ...(raw as any) };
    if (!KNOWN.has(b.type)) continue;
    const style = parseStyle(b.style);
    if (style) b.style = style; else delete b.style;
    /* الوسيط المرفوع لا يُنقل مع القالب: معرّفه يشير إلى صفٍّ في
       `media_assets` قد لا يوجد في المستودع الذي استُورد إليه، فتصل
       الرسالة بصورةٍ مكسورة. الرابط الخارجي يبقى لأنه مطلق. */
    if (b.mediaId) delete b.mediaId;
    out.push(b as Block);
  }
  return out;
}

/** يبني ملف القالب المصدَّر من نشرةٍ أو قالبٍ محفوظ. */
export function buildTemplateFile(o: {
  name: string; description?: string; subject?: string; preheader?: string;
  blocksJson: string; themeJson?: string | null;
}): TemplateFile {
  return {
    kind: TEMPLATE_FILE_KIND,
    version: TEMPLATE_FILE_VERSION,
    name: o.name,
    description: o.description || '',
    subject: o.subject || '',
    preheader: o.preheader || '',
    blocks: sanitizeBlocks(parseBlocks(o.blocksJson)),
    theme: parseTheme(o.themeJson),
  };
}

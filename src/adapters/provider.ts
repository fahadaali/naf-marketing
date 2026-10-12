// طبقة النشر المجرّدة — واجهة محايدة للمزوّد.
// أي مزوّد (Zernio / Late / Ayrshare ...) ينفّذ هذه الواجهة، ويبقى بقية الكود محايداً.

// وسيط مرفق بالنشر — نُمرّر البايتات لأن مسار /api/media محمي بالمصادقة،
// فلا يستطيع المزوّد جلبه برابط. المزوّدون الذين يقبلون روابط عامة يستخدمون url.
export interface PublishMedia {
  data?: ArrayBuffer;
  /**
   * يفتح الملف تدفّقاً من التخزين — بلا تحميله كلّه في الذاكرة. ذاكرة العامل
   * ١٢٨ ميغابايت، والوسيط يبلغ ١٠٠ (`MAX_MEDIA_BYTES`)، فمقطعٌ كبير يُقرأ
   * كاملاً ثم يُنسخ في جسم الطلب يُسقط العامل. ويُستدعى لكل محاولة رفع:
   * التدفّق يُقرأ مرّةً واحدة.
   */
  open?: () => Promise<ReadableStream<Uint8Array> | null>;
  /** حجم الملف بالبايت — يلزم مع `open` لطولِ جسم الطلب. */
  size?: number;
  mimeType: string;
  filename: string;
  url?: string; // رابط عام إن توفّر (لمزوّدين يقبلون الروابط مثل Buffer)
  /** أبعاد الوسيط ومدّة المقطع كما حُفظت عند الرفع — الغائب لا يُعرف. */
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
}

export interface PublishInput {
  platforms: string[];
  text: string;
  /** عنوان المحتوى — يوتيوب يشترطه للمقطع، ومنشورات المنصات الأخرى بلا عنوان. */
  title?: string;
  media?: PublishMedia[];
  firstComment?: string; // أول تعليق يُنشر بعد المنشور (روابط/وسوم)
  scheduleAt?: string; // ISO 8601, UTC
  /** غلاف المقطع — مكيّفاً إلى أبعاده — للمنصات التي تقبله. */
  cover?: PublishMedia;
  /**
   * مفتاحُ محاولة النشر لدى المزوّد — طلبٌ ثانٍ بالمفتاح نفسه يُرفض ولا يُنشر.
   * يبقى للموعد ما دامت نتيجة محاولته لا تُعرف (`PublishUncertain`)، ويُجدَّد
   * بعد كل نتيجةٍ معروفة. ومن لا يقبله من المزوّدين يتجاهله.
   */
  idempotencyKey?: string;
}

/**
 * نشرٌ لا تُعرف نتيجته: انقطع الاتصال أو انتهت المهلة قبل ردّ المزوّد، فقد
 * يكون المنشور وصله. فيبقى للموعد مفتاحُ محاولته — وإعادةُ النشر بالمفتاح
 * نفسه يرفضها المزوّد إن كان المنشور وصله، فلا يُنشر مرّتين.
 */
export class PublishUncertain extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishUncertain';
  }
}

/**
 * حالُ المنشور لدى المزوّد: نُشر، أو قُبل ولم يُنشر بعد، أو رُفض.
 *
 * والقبول ليس نشراً: SocialAPI يردّ على طلب النشر فوراً بأنه استلمه، ثم
 * يرفعه إلى المنصة وحده، وقد ترفضه المنصة بعد ذلك. وكان الاستلام يُكتب
 * «منشور» فلا يظهر الرفض في أي موضع.
 */
export type PublishState = 'published' | 'pending' | 'failed';

export interface PublishResult {
  providerPostId: string;
  status: string;
  /** غيابه = «منشور» — سلوك المزوّدين الذين لا يُعلنون غيره. */
  state?: PublishState;
  /** منشوراتٌ أخرى للموعد نفسه (سناب: سبوتلايت وقصة محفوظة وقصة). */
  extraIds?: string[];
  /** ما فشل منها والموعد منشورٌ بغيره — يُكتب تحت الموعد. */
  note?: string;
}

/** ما يُعرف عن موعدٍ ينتظر التأكيد — به يُسأل سجلّ المنصة حين يطول انتظاره. */
export interface PublishStatusContext {
  platform: string;
  /** وقت الإرسال إلى المزوّد (ISO). */
  sentAt: string | null;
  /** نصّ المنشور كما أُرسل. */
  text: string;
}

export interface PublishCheck {
  state: PublishState;
  error?: string;
}

export interface AnalyticsResult {
  reach: number;
  impressions: number;
  engagement: number;
}

export type InboxKind = 'comment' | 'dm' | 'mention' | 'review';
export type ModerateAction = 'hide' | 'unhide' | 'delete' | 'like';

export interface CommentItem {
  id: string;
  kind: InboxKind;
  authorName: string;
  body: string;
  createdAt: string;
  capabilities?: Record<string, boolean>;
  isHidden?: boolean;
  repliedBody?: string | null; // نص الرد الموجود مسبقاً على المنصة (للتقييمات)
}

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
  getAnalytics(providerPostId: string): Promise<AnalyticsResult>;
  /** تنظيفٌ لا يُعطّل: يبتلع خطأه. وللحذف الذي يراه الفريق `deleteFromPlatform`. */
  deletePost(providerPostId: string): Promise<void>;
  /**
   * يحذف منشوراً نُشر من منصته نفسها — ويرمي بسببٍ يُقرأ إن تعذّر. اختيارية:
   * من لا يُعلنها يُقال عنه إن مزوّد النشر لا يحذف. و`extraIds` منشوراتٌ أخرى
   * للموعد نفسه (سناب). والمنصة التي لا تحذف عبر الواجهة (إنستغرام وتيك توك)
   * يُحذف منشورها من تطبيقها، ثم يُسجَّل هنا محذوفاً بعد أن يتحقّق المزوّد.
   */
  deleteFromPlatform?(providerPostId: string, opts: { platform: string; extraIds?: string[] }): Promise<void>;
  /**
   * حالُ منشورٍ قبله المزوّد ولم يؤكّد نشره — اختيارية. `null` = المزوّد لا
   * يُعلن حالاً يُقرأ، فيُعدّ منشوراً كما كان قبلها.
   */
  getPublishStatus?(providerPostId: string, ctx?: PublishStatusContext): Promise<PublishCheck | null>;
  /**
   * فحصٌ مسبق بلا نشر: ما سترفضه المنصة من هذا المحتوى — بنصٍّ يُعرض كما هو.
   * اختيارية؛ ومن لا يُعلن حدود منصاته يردّ قائمةً فارغة.
   */
  preflight?(input: PublishInput): Promise<string[]>;
  // إدارة التعليقات/الرسائل — اختيارية؛ المزوّدون غير الداعمين يتجاوزونها بأمان.
  // يعيد replyComment معرّف الرد على المنصة (إن توفّر) لتمكين تعديله/حذفه لاحقاً.
  getComments?(providerPostId: string): Promise<CommentItem[]>;
  replyComment?(providerPostId: string, commentId: string, text: string): Promise<string | void>;
  // إشراف على التعليقات ورد خاص — اختيارية
  moderateComment?(commentId: string, action: ModerateAction): Promise<void>;
  privateReply?(commentId: string, text: string): Promise<void>;
  // تعديل/حذف ردّي على المنصة — اختيارية (يمرَّر معرّف الرد الملتقَط سابقاً)
  editReply?(commentId: string, replyProviderId: string | null, text: string): Promise<string | void>;
  deleteReply?(commentId: string, replyProviderId: string | null): Promise<void>;
}

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
}

export interface PublishInput {
  platforms: string[];
  text: string;
  /** عنوان المحتوى — يوتيوب يشترطه للمقطع، ومنشورات المنصات الأخرى بلا عنوان. */
  title?: string;
  media?: PublishMedia[];
  firstComment?: string; // أول تعليق يُنشر بعد المنشور (روابط/وسوم)
  scheduleAt?: string; // ISO 8601, UTC
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
  deletePost(providerPostId: string): Promise<void>;
  /**
   * حالُ منشورٍ قبله المزوّد ولم يؤكّد نشره — اختيارية. `null` = المزوّد لا
   * يُعلن حالاً يُقرأ، فيُعدّ منشوراً كما كان قبلها.
   */
  getPublishStatus?(providerPostId: string): Promise<PublishCheck | null>;
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

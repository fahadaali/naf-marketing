export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /* تصيير المتصفح — لتوليد PDF. اختياريّ بحقّ: الربط يحتاج خطة
     Workers مدفوعة، والمنصة تعمل بدونه وتعرض «نسخة للطباعة» بدلاً
     منه. الشيفرة تفحصه ولا تفترضه. */
  BROWSER?: Fetcher;
  // الدخول الموحّد (naf-auth): جلسات وكاش مفاتيح وحالة عابرة
  AUTH_KV?: KVNamespace;
  // vars
  APP_TIMEZONE: string;
  APP_NAME: string;
  PLATFORM_ID?: string;
  AUTH_ISSUER?: string;
  // secrets
  CLAUDE_API_KEY?: string;
  PROVIDER_API_KEY?: string; // مفتاح عام (تراجعي) — يُستخدم إن لم يوجد سرّ خاص بالمزوّد
  PROVIDER_NAME?: string;
  // أسرار خاصة لكل مزوّد (تتيح تخزين أكثر من مفتاح والتبديل بينها):
  BUFFER_API_KEY?: string;
  SOCIALAPI_API_KEY?: string;
  AYRSHARE_API_KEY?: string;
  AUTH_SECRET?: string;
  AUTH_CLIENT_SECRET?: string;
  // basecamp (مركز المعرفة)
  BASECAMP_CLIENT_ID?: string;
  BASECAMP_CLIENT_SECRET?: string;
  BASECAMP_REFRESH_TOKEN?: string;
  // توليد الوسائط بالذكاء الاصطناعي
  IMAGE_PROVIDER_API_KEY?: string;
  VIDEO_PROVIDER_API_KEY?: string;
  // إشعارات بريدية
  EMAIL_PROVIDER_API_KEY?: string;
  /* ═══ مصادر المؤشرات الخارجية ═══
     كلها اختيارية: مصدرٌ بلا مفتاح يبقى «غير مربوط» في شاشة التكاملات،
     ولا يُسحب منه شيء، ولا تسقط المنصة لغيابه. */
  // منصة إدارة الشركة (`naf-manger`) — مفتاح خدمة للقراءة
  CRM_API_KEY?: string;
  /* حساب خدمة جوجل — ملفّ JSON كاملاً في سرٍّ واحد. ثلاثة مصادر تقرأ منه:
     تحليلات الموقع، وأدوات مشرفي المواقع، والملف التجاري. وتفريقُه ثلاثة
     أسرارٍ يعني ثلاث نسخٍ من المفتاح نفسه تنتهي صلاحيتها في ثلاثة أوقات. */
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  /* مفتاح واجهة جوجل العام — لتقرير تجربة كروم وحده (مؤشرات تجربة الصفحة).
     وهو مفتاحُ واجهةٍ لا حسابَ خدمة: التقرير بياناتٌ عامة لا تُملك، فلا
     صلاحية تُمنح عليه ولا حساب يُضاف قارئاً. */
  GOOGLE_API_KEY?: string;
  // منصات الإعلان وقنوات المراسلة وتتبّع المكالمات ورصد الذكر
  ADS_API_KEY?: string;
  MESSAGING_API_KEY?: string;
  CALL_TRACKING_API_KEY?: string;
  LISTENING_API_KEY?: string;
};

export type Role = 'writer' | 'marketing_manager' | 'general_manager';

export type User = {
  id: string;
  name: string;
  email: string;
  role_name: Role;
  is_active: number;
  created_at: string;
};

export type Variables = {
  user: User;
  /**
   * المعرّف المركزي (`sub`) كما تحقّق منه حارس الدخول الموحّد في هذا الطلب.
   * اختياري لأن المسارات العامة لا تمرّ بالحارس أصلاً.
   */
  sub?: string;
};

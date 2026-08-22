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

  /* ═══ الموقع الرئيسي (naf-home) ═══
     رمزٌ واحد للاتجاهين: تحمله نقاط `/api/site` هنا، ويحمله الموقع في
     `NEWSLETTER_API_TOKEN` عنده. وسرُّ الخطاف مستقلٌّ عنه لأنه يحمي
     اتجاهاً معاكساً — لو اتّحدا لفتح تسريبُ أحدهما البابين. */
  SITE_API_TOKEN?: string;
  SITE_WEBHOOK_URL?: string;
  SITE_WEBHOOK_SECRET?: string;
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

/* ═══ الحملة ═══
   حالاتها الأربع هي قيد CHECK في 0001_init.sql، ومصطلحاتها وأيقوناتها
   مسجّلة في naf-terms.md §٣ «حالات الحملة» وnaf-icons.md. */
export type CampaignStatus = 'planned' | 'active' | 'completed' | 'archived';

export type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  start_date: string | null;
  end_date: string | null;
  /** JSON: ["linkedin","x",...] — يُقرأ بحارس، لا بـ JSON.parse مباشرة. */
  target_platforms: string | null;
  status: CampaignStatus;
  created_at: string;
  updated_at: string | null;
  owner_id: string | null;
  /** الميزانية المخطّطة بالريال — لا المنفَق. */
  budget: number | null;
  target_impressions: number | null;
  target_engagement: number | null;
  target_leads: number | null;
};

/**
 * انتقالات حالة الحملة المسموحة. الخادم هو الحكم، ويُرجعها للواجهة في
 * `GET /campaigns/:id` كي لا يوجد جدولان يفترقان — وهو بعينه ما جعل
 * لوحة كانبان القديمة تُسقط ثلاث حالاتٍ صامتةً.
 *
 * والأرشفة متاحةٌ من كل حالة، والاستعادة تُعيد إلى «مكتملة» لا إلى
 * «نشطة»: حملةٌ أُرشفت ثم عادت لا تستأنف نشاطها من تلقاء نفسها.
 */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  planned: ['active', 'archived'],
  active: ['completed', 'archived'],
  completed: ['archived'],
  archived: ['completed'],
};

export type Variables = {
  user: User;
  /**
   * المعرّف المركزي (`sub`) كما تحقّق منه حارس الدخول الموحّد في هذا الطلب.
   * اختياري لأن المسارات العامة لا تمرّ بالحارس أصلاً.
   */
  sub?: string;
};

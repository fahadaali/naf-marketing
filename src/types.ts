export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  // vars
  APP_TIMEZONE: string;
  APP_NAME: string;
  // secrets
  CLAUDE_API_KEY?: string;
  PROVIDER_API_KEY?: string; // مفتاح عام (تراجعي) — يُستخدم إن لم يوجد سرّ خاص بالمزوّد
  PROVIDER_NAME?: string;
  // أسرار خاصة لكل مزوّد (تتيح تخزين أكثر من مفتاح والتبديل بينها):
  BUFFER_API_KEY?: string;
  SOCIALAPI_API_KEY?: string;
  AYRSHARE_API_KEY?: string;
  AUTH_SECRET?: string;
  // basecamp (مركز المعرفة)
  BASECAMP_CLIENT_ID?: string;
  BASECAMP_CLIENT_SECRET?: string;
  BASECAMP_REFRESH_TOKEN?: string;
  // توليد الوسائط بالذكاء الاصطناعي
  IMAGE_PROVIDER_API_KEY?: string;
  VIDEO_PROVIDER_API_KEY?: string;
  // إشعارات بريدية
  EMAIL_PROVIDER_API_KEY?: string;
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
};

import type { ThreadEntry } from '../services/inboxThread';
import type { mapMetrics } from './metrics';

/** عنصر صندوق وارد موحّد (تعليق/رسالة/إشارة/مراجعة) مع منصّته */
export type InboxItem = {
  id: string;
  platform: string;
  kind: 'comment' | 'dm' | 'mention' | 'review';
  authorName: string;
  body: string;
  createdAt: string;
  capabilities?: Record<string, boolean>;
  isHidden?: boolean;
  repliedBody?: string | null; // ردٌّ موجود على المنصة كُتب من خارج هذه المنصة
  repliedAt?: string | null; // ووقته إن أعلنه المزوّد
  rating?: number | null; // تقييم بالنجوم (١..٥) للمراجعات
  /** معرّف المزوّد `sapi_cmt_…` — يُحفظ كي تُفحص ردود التعليق القديم بالمسار الآخر أيضاً. */
  interactionId?: string | null;
  /** السلسلة تحت التعليق كلُّها — من Ayrshare. غيابُها: لا سلسلة تُكتب ولا تُمسّ. */
  thread?: ThreadEntry[];
};

/** منشورٌ من سجلّ الحساب على منصّته — ومنه ما نُشر من خارج المنصة. */
export type AccountPost = {
  id: string;
  platform: string;
  accountId: string;
  title: string;
  sentAt: string | null;
  externalUrl: string | null;
  metrics: ReturnType<typeof mapMetrics>;
};

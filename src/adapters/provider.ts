// طبقة النشر المجرّدة — واجهة محايدة للمزوّد.
// أي مزوّد (Zernio / Late / Ayrshare ...) ينفّذ هذه الواجهة، ويبقى بقية الكود محايداً.

export interface PublishInput {
  platforms: string[];
  text: string;
  mediaUrls?: string[];
  scheduleAt?: string; // ISO 8601, UTC
}

export interface PublishResult {
  providerPostId: string;
  status: string;
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
  // إدارة التعليقات/الرسائل — اختيارية؛ المزوّدون غير الداعمين يتجاوزونها بأمان
  getComments?(providerPostId: string): Promise<CommentItem[]>;
  replyComment?(providerPostId: string, commentId: string, text: string): Promise<void>;
  // إشراف على التعليقات ورد خاص — اختيارية
  moderateComment?(commentId: string, action: ModerateAction): Promise<void>;
  privateReply?(commentId: string, text: string): Promise<void>;
}

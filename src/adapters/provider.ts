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

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
  getAnalytics(providerPostId: string): Promise<AnalyticsResult>;
  deletePost(providerPostId: string): Promise<void>;
}

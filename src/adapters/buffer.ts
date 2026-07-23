import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult, CommentItem } from './provider';

// مزوّد Buffer — ينفّذ الواجهة المحايدة عبر واجهة Buffer API v1.
// ملاحظتان:
//  - Buffer ينشر إلى «حسابات» (profiles) لها معرّفات، لا إلى أسماء منصات؛ لذا نمرّر خريطة
//    (منصة → معرّف حساب Buffer) تُضبط من الإعدادات (buffer_profiles).
//  - الرد المباشر على التعليقات غير متاح في واجهة Buffer العامة (يتم من لوحة Buffer)، لذا
//    لا نُنفّذ replyComment — تعرض المنصة التعليقات فقط وتُبلّغ بعدم دعم الرد المباشر.
const BUFFER_BASE = 'https://api.bufferapp.com/1';

function toIso(v: unknown): string {
  if (v == null) return new Date().toISOString();
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 && n < 1e11 ? new Date(n * 1000) : new Date(v as string);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export class BufferProvider implements PublishingProvider {
  constructor(private accessToken: string, private profiles: Record<string, string>) {}

  private url(path: string): string {
    const sep = path.includes('?') ? '&' : '?';
    return `${BUFFER_BASE}${path}${sep}access_token=${encodeURIComponent(this.accessToken)}`;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const profileIds = input.platforms.map((p) => this.profiles[p]).filter(Boolean);
    if (!profileIds.length) {
      throw new Error(`لا يوجد حساب Buffer مربوط للمنصات: ${input.platforms.join('، ')} — اربطها من الإعدادات ← المنصات والمزوّد`);
    }
    const form = new URLSearchParams();
    form.set('text', input.text);
    for (const id of profileIds) form.append('profile_ids[]', id);
    if (input.scheduleAt) form.set('scheduled_at', input.scheduleAt);
    else form.set('now', 'true');
    if (input.mediaUrls?.length) {
      form.set('media[photo]', input.mediaUrls[0]);
      form.set('media[thumbnail]', input.mediaUrls[0]);
    }

    const res = await fetch(this.url('/updates/create.json'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = (await res.json()) as any;
    if (!res.ok || data?.success === false) {
      throw new Error(`فشل النشر عبر Buffer: ${data?.message || data?.error || res.status}`);
    }
    const update = (data.updates || [])[0] || {};
    return {
      providerPostId: String(update.id || ''),
      status: input.scheduleAt ? 'scheduled' : String(update.status || 'published'),
    };
  }

  async getAnalytics(providerPostId: string): Promise<AnalyticsResult> {
    const res = await fetch(this.url(`/updates/${providerPostId}.json`));
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`فشل سحب تحليلات Buffer: ${data?.message || res.status}`);
    const s = data?.statistics || {};
    const reach = Number(s.reach || 0);
    const impressions = Number(s.impressions || s.reach || 0);
    const engagement =
      Number(s.likes || 0) +
      Number(s.favorites || 0) +
      Number(s.comments || 0) +
      Number(s.shares || 0) +
      Number(s.retweets || 0) +
      Number(s.mentions || 0);
    return { reach, impressions, engagement };
  }

  async deletePost(providerPostId: string): Promise<void> {
    await fetch(this.url(`/updates/${providerPostId}/destroy.json`), { method: 'POST' });
  }

  // تعليقات/تفاعلات المنشور من Buffer (event=comment)
  async getComments(providerPostId: string): Promise<CommentItem[]> {
    const res = await fetch(this.url(`/updates/${providerPostId}/interactions.json&event=comment`));
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`فشل جلب تعليقات Buffer: ${data?.message || res.status}`);
    const list: any[] = data?.interactions || data?.comments || [];
    return list.map((it) => ({
      id: String(it.id || it.interaction_id || it.comment_id),
      kind: 'comment' as const,
      authorName: it.author?.name || it.name || it.username || it.from || 'مستخدم',
      body: it.text || it.comment || it.body || it.message || '',
      createdAt: toIso(it.created_at || it.created),
    }));
  }
}

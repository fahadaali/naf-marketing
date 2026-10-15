/* ═══ منصات المنشور ومواعيده ═══

   رقائق «منصات التواصل» تقول ما على كل منصة وتتحكّم به: إلغاء التحديد ثم
   الحفظ يلغي الجدولة عليها، وتحديدُ منصةٍ بلا موعد ثم الحفظ يفتح «جدولة النشر».
   والمنشورة أو التي تُنشر الآن مقفلة: لا يُلغى ما وقع.

   منطقٌ بلا واجهة، يشترك فيه المحرر ونافذة «منصات المنشور». */

export type ScheduleRow = { platform: string; status: string; scheduled_at: string; deleted_at?: string | null };

/** حال المنصة: ما نُشر، وما يُنشر الآن، وما فشل، وما ينتظر (وقد فات موعده)، أو بلا موعد. */
export type PlatformState = 'published' | 'processing' | 'failed' | 'late' | 'pending' | 'none';

const RANK: Record<string, number> = { processing: 4, failed: 3, pending: 2, published: 1 };

export function platformStates(schedules: ScheduleRow[], now = Date.now()): Record<string, PlatformState> {
  const out: Record<string, PlatformState> = {};
  const best: Record<string, ScheduleRow> = {};
  for (const s of schedules) {
    // ما حُذف من منصته لم يعد عليها — يُجدوَل من جديد كمنصةٍ بلا موعد
    if (s.deleted_at || !RANK[s.status]) continue;
    if (!best[s.platform] || RANK[s.status] > RANK[best[s.platform].status]) best[s.platform] = s;
  }
  for (const [p, s] of Object.entries(best)) {
    out[p] = s.status === 'pending' && new Date(s.scheduled_at).getTime() < now ? 'late' : (s.status as PlatformState);
  }
  return out;
}

/** ما لا يُلغى: نُشر، أو يُنشر الآن. */
export function lockedState(state: PlatformState | undefined): boolean {
  return state === 'published' || state === 'processing';
}

/** ما له موعدٌ يُلغى. */
export function cancellable(state: PlatformState | undefined): boolean {
  return state === 'pending' || state === 'late' || state === 'failed';
}

/**
 * ما يعنيه الحفظ: منصاتٌ أُلغي تحديدها ولها موعدٌ يُلغى، ومنصاتٌ حُدّدت الآن
 * ولا موعد لها فتُجدوَل.
 */
export function platformChanges(
  states: Record<string, PlatformState>,
  before: string[],
  after: string[],
): { cancel: string[]; schedule: string[] } {
  return {
    cancel: Object.keys(states).filter((p) => cancellable(states[p]) && !after.includes(p)),
    schedule: after.filter((p) => !before.includes(p) && !states[p]),
  };
}

/** الحالات التي تتحكّم فيها الرقائق بالمواعيد — قبلها لا موعد، والرقائق خطةٌ فقط. */
export const SCHEDULING_STATUSES = ['approved', 'scheduled', 'published'];

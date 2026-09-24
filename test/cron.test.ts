// جدول المهام: لكل مهمةٍ ثقيلة دقيقتُها، ولا يجري معها ما يستهلك حصّتها.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` يُرفع فوق كل شيء — فما يستعمله يُرفع معه
const { called, track } = vi.hoisted(() => {
  const called: string[] = [];
  const track = (name: string) => vi.fn(async () => { called.push(name); });
  return { called, track };
});

vi.mock('../src/services/rss', () => ({ refreshAllFeeds: track('feeds') }));
vi.mock('../src/services/analytics', () => ({ pullAnalytics: track('analytics') }));
vi.mock('../src/services/report', () => ({ uploadWeeklyReport: track('weekly'), uploadMonthlyReport: track('monthly') }));
vi.mock('../src/services/commentsSync', () => ({ syncComments: track('inbox') }));
vi.mock('../src/services/alerts', () => ({ checkStaleContent: track('stale') }));
vi.mock('../src/services/basecampSync', () => ({ syncCardCommentsSafe: track('basecamp') }));
vi.mock('../src/services/publish', () => ({ runDuePublishes: track('publish') }));
vi.mock('../src/services/newsletterSend', () => ({
  queueDueNewsletters: track('queue'), sendQueuedBatch: track('newsletter'), syncNewsletterAnalytics: track('nl-analytics'),
}));
vi.mock('../src/services/metricSync', () => ({ syncAllSources: vi.fn(async () => { called.push('sources'); return []; }) }));
vi.mock('../src/services/crmSync', () => ({ syncCrm: track('crm') }));
vi.mock('../src/services/metrics', () => ({ computeAuto: track('compute') }));
vi.mock('../src/services/metricsHistory', () => ({ recomputePastPeriods: track('past-periods') }));

import { handleScheduled, jobAt } from '../src/cron';

const tick = (iso: string) => handleScheduled({ scheduledTime: Date.parse(iso) } as ScheduledController, {} as any);

beforeEach(() => {
  called.length = 0;
});

describe('جدول المهام', () => {
  it('يسمّي لكل دقيقةٍ مهمتها', () => {
    expect(jobAt(new Date('2026-09-24T10:00:00Z')).job).toBe('feeds');
    expect(jobAt(new Date('2026-09-24T10:02:00Z')).job).toBe('analytics');
    expect(jobAt(new Date('2026-09-24T10:24:00Z')).job).toBe('inbox');
    expect(jobAt(new Date('2026-09-24T10:44:00Z')).job).toBe('inbox');
    expect(jobAt(new Date('2026-09-24T01:08:00Z')).job).toBe('crm');
    expect(jobAt(new Date('2026-09-24T01:16:00Z'))).toEqual({ job: 'metrics', kind: 'annual' });
    expect(jobAt(new Date('2026-09-26T18:06:00Z')).job).toBe('reports');
    expect(jobAt(new Date('2026-09-24T10:12:00Z')).job).toBeNull();
  });

  it('يجعل للسجلّ القديم ثلاث دقائق لا تقع على المحجوز', () => {
    expect(jobAt(new Date('2026-09-24T10:18:00Z')).job).toBe('inbox-history');
    expect(jobAt(new Date('2026-09-24T10:38:00Z')).job).toBe('analytics-history');
    expect(jobAt(new Date('2026-09-24T10:58:00Z')).job).toBe('metrics-history');
    // والساعة الأولى على حالها: الربع في ٠١:١٤ والسنة في ٠١:١٦
    expect(jobAt(new Date('2026-09-24T01:14:00Z'))).toEqual({ job: 'metrics', kind: 'quarterly' });
    expect(jobAt(new Date('2026-09-24T01:18:00Z')).job).toBe('inbox-history');
  });

  it('يسحب سجلّ الصندوق بنمطه لا بنمط الدورة المعتادة', async () => {
    const { syncComments } = await import('../src/services/commentsSync');
    await tick('2026-09-24T10:18:00Z');
    expect(called).toContain('inbox');
    expect(vi.mocked(syncComments)).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ mode: 'history' }));
    called.length = 0;
    await tick('2026-09-24T10:58:00Z');
    expect(called).toContain('past-periods');
  });

  it('الدورة الثقيلة لا تشارك حصّتها بيسكامب ولا دفعة النشرة', async () => {
    await tick('2026-09-24T10:04:00Z');
    expect(called).toContain('inbox');
    expect(called).toContain('publish');
    expect(called).not.toContain('basecamp');
    expect(called).not.toContain('newsletter');
  });

  it('الدورة الخفيفة تجري فيها بيسكامب ودفعة النشرة', async () => {
    await tick('2026-09-24T10:12:00Z');
    expect(called).toEqual(expect.arrayContaining(['publish', 'queue', 'newsletter', 'basecamp']));
    expect(called).not.toContain('inbox');
    expect(called).not.toContain('analytics');
  });

  it('تُحتسب الفترتان الجارية والسابقة للسنة كذلك', async () => {
    await tick('2026-09-24T01:16:00Z');
    expect(called.filter((c) => c === 'compute')).toHaveLength(2);
  });

  it('يقرأ الوقت من موعد الدورة لا من ساعة التنفيذ', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:05:30Z'));
    await tick('2026-09-24T10:02:00Z');
    vi.useRealTimers();
    expect(called).toContain('analytics');
  });
});

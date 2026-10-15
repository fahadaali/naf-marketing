import { describe, it, expect, afterEach, vi } from 'vitest';
import { SOURCES } from '../src/adapters/sources';
import type { Env } from '../src/types';
import { periodOf } from '../src/services/period';

/* مصدر مزوّد النشر — أرقام الحساب من Ayrshare، وتخريطها في
   `ayrshareAccountMetrics.test.ts`. وهنا العقد وحده: لا سحب بلا مفتاح. */

const current = periodOf('monthly');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('مصدر مزوّد النشر', () => {
  it('سرُّه مفتاح Ayrshare', () => {
    expect(SOURCES.social.secretName).toBe('AYRSHARE_API_KEY');
  });

  it('يرفض السحب بلا مفتاح — ولا يكتب صفراً مكانه', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, text: async () => '{}' }) as unknown as Response);
    const db = { prepare: () => ({ bind: () => ({ first: async () => null }), first: async () => null }) };
    await expect(
      SOURCES.social.fetch({ DB: db } as unknown as Env, {}, { start: current.start, end: current.end }),
    ).rejects.toThrow();
  });
});

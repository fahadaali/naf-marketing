import { describe, it, expect, afterEach, vi } from 'vitest';
import { SOURCES } from '../src/adapters/sources';
import type { Env } from '../src/types';

/* مصدر الموقع الرئيسي — ما تقرؤه المنصّة من قاعدة الموقع.
   الاختبار يخنق `fetch` ولا يبلغ الشبكة: ما يُتحقّق منه هو أن الرمز
   يُرسل، وأن المدى يُمرَّر، وأن العقد يُقرأ كما هو، وأن ردّاً لا يطابقه
   يُردّ بخطأ مقروء لا بصمت. */

const env = { SITE_API_TOKEN: 'shared_site_token' } as unknown as Env;
const range = { start: '2026-08-01', end: '2026-08-31' };
const cfg = { endpoint: 'https://naflaw.sa/api/public/metrics' };

let seen: { url: string; auth: string | undefined } | null = null;

function stub(body: unknown, ok = true): void {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    seen = {
      url: String(url),
      auth: (init?.headers as Record<string, string> | undefined)?.authorization,
    };
    return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen = null;
});

describe('مصدر الموقع الرئيسي', () => {
  it('يُرسل الرمز ويمرّر المدى في الرابط', async () => {
    stub({ points: [] });
    await SOURCES.website!.fetch(env, cfg, range);

    expect(seen?.auth).toBe('Bearer shared_site_token');
    const url = new URL(seen!.url);
    expect(url.searchParams.get('start')).toBe('2026-08-01');
    expect(url.searchParams.get('end')).toBe('2026-08-31');
  });

  it('يقرأ النقاط المفردة والموزّعة على بُعد', async () => {
    stub({
      points: [
        { metric: 'site_contact_requests', value: 12 },
        { metric: 'site_contact_by_service', dim: 'service', dimValue: 'تأسيس الشركات', value: 5 },
      ],
    });

    const points = await SOURCES.website!.fetch(env, cfg, range);

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ metricKey: 'site_contact_requests', value: 12 });
    expect(points[1]).toMatchObject({
      metricKey: 'site_contact_by_service',
      dimKey: 'service',
      dimValue: 'تأسيس الشركات',
      value: 5,
    });
  });

  // نقطةٌ بلا مفتاح أو بقيمةٍ ليست رقماً تُسقط وحدها ولا تُسقط الدفعة:
  // مؤشرٌ واحد معطوب في الموقع لا يمنع بقية الأرقام من الوصول.
  it('يُسقط النقاط المعطوبة ويُبقي السليمة', async () => {
    stub({
      points: [
        { metric: '', value: 3 },
        { metric: 'site_articles_published', value: 'كثير' },
        { metric: 'site_newsletter_signups', value: 7 },
      ],
    });

    const points = await SOURCES.website!.fetch(env, cfg, range);

    expect(points).toHaveLength(1);
    expect(points[0]?.metricKey).toBe('site_newsletter_signups');
  });

  it('يرفض ردّاً لا يطابق العقد برسالة تذكر العقد', async () => {
    stub({ data: [] });
    await expect(SOURCES.website!.fetch(env, cfg, range)).rejects.toThrow(/points/);
  });

  it('يطلب ضبط العنوان قبل أن يبلغ الشبكة', async () => {
    stub({ points: [] });
    await expect(SOURCES.website!.fetch(env, {}, range)).rejects.toThrow(/التكاملات/);
    expect(seen).toBeNull();
  });
});

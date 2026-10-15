import type { Env } from '../types';
import type { PublishingProvider } from './provider';
import { MockProvider } from './mock';
import { AYRSHARE_RATE_KEY, AyrshareProvider, AyrshareRate, type AyrshareAuth } from './ayrshare';
import { customPlatformLabels } from '../platformLabels';
import { suspensionNotice } from '../services/ayrshareAlerts';

// يحل مفتاح المزوّد: يُفضّل السرّ الخاص بالمزوّد، ثم يتراجع إلى PROVIDER_API_KEY العام.
export function providerKey(env: Env, name: string): string {
  const specific = name.toLowerCase() === 'ayrshare' ? env.AYRSHARE_API_KEY : undefined;
  return (specific || env.PROVIDER_API_KEY || '').trim();
}

/** مصادقة Ayrshare من الأسرار — المفتاح، ومفتاحا تطبيق إكس إن ضُبطا. `null` بلا مفتاح. */
export function ayrshareAuth(env: Env): AyrshareAuth | null {
  const key = providerKey(env, 'ayrshare');
  if (!key) return null;
  return {
    key,
    x: { key: env.AYRSHARE_X_API_KEY?.trim(), secret: env.AYRSHARE_X_API_SECRET?.trim() },
    rate: ayrshareRate(env),
  };
}

/** عدّاد حدّ الطلبات، ورفضُه محفوظٌ في الإعدادات بين الاستدعاءات — انظر `AyrshareRate`. */
function ayrshareRate(env: Env): AyrshareRate {
  return new AyrshareRate({
    async read() {
      const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(AYRSHARE_RATE_KEY).first<{ value: string }>();
      return Number(row?.value) || 0;
    },
    async write(until) {
      await env.DB.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind(AYRSHARE_RATE_KEY, String(until)).run();
    },
  });
}

/** المزوّدون الذين ينشرون فعلاً — وما عداهم تجريبيٌّ أو غير مدعوم. */
const REAL_PROVIDERS = ['ayrshare'];

/**
 * أمزوّد النشر مربوطٌ بخدمةٍ حقيقية؟
 *
 * التجريبي يحاكي النشر ولا يقيس شيئاً (`adapters/mock.ts`)، فما يقوم على
 * لقطات المزوّد لا يُعرض مربوطاً معه — والمزوّد الحقيقي بلا مفتاح لا يسحب
 * شيئاً، فهو غير مربوط كذلك.
 */
export async function publishingProviderConnected(env: Env): Promise<boolean> {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'provider_name'").first<{
    value: string;
  }>();
  const name = (setting?.value || env.PROVIDER_NAME || 'mock').toLowerCase();
  return REAL_PROVIDERS.includes(name) && providerKey(env, name) !== '';
}

// مصنع المزوّد — Ayrshare وحده، ومفتاحه من Secrets. والتجريبي للتطوير والاختبار
// وحدهما، لا يُعرض في الإعدادات.
export async function getProvider(env: Env): Promise<PublishingProvider> {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'provider_name'").first<{
    value: string;
  }>();
  const name = (setting?.value || env.PROVIDER_NAME || 'mock').toLowerCase();
  const key = providerKey(env, name);

  switch (name) {
    case 'ayrshare':
      if (!key) throw new Error('مفتاح Ayrshare غير مضبوط (AYRSHARE_API_KEY أو PROVIDER_API_KEY)');
      return new AyrshareProvider(
        key, ayrshareAuth(env)?.x, await customPlatformLabels(env), env.IMAGES, await suspensionNotice(env), ayrshareRate(env),
      );
    case 'mock':
      return new MockProvider();
    default:
      // مزوّد غير معروف في الإعدادات — لا نسقط بصمت إلى التجريبي كي لا يظن المستخدم أنه ينشر فعلياً
      throw new Error(`مزوّد غير مدعوم: ${name} — اختر مزوّداً مدعوماً من الإعدادات، قسم المنصات والمزوّد`);
  }
}

export type { PublishingProvider };

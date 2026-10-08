import type { Env } from '../types';
import type { PublishingProvider } from './provider';
import { MockProvider } from './mock';
import { AyrshareProvider } from './ayrshare';
import { BufferProvider } from './buffer';
import { SocialApiProvider } from './socialapi';
import { customPlatformLabels } from '../platformLabels';

// يحل مفتاح المزوّد: يُفضّل السرّ الخاص بالمزوّد، ثم يتراجع إلى PROVIDER_API_KEY العام.
// هكذا يمكن تخزين مفتاح Buffer وSocialAPI معاً على Cloudflare بأسماء مختلفة والتبديل بينهما.
export function providerKey(env: Env, name: string): string {
  const n = name.toLowerCase();
  const specific =
    n === 'buffer' ? env.BUFFER_API_KEY :
    n === 'socialapi' ? env.SOCIALAPI_API_KEY :
    n === 'ayrshare' ? env.AYRSHARE_API_KEY :
    undefined;
  return (specific || env.PROVIDER_API_KEY || '').trim();
}

/** المزوّدون الذين ينشرون فعلاً — وما عداهم تجريبيٌّ أو غير مدعوم. */
const REAL_PROVIDERS = ['socialapi', 'buffer', 'ayrshare'];

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

// مصنع المزوّد — يُحقَن المزوّد الفعلي حسب الإعدادات، ومفتاحه من Secrets.
// إضافة مزوّد جديد (Zernio / Late): أنشئ ملفاً ينفّذ PublishingProvider وأضِفه هنا.
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
        key,
        { key: env.AYRSHARE_X_API_KEY?.trim(), secret: env.AYRSHARE_X_API_SECRET?.trim() },
        await customPlatformLabels(env),
      );
    case 'buffer': {
      if (!key) throw new Error('مفتاح Buffer غير مضبوط (BUFFER_API_KEY أو PROVIDER_API_KEY)');
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'buffer_profiles'").first<{ value: string }>();
      let profiles: Record<string, string> = {};
      try { profiles = row?.value ? JSON.parse(row.value) : {}; } catch { /* خريطة فارغة */ }
      return new BufferProvider(key, profiles, await customPlatformLabels(env));
    }
    case 'socialapi': {
      if (!key) throw new Error('مفتاح SocialAPI.ai غير مضبوط (SOCIALAPI_API_KEY أو PROVIDER_API_KEY)');
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'socialapi_profiles'").first<{ value: string }>();
      let accounts: Record<string, string> = {};
      try { accounts = row?.value ? JSON.parse(row.value) : {}; } catch { /* خريطة فارغة */ }
      return new SocialApiProvider(key, accounts, await customPlatformLabels(env));
    }
    case 'mock':
      return new MockProvider();
    default:
      // مزوّد غير معروف في الإعدادات — لا نسقط بصمت إلى التجريبي كي لا يظن المستخدم أنه ينشر فعلياً
      throw new Error(`مزوّد غير مدعوم: ${name} — اختر مزوّداً مدعوماً من الإعدادات، قسم المنصات والمزوّد`);
  }
}

export type { PublishingProvider };

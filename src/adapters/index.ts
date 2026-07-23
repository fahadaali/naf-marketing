import type { Env } from '../types';
import type { PublishingProvider } from './provider';
import { MockProvider } from './mock';
import { AyrshareProvider } from './ayrshare';
import { BufferProvider } from './buffer';

// مصنع المزوّد — يُحقَن المزوّد الفعلي حسب الإعدادات، ومفتاحه من Secrets.
// إضافة مزوّد جديد (Zernio / Late): أنشئ ملفاً ينفّذ PublishingProvider وأضِفه هنا.
export async function getProvider(env: Env): Promise<PublishingProvider> {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'provider_name'").first<{
    value: string;
  }>();
  const name = (setting?.value || env.PROVIDER_NAME || 'mock').toLowerCase();
  const key = env.PROVIDER_API_KEY || '';

  switch (name) {
    case 'ayrshare':
      if (!key) throw new Error('PROVIDER_API_KEY غير مضبوط للمزوّد ayrshare');
      return new AyrshareProvider(key);
    case 'buffer': {
      if (!key) throw new Error('PROVIDER_API_KEY (رمز وصول Buffer) غير مضبوط للمزوّد buffer');
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'buffer_profiles'").first<{ value: string }>();
      let profiles: Record<string, string> = {};
      try { profiles = row?.value ? JSON.parse(row.value) : {}; } catch { /* خريطة فارغة */ }
      return new BufferProvider(key, profiles);
    }
    // case 'zernio': return new ZernioProvider(key);
    // case 'late':   return new LateProvider(key);
    case 'mock':
    default:
      return new MockProvider();
  }
}

export type { PublishingProvider };

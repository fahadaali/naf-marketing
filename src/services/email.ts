import type { Env } from '../types';

// طبقة بريد مجرّدة محايدة للمزوّد — لإرسال إشعارات بريدية اختيارية.
export interface EmailProvider {
  send(to: string, subject: string, html: string): Promise<void>;
}

// مزوّد تجريبي: لا يرسل فعلياً (للتطوير/عند غياب مزوّد حقيقي)
export class MockEmailProvider implements EmailProvider {
  async send(_to: string, _subject: string, _html: string): Promise<void> {
    // لا شيء
  }
}

// مزوّد Resend — بسيط وموثّق جيداً
export class ResendEmailProvider implements EmailProvider {
  constructor(private apiKey: string, private from: string) {}
  async send(to: string, subject: string, html: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from || 'onboarding@resend.dev', to: [to], subject, html }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      throw new Error(`فشل إرسال البريد: ${data?.message || res.status}`);
    }
  }
}

/**
 * جاهزية البريد — تُقرأ قبل الإرسال وتُعرض في الإعدادات.
 *
 * ‏`mock` اختيارٌ صريح لا نقص: من اختاره أراد التطوير بلا تكلفة، فهو
 * «مضبوط» بمعنى أنّ ما يجري هو ما طُلب. والنقص أن يُختار `resend` ولا
 * يوجد مفتاحه.
 */
export async function emailReadiness(
  env: Env,
): Promise<{ provider: string; configured: boolean; reason: string }> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'email_provider'").first<{ value: string }>();
  const provider = (row?.value || 'mock').toLowerCase();
  if (provider !== 'resend') return { provider, configured: true, reason: '' };
  if (!env.EMAIL_PROVIDER_API_KEY) {
    return {
      provider,
      configured: false,
      reason: 'مفتاح Resend غير مضبوط. اضبط EMAIL_PROVIDER_API_KEY في أسرار كلاودفلير.',
    };
  }
  return { provider, configured: true, reason: '' };
}

/* ═══ ويرمي عند النقص، ولا يسقط صامتاً إلى التجريبي ═══

   كان يعود بـ`MockEmailProvider` حين يُختار `resend` ولا مفتاح له —
   وهو **يعلن النجاح ولا يرسل**. فتُعلَّم صفوف الإرسال كلُّها `sent`،
   وتقول الشاشة «بدأ الإرسال إلى N مشترك»، وتُظهر الإحصاءات إرسالاً
   كاملاً. ولا يغادر شيء.

   والصواب ما يفعله `getProvider` لمزوّد النشر في `adapters/index.ts`:
   يرمي باسم المفتاح الناقص. ومزوّدُ بريدٍ ناقصٌ أولى بذلك، لأن عطله
   لا يُكتشف بالنظر — لا رسالةَ خطأ تصل ولا مشتركَ يشكو. */
export async function getEmailProvider(env: Env): Promise<EmailProvider> {
  const state = await emailReadiness(env);
  if (!state.configured) throw new Error(state.reason);
  if (state.provider === 'resend') {
    const fromRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'email_from'").first<{ value: string }>();
    return new ResendEmailProvider(env.EMAIL_PROVIDER_API_KEY!, fromRow?.value || '');
  }
  return new MockEmailProvider();
}

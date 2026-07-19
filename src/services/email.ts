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

export async function getEmailProvider(env: Env): Promise<EmailProvider> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'email_provider'").first<{ value: string }>();
  const name = (row?.value || 'mock').toLowerCase();
  if (name === 'resend') {
    if (!env.EMAIL_PROVIDER_API_KEY) return new MockEmailProvider();
    const fromRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'email_from'").first<{ value: string }>();
    return new ResendEmailProvider(env.EMAIL_PROVIDER_API_KEY, fromRow?.value || '');
  }
  return new MockEmailProvider();
}

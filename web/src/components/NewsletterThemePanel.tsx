import { Eraser } from 'lucide-react';
import Modal from './Modal';
import ColorField from './ColorField';
import {
  DEFAULT_THEME, RADIUS_LABEL, RADIUS_PX, SIZE_LABEL, WIDTH_LABEL, WIDTH_PX, BODY_PX, isCustomTheme,
} from '../lib/newsletterTheme';
import type { NewsletterTheme, RadiusStep } from '../lib/newsletterTheme';

/* سمة النشرة: ما يحيط بالكتل لا ما بداخلها.

   وهي ليست «المظهر» في §٩ — ذاك وضعُ القارئ يتبدّل بجهازه، وهذه
   رسالةٌ غادرت إلى صندوق الوارد وثبتت. ولذلك لا فاتح ولا داكن هنا،
   وتنبيهُ ثبات الألوان مكتوبٌ حيث تُختار لا في صفحة مساعدة. */

const COLOR_FIELDS: { key: keyof NewsletterTheme; label: string }[] = [
  { key: 'pageBackground', label: 'خلفية الصفحة' },
  { key: 'cardBackground', label: 'سطح البطاقة' },
  { key: 'text', label: 'لون المتن' },
  { key: 'heading', label: 'لون العناوين' },
  { key: 'link', label: 'لون الروابط' },
  { key: 'buttonBackground', label: 'لون الزر' },
  { key: 'buttonText', label: 'لون نصّ الزر' },
  { key: 'border', label: 'لون الحدّ' },
];

export default function NewsletterThemePanel({
  theme, onChange, onClose,
}: {
  theme: NewsletterTheme;
  onChange: (next: NewsletterTheme) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<NewsletterTheme>) => onChange({ ...theme, ...patch });
  const custom = isCustomTheme(theme);

  return (
    <Modal title="سمة النشرة" onClose={onClose}>
      <div className="field">
        <label>الألوان</label>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          {COLOR_FIELDS.map((f) => (
            <ColorField
              key={f.key}
              label={f.label}
              value={theme[f.key] as string}
              onChange={(hex) => set({ [f.key]: hex || DEFAULT_THEME[f.key] } as Partial<NewsletterTheme>)}
            />
          ))}
        </div>
        <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '8px 0 0', lineHeight: 1.8 }}>
          الألوان المخصّصة تصل كما هي في البريد وفي الصفحة العامة، ولا تتبدّل مع وضع القارئ.
        </p>
      </div>

      <div className="grid cols-3" style={{ gap: 'var(--space-3)' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="th-width">عرض المحتوى</label>
          <select
            id="th-width"
            className="select"
            value={theme.width}
            onChange={(e) => set({ width: e.target.value as NewsletterTheme['width'] })}
          >
            {(Object.keys(WIDTH_LABEL) as NewsletterTheme['width'][]).map((k) => (
              <option key={k} value={k}>{WIDTH_LABEL[k]}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="th-size">حجم النصّ</label>
          <select
            id="th-size"
            className="select"
            value={theme.size}
            onChange={(e) => set({ size: e.target.value as NewsletterTheme['size'] })}
          >
            {(['sm', 'md', 'lg'] as const).map((k) => (
              <option key={k} value={k}>{SIZE_LABEL[k]}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="th-radius">استدارة الحواف</label>
          <select
            id="th-radius"
            className="select"
            value={theme.radius}
            onChange={(e) => set({ radius: e.target.value as RadiusStep })}
          >
            {(Object.keys(RADIUS_LABEL) as RadiusStep[]).map((k) => (
              <option key={k} value={k}>{RADIUS_LABEL[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* معاينةٌ مصغَّرة بقيم السمة الحرفية — استثناء قوالب البريد،
          CLAUDE.md §1. معاينةٌ تتبع ثيم المنصة تُري الكاتب شيئاً لا
          يصل المشترك أبداً. */}
      <div className="field" style={{ marginTop: 'var(--space-4)' }}>
        <label>المعاينة</label>
        <div style={{ background: theme.pageBackground, padding: 'var(--space-4)', borderRadius: 'var(--radius)' }}>
          <div
            style={{
              background: theme.cardBackground,
              color: theme.text,
              borderRadius: RADIUS_PX[theme.radius],
              border: `1px solid ${theme.border}`,
              maxWidth: WIDTH_PX[theme.width] / 2,
              margin: '0 auto',
              padding: 'var(--space-4)',
              fontSize: BODY_PX[theme.size],
              lineHeight: 1.9,
            }}
          >
            <div style={{ color: theme.heading, fontWeight: 700, fontSize: BODY_PX[theme.size] * 1.35 }}>
              عنوان النشرة
            </div>
            <p style={{ margin: '8px 0' }}>
              فقرة من المتن، وفيها <span style={{ color: theme.link, textDecoration: 'underline' }}>رابط</span>.
            </p>
            <span
              style={{
                display: 'inline-block',
                background: theme.buttonBackground,
                color: theme.buttonText,
                borderRadius: RADIUS_PX[theme.radius],
                padding: '8px 16px',
                fontWeight: 600,
                fontSize: BODY_PX[theme.size] * 0.9,
              }}
            >
              زر
            </span>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 'var(--space-2)' }}>
        {custom && (
          <button className="btn ghost" onClick={() => onChange({ ...DEFAULT_THEME })}>
            <Eraser size={20} /> إعادة السمة الافتراضية
          </button>
        )}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>إغلاق</button>
      </div>
    </Modal>
  );
}

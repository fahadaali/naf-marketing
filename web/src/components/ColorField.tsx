import { useId, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Popover } from './Popover';
import { EMAIL, SWATCHES, hexColor, paletteGradient } from '../lib/newsletterTheme';

/* منتقي لون: مربّعات اللوحة المسجّلة أولاً، ثم لونٌ حرّ من منتقي
   المتصفح، ثم «الافتراضي» للعودة.

   و«الافتراضي» خيارٌ ظاهر لا غيابُ خيار — `naf-terms.md` §١٤: الكاتب
   الذي لوّن كلمةً يحتاج طريقاً معلومةً للعودة، وقائمةٌ بلا هذا الخيار
   تجعل التراجع تخميناً. ولا يُكتب «بلا لون»: اللون قائم دائماً،
   والافتراضي لونُ السمة لا العدم.

   المربّعات هنا **قيمُ محتوى** لا رموز تصميم: لونٌ يختاره الكاتب
   لفقرةٍ في نشرته يُخزَّن مع نصّها. وقيمها من مرآة السجلّ في
   `lib/newsletterTheme.ts` لا مكتوبةً هنا. */

export default function ColorField({
  label, value, onChange, className,
}: {
  label: string;
  value?: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  const inputId = useId();
  const current = hexColor(value);

  return (
    <div className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <Popover
        render={({ toggle, open }) => (
          <button
            type="button"
            className="btn sm ghost"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={toggle}
            title={label}
          >
            {/* شريطٌ متعدّد الألوان حين لا لون مختار: مربّعٌ بلون
                واحد لا يقول إنه منتقي ألوان — وقد قيل لنا ذلك. وحين
                يُختار لونٌ يصير الشريط لونَه، فيقول أيضاً «هذا هو
                المختار». */}
            <span
              aria-hidden="true"
              className="swatch-dot"
              style={{ background: current || paletteGradient(135) }}
            />
            {label}
          </button>
        )}
      >
        {({ close }) => (
          <div className="card" style={{ width: 232, padding: 'var(--space-3)', boxShadow: 'var(--shadow-xl)' }}>
            <div
              role="group"
              aria-label={label}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-1)' }}
            >
              {SWATCHES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className="swatch"
                  aria-label={s.label}
                  title={s.label}
                  aria-pressed={current === s.value}
                  style={{ background: s.value }}
                  onClick={() => { onChange(s.value); close(); }}
                />
              ))}
            </div>

            <label
              htmlFor={inputId}
              className="row"
              style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}
            >
              لون آخر
              <div className="spacer" />
              <input
                id={inputId}
                type="color"
                className="color-input"
                /* منتقي المتصفح يشترط قيمة، فيبدأ من سطح البطاقة حين
                   لا يكون هناك لون مختار — القيمة من المرآة لا مكتوبة. */
                value={current || EMAIL.card}
                onChange={(e) => onChange(hexColor(e.target.value))}
              />
            </label>

            <button
              type="button"
              className="btn sm ghost"
              style={{ marginTop: 'var(--space-2)', width: '100%' }}
              onClick={() => { onChange(''); close(); }}
            >
              <Eraser size={16} /> الافتراضي
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}

/* منتقٍ مصغَّر لشريط التنسيق: أيقونةٌ وحدها بلا نصّ، فالشريط ضيّق.
   والتسمية تبقى في `aria-label` و`title` — زرٌّ بلا اسمٍ مقروء لا
   يجده قارئ الشاشة. */
export function ColorPickButton({
  icon, label, onPick,
}: {
  icon: JSX.Element;
  label: string;
  onPick: (hex: string) => void;
}) {
  const [custom, setCustom] = useState<string>(EMAIL.primary);
  return (
    <Popover
      /* الأيقونة فوق شريط الألوان — الشكل المألوف في محرّرات النصوص:
         الرمز يقول أيَّ شيءٍ يُلوَّن، والشريط يقول إن هنا ألواناً تُختار. */
      render={({ toggle, open }) => (
        <button type="button" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
                className="color-btn"
                onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
          {icon}
          <span aria-hidden="true" className="swatch-bar" style={{ background: paletteGradient(90) }} />
        </button>
      )}
    >
      {({ close }) => (
        <div className="card" style={{ width: 232, padding: 'var(--space-3)', boxShadow: 'var(--shadow-xl)' }}>
          <div role="group" aria-label={label}
               style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-1)' }}>
            {SWATCHES.map((s) => (
              <button key={s.value} type="button" className="swatch" aria-label={s.label} title={s.label}
                      style={{ background: s.value }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { onPick(s.value); close(); }} />
            ))}
          </div>
          <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <input type="color" className="color-input" aria-label="لون آخر"
                   value={custom} onChange={(e) => setCustom(hexColor(e.target.value) || EMAIL.primary)} />
            <button type="button" className="btn sm ghost" style={{ flex: 1 }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onPick(custom); close(); }}>
              تطبيق
            </button>
          </div>

          {/* الطريق المعلومة للعودة. `naf-terms.md` §١٤: «الافتراضي»
              خيارٌ ظاهر في **كل** قائمة لون لا غيابُ خيار — ومن لوّن
              كلمةً بلا هذا الخيار يصير تراجعُه تخميناً. ولا يُكتب «بلا
              لون»: اللون قائم دائماً، والافتراضي لونُ السمة لا العدم. */}
          <button type="button" className="btn sm ghost"
                  style={{ marginTop: 'var(--space-2)', width: '100%' }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onPick(''); close(); }}>
            <Eraser size={16} /> الافتراضي
          </button>
        </div>
      )}
    </Popover>
  );
}

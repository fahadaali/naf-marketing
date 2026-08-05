import { useId, useState } from 'react';
import { Eraser, Pipette } from 'lucide-react';
import { Popover } from './Popover';
import { EMAIL, SWATCHES, hexColor, paletteGradient } from '../lib/newsletterTheme';

/* منتقي لون: مربّعات اللوحة المسجّلة أولاً، ثم لونٌ حرّ من منتقي
   المتصفح، ثم «الافتراضي» للعودة.

   و«لون آخر» صفٌّ كامل بأيقونةٍ ونصّ، لا مربّعاً في آخر الشبكة.

   السبب أن المتصفح يرسم `<input type="color">` مربّعاً مصمتاً لا
   يفرّقه شيء عن مربّعات اللوحة فوقه — فقيل لنا إنه يُحسب لوناً
   مقرَّراً كبقيّتها، ولا يُعرف أن الضغط عليه يفتح الطيف كلَّه. وهو
   استنتاجٌ سليم ممّا يراه الناظر: أربعةَ عشرَ مربّعاً في شبكة،
   وخامسَ عشرَ مثلها في الصفّ الأسفل.

   فالعلامة الفارقة ثلاثٌ معاً: `Pipette` القطّارة المسجّلة لهذا
   المعنى وحده، ونصٌّ ظاهر يقول «لون آخر»، وصفٌّ مستقلٌّ عن الشبكة
   بعرضها كلِّه. والمربّع يبقى — لكنه صار **أثرَ** الاختيار لا بابَه.

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

            <label htmlFor={inputId} className="pick-row">
              <Pipette size={16} aria-hidden="true" />
              <span>لون آخر</span>
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
  const customId = useId();
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
          {/* الصفّ نفسه هنا: أيقونةٌ ونصٌّ ظاهر يقولان إن هذا بابٌ
              يُفتح، لا لونٌ خامس عشر في الشبكة. و«تطبيق» تحته لأن
              منتقي المتصفح يبثّ التغيير مع كل حركةِ إصبع — فلولا
              خطوةُ التأكيد لصُبغ النصّ بكل لونٍ يمرّ عليه المؤشّر. */}
          <label htmlFor={customId} className="pick-row">
            <Pipette size={16} aria-hidden="true" />
            <span>لون آخر</span>
            <div className="spacer" />
            <input id={customId} type="color" className="color-input"
                   value={custom} onChange={(e) => setCustom(hexColor(e.target.value) || EMAIL.primary)} />
          </label>
          <button type="button" className="btn sm ghost"
                  style={{ marginTop: 'var(--space-2)', width: '100%' }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onPick(custom); close(); }}>
            تطبيق
          </button>

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

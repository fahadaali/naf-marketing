import { TextAlignStart, TextAlignCenter, TextAlignEnd, ALargeSmall, Eraser, Palette } from 'lucide-react';
import ColorField from './ColorField';
import {
  ALIGN_LABEL, SIZE_LABEL, WEIGHT_LABEL, RADIUS_LABEL, cleanStyle,
} from '../lib/newsletterTheme';
import type { Align, BlockStyle, RadiusStep, SizeStep, Weight } from '../lib/newsletterTheme';

/* شريط تخصيص الكتلة. يظهر بطيّه لا مفتوحاً: سبعة عشر نوعَ كتلةٍ
   بشريطٍ مفتوحٍ لكلٍّ منها تجعل المحرر جدارَ أزرار، والكاتب في أغلب
   الفقرات لا يريد إلا أن يكتب.

   وما يُعرض يتبع الكتلة: فاصلٌ لا حجم نصّ له، وصورةٌ لا ثقل خطّ لها.
   عرضُ خيارٍ لا أثر له كذبٌ صغير يتكرّر في كل كتلة.

   أيقونات المحاذاة من الكتلة (أ) في «قواعد القلب»: أسماؤها منطقية
   ورسمها لاتينيّ، فتُقلبان في RTL بورقة الأنماط المسجّلة. ولا
   `AlignLeft`/`AlignRight` — كنيتان مهجورتان في Lucide 1.x. */

export type StyleCapability = 'ink' | 'surface' | 'align' | 'size' | 'weight' | 'radius' | 'full' | 'border';

/** ما يقبله كلُّ نوع من التخصيص. المفتاح نوع الكتلة في نموذج النشرة. */
export const BLOCK_STYLE_CAPS: Record<string, StyleCapability[]> = {
  heading: ['ink', 'surface', 'align', 'size', 'weight'],
  text: ['ink', 'surface', 'align', 'size', 'weight', 'radius', 'border'],
  quote: ['ink', 'surface', 'align', 'size', 'border'],
  callout: ['ink', 'surface', 'align', 'size', 'border', 'radius'],
  button: ['ink', 'surface', 'align', 'size', 'radius', 'full'],
  image: ['align', 'radius'],
  divider: ['border'],
  table: ['ink', 'surface', 'align', 'size', 'border'],
  code: ['ink', 'surface', 'border', 'radius'],
  toc: ['ink', 'surface', 'radius'],
  footnote: ['ink'],
  checklist: ['ink', 'size'],
  columns: ['ink', 'surface', 'align', 'size', 'radius'],
};

const ALIGNS: { value: Align; icon: JSX.Element }[] = [
  { value: 'start', icon: <TextAlignStart size={16} /> },
  { value: 'center', icon: <TextAlignCenter size={16} /> },
  { value: 'end', icon: <TextAlignEnd size={16} /> },
];

export default function BlockStyleBar({
  blockType, style, onChange,
}: {
  blockType: string;
  style?: BlockStyle;
  onChange: (style: BlockStyle | undefined) => void;
}) {
  const caps = BLOCK_STYLE_CAPS[blockType];
  if (!caps?.length) return null;

  const s = style || {};
  const set = (patch: Partial<BlockStyle>) => onChange(cleanStyle({ ...s, ...patch }));
  const has = (c: StyleCapability) => caps.includes(c);
  const touched = !!cleanStyle(s);

  // «لون الخلفية» على الزرّ يعني لون الزرّ نفسه — الكاتب يقرأ ما يرى
  const surfaceLabel = blockType === 'button' ? 'لون الزر' : 'لون الخلفية';
  const inkLabel = blockType === 'button' ? 'لون نصّ الزر' : 'لون النصّ';

  return (
    <div className="style-bar">
      <span className="muted" style={{ fontSize: 'var(--text-xs)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Palette size={16} /> التخصيص
      </span>

      {has('ink') && <ColorField label={inkLabel} value={s.color} onChange={(color) => set({ color })} />}
      {has('surface') && <ColorField label={surfaceLabel} value={s.background} onChange={(background) => set({ background })} />}
      {has('border') && <ColorField label="لون الحدّ" value={s.border} onChange={(border) => set({ border })} />}

      {has('align') && (
        <div className="seg" role="group" aria-label="محاذاة">
          {ALIGNS.map((a) => (
            <button
              key={a.value}
              type="button"
              className={s.align === a.value ? 'on' : ''}
              aria-pressed={s.align === a.value}
              title={ALIGN_LABEL[a.value]}
              aria-label={ALIGN_LABEL[a.value]}
              onClick={() => set({ align: s.align === a.value ? undefined : a.value })}
            >
              {a.icon}
            </button>
          ))}
        </div>
      )}

      {has('size') && (
        <label className="style-pick" title="حجم النصّ">
          <ALargeSmall size={16} aria-hidden="true" />
          <span className="sr-only">حجم النصّ</span>
          <select
            className="select sm"
            value={s.size || ''}
            onChange={(e) => set({ size: (e.target.value || undefined) as SizeStep | undefined })}
          >
            <option value="">الافتراضي</option>
            {(Object.keys(SIZE_LABEL) as SizeStep[]).map((k) => (
              <option key={k} value={k}>{SIZE_LABEL[k]}</option>
            ))}
          </select>
        </label>
      )}

      {has('weight') && (
        <label className="style-pick">
          <span className="sr-only">ثقل الخط</span>
          <select
            className="select sm"
            aria-label="ثقل الخط"
            value={s.weight || ''}
            onChange={(e) => set({ weight: (e.target.value ? Number(e.target.value) : undefined) as Weight | undefined })}
          >
            <option value="">ثقل الخط</option>
            {(Object.keys(WEIGHT_LABEL) as unknown as Weight[]).map((k) => (
              <option key={k} value={k}>{WEIGHT_LABEL[k]}</option>
            ))}
          </select>
        </label>
      )}

      {has('radius') && (
        <label className="style-pick">
          <span className="sr-only">استدارة الحواف</span>
          <select
            className="select sm"
            aria-label="استدارة الحواف"
            value={s.radius || ''}
            onChange={(e) => set({ radius: (e.target.value || undefined) as RadiusStep | undefined })}
          >
            <option value="">استدارة الحواف</option>
            {(Object.keys(RADIUS_LABEL) as RadiusStep[]).map((k) => (
              <option key={k} value={k}>{RADIUS_LABEL[k]}</option>
            ))}
          </select>
        </label>
      )}

      {has('full') && (
        <label className="row" style={{ gap: 6, fontSize: 'var(--text-xs)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!s.full} onChange={(e) => set({ full: e.target.checked || undefined })} />
          بعرض كامل
        </label>
      )}

      <div className="spacer" />
      {touched && (
        <button type="button" className="btn sm ghost" onClick={() => onChange(undefined)}>
          <Eraser size={16} /> إعادة الافتراضي
        </button>
      )}
    </div>
  );
}

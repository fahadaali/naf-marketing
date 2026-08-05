import { useState, type RefObject } from 'react';
import { Bold, Italic, Underline, Link, Baseline, Highlighter } from 'lucide-react';
import { FieldModal } from './ConfirmModal';
import { ColorPickButton } from './ColorField';

/* شريط تنسيق فوق حقل نصّي عادي (textarea) لا فوق contentEditable.

   الكتلة تحفظ نصّاً خاماً بعلاماتٍ قليلة، والمصيّر في
   src/services/inline.ts يحوّلها. فالشريط هنا يلفّ التحديد بالعلامة
   ولا يبني HTML — ولهذا يعمل على textarea عادي، ويبقى ما يكتبه
   الكاتب مقروءاً حتى لو لم يستعمل الشريط أصلاً.

   ولون الكلمة يتبع القاعدة نفسها: يلفّ التحديد بـ`{c:#RRGGBB|…}`
   ولا يكتب `<span>`. اللون يُفحص في الخادم قبل أن يصير نمطاً، ولو لم
   يطابق سقطت العلامة وبقي النصّ ظاهراً.

   الأيقونات الستّ مسجّلة في naf-icons.md §المحرر النصّي — التنسيق
   داخل النصّ، وتخصيص المظهر. */

type Props = {
  areaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
  onError?: (message: string) => void;
};

export default function InlineToolbar({ areaRef, value, onChange, onError }: Props) {
  const [linking, setLinking] = useState(false);
  const [linkErr, setLinkErr] = useState('');

  /* يلفّ التحديد ببادئةٍ ولاحقة ويعيد المؤشر إلى داخل اللفّ — الكاتب
     الذي ضغط «غامق» بلا تحديد يجد المؤشر بين النجمتين جاهزاً للكتابة. */
  function wrapWith(open: string, close: string) {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const picked = value.slice(s, e);
    onChange(value.slice(0, s) + open + picked + close + value.slice(e));
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(s + open.length, s + open.length + picked.length);
    });
  }

  const wrap = (mark: string) => wrapWith(mark, mark);

  /* اللون بلا تحديد يلفّ كلمةً نائبة لا فراغاً: علامةٌ فارغة
     `{c:#…|}` لا تطابق النمط في الخادم فتبقى ظاهرةً نصّاً، والكاتب
     يظنّ اللون معطوباً وهو لم يختر ما يلوّنه. */
  function applyColor(kind: 'c' | 'h', hex: string) {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    if (s === e) {
      const word = 'نصّ';
      const open = `{${kind}:${hex}|`;
      onChange(value.slice(0, s) + open + word + '}' + value.slice(e));
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(s + open.length, s + open.length + word.length);
      });
      return;
    }
    wrapWith(`{${kind}:${hex}|`, '}');
  }

  function insertLink(href: string) {
    const el = areaRef.current;
    if (!el) return;
    // نفس القائمة البيضاء في inline.ts. التحقق هنا يمنع الكتابة أصلاً
    // بدل أن يكتشف الكاتبُ صمتَ الرابط بعد الإرسال.
    if (!/^(?:https?:\/\/|mailto:)/i.test(href)) {
      setLinkErr('الرابط بلا عنوان. أدخل عنواناً يبدأ بـ https://.');
      return;
    }
    const { selectionStart: s, selectionEnd: e } = el;
    const label = value.slice(s, e) || 'رابط';
    onChange(`${value.slice(0, s)}[${label}](${href})${value.slice(e)}`);
    setLinking(false);
    setLinkErr('');
    onError?.('');
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(s + 1, s + 1 + label.length);
    });
  }

  const marks: { icon: JSX.Element; title: string; run: () => void }[] = [
    { icon: <Bold size={20} />, title: 'غامق', run: () => wrap('**') },
    { icon: <Italic size={20} />, title: 'مائل', run: () => wrap('*') },
    { icon: <Underline size={20} />, title: 'تسطير', run: () => wrap('__') },
    { icon: <Link size={20} />, title: 'رابط', run: () => { setLinkErr(''); setLinking(true); } },
  ];

  return (
    <div className="rte-toolbar">
      {marks.map((m) => (
        <button
          key={m.title}
          type="button"
          title={m.title}
          aria-label={m.title}
          onMouseDown={(ev) => ev.preventDefault()} // يحفظ التحديد داخل الحقل
          onClick={m.run}
        >
          {m.icon}
        </button>
      ))}

      <ColorPickButton
        icon={<Baseline size={20} />}
        label="لون النصّ"
        onPick={(hex) => applyColor('c', hex)}
      />
      <ColorPickButton
        icon={<Highlighter size={20} />}
        label="تظليل"
        onPick={(hex) => applyColor('h', hex)}
      />

      {linking && (
        <FieldModal
          title="رابط"
          label="الرابط"
          type="url"
          placeholder="https://"
          actionLabel="إضافة"
          error={linkErr}
          onSubmit={insertLink}
          onClose={() => { setLinking(false); setLinkErr(''); }}
        />
      )}
    </div>
  );
}

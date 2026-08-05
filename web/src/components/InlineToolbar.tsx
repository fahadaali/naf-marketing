import type { RefObject } from 'react';
import { Bold, Italic, Underline, Link } from 'lucide-react';

/* شريط تنسيق فوق حقل نصّي عادي (textarea) لا فوق contentEditable.

   الكتلة تحفظ نصّاً خاماً بعلاماتٍ قليلة، والمصيّر في
   src/services/inline.ts يحوّلها. فالشريط هنا يلفّ التحديد بالعلامة
   ولا يبني HTML — ولهذا يعمل على textarea عادي، ويبقى ما يكتبه
   الكاتب مقروءاً حتى لو لم يستعمل الشريط أصلاً.

   الأيقونات الأربع مسجّلة في naf-icons.md §المحرر النصّي — التنسيق
   داخل النصّ. */

type Props = {
  areaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
  onError?: (message: string) => void;
};

export default function InlineToolbar({ areaRef, value, onChange, onError }: Props) {
  /* يلفّ التحديد بعلامتين ويعيد المؤشر إلى داخل اللفّ — الكاتب الذي
     ضغط «غامق» بلا تحديد يجد المؤشر بين النجمتين جاهزاً للكتابة. */
  function wrap(mark: string) {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const picked = value.slice(s, e);
    const next = value.slice(0, s) + mark + picked + mark + value.slice(e);
    onChange(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(s + mark.length, s + mark.length + picked.length);
    });
  }

  function insertLink() {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const picked = value.slice(s, e);
    const url = prompt('الرابط');
    if (url === null) return; // ألغى الكاتب — لا رسالة ولا تغيير
    const href = url.trim();
    // نفس القائمة البيضاء في inline.ts. التحقق هنا يمنع الكتابة أصلاً
    // بدل أن يكتشف الكاتبُ صمتَ الرابط بعد الإرسال.
    if (!/^(?:https?:\/\/|mailto:)/i.test(href)) {
      onError?.('الرابط بلا عنوان. أدخل عنواناً يبدأ بـ https://.');
      return;
    }
    const label = picked || 'رابط';
    const next = `${value.slice(0, s)}[${label}](${href})${value.slice(e)}`;
    onChange(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(s + 1, s + 1 + label.length);
    });
  }

  const marks: { icon: JSX.Element; title: string; run: () => void }[] = [
    { icon: <Bold size={20} />, title: 'غامق', run: () => wrap('**') },
    { icon: <Italic size={20} />, title: 'مائل', run: () => wrap('*') },
    { icon: <Underline size={20} />, title: 'تسطير', run: () => wrap('__') },
    { icon: <Link size={20} />, title: 'رابط', run: insertLink },
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
    </div>
  );
}

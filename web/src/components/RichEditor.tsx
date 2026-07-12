import { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, Heading2, Quote, List, ListOrdered, RemoveFormatting } from 'lucide-react';

// محرر نصوص غني عربي RTL خفيف (يعتمد contentEditable + execCommand).
// يوحّد تحرير المصادر الثلاثة (يدوي/ذكاء اصطناعي/RSS).
export default function RichEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const cmd = (command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    ref.current?.focus();
    onChange(ref.current?.innerHTML || '');
  };

  const buttons: { icon: JSX.Element; cmd: string; arg?: string; title: string }[] = [
    { icon: <Bold size={16} />, cmd: 'bold', title: 'غامق' },
    { icon: <Italic size={16} />, cmd: 'italic', title: 'مائل' },
    { icon: <Underline size={16} />, cmd: 'underline', title: 'تسطير' },
    { icon: <Heading2 size={16} />, cmd: 'formatBlock', arg: 'H2', title: 'عنوان' },
    { icon: <Quote size={16} />, cmd: 'formatBlock', arg: 'BLOCKQUOTE', title: 'اقتباس' },
    { icon: <List size={16} />, cmd: 'insertUnorderedList', title: 'قائمة نقطية' },
    { icon: <ListOrdered size={16} />, cmd: 'insertOrderedList', title: 'قائمة مرقمة' },
    { icon: <RemoveFormatting size={16} />, cmd: 'removeFormat', title: 'إزالة التنسيق' },
  ];

  return (
    <div>
      <div className="rte-toolbar">
        {buttons.map((b, i) => (
          <button
            key={i}
            type="button"
            title={b.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => cmd(b.cmd, b.arg)}
          >
            {b.icon}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="rte"
        contentEditable
        dir="rtl"
        data-placeholder={placeholder || 'اكتب المحتوى هنا...'}
        onInput={() => onChange(ref.current?.innerHTML || '')}
        suppressContentEditableWarning
      />
    </div>
  );
}

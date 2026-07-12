import { useEffect, useRef } from 'react';

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

  // مزامنة القيمة الخارجية (مثلاً حقن مخرجات الذكاء الاصطناعي) دون كسر المؤشر أثناء الكتابة
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

  const buttons: { label: string; cmd: string; arg?: string; title: string }[] = [
    { label: 'B', cmd: 'bold', title: 'غامق' },
    { label: 'I', cmd: 'italic', title: 'مائل' },
    { label: 'U', cmd: 'underline', title: 'تسطير' },
    { label: 'H', cmd: 'formatBlock', arg: 'H2', title: 'عنوان' },
    { label: '“”', cmd: 'formatBlock', arg: 'BLOCKQUOTE', title: 'اقتباس' },
    { label: '•', cmd: 'insertUnorderedList', title: 'قائمة نقطية' },
    { label: '1.', cmd: 'insertOrderedList', title: 'قائمة مرقمة' },
    { label: '↺', cmd: 'removeFormat', title: 'إزالة التنسيق' },
  ];

  return (
    <div>
      <div className="rte-toolbar">
        {buttons.map((b) => (
          <button key={b.label} type="button" title={b.title} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd(b.cmd, b.arg)}>
            {b.label}
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

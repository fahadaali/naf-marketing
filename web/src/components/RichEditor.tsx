import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Bold, Italic, Underline, Heading2, Quote, List, ListOrdered, RemoveFormatting } from 'lucide-react';

export type RichEditorHandle = { insertHtml: (html: string) => void; focus: () => void };

// محرر نصوص غني عربي RTL خفيف (contentEditable + execCommand)، مع إدراج الوسائط
// عند موضع المؤشر بحيث تبقى مثبّتة في مكانها داخل المحتوى.
const RichEditor = forwardRef<RichEditorHandle, { value: string; onChange: (html: string) => void; placeholder?: string }>(
  ({ value, onChange, placeholder }, ref) => {
    const el = useRef<HTMLDivElement>(null);
    const savedRange = useRef<Range | null>(null);

    useEffect(() => {
      if (el.current && el.current.innerHTML !== value) el.current.innerHTML = value || '';
    }, [value]);

    function saveSelection() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        if (el.current && el.current.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
      }
    }

    useImperativeHandle(ref, () => ({
      focus: () => el.current?.focus(),
      insertHtml: (html: string) => {
        const editor = el.current;
        if (!editor) return;
        editor.focus();
        const sel = window.getSelection();
        if (!sel) return;
        let range = savedRange.current;
        if (!range || !editor.contains(range.commonAncestorContainer)) {
          range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false); // النهاية
        }
        sel.removeAllRanges();
        sel.addRange(range);
        const frag = range.createContextualFragment(html + '<p><br/></p>');
        const last = frag.lastChild;
        range.deleteContents();
        range.insertNode(frag);
        if (last) {
          const after = document.createRange();
          after.setStartAfter(last);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
          savedRange.current = after.cloneRange();
        }
        onChange(editor.innerHTML);
      },
    }));

    const cmd = (command: string, arg?: string) => {
      document.execCommand(command, false, arg);
      el.current?.focus();
      onChange(el.current?.innerHTML || '');
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
            <button key={i} type="button" title={b.title} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd(b.cmd, b.arg)}>
              {b.icon}
            </button>
          ))}
        </div>
        <div
          ref={el}
          className="rte"
          contentEditable
          dir="rtl"
          data-placeholder={placeholder || 'اكتب المحتوى هنا...'}
          onInput={() => onChange(el.current?.innerHTML || '')}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onBlur={saveSelection}
          suppressContentEditableWarning
        />
      </div>
    );
  },
);

RichEditor.displayName = 'RichEditor';
export default RichEditor;

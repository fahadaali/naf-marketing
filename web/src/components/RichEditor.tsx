import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Bold, Italic, Underline, Heading2, Quote, List, ListOrdered, RemoveFormatting, Paperclip } from 'lucide-react';
import { mediaEmbedHtml, mediaFromEl, type MediaInfo } from '../mediaEmbed';

export type RichEditorHandle = { insertHtml: (html: string) => void; focus: () => void };

type UploadResult = { id: string; url?: string; filename?: string; mime_type?: string } | null;

// محرر نصوص غني عربي RTL خفيف (contentEditable + execCommand)، مع زر إرفاق داخل الشريط
// يُدرج الوسائط عند موضع المؤشر (تبقى مثبّتة في مكانها)، والنقر على الوسيط يفتح نافذة الاستعراض.
const RichEditor = forwardRef<
  RichEditorHandle,
  {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
    onUpload?: (file: File) => Promise<UploadResult>;
    onMediaClick?: (m: MediaInfo) => void;
  }
>(({ value, onChange, placeholder, onUpload, onMediaClick }, ref) => {
  const el = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [busy, setBusy] = useState(false);

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

  function insertHtml(html: string) {
    const editor = el.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return;
    let range = savedRange.current;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
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
  }

  useImperativeHandle(ref, () => ({ focus: () => el.current?.focus(), insertHtml }));

  async function handleFile(file: File) {
    if (!onUpload) return;
    setBusy(true);
    try {
      const res = await onUpload(file);
      if (res) insertHtml(mediaEmbedHtml(res));
    } finally {
      setBusy(false);
    }
  }

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
        {onUpload && (
          <>
            <span className="rte-sep" />
            <button
              type="button"
              title="إرفاق ملف أو وسيط"
              disabled={busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
          </>
        )}
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
        onClick={(e) => {
          const m = mediaFromEl(e.target);
          if (m && onMediaClick) onMediaClick(m);
        }}
        suppressContentEditableWarning
      />
    </div>
  );
});

RichEditor.displayName = 'RichEditor';
export default RichEditor;

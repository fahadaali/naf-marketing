import type { ReactNode } from 'react';
import Modal from './Modal';

/* تأكيدٌ في نافذة المنصة لا في مربّع المتصفح.

   `confirm()` يفتح مربّعاً بخطّ النظام لا بخطّنا، وأزراره «موافق/إلغاء»
   بلغة المتصفح لا بلغة المستخدم، ولا يقبل عنواناً ولا وصفاً ولا زرّاً
   باسم الفعل — فيسقط منه كلّ ما يفرضه `naf-terms.md` §٤ دفعةً واحدة.
   ولا يتبع الاتجاه ولا الوضع الفاتح والداكن.

   والشكل من §٤ حرفياً: عنوانٌ يسمّي الفعل، وجملةٌ تقول ما سيحدث،
   وزرّان — [إلغاء] وزرٌّ يحمل اسم الفعل لا «نعم». */
export default function ConfirmModal({
  title, message, actionLabel, danger, busy, onConfirm, onClose,
}: {
  title: string;
  message: ReactNode;
  actionLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ marginTop: 0, lineHeight: 1.9 }}>{message}</p>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className={danger ? 'btn danger' : 'btn'} disabled={busy} onClick={onConfirm}>
          {actionLabel}
        </button>
      </div>
    </Modal>
  );
}

/* طلبُ قيمةٍ من المستخدم، للسبب نفسه الذي أخرج `confirm`: `prompt`
   مربّعٌ بلا تحقّق ولا رسالة خطأ ولا خيارٍ ثانٍ بجانب الحقل — ويظهر
   معلّقاً في أعلى الشاشة بلا هوية. */
export function FieldModal({
  title, label, placeholder, type = 'text', actionLabel, initial, hint, error, onSubmit, onClose,
}: {
  title: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'url';
  actionLabel: string;
  initial?: string;
  hint?: ReactNode;
  error?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {/* `noValidate` مقصودة: تحقّق المتصفح المدمج يفتح فقاعةً بلغة
          المتصفح لا بلغة المستخدم — «Please enter a URL» — ويمنع
          الإرسال فلا تصل رسالتنا المسجّلة أصلاً. وهي العلّة نفسها التي
          أخرجت `prompt` من الشاشة. ويبقى `type` لأنه يختار لوحة
          مفاتيح الجوّال، والتحقّق لنا. */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const el = (e.currentTarget.elements.namedItem('value') as HTMLInputElement);
          onSubmit(el.value.trim());
        }}
      >
        <div className="field">
          <label htmlFor="field-modal-value">{label}</label>
          <input
            id="field-modal-value"
            name="value"
            className="input"
            type={type}
            defaultValue={initial || ''}
            placeholder={placeholder}
            // الحقل الوحيد في النافذة يأخذ التركيز فور فتحها
            autoFocus
          />
          {hint && <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '4px 0 0' }}>{hint}</p>}
          {error && <p className="err" style={{ fontSize: 'var(--text-xs)', margin: '4px 0 0' }}>{error}</p>}
        </div>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button type="submit" className="btn">{actionLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

import { useState, type RefObject } from 'react';
import {
  Bold, Italic, Underline, Link, Baseline, Highlighter, Eye, EyeOff,
} from 'lucide-react';
import { FieldModal } from './ConfirmModal';
import { ColorPickButton } from './ColorField';
import { parseMarks, applyCleanEdit, wrapClean, clearColorIn, toSource } from '../lib/markSource';
import type { Parsed } from '../lib/markSource';

/* شريط تنسيق فوق حقل نصّي عادي (textarea) لا فوق contentEditable.

   الكتلة تحفظ نصّاً خاماً بعلاماتٍ مغلقة، والمصيّر في
   src/services/inline.ts يحوّلها. فالشريط هنا يلفّ التحديد بالعلامة
   ولا يبني HTML — ولهذا يعمل على textarea عادي، ويبقى ما يكتبه
   الكاتب مقروءاً حتى لو لم يستعمل الشريط أصلاً.

   والعلامات مخفيّة افتراضاً: الحقل يعرض نصّاً نظيفاً، فالتحديد يأتي
   بإحداثياته لا بإحداثيات المصدر. `lib/markSource.ts` يترجم بينهما،
   وكل زرٍّ هنا يمرّ من هناك.

   الأيقونات الثمان مسجّلة في naf-icons.md — التنسيق داخل النصّ،
   وتخصيص المظهر، والإجراءات (إظهار وإخفاء). */

type Props = {
  areaRef: RefObject<HTMLTextAreaElement>;
  /** المصدر المعلَّم — هو ما يُخزَّن */
  value: string;
  parsed: Parsed;
  showMarks: boolean;
  onToggleMarks: () => void;
  onChange: (next: string) => void;
  onError?: (message: string) => void;
};

export default function InlineToolbar({
  areaRef, value, parsed, showMarks, onToggleMarks, onChange, onError,
}: Props) {
  const [linking, setLinking] = useState(false);
  const [linkErr, setLinkErr] = useState('');

  /** التحديد بإحداثيات ما يراه الكاتب. */
  const sel = () => {
    const el = areaRef.current;
    return el ? { s: el.selectionStart, e: el.selectionEnd } : { s: 0, e: 0 };
  };

  /** يعيد المؤشّر إلى الحقل محدِّداً المدى نفسه بعد التغيير. */
  const restore = (from: number, to: number) => {
    queueMicrotask(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(from, to);
    });
  };

  /* اللفّ بعلامةٍ يعمل في الوضعين: في وضع الإظهار الحقلُ هو المصدر
     فالإحداثيات واحدة، وفي وضع الإخفاء تُترجَم عبر الخريطة. */
  function wrap(open: string, close: string) {
    const { s, e } = sel();

    if (showMarks) {
      const picked = value.slice(s, e);
      onChange(value.slice(0, s) + open + picked + close + value.slice(e));
      restore(s + open.length, s + open.length + picked.length);
      return;
    }

    /* بلا تحديد تُدرَج كلمةٌ نائبة محدَّدة: علامةٌ فارغة لا يقرؤها
       المصيّر فتظهر حرفياً، والكاتب يظنّ الأداة معطوبة وهو لم يحدّد
       شيئاً. والنائبة محدَّدة فيكتب فوقها مباشرة. */
    if (s === e) {
      const word = 'نصّ';
      const withWord = applyCleanEdit(
        value, parsed, parsed.clean.slice(0, s) + word + parsed.clean.slice(s),
      );
      onChange(wrapClean(withWord, parseMarks(withWord), s, s + word.length, open, close));
      restore(s, s + word.length);
      return;
    }

    onChange(wrapClean(value, parsed, s, e, open, close));
    restore(s, e);
  }

  /* اللون يحلّ محلّ اللون ولا يتداخل معه.

     `{c:…|{h:…|نصّ}}` علامةٌ متداخلة لا يقرؤها المصيّر — متنُه
     `[^{}\n]+` يرفض القوس — فتصل القارئ حرفياً. ووقع هذا فعلاً عند
     تظليل كلمةٍ داخل فقرةٍ ملوّنة.

     فيُنزع اللون عن المدى أولاً ثم يُلفّ بالجديد. والمدى بإحداثيات
     النظيف، والنزعُ لا يمسّ الحروف — فتبقى صالحةً بعده.

     و`hex` فارغاً هو «الافتراضي»: نزعٌ بلا لفّ. وهو من القائمة نفسها
     لا من زرٍّ مستقلّ — `naf-terms.md` §١٤: «الافتراضي» خيارٌ ظاهر في
     كل قائمة لون. وكلُّ قائمةٍ تعيد نوعَها وحده. */
  const applyColor = (kind: 'c' | 'h', hex: string) => {
    const { s, e } = sel();

    if (!hex) {
      if (s === e) { onError?.('حدّد النصّ الذي تريد إعادته إلى الافتراضي'); return; }
      // في وضع الإظهار يحرّر الكاتب المصدر بيده، فالإحداثيات ليست نظيفة
      if (showMarks) { onError?.('أخفِ العلامات أولاً لإعادة اللون إلى الافتراضي'); return; }
      onError?.('');
      onChange(clearColorIn(value, parsed, s, e, kind));
      restore(s, e);
      return;
    }

    onError?.('');
    if (showMarks || s === e) return wrap(`{${kind}:${hex}|`, '}');
    const cleared = clearColorIn(value, parsed, s, e);
    onChange(wrapClean(cleared, parseMarks(cleared), s, e, `{${kind}:${hex}|`, '}'));
    restore(s, e);
  };

  function insertLink(href: string) {
    // نفس القائمة البيضاء في inline.ts. التحقق هنا يمنع الكتابة أصلاً
    // بدل أن يكتشف الكاتبُ صمتَ الرابط بعد الإرسال.
    if (!/^(?:https?:\/\/|mailto:)/i.test(href)) {
      setLinkErr('الرابط بلا عنوان. أدخل عنواناً يبدأ بـ https://.');
      return;
    }
    const { s, e } = sel();
    const label = (showMarks ? value : parsed.clean).slice(s, e) || 'رابط';

    if (showMarks) {
      onChange(`${value.slice(0, s)}[${label}](${href})${value.slice(e)}`);
    } else if (s === e) {
      const at = toSource(parsed, s, value);
      onChange(`${value.slice(0, at)}[${label}](${href})${value.slice(at)}`);
    } else {
      onChange(wrapClean(value, parsed, s, e, '[', `](${href})`));
    }

    setLinking(false);
    setLinkErr('');
    onError?.('');
    restore(s, s + label.length);
  }

  const marks: { icon: JSX.Element; title: string; run: () => void }[] = [
    { icon: <Bold size={20} />, title: 'غامق', run: () => wrap('**', '**') },
    { icon: <Italic size={20} />, title: 'مائل', run: () => wrap('*', '*') },
    { icon: <Underline size={20} />, title: 'تسطير', run: () => wrap('__', '__') },
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

      {/* «تظليل» لا «لون الخلفية»: الثانية مسجّلة لسطح الكتلة كلِّه
          (`PaintBucket`)، وهذه لكلماتٍ بعينها — naf-terms.md §١٤. */}
      <ColorPickButton icon={<Baseline size={20} />} label="لون النصّ" onPick={(hex) => applyColor('c', hex)} />
      <ColorPickButton icon={<Highlighter size={20} />} label="تظليل" onPick={(hex) => applyColor('h', hex)} />

      <div className="spacer" />

      {/* العلامة مخفيّة افتراضاً، والزرّ يكشفها لمن أرادها. والأيقونة
          تصف ما سيحدث عند الضغط لا ما هو قائم. */}
      <button
        type="button"
        title={showMarks ? 'إخفاء العلامات' : 'إظهار العلامات'}
        aria-label={showMarks ? 'إخفاء العلامات' : 'إظهار العلامات'}
        aria-pressed={showMarks}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={onToggleMarks}
      >
        {showMarks ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>

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

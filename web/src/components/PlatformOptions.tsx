// خيارات النشر لكل منصة في «نسخة كل منصة» — ما تتيحه المنصة فوق النص والوسيط.
//
// تُحفظ مع نسخة المنصة بزرّ «حفظ» نفسه، ويصفّيها الخادم بما تقبله كل منصة
// (`src/services/publishOptions.ts`). والقيم هنا بأسمائنا لا بأسماء المزوّد.

import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { DateTimePicker } from './DatePicker';
import { uploadMedia } from '../mediaUpload';

export type PlatformOptionsValue = {
  thread?: boolean;
  threadNumber?: boolean;
  story?: boolean;
  cta?: { type: string; url?: string };
  event?: { title: string; start: string; end: string };
  categoryId?: number;
  tags?: string[];
  subtitle?: { mediaId: string; language: 'ar' | 'en'; filename?: string };
};

/** المنصات التي لها خيارات هنا — وما سواها لا يُعرض له شيء. */
export const HAS_OPTIONS = new Set(['x', 'instagram', 'facebook', 'google', 'youtube']);

const CTA_LABELS: [string, string][] = [
  ['call', 'اتصال'],
  ['book', 'حجز'],
  ['learn_more', 'معرفة المزيد'],
  ['sign_up', 'تسجيل'],
];

/** معرّفات تصنيفات يوتيوب في واجهته البرمجية — وما لم يُختر منها يتركه يوتيوب لتصنيفه. */
const YOUTUBE_CATEGORY_LABELS: [number, string][] = [
  [22, 'الأشخاص والمدوّنات'],
  [25, 'الأخبار والسياسة'],
  [27, 'التعليم'],
  [28, 'العلوم والتكنولوجيا'],
];

/* موعد الفعالية يُكتب بتوقيت الرياض ويُحفظ لحظةً بـ UTC — كموعد الجدولة نفسه. */
const toIso = (local: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? new Date(`${local}:00+03:00`).toISOString() : '');
const toLocal = (iso: string) => (iso ? new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(0, 16) : '');

export default function PlatformOptions({
  platform, value, onChange, onError,
}: {
  platform: string;
  value: PlatformOptionsValue;
  onChange: (v: PlatformOptionsValue) => void;
  onError: (m: string) => void;
}) {
  const set = (patch: Partial<PlatformOptionsValue>) => onChange({ ...value, ...patch });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // الوسوم تُكتب نصّاً مفصولاً بفاصلة، وتُحفظ مصفوفة — فيبقى ما يُكتب كما كُتب حتى الحفظ
  const [tagsText, setTagsText] = useState((value.tags || []).join('، '));

  if (!HAS_OPTIONS.has(platform)) return null;

  async function pickSubtitle(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    onError('');
    try {
      const d = await uploadMedia<{ id: string; filename?: string }>(file);
      set({ subtitle: { mediaId: d.id, language: value.subtitle?.language || 'ar', filename: d.filename || file.name } });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="po-box">
      <div className="po-title">خيارات النشر</div>

      {platform === 'x' && (
        <>
          <label className="po-check">
            <input type="checkbox" className="chk" checked={!!value.thread}
              onChange={(e) => set({ thread: e.target.checked, threadNumber: e.target.checked ? value.threadNumber : false })} />
            انشره سلسلة
          </label>
          <label className="po-check">
            <input type="checkbox" className="chk" disabled={!value.thread} checked={!!value.threadNumber}
              onChange={(e) => set({ threadNumber: e.target.checked })} />
            رقّم أجزاءها
          </label>
          <p className="muted po-hint">يُقسَّم النص على منشوراتٍ متتابعة عند حدّ إكس، وتبقى الجملة كاملةً في جزئها.</p>
        </>
      )}

      {(platform === 'instagram' || platform === 'facebook') && (
        <>
          <label className="po-check">
            <input type="checkbox" className="chk" checked={!!value.story} onChange={(e) => set({ story: e.target.checked })} />
            انشره قصة
          </label>
          <p className="muted po-hint">القصة وسيطٌ واحد يختفي بعد يوم، ولا يظهر معه نصّ ولا تعليقٌ أول.</p>
        </>
      )}

      {platform === 'google' && (
        <>
          <div className="field po-field">
            <label htmlFor={`po-cta-${platform}`}>زرّ تحت المنشور</label>
            <select
              id={`po-cta-${platform}`}
              className="select"
              value={value.cta?.type || ''}
              onChange={(e) => set({ cta: e.target.value ? { type: e.target.value, url: value.cta?.url } : undefined })}
            >
              <option value="">بلا زرّ</option>
              {CTA_LABELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          {value.cta && value.cta.type !== 'call' && (
            <div className="field po-field">
              <label htmlFor={`po-url-${platform}`}>رابط الزرّ</label>
              <input id={`po-url-${platform}`} className="input" dir="ltr" placeholder="https://" value={value.cta.url || ''}
                onChange={(e) => set({ cta: { type: value.cta!.type, url: e.target.value } })} />
            </div>
          )}
          {value.cta?.type === 'call' && (
            <p className="muted po-hint">يتّصل الزرّ برقم الهاتف المسجّل في ملفّ النشاط على Google.</p>
          )}
          <label className="po-check">
            <input type="checkbox" className="chk" checked={!!value.event}
              onChange={(e) => set({ event: e.target.checked ? { title: '', start: '', end: '' } : undefined })} />
            فعالية
          </label>
          {value.event && (
            <div className="po-event">
              <div className="field po-field">
                <label htmlFor={`po-ev-${platform}`}>عنوان الفعالية</label>
                <input id={`po-ev-${platform}`} className="input" maxLength={58} value={value.event.title}
                  onChange={(e) => set({ event: { ...value.event!, title: e.target.value } })} />
              </div>
              <div className="field po-field">
                <label>تبدأ (بتوقيت الرياض)</label>
                <DateTimePicker value={toLocal(value.event.start)} onChange={(v) => set({ event: { ...value.event!, start: toIso(v) } })} />
              </div>
              <div className="field po-field">
                <label>تنتهي (بتوقيت الرياض)</label>
                <DateTimePicker value={toLocal(value.event.end)} onChange={(v) => set({ event: { ...value.event!, end: toIso(v) } })} />
              </div>
            </div>
          )}
        </>
      )}

      {platform === 'youtube' && (
        <>
          <div className="field po-field">
            <label htmlFor={`po-cat-${platform}`}>تصنيف يوتيوب</label>
            <select
              id={`po-cat-${platform}`}
              className="select"
              value={value.categoryId ? String(value.categoryId) : ''}
              onChange={(e) => set({ categoryId: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">يختاره يوتيوب</option>
              {YOUTUBE_CATEGORY_LABELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <div className="field po-field">
            <label htmlFor={`po-tags-${platform}`}>وسوم يوتيوب</label>
            <input
              id={`po-tags-${platform}`}
              className="input"
              placeholder="مفصولة بفاصلة"
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value);
                set({ tags: e.target.value.split(/[,،]/).map((t) => t.trim()).filter(Boolean) });
              }}
            />
          </div>
          <div className="field po-field">
            <label>ملف الترجمة</label>
            <input ref={fileRef} type="file" hidden accept=".srt,.sbv" onChange={(e) => { pickSubtitle(e.target.files?.[0]); e.target.value = ''; }} />
            {value.subtitle ? (
              <div className="row po-row">
                <bdi className="po-file">{value.subtitle.filename || value.subtitle.mediaId}</bdi>
                <select
                  className="select po-lang"
                  aria-label="لغة الترجمة"
                  value={value.subtitle.language}
                  onChange={(e) => set({ subtitle: { ...value.subtitle!, language: e.target.value === 'en' ? 'en' : 'ar' } })}
                >
                  <option value="ar">العربية</option>
                  <option value="en">الإنجليزية</option>
                </select>
                {/* حذفُ المرفق قبل النشر — `Trash2` كما في `naf-icons.md`، و`X` للإغلاق وحده */}
                <button type="button" className="btn sm ghost" aria-label="حذف ملف الترجمة" onClick={() => set({ subtitle: undefined })}>
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <button type="button" className="btn sm ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> {uploading ? 'جارٍ الرفع…' : 'رفع ملف ترجمة'}
              </button>
            )}
            <p className="muted po-hint">ملف <bdi>SRT</bdi> أو <bdi>SBV</bdi> بتوقيت المقطع.</p>
          </div>
        </>
      )}
    </div>
  );
}

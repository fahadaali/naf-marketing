import { useEffect, useRef, useState } from 'react';
import {
  LayoutTemplate, FilePlus2, Import, FileJson, FileCode2, Trash2, Save, FileOutput,
} from 'lucide-react';
import { api } from '../api';
import { isolate } from '../lib/format';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';

/* ===== معرض القوالب =====

   صنفان يظهران معاً ولا يختلطان — `naf-terms.md` §١٤: قالبٌ جاهز
   يُشحن مع المنصة ولا يُحذف، وقالبٌ محفوظ يكتبه الفريق ويحذفه صاحبه.
   والقارئ الذي لا يفرّق بينهما يبحث عن زرّ حذفٍ لا يوجد.

   و«البدء من الصفر» خيارٌ ظاهر لا غيابُ خيار: نافذةٌ تعرض القوالب
   وحدها تجعل الكاتب يبحث عن طريقةٍ لتجاوزها. */

type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  origin: 'builtin' | 'saved' | 'imported' | 'imported_html';
  blocks: number;
  creator_name?: string | null;
};

const ORIGIN_NOTE: Record<TemplateSummary['origin'], string> = {
  builtin: 'قالب جاهز',
  saved: 'قالب محفوظ',
  imported: 'مستورد',
  imported_html: 'مستورد من HTML',
};

function TemplateCard({
  name, description, note, blocks, selected, onSelect,
}: {
  name: string; description: string; note: string; blocks?: number;
  selected: boolean; onSelect: () => void;
}) {
  return (
    <button type="button" className="tpl-card" aria-pressed={selected} onClick={onSelect}>
      <span className="tpl-name">{name}</span>
      <span className="tpl-desc">{description}</span>
      <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
        {note}{blocks !== undefined ? <> · <bdi>{blocks}</bdi> كتلة</> : null}
      </span>
    </button>
  );
}

/** نافذة إنشاء نشرة: العنوان، ثم من الصفر أو من قالب أو باستيراد ملف. */
export function NewNewsletterModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string, message: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [pick, setPick] = useState('');            // '' يعني البدء من الصفر
  const [builtin, setBuiltin] = useState<TemplateSummary[]>([]);
  const [saved, setSaved] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    api.get('/newsletters/meta/templates')
      .then((d) => { setBuiltin(d.builtin || []); setSaved(d.saved || []); })
      .catch((e) => setErr(e.message));
  }
  useEffect(load, []);

  async function create() {
    setBusy(true);
    setErr('');
    try {
      const d = await api.post('/newsletters/from-template', {
        template_id: pick || undefined,
        title: title.trim() || undefined,
      });
      onCreated(d.id, 'تم الإنشاء');
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  /* الاستيراد يصنع قالباً محفوظاً ثم يُختار — لا نشرةً مباشرة. فملفٌّ
     استُورد مرّةً يُبنى منه عددٌ بعد عدد، وهو الغرض من استيراده. */
  async function importFile(file: File) {
    setBusy(true);
    setErr('');
    setNote('');
    try {
      const payload = await file.text();
      const format = /\.html?$/i.test(file.name) || /^\s*<(?:!doctype|html)/i.test(payload) ? 'html' : 'naf';
      const d = await api.post('/newsletters/meta/templates/import', {
        format,
        payload,
        name: file.name.replace(/\.[^.]+$/, ''),
      });
      load();
      setPick(d.id);
      setNote(format === 'html'
        // ما لا يُنقل يُقال صراحةً — `naf-terms.md` §١٤
        // العدد معزولٌ اتجاهياً — رقمٌ في جملة عربية يُعاد ترتيبه بلا عزل
        ? `تم استيراد القالب — ${isolate(d.blocks)} كتلة. تخطيط القالب الأصلي وأنماطه الخاصة لا تُنقل، فراجع الكتل قبل الإرسال.`
        : 'تم استيراد القالب');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="نشرة جديدة" onClose={onClose}>
      <div className="field">
        <label htmlFor="nl-title">عنوان النشرة</label>
        <input
          id="nl-title"
          className="input"
          autoFocus
          value={title}
          placeholder="يظهر في القائمة وفي رابط المقالة"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="field">
        <label>البداية</label>
        <div className="grid cols-2" style={{ gap: 'var(--space-2)', alignItems: 'stretch' }}>
          <button type="button" className="tpl-card" aria-pressed={pick === ''} onClick={() => setPick('')}>
            <span className="tpl-name"><FilePlus2 size={16} /> البدء من الصفر</span>
            <span className="tpl-desc">نشرة بلا كتل — تبنيها بنفسك من شريط الكتل.</span>
          </button>

          {builtin.map((t) => (
            <TemplateCard
              key={t.id}
              name={t.name}
              description={t.description}
              note={ORIGIN_NOTE.builtin}
              blocks={t.blocks}
              selected={pick === t.id}
              onSelect={() => setPick(t.id)}
            />
          ))}
        </div>
      </div>

      {saved.length > 0 && (
        <div className="field">
          <label><LayoutTemplate size={16} /> قوالب محفوظة</label>
          <div className="grid cols-2" style={{ gap: 'var(--space-2)', alignItems: 'stretch' }}>
            {saved.map((t) => (
              <TemplateCard
                key={t.id}
                name={t.name}
                description={t.description || (t.creator_name ? `حفظه ${t.creator_name}` : '')}
                note={ORIGIN_NOTE[t.origin]}
                blocks={t.blocks}
                selected={pick === t.id}
                onSelect={() => setPick(t.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Import size={20} /> استيراد قالب
        </button>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          <FileJson size={16} style={{ verticalAlign: -3 }} /> ملف قالب ناف
          {' · '}
          <FileCode2 size={16} style={{ verticalAlign: -3 }} /> قالب HTML خارجي
        </span>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".json,.html,.htm,application/json,text/html"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }}
        />
      </div>

      {note && <p className="ok" style={{ fontSize: 'var(--text-xs)' }}>{note}</p>}
      {err && <p className="err" style={{ fontSize: 'var(--text-xs)' }}>{err}</p>}

      <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className="btn" disabled={busy} onClick={create}>إنشاء</button>
      </div>
    </Modal>
  );
}

/** نافذة القوالب داخل المحرر: حفظ النشرة قالباً، أو تصديرها ملفاً، أو حذف قالب. */
export function TemplatesModal({
  newsletterId, onClose, onMessage,
}: {
  newsletterId: string;
  onClose: () => void;
  onMessage: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saved, setSaved] = useState<TemplateSummary[]>([]);
  const [err, setErr] = useState('');
  const [removing, setRemoving] = useState<TemplateSummary | null>(null);

  function load() {
    api.get('/newsletters/meta/templates').then((d) => setSaved(d.saved || [])).catch(() => {});
  }
  useEffect(load, []);

  async function saveAsTemplate() {
    setErr('');
    if (!name.trim()) return setErr('أدخل اسماً للقالب');
    try {
      await api.post('/newsletters/meta/templates', {
        newsletter_id: newsletterId,
        name: name.trim(),
        description: description.trim(),
      });
      setName('');
      setDescription('');
      onMessage('تم حفظ القالب');
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function remove(t: TemplateSummary) {
    try {
      await api.del(`/newsletters/meta/templates/${t.id}`);
      onMessage('تم حذف القالب');
      load();
    } catch (e: any) { setErr(e.message); } finally { setRemoving(null); }
  }

  return (
    <Modal title="القوالب" onClose={onClose}>
      <div className="field">
        <label htmlFor="tpl-name">حفظ هذه النشرة كقالب</label>
        <input
          id="tpl-name"
          className="input"
          placeholder="اسم القالب"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          style={{ marginTop: 'var(--space-2)' }}
          placeholder="وصف مختصر (اختياري)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '6px 0 0' }}>
          يُحفظ المحتوى والسمة معاً. الوسائط المرفوعة لا تُنقل مع القالب.
        </p>
        <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button className="btn sm" onClick={saveAsTemplate}><Save size={20} /> حفظ كقالب</button>
          <a
            className="btn sm ghost"
            href={`/api/newsletters/${newsletterId}/export.json`}
            download
          >
            <FileOutput size={20} /> تصدير قالب
          </a>
        </div>
        {err && <p className="err" style={{ fontSize: 'var(--text-xs)', margin: '6px 0 0' }}>{err}</p>}
      </div>

      <div className="field">
        <label>القوالب المحفوظة</label>
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {saved.map((t) => (
            <div key={t.id} className="row" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{t.name}</div>
                <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                  {ORIGIN_NOTE[t.origin]} · <bdi>{t.blocks}</bdi> كتلة
                  {t.creator_name ? ` · ${t.creator_name}` : ''}
                </div>
              </div>
              <div className="spacer" />
              <button className="btn danger sm" aria-label={`حذف ${t.name}`} onClick={() => setRemoving(t)}>
                <Trash2 size={20} />
              </button>
            </div>
          ))}
          {saved.length === 0 && (
            <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              لا قوالب محفوظة بعد. احفظ المحتوى الحالي كقالب.
            </p>
          )}
        </div>
      </div>

      {removing && (
        <ConfirmModal
          title="حذف القالب"
          message="سيُحذف القالب ولن يظهر في المعرض. النشرات المبنيّة منه لا تتأثر."
          actionLabel="حذف"
          danger
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Modal>
  );
}

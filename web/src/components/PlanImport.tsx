import { useRef, useState } from 'react';
import { ChevronDown, Download, FileOutput, Import, Upload } from 'lucide-react';
import { api, FORMAT_LABELS } from '../api';
import Modal from './Modal';
import { Popover } from './Popover';
import { usePlanOptions } from './PlanItemModal';
import { platformLabel } from '../platforms';
import { parsePlatforms } from '../campaigns';
import { mapImportRow, rowsFromTable, type ImportRow } from '../planning';
import {
  PLAN_SHEET_NAME, PLAN_TEMPLATE_HEADERS, PLAN_TEMPLATE_WIDTHS, decodeCsv, parseCsv, planTemplateRows,
  requireTitleAndDay, toCsv,
} from '../planTemplate';
import { isolate } from '../lib/format';
import { saveBlob, saveText } from '../lib/download';
// مولّد Excel وقارئه من الخادم نفسه — مولّدٌ واحد للتقرير والقالب لا اثنان
import { buildXlsx } from '../../../src/services/xlsx';
import { readXlsx } from '../../../src/services/xlsxRead';

/* استيراد خطة المحتوى وتصديرها بقالب الاستيراد — naf-terms «قالب الاستيراد».
   تتشاركه «إدارة المحتوى» وطبقة «خطة المحتوى» في التقويم. */

export type PlanFileFormat = 'xlsx' | 'csv';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function saveRows(rows: string[][], fmt: PlanFileFormat, basename: string) {
  if (fmt === 'csv') {
    saveText(toCsv(rows), `${basename}.csv`, 'text/csv;charset=utf-8');
  } else {
    const bytes = buildXlsx([{ name: PLAN_SHEET_NAME, rows, rtl: true, widths: PLAN_TEMPLATE_WIDTHS }]);
    saveBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), `${basename}.xlsx`);
  }
}

/** يصدّر عناصر الخطة بأعمدة القالب نفسها، فيُعاد استيرادها بعد تعديلها. */
export function exportPlanFile(
  posts: readonly Record<string, any>[], fmt: PlanFileFormat, basename: string, labels?: Record<string, string>,
) {
  const rows = planTemplateRows(posts, {
    format: (k) => FORMAT_LABELS[k] || k,
    platform: (k) => platformLabel(k, labels),
  });
  saveRows(rows, fmt, basename);
}

/** قائمة «تصدير» بخياريها المسجّلين Excel وCSV. */
export function PlanExportMenu({ onExport, disabled }: { onExport: (fmt: PlanFileFormat) => void; disabled?: boolean }) {
  return (
    <Popover
      render={({ toggle }) => (
        <button type="button" className="btn ghost sm" onClick={toggle} disabled={disabled}>
          <FileOutput size={20} /> تصدير <ChevronDown size={20} />
        </button>
      )}
    >
      {({ close }) => (
        <div className="menu">
          <button type="button" onClick={() => { onExport('xlsx'); close(); }}>Excel</button>
          <button type="button" onClick={() => { onExport('csv'); close(); }}>CSV</button>
        </div>
      )}
    </Popover>
  );
}

export type PlanImportResult = { created: number; unmatched: number; skipped: number };

/** نصّ نتيجة الاستيراد — نجاحه، وما لم يُطابَق، وما تُرك من صفوف. */
export function importSummary(r: PlanImportResult): string {
  return [
    `تم استيراد ${isolate(r.created)} عنصراً`,
    r.unmatched ? `لم تُطابَق ${isolate(r.unmatched)} قيمة فتُركت فارغة.` : '',
    r.skipped ? `صفوف متروكة لنقص العنوان أو التاريخ: ${isolate(r.skipped)}` : '',
  ].filter(Boolean).join(' · ');
}

/** عنصر JSON ← صفّ استيراد: ما يصدّره JSON (معرّفات ومنصاتٌ JSON) وما يُكتب يدوياً (أسماء). */
function fromJson(x: any): ImportRow {
  const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));
  const plats = Array.isArray(x.planned_platforms) ? x.planned_platforms : parsePlatforms(x.planned_platforms);
  return {
    title: str(x.title),
    body: str(x.body ?? x.content),
    format: str(x.format ?? x.content_type),
    planned_on: str(x.planned_on),
    planned_platforms: plats.length ? plats.join(',') : str(x.planned_platforms),
    assignee: str(x.assignee_id ?? x.assignee ?? x.assignee_name),
    pillar: str(x.pillar),
    brief: str(x.brief),
    campaign: str(x.campaign_id ?? x.campaign ?? x.campaign_name),
  };
}

/* الحقول تُطابَق عند الاستيراد لا عند اختيار الملف: الخيارات (المنصات والمسؤولون
   والسلاسل والحملات) تصل بعد فتح النافذة، والملفّ قد يُختار قبلها.

   والإلزاميّ العنوان والتاريخ في ملف الجدول (Excel وCSV) وحده. وJSON نسخةٌ كاملة
   يصدّرها «إدارة المحتوى»، فيها مسوداتٌ بلا يوم لا يُعقل تركها عند إعادتها. */
export default function PlanImportModal({ onClose, onDone }: {
  onClose: () => void; onDone: (r: PlanImportResult) => void;
}) {
  const [items, setItems] = useState<ImportRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const options = usePlanOptions();

  async function onFile(f: File) {
    setErr(''); setItems([]); setSkipped(0);
    const name = f.name.toLowerCase();
    let rows: ImportRow[];
    let left = 0;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (name.endsWith('.json')) {
        const j = JSON.parse(new TextDecoder().decode(bytes));
        rows = (Array.isArray(j) ? j : j.items || []).map(fromJson).filter((r: ImportRow) => r.title);
      } else if (name.endsWith('.xlsx') || name.endsWith('.csv')) {
        const table = name.endsWith('.xlsx') ? await readXlsx(bytes) : parseCsv(decodeCsv(bytes));
        const checked = requireTitleAndDay(rowsFromTable(table));
        rows = checked.valid;
        left = checked.skipped;
      } else {
        setErr('صيغة الملف غير مدعومة. الصيغ المقبولة: Excel وCSV وJSON');
        return;
      }
    } catch {
      setErr('تعذّرت قراءة الملف. تأكّد أنه على قالب الاستيراد ثم أعد المحاولة.');
      return;
    }
    if (!rows.length) {
      setErr('لا صفّ صالحاً في الملف. العنوان والتاريخ إلزاميان في كل صفّ.');
      return;
    }
    setItems(rows);
    setSkipped(left);
  }

  async function submit() {
    setBusy(true); setErr('');
    const ctx = {
      platforms: options.platforms.map((k) => ({ key: k, label: platformLabel(k, options.labels) })),
      assignees: options.assignees,
      pillars: options.pillars,
      campaigns: options.campaigns,
      formats: FORMAT_LABELS,
    };
    let unmatched = 0;
    const mapped = items.map((row) => {
      const r = mapImportRow(row, ctx);
      unmatched += r.unmatched;
      return r.item;
    });
    try {
      const d = await api.post('/posts/import', { items: mapped });
      onDone({ created: d.created, unmatched, skipped });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="استيراد" onClose={onClose}>
      {/* naf-terms «نصوص خطة المحتوى» ← شرح الاستيراد */}
      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 0 }}>
        ارفع ملف Excel أو CSV على قالب الاستيراد. العنوان والتاريخ إلزاميان، وما سواهما يُترك فارغاً إن شئت. والتاريخ بصيغة <bdi>2026/10/31</bdi>.
      </p>
      <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>{PLAN_TEMPLATE_HEADERS.join('، ')}</p>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.csv,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }}
      />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={20} /> اختيار ملف</button>
        <Popover
          render={({ toggle }) => (
            <button type="button" className="btn ghost" onClick={toggle}>
              <Download size={20} /> تنزيل قالب الاستيراد <ChevronDown size={20} />
            </button>
          )}
        >
          {({ close }) => (
            <div className="menu">
              <button type="button" onClick={() => { saveRows([[...PLAN_TEMPLATE_HEADERS]], 'xlsx', 'content-plan-template'); close(); }}>Excel</button>
              <button type="button" onClick={() => { saveRows([[...PLAN_TEMPLATE_HEADERS]], 'csv', 'content-plan-template'); close(); }}>CSV</button>
            </div>
          )}
        </Popover>
      </div>

      {items.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="ok">جاهز للاستيراد: <bdi>{items.length}</bdi> عنصراً</p>
          {skipped > 0 && <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>صفوف متروكة لنقص العنوان أو التاريخ: <bdi>{skipped}</bdi></p>}
          <ul className="import-preview">
            {items.slice(0, 20).map((it, i) => <li key={i}>{it.title}</li>)}
          </ul>
        </div>
      )}
      {err && <p className="err">{err}</p>}
      <button type="button" className="btn" style={{ marginTop: 12 }} disabled={!items.length || busy} onClick={submit}>
        <Import size={20} /> {items.length ? <>استيراد <bdi>{items.length}</bdi> عنصراً</> : 'استيراد'}
      </button>
    </Modal>
  );
}

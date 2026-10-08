import { useState } from 'react';
import type { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { SOURCE_LABELS, displayStatus } from '../api';
import StatusBadge from './StatusBadge';
import { PlatformIcons, platformsOf } from '../platforms';
import { KANBAN_COLS } from '../contentFlow';

export { moveAction, opensScheduling } from '../contentFlow';

/* لوحة المحتوى — أعمدةٌ بحالاته، بالسحب والإفلات.

   كانت داخل pages/PostsList.tsx، ونسخةٌ ثانيةٌ مختصرة داخل صفحة الحملات
   تعرض خمسةً من ثمانية: منشورٌ «معتمد» أو «مرفوض» أو «مؤرشف» لا يظهر في
   أي عمود، والبطاقة تقول «٥ منشور» واللوحة تعرض اثنين بلا إشارة. جدولان
   للحالات في ملفّين هما علّةُ ذلك بعينها، فصارا واحداً — وهو اليوم في
   `contentFlow.ts` مع قاعدة النقل، حيث يصلهما الاختبار. */

/** الأعمدة التي تبقى ظاهرةً وإن خلت — بقيّتها، و«فكرة» منها، تظهر عند أول عنصر فيها. */
const ALWAYS_SHOWN = ['draft', 'pending_marketing', 'pending_gm', 'scheduled', 'published'];

export default function PostKanban({
  rows,
  onOpen,
  onMove,
  showCampaign = true,
  cardAction,
}: {
  rows: any[];
  onOpen: (post: any) => void;
  onMove: (post: any, toCol: string) => void;
  /** اسم الحملة على البطاقة — يُخفى داخل صفحة الحملة نفسها فهو مكرّر. */
  showCampaign?: boolean;
  cardAction?: (post: any) => ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const cols = KANBAN_COLS.map((col) => ({
    ...col,
    items: rows.filter((p) => col.statuses.includes(displayStatus(p))),
  })).filter((c) => c.items.length > 0 || ALWAYS_SHOWN.includes(c.key));

  function handleDrop(colKey: string) {
    const post = rows.find((p) => p.id === dragId);
    setDragId(null);
    setOverCol(null);
    if (post) onMove(post, colKey);
  }

  return (
    <div className="kanban-scroll">
      <p className="muted kanban-hint">
        <Lightbulb size={16} /> اسحب البطاقة إلى العمود التالي لتحريك مرحلتها (ضمن التسلسل المسموح).
      </p>
      <div className="kanban-board">
        {cols.map((col) => (
          <div
            key={col.key}
            className={`kanban-col board-col ${overCol === col.key && dragId ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
          >
            <h4 className="row">
              <StatusBadge status={col.key} />
              <div className="spacer" />
              <span className="muted"><bdi>{col.items.length}</bdi></span>
            </h4>
            {col.items.map((p) => (
              <div
                key={p.id}
                className={`kanban-card ${dragId === p.id ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(p.id)}
                onDragEnd={() => { setDragId(null); setOverCol(null); }}
                onClick={() => onOpen(p)}
              >
                <PlatformIcons platforms={platformsOf(p)} className="platforms-above" />
                <div className="kanban-card-title">{p.title}</div>
                <div className="row kanban-card-meta">
                  <span className="muted">{SOURCE_LABELS[p.source] || p.source}</span>
                  {showCampaign && p.campaign_name && <span className="badge gray">{p.campaign_name}</span>}
                  <div className="spacer" />
                  <span className="muted">{p.author_name}</span>
                </div>
                {cardAction && (
                  <div className="row kanban-card-meta" onClick={(e) => e.stopPropagation()}>
                    {cardAction(p)}
                  </div>
                )}
              </div>
            ))}
            {col.items.length === 0 && <p className="muted kanban-empty">—</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

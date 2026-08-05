import { useEffect, useState } from 'react';
import { Images, Upload } from 'lucide-react';
import { api } from '../api';
import Modal from './Modal';

/* منتقي صورة من مكتبة الوسائط.

   كتلة الصورة في النشرة كانت تطلب من الكاتب لصق رابط نصّي بيده،
   والمكتبة قائمة في /api/media منذ البداية بالرفع والفهرس والتوليد.
   هذا وصلٌ لما هو موجود لا بناءُ مكتبة جديدة.

   الصور وحدها تُعرض: كتلة الصورة لا تعرض PDF ولا صوتاً، وعرض ما لا
   يُدرَج دعوةٌ إلى خطأ. */

export type PickedMedia = { id: string; filename: string | null };

type Asset = { id: string; mime_type: string | null; filename: string | null };

export default function MediaPicker({ onPick, onClose }: {
  onPick: (m: PickedMedia) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api.get('/media')
      .then((d) => setItems((d.media || []).filter((m: Asset) => (m.mime_type || '').startsWith('image/'))))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function upload(file: File) {
    setBusy(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      const d = await api.upload('/media', form);
      onPick({ id: d.id, filename: d.filename ?? file.name });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="مكتبة الوسائط" onClose={onClose}>
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
          <Upload size={20} /> رفع
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = '';
            }}
          />
        </label>
        <div className="spacer" />
        {err && <span className="err" style={{ fontSize: 'var(--text-xs)' }}>{err}</span>}
      </div>

      {loading && <p className="muted">جارٍ التحميل…</p>}

      {!loading && items.length === 0 && (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          <Images size={20} style={{ verticalAlign: -4, marginInlineEnd: 6 }} />
          لا صورة في المكتبة بعد. ارفع أول صورة.
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 'var(--space-2)',
          maxHeight: 420,
          overflowY: 'auto',
        }}
      >
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            className="media-card"
            style={{ display: 'block', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', cursor: 'pointer', background: 'var(--card)' }}
            title={m.filename || m.id}
            onClick={() => onPick({ id: m.id, filename: m.filename })}
          >
            <img
              src={`/api/media/${m.id}`}
              alt={m.filename || ''}
              loading="lazy"
              style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
            />
            <span
              className="muted"
              style={{ display: 'block', fontSize: 'var(--text-xs)', padding: 'var(--space-2)', textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              <bdi>{m.filename || m.id}</bdi>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

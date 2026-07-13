import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import type { MediaInfo } from '../mediaEmbed';

// نافذة استعراض عائمة فوق المحتوى: صور/فيديو/صوت/PDF مباشرةً، مع أزرار تنزيل وإغلاق.
export function MediaViewer({ media, onClose }: { media: MediaInfo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { url, name, kind } = media;
  let body;
  if (kind === 'image') body = <img src={url} className="mv-media" alt={name} />;
  else if (kind === 'video') body = <video src={url} className="mv-media" controls autoPlay />;
  else if (kind === 'audio') body = <audio src={url} controls style={{ width: '90%' }} />;
  else if (kind === 'pdf') body = <iframe src={url} className="mv-pdf" title={name} />;
  else body = <div className="mv-file">لا يمكن استعراض هذا النوع مباشرةً في المتصفح — استخدم زر التنزيل.</div>;

  return createPortal(
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-box" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">{name}</div>
        <div className="mv-body">{body}</div>
        <div className="mv-bar">
          <a className="btn" href={`${url}?download=1`} download={name}>
            <Download size={16} /> تنزيل
          </a>
          <button className="btn ghost" onClick={onClose}>
            <X size={16} /> إغلاق
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

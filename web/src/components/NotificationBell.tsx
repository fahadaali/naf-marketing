import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Popover } from './Popover';
import { api, formatRiyadh } from '../api';

// جرس الإشعارات — يُحدَّث دورياً، مع نافذة منبثقة تعرض آخر الإشعارات وزر «تعليم الكل مقروءاً».
export default function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  function load() {
    api.get('/notifications').then((d) => { setItems(d.notifications); setUnread(d.unread); }).catch(() => {});
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, []);

  async function open(n: any, close: () => void) {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`);
    close();
    load();
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    await api.post('/notifications/read-all');
    load();
  }

  return (
    <Popover
      render={({ toggle }) => (
        <button className="icon-btn" onClick={toggle} title="الإشعارات" style={{ position: 'relative' }}>
          <Bell size={17} />
          {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
    >
      {({ close }) => (
        <div className="menu notif-menu">
          <div className="row" style={{ padding: '4px 6px 8px' }}>
            <strong style={{ fontSize: 14 }}>الإشعارات</strong>
            <div className="spacer" />
            {unread > 0 && (
              <button className="btn ghost sm" onClick={markAll}><CheckCheck size={13} /> تعليم الكل</button>
            )}
          </div>
          <div style={{ maxHeight: 340, overflow: 'auto' }}>
            {items.map((n) => (
              <div
                key={n.id}
                className="notif-item"
                style={{ background: n.read_at ? 'transparent' : 'hsl(var(--primary-soft))' }}
                onClick={() => open(n, close)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                {n.body && <div className="muted" style={{ fontSize: 12 }}>{n.body}</div>}
                <div className="muted" style={{ fontSize: 11 }}>{formatRiyadh(n.created_at)}</div>
              </div>
            ))}
            {items.length === 0 && <p className="muted" style={{ padding: 16, textAlign: 'center', margin: 0 }}>لا توجد إشعارات</p>}
          </div>
        </div>
      )}
    </Popover>
  );
}

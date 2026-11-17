import { useEffect, useState } from 'react';
import PageLayout from '../../components/PageLayout';
import AdminSectionHeader from '../../components/AdminSectionHeader';
import { verifyToken } from '../../lib/discord';
import { SUPER_ADMIN_ID } from '../../lib/admins';
import { getDepartment } from '../../lib/departments';

const panel = {
  background: 'rgba(11,15,22,.72)',
  border: '1px solid rgba(148,163,184,.15)',
  borderRadius: 6,
  padding: 22,
  marginBottom: 16,
  color: '#e5e7eb'
};
const label = { color: '#7f8a9a', fontSize: 11, letterSpacing: 1, fontFamily: "'DM Mono', monospace", marginBottom: 6 };
const value = { color: '#f3f4f6', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const button = (color) => ({
  background: color === 'green' ? 'rgba(76,175,80,.12)' : 'rgba(220,53,69,.12)',
  border: `1px solid ${color === 'green' ? 'rgba(76,175,80,.5)' : 'rgba(220,53,69,.5)'}`,
  color: color === 'green' ? '#81c784' : '#ff7b88',
  borderRadius: 4, padding: '10px 16px', cursor: 'pointer', fontWeight: 700,
  fontFamily: "'DM Mono', monospace", fontSize: 12
});

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  const user = verifyToken(req.cookies?.token);
  if (!user) {
    return { redirect: { destination: '/start', permanent: false } };
  }
  if (String(user.id) !== SUPER_ADMIN_ID) {
    return { notFound: true };
  }
  return { props: {} };
}

const FIELD_LABELS = {
  fullName: 'Имя и статик',
  department: 'Отдел',
  currentRank: 'Текущий ранг',
  targetRank: 'Запрашиваемый ранг',
  isInstructor: 'Назначение инструктором',
  workLinks: 'Ссылки на проделанную работу'
};

const STATUS_LABELS = {
  all: 'Все заявки',
  pending: 'Ожидают',
  accepted: 'Одобрены',
  rejected: 'Отклонены'
};

function displayFieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'isInstructor') return value === 'yes' ? 'Да' : value === 'no' ? 'Нет' : String(value);
  if (key === 'department') {
    const department = getDepartment(value);
    return department ? `${department.emoji} ${department.name}` : String(value);
  }
  return String(value);
}

function renderFieldContent(key, value) {
  if (key !== 'workLinks' || !value) return displayFieldValue(key, value);
  const parts = String(value).split(/(https?:\/\/[^\s,]+)/gi);
  return parts.map((part, index) => /^https?:\/\//i.test(part)
    ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#81c784', textDecoration: 'underline', overflowWrap: 'anywhere' }}>{part}</a>
    : part);
}

export default function HrAuditPage() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setError('');
    try {
      const response = await fetch('/api/admin/hr-audit');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить заявки');
      setItems(data.items || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => setUser(d.user || null)).catch(() => {});
    load();
  }, []);

  const decide = async (item, decision) => {
    const reason = reasons[item.id] || '';
    if (decision === 'rejected' && !reason.trim()) {
      setError('Для отказа обязательно укажи причину.');
      return;
    }
    if (!window.confirm(decision === 'accepted' ? `Одобрить заявку №${item.number}?` : `Отклонить заявку №${item.number}?`)) return;
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/api/admin/hr-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, decision, reason })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить решение');
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry));
      if (data.notificationPending) setError('Решение сохранено, но Discord не подтвердил уведомление. Понадобится повторная отправка.');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const retryDelivery = async item => {
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/api/admin/hr-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'retry-delivery' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось повторить отправку');
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry));
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const retryNotification = async item => {
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/api/admin/hr-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'retry-notification' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось повторить уведомление');
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry));
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const status = item => item.status === 'pending' ? ['ОЖИДАЕТ', '#ffb74d'] : item.status === 'accepted' ? ['ОДОБРЕНО', '#81c784'] : ['ОТКЛОНЕНО', '#ff7b88'];
  const counts = items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
  const visibleItems = items.filter(item => {
    const statusMatches = statusFilter === 'all' || item.status === statusFilter;
    const haystack = [
      item.number, item.submitter?.username, item.submitter?.id,
      ...Object.values(item.data || {})
    ].join(' ').toLocaleLowerCase('ru-RU');
    return statusMatches && (!normalizedSearch || haystack.includes(normalizedSearch));
  });

  return (
    <PageLayout user={user}>
        <AdminSectionHeader title="Кадровый аудит" description="Тестовый реестр отчётов на повышение. Принимать решения пока может только владелец сайта." />
        <div style={{ ...panel, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div><div style={label}>ТЕСТОВЫЙ ДОСТУП</div><div style={value}>Разрешён только Discord ID 200102286473691139</div></div>
          <button onClick={load} style={{ ...button('green'), color: '#cbd5e1', borderColor: 'rgba(148,163,184,.3)', background: 'transparent' }}>ОБНОВИТЬ СПИСОК</button>
        </div>
        {error && <div role="alert" style={{ ...panel, borderColor: 'rgba(220,53,69,.5)', color: '#ff9aa4' }}>{error}</div>}
        <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12 }}>
          <div><div style={label}>ВСЕГО</div><div style={{ ...value, fontSize: 23, fontWeight: 800 }}>{items.length}</div></div>
          <div><div style={label}>ОЖИДАЮТ</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#ffb74d' }}>{counts.pending || 0}</div></div>
          <div><div style={label}>ОДОБРЕНО</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#81c784' }}>{counts.accepted || 0}</div></div>
          <div><div style={label}>ОТКЛОНЕНО</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#ff7b88' }}>{counts.rejected || 0}</div></div>
        </div>
        <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(160px,240px)', gap: 12 }}>
          <input aria-label="Поиск по заявкам" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по номеру, имени, Discord ID, отделу…" style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', background: '#080c12', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4, color: '#fff', font: '14px inherit' }} />
          <select aria-label="Фильтр по статусу" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: '100%', padding: '11px 12px', background: '#080c12', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4, color: '#fff', font: '14px inherit' }}>
            {Object.entries(STATUS_LABELS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </select>
        </div>

        {loading ? <div style={panel}>Загрузка реестра…</div> : items.length === 0 ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>Заявок пока нет. Новые отчёты на повышение появятся здесь.</div> : visibleItems.length === 0 ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>По заданным условиям заявки не найдены.</div> : visibleItems.map(item => {
          const [statusText, statusColor] = status(item);
          return <section key={item.id} style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: '#fff' }}>Заявка №{item.number}</h2>
              <span style={{ color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '5px 9px', fontSize: 11, fontWeight: 700 }}>{statusText}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginBottom: 18 }}>
              <div><div style={label}>ЗАЯВИТЕЛЬ</div><div style={value}>{item.data?.fullName || item.submitter?.username || 'Не указано'}</div><div style={{ ...value, color: '#9ca3af', fontSize: 12 }}>Discord: {item.submitter?.id || '—'}</div></div>
              <div><div style={label}>ОТДЕЛ</div><div style={value}>{displayFieldValue('department', item.data?.department)}</div></div>
              <div><div style={label}>ОТПРАВЛЕНО</div><div style={value}>{item.submittedAt ? new Date(item.submittedAt).toLocaleString('ru-RU') : '—'}</div></div>
              <div><div style={label}>ТЕКУЩИЙ / НОВЫЙ РАНГ</div><div style={value}>{item.data?.currentRank || '—'} → {item.data?.targetRank || '—'}</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              {Object.entries(item.data || {}).filter(([key]) => !['fullName','department','currentRank','targetRank'].includes(key)).map(([key, val]) => <div key={key}><div style={label}>{FIELD_LABELS[key] || key}</div><div style={value}>{renderFieldContent(key, val)}</div></div>)}
            </div>
            {item.status === 'pending' ? <div style={{ marginTop: 22, borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 18 }}>
              <label style={{ ...label, display: 'block' }}>ПРИЧИНА ОТКАЗА (ОБЯЗАТЕЛЬНО ПРИ ОТКЛОНЕНИИ)</label>
              <textarea value={reasons[item.id] || ''} onChange={e => setReasons(prev => ({ ...prev, [item.id]: e.target.value }))} maxLength={1000} rows={3} placeholder="Укажи причину, если отклоняешь заявку…" style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 14px', padding: 12, resize: 'vertical', background: '#080c12', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4, color: '#fff', font: '14px inherit' }} />
              {item.deliveryPending && <div style={{ marginBottom: 12, color: '#ffb74d' }}>Заявка сохранена, но не доставлена в Discord.</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {item.deliveryPending && <button disabled={busy === item.id} onClick={() => retryDelivery(item)} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ПОВТОРИТЬ ОТПРАВКУ</button>}
                <button disabled={busy === item.id || item.deliveryPending} onClick={() => decide(item, 'accepted')} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ОДОБРИТЬ</button>
                <button disabled={busy === item.id || item.deliveryPending} onClick={() => decide(item, 'rejected')} style={{ ...button('red'), opacity: busy === item.id ? .5 : 1 }}>ОТКЛОНИТЬ</button>
              </div>
            </div> : <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.12)' }}>
              <div style={label}>РЕШЕНИЕ</div><div style={value}>{item.reviewer?.username} · {item.reviewer?.id} · {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString('ru-RU') : ''}</div>
              {item.reason && <><div style={{ ...label, marginTop: 12 }}>ПРИЧИНА</div><div style={value}>{item.reason}</div></>}
              {item.notificationPending && <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: '#ffb74d' }}>Уведомление Discord ожидает повторной отправки.</span>
                <button disabled={busy === item.id} onClick={() => retryNotification(item)} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ПОВТОРИТЬ УВЕДОМЛЕНИЕ</button>
              </div>}
            </div>}
            {Array.isArray(item.history) && item.history.length > 0 && <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.12)' }}>
              <div style={{ ...label, marginBottom: 10 }}>ИСТОРИЯ ДЕЙСТВИЙ</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {item.history.slice().reverse().map((entry, index) => <div key={`${item.id}-history-${index}`} style={{ ...value, fontSize: 12, color: '#aeb8c7' }}>
                  <strong style={{ color: '#e5e7eb' }}>{entry.action === 'submitted' ? 'Заявка создана' : entry.action === 'accepted' ? 'Заявка одобрена' : entry.action === 'rejected' ? 'Заявка отклонена' : entry.action === 'delivered' ? 'Доставлено в Discord' : entry.action === 'delivery_pending' ? 'Ожидает доставки' : entry.action === 'notification_sent' ? 'Уведомление отправлено' : entry.action === 'notification_pending' ? 'Уведомление ожидает отправки' : entry.action === 'notification_retry_failed' ? 'Повтор уведомления не удался' : entry.action === 'delivery_retry_failed' ? 'Повтор доставки не удался' : entry.action}</strong>
                  {' · '}{entry.at ? new Date(entry.at).toLocaleString('ru-RU') : 'Время не указано'}
                  {' · Discord ID: '}{entry.userId || 'не указан'}
                  {entry.reason && <div style={{ marginTop: 3, color: '#cbd5e1' }}>Причина: {entry.reason}</div>}
                </div>)}
              </div>
            </div>}
          </section>;
        })}
    </PageLayout>
  );
}

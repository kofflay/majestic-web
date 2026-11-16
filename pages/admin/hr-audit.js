import { useEffect, useState } from 'react';
import PageLayout from '../../components/PageLayout';
import AdminSectionHeader from '../../components/AdminSectionHeader';

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

export default function HrAuditPage() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('promotion_report');

  const load = async () => {
    setError('');
    try {
      const params = new URLSearchParams({ type: typeFilter });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (departmentFilter) params.set('department', departmentFilter);
      const response = await fetch('/api/admin/hr-audit?' + params.toString());
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

  const status = item => item.status === 'pending' ? ['ОЖИДАЕТ', '#ffb74d'] : item.status === 'accepted' ? ['ОДОБРЕНО', '#81c784'] : ['ОТКЛОНЕНО', '#ff7b88'];

  return (
    <PageLayout user={user}>
        <AdminSectionHeader title="Кадровый аудит" description="Тестовый реестр отчётов на повышение. Принимать решения пока может только владелец сайта." />
        <div style={{ ...panel, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div><div style={label}>ТЕСТОВЫЙ ДОСТУП</div><div style={value}>Разрешён только Discord ID 200102286473691139</div></div>
          <button onClick={load} style={{ ...button('green'), color: '#cbd5e1', borderColor: 'rgba(148,163,184,.3)', background: 'transparent' }}>ОБНОВИТЬ СПИСОК</button>
        </div>
        <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          <label style={label}>ТИП ФОРМЫ
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10, background: '#080c12', color: '#fff', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4 }}>
              <option value="promotion_report">Отчёты о повышении</option>
              <option value="department_transfer" disabled>Переводы в отдел (подготовлено)</option>
            </select>
          </label>
          <label style={label}>ПОИСК ПО НОМЕРУ / АВТОРУ
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Например, 12 или username" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 10, background: '#080c12', color: '#fff', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4 }} />
          </label>
          <label style={label}>СТАТУС
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10, background: '#080c12', color: '#fff', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4 }}>
              <option value="">Все статусы</option><option value="pending">Ожидает</option><option value="accepted">Одобрено</option><option value="rejected">Отклонено</option>
            </select>
          </label>
          <label style={label}>ОТДЕЛ
            <input value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)} placeholder="ID отдела" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 10, background: '#080c12', color: '#fff', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4 }} />
          </label>
          <button onClick={load} style={{ ...button('green'), alignSelf: 'end' }}>ПРИМЕНИТЬ ФИЛЬТРЫ</button>
        </div>
        {error && <div role="alert" style={{ ...panel, borderColor: 'rgba(220,53,69,.5)', color: '#ff9aa4' }}>{error}</div>}
        {loading ? <div style={panel}>Загрузка реестра…</div> : items.length === 0 ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>Заявок пока нет. Новые заявки на повышение появятся здесь.</div> : items.map(item => {
          const [statusText, statusColor] = status(item);
          return <section key={item.id} style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: '#fff' }}><a href={"/admin/hr-audit/" + item.number} style={{ color: 'inherit' }}>Отчёт о повышении №{item.number} ↗</a></h2>
              <span style={{ color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '5px 9px', fontSize: 11, fontWeight: 700 }}>{statusText}</span>
            </div>
            <div style={{ ...label }}>ЗАЯВИТЕЛЬ</div><div style={{ ...value, marginBottom: 14 }}>{item.submitter?.username} · {item.submitter?.id}</div>
            <div style={{ ...label }}>ОТПРАВЛЕНО</div><div style={{ ...value, marginBottom: 18 }}>{new Date(item.submittedAt).toLocaleString('ru-RU')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              {Object.entries(item.data || {}).map(([key, val]) => <div key={key}><div style={label}>{key}</div><div style={value}>{String(val)}</div></div>)}
            </div>
            {item.status === 'pending' ? <div style={{ marginTop: 22, borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 18 }}>
              <label style={{ ...label, display: 'block' }}>ПРИЧИНА ОТКАЗА (ОБЯЗАТЕЛЬНО ПРИ ОТКЛОНЕНИИ)</label>
              <textarea value={reasons[item.id] || ''} onChange={e => setReasons(prev => ({ ...prev, [item.id]: e.target.value }))} maxLength={1000} rows={3} placeholder="Укажи причину, если отклоняешь заявку…" style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 14px', padding: 12, resize: 'vertical', background: '#080c12', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4, color: '#fff', font: '14px inherit' }} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button disabled={busy === item.id} onClick={() => decide(item, 'accepted')} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ОДОБРИТЬ</button>
                <button disabled={busy === item.id} onClick={() => decide(item, 'rejected')} style={{ ...button('red'), opacity: busy === item.id ? .5 : 1 }}>ОТКЛОНИТЬ</button>
              </div>
            </div> : <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.12)' }}>
              <div style={label}>РЕШЕНИЕ</div><div style={value}>{item.reviewer?.username} · {item.reviewer?.id} · {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString('ru-RU') : ''}</div>
              {item.reason && <><div style={{ ...label, marginTop: 12 }}>ПРИЧИНА</div><div style={value}>{item.reason}</div></>}
              {item.notificationPending && <div style={{ color: '#ffb74d', marginTop: 10 }}>Уведомление Discord ожидает повторной отправки.</div>}
            </div>}
          </section>;
        })}
    </PageLayout>
  );
}

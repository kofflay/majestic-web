import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../../components/PageLayout';
import AdminSectionHeader from '../../../components/AdminSectionHeader';

const panel = { background: 'rgba(11,15,22,.72)', border: '1px solid rgba(148,163,184,.15)', borderRadius: 6, padding: 22, marginBottom: 16, color: '#e5e7eb' };
const label = { color: '#7f8a9a', fontSize: 11, letterSpacing: 1, fontFamily: "'DM Mono', monospace", marginBottom: 6 };
const value = { color: '#f3f4f6', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

export default function HrAuditDetailPage() {
  const router = useRouter(); const { number } = router.query;
  const [user, setUser] = useState(null); const [item, setItem] = useState(null); const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [comment, setComment] = useState('');
  const load = async () => { if (!number) return; try { const response = await fetch('/api/admin/hr-audit?type=promotion_report&id=' + encodeURIComponent(number)); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось загрузить отчёт'); setItem(data.item); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { fetch('/api/me').then(r => r.json()).then(d => setUser(d.user || null)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [number]);
  const decide = async decision => { if (decision === 'rejected' && !reason.trim()) { setError('Укажите обязательную причину отказа.'); return; } if (!window.confirm(decision === 'accepted' ? 'Одобрить отчёт?' : 'Отклонить отчёт?')) return; setBusy(true); setError(''); try { const response = await fetch('/api/admin/hr-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, decision, reason }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось сохранить решение'); setItem(data.item); if (data.notificationPending) setError('Решение сохранено, но уведомление Discord ожидает повторной отправки.'); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const addComment = async () => {
    if (!comment.trim() || !item) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/hr-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'comment', id: item.id, comment }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить комментарий');
      setItem(data.item); setComment('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <PageLayout user={user}><AdminSectionHeader title="Карточка отчёта" description="Постоянная ссылка на запись кадрового реестра." /><div style={panel}><a href="/admin/hr-audit" style={{ color: '#9ca3af' }}>← Вернуться к реестру</a></div>{error && <div role="alert" style={{ ...panel, borderColor: 'rgba(220,53,69,.5)' }}>{error}</div>}{loading ? <div style={panel}>Загрузка…</div> : !item ? <div style={panel}>Отчёт не найден.</div> : <><section style={panel}><h2 style={{ marginTop: 0, color: '#fff' }}>Отчёт о повышении №{item.number}</h2><div style={label}>АВТОР</div><div style={{ ...value, marginBottom: 14 }}>{item.submitter?.username} · {item.submitter?.id}</div><div style={label}>ДАТА ПОДАЧИ</div><div style={{ ...value, marginBottom: 18 }}>{new Date(item.submittedAt).toLocaleString('ru-RU')}</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>{Object.entries(item.data || {}).map(([key, val]) => <div key={key}><div style={label}>{key}</div><div style={value}>{String(val)}</div></div>)}</div></section>{item.status === 'pending' ? <section style={panel}><label style={label}>ПРИЧИНА ОТКАЗА (ОБЯЗАТЕЛЬНО ПРИ ОТКЛОНЕНИИ)</label><textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} rows={4} style={{ display: 'block', width: '100%', boxSizing: 'border-box', margin: '8px 0 14px', padding: 12, background: '#080c12', color: '#fff', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4 }} /><button disabled={busy} onClick={() => decide('accepted')}>ОДОБРИТЬ</button><button disabled={busy} onClick={() => decide('rejected')} style={{ marginLeft: 10 }}>ОТКЛОНИТЬ</button></section> : <section style={panel}><div style={label}>РЕШЕНИЕ</div><div style={value}>{item.status === 'accepted' ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'} · {item.reviewer?.username} · {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString('ru-RU') : ''}</div>{item.reason && <><div style={{ ...label, marginTop: 14 }}>ПРИЧИНА ОТКАЗА</div><div style={value}>{item.reason}</div></>}</section>}<section style={panel}><div style={label}>ИСТОРИЯ</div>{(item.history || []).map((entry, index) => <div key={index} style={{ ...value, padding: '8px 0', borderBottom: '1px solid rgba(148,163,184,.1)' }}>{entry.action} · {new Date(entry.at).toLocaleString('ru-RU')} · {entry.userId}</div>)}</section>
      <section style={panel}>
        <div style={label}>ВНУТРЕННИЕ КОММЕНТАРИИ · ВИДНЫ ТОЛЬКО ПРОВЕРЯЮЩИМ</div>
        {(item.comments || []).map(entry => <div key={entry.id} style={{ ...value, padding: '10px 0', borderBottom: '1px solid rgba(148,163,184,.1)' }}><strong>{entry.author?.username || 'Проверяющий'}</strong> · {new Date(entry.at).toLocaleString('ru-RU')}<div>{entry.comment}</div></div>)}
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={2000} placeholder="Внутренний комментарий..." style={{ display: 'block', width: '100%', boxSizing: 'border-box', margin: '12px 0', padding: 12, background: '#080c12', color: '#fff', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4 }} />
        <button disabled={busy || !comment.trim()} onClick={addComment}>ДОБАВИТЬ КОММЕНТАРИЙ</button>
      </section>
    }</PageLayout>;
}

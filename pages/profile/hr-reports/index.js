import { useEffect, useState } from 'react';
import PageLayout from '../../../components/PageLayout';

const panel = { background: 'rgba(11,15,22,.72)', border: '1px solid rgba(148,163,184,.15)', borderRadius: 6, padding: 22, marginBottom: 16, color: '#e5e7eb' };

export default function PersonalHrReportsPage() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => setUser(d.user || null)).catch(() => {});
    fetch('/api/hr-audit/my')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить отчёты.');
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return <PageLayout user={user}>
    <main className="page-container">
      <a href="/profile" style={{ color: '#9ca3af', display: 'inline-block', marginBottom: 18, textDecoration: 'none' }}>← Вернуться в профиль</a>
      <section style={panel}>
        <div style={{ color: '#7f8a9a', font: "11px 'DM Mono', monospace", letterSpacing: 1 }}>ЛИЧНЫЙ КАБИНЕТ / ИСТОРИЯ</div>
        <h1 style={{ color: '#fff', fontSize: 30, margin: '8px 0' }}>Все отчёты о повышении</h1>
        <p style={{ color: '#9aa6b9', fontSize: 13 }}>Полная история отправленных вами отчётов за всё время.</p>
        <div style={{ color: '#9aa6b9', fontSize: 12, marginTop: 12 }}>{loading ? 'Загрузка…' : `Всего отчётов: ${items.length}`}</div>
      </section>
      {error && <section style={panel} role="alert">{error}</section>}
      {!loading && !error && items.length === 0 && <section style={panel}>Отчётов пока нет.</section>}
      {items.map(item => {
        const status = item.status === 'pending' ? 'ОЖИДАЕТ РАССМОТРЕНИЯ' : item.status === 'accepted' ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО';
        const date = item.submittedAt ? new Date(item.submittedAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Дата неизвестна';
        return <a key={item.id} href={`/profile/hr-reports/${encodeURIComponent(item.number)}`} style={{ ...panel, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, textDecoration: 'none', color: 'inherit' }}>
          <div><strong style={{ display: 'block', color: '#f3f4f6', marginBottom: 5 }}>{item.title}</strong><span style={{ color: '#8995a8', fontSize: 12 }}>{date}</span>{item.reason && <p style={{ color: '#f0a0a0', fontSize: 12, marginTop: 8 }}>Причина отказа: {item.reason}</p>}</div>
          <span style={{ color: item.status === 'accepted' ? '#7dd3a7' : item.status === 'rejected' ? '#f0a0a0' : '#e8c47a', fontSize: 11, textAlign: 'right', flexShrink: 0 }}>{status} →</span>
        </a>;
      })}
    </main>
  </PageLayout>;
}

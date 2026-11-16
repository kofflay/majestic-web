import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../../components/PageLayout';

const panel = { background: 'rgba(11,15,22,.72)', border: '1px solid rgba(148,163,184,.15)', borderRadius: 6, padding: 22, marginBottom: 16, color: '#e5e7eb' };
const label = { color: '#7f8a9a', fontSize: 11, letterSpacing: 1, fontFamily: "'DM Mono', monospace", marginBottom: 6 };
const value = { color: '#f3f4f6', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

export default function PersonalHrReportPage() {
  const router = useRouter();
  const { number } = router.query;
  const [user, setUser] = useState(null);
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => setUser(d.user || null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!number) return;
    let active = true;
    setLoading(true);
    fetch('/api/hr-audit/my/' + encodeURIComponent(number))
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить отчёт.');
        if (active) setItem(data.item);
      })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [number]);

  const status = item?.status === 'pending' ? 'ОЖИДАЕТ РАССМОТРЕНИЯ' : item?.status === 'accepted' ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО';

  return <PageLayout user={user}>
    <main className="page-container">
      <a href="/profile/hr-reports" style={{ color: '#9ca3af', display: 'inline-block', marginBottom: 18, textDecoration: 'none' }}>← Все мои отчёты</a>
      {loading ? <section style={panel}>Загрузка отчёта…</section> : error ? <section style={panel} role="alert">{error}</section> : item ? <>
        <header style={panel}>
          <div style={label}>ЛИЧНЫЙ КАБИНЕТ / КАДРОВЫЕ ЗАЯВКИ</div>
          <h1 style={{ color: '#fff', fontSize: 30, margin: '8px 0' }}>{item.title}</h1>
          <div style={{ color: '#aeb8c9', fontSize: 13 }}>Отправлен: {item.submittedAt ? new Date(item.submittedAt).toLocaleString('ru-RU') : 'дата неизвестна'}</div>
          <div style={{ marginTop: 14, fontWeight: 600 }}>{status}</div>
          {item.resolvedAt && <div style={{ color: '#aeb8c9', fontSize: 13, marginTop: 6 }}>Рассмотрен: {new Date(item.resolvedAt).toLocaleString('ru-RU')}</div>}
        </header>
        <section style={panel}>
          <h2 style={{ color: '#fff', fontSize: 20, marginBottom: 18 }}>Данные отчёта</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
            {Object.entries(item.data || {}).map(([key, val]) => <div key={key}><div style={label}>{key}</div><div style={value}>{String(val ?? '—')}</div></div>)}
          </div>
        </section>
        {item.reason && <section style={{ ...panel, borderColor: 'rgba(220,53,69,.35)' }}><div style={label}>ПРИЧИНА ОТКАЗА</div><div style={value}>{item.reason}</div></section>}
      </> : <section style={panel}>Отчёт не найден.</section>}
    </main>
  </PageLayout>;
}

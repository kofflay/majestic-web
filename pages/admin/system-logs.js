import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../components/PageLayout';
import AdminPageGuard from '../../components/AdminPageGuard';
import AdminSectionHeader from '../../components/AdminSectionHeader';
import { adminPanelStyle, adminPrimaryButtonStyle } from '../../components/adminStyles';

const LEVELS = [
  { value: 'all', label: 'Все уровни' },
  { value: 'error', label: 'Ошибки' },
  { value: 'warn', label: 'Предупреждения' },
  { value: 'info', label: 'Информация' }
];

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Неизвестная дата' : date.toLocaleString('ru-RU');
}

const levelColors = { error: '#ff7b8b', warn: '#f2c879', info: '#83b8ff' };

export default function SystemLogsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLogs = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/admin/system-logs', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) {
        router.replace('/admin');
        return;
      }
      if (!response.ok) throw new Error('Не удалось загрузить системные логи');
      const data = await response.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Ошибка загрузки');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then(response => response.json()).then(data => {
      if (!data.user) { router.replace('/start'); return; }
      setUser(data.user);
    }).catch(() => router.replace('/start'));
    loadLogs();
    const interval = window.setInterval(() => loadLogs(true), 10000);
    return () => window.clearInterval(interval);
  }, [loadLogs, router]);

  const visibleLogs = level === 'all' ? logs : logs.filter(entry => entry.level === level);

  return (
    <AdminPageGuard superAdminOnly>
      <PageLayout user={user}>
        <AdminSectionHeader
          title="Системные логи"
          description="Технические события приложения и диагностика интеграций. Обновление каждые 10 секунд; хранятся последние 1000 событий."
          actions={<button type="button" onClick={() => loadLogs()} disabled={loading} style={{ ...adminPrimaryButtonStyle, opacity: loading ? 0.5 : 1 }}>ОБНОВИТЬ</button>}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {LEVELS.map(item => (
            <button key={item.value} type="button" onClick={() => setLevel(item.value)} style={{
              ...adminPrimaryButtonStyle,
              minHeight: 36,
              padding: '7px 12px',
              color: level === item.value ? '#fff' : '#91a0b5',
              borderColor: level === item.value ? 'rgba(91,151,235,.7)' : 'rgba(148,163,184,.2)',
              background: level === item.value ? 'rgba(63,131,248,.22)' : 'rgba(0,0,0,.2)'
            }}>{item.label}</button>
          ))}
        </div>
        <div style={adminPanelStyle}>
          {error && <div style={{ padding: 18, color: '#ff7b8b' }}>{error}</div>}
          {loading && <div style={{ padding: 24, color: '#9ca3af' }}>Загрузка логов...</div>}
          {!loading && !error && visibleLogs.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>Событий пока нет. Новые диагностические записи появятся здесь.</div>}
          {visibleLogs.map((entry, index) => (
            <article key={entry.id || index} style={{ padding: '16px 20px', borderBottom: '1px solid rgba(148,163,184,.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ color: levelColors[entry.level] || '#9ca3af', fontSize: 11, fontWeight: 800, letterSpacing: '.08em' }}>{String(entry.level || 'info').toUpperCase()}</span>
                  <strong style={{ color: '#f3f4f6', fontSize: 13 }}>{entry.message || entry.event || 'Системное событие'}</strong>
                </div>
                <time style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}>{formatDate(entry.timestamp)}</time>
              </div>
              <div style={{ marginTop: 7, color: '#8190a5', fontSize: 12 }}>
                {entry.category || 'system'}{entry.event ? ` · ${entry.event}` : ''}
                {entry.auditId ? ` · Заявка №${entry.auditId}` : ''}
                {entry.auditType ? ` · ${entry.auditType}` : ''}
                {entry.decision ? ` · ${entry.decision}` : ''}
                {Number.isInteger(entry.httpStatus) ? ` · HTTP ${entry.httpStatus}` : ''}
              </div>
              {entry.details && <pre style={{ margin: '10px 0 0', padding: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'rgba(0,0,0,.3)', border: '1px solid rgba(148,163,184,.1)', borderRadius: 4, color: '#cbd5e1', fontSize: 11, lineHeight: 1.5 }}>{entry.details}</pre>}
            </article>
          ))}
        </div>
        <div style={{ marginTop: 12, color: '#64748b', fontSize: 11 }}>Показано: {visibleLogs.length} из {logs.length} последних событий. Автообновление включено.</div>
      </PageLayout>
    </AdminPageGuard>
  );
}

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../components/PageLayout';
import AdminPageGuard from '../../components/AdminPageGuard';
import AdminSectionHeader from '../../components/AdminSectionHeader';
import { adminPanelStyle, adminPrimaryButtonStyle, adminDangerButtonStyle } from '../../components/adminStyles';

export default function SubmissionGatePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadStatus = async () => {
    try {
      const response = await fetch('/api/admin/submission-gate');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить состояние');
      setEnabled(Boolean(data.enabled));
    } catch (error) {
      window.toast?.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => {
      if (!d.user) { router.push('/'); return; }
      if (String(d.user.id) !== '200102286473691139') { router.replace('/admin'); return; }
      setUser(d.user);
    }).catch(() => router.replace('/'));
    loadStatus();
  }, []);

  const toggle = async (nextEnabled) => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/submission-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось изменить состояние');
      setEnabled(data.enabled);
      window.toast?.success(data.enabled ? 'Приём новых заявок включён' : 'Приём новых заявок выключен');
    } catch (error) {
      window.toast?.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <AdminPageGuard>
      <PageLayout user={user}>
        <AdminSectionHeader
          title="Приём заявок"
          description="Глобальное управление отправкой новых заявок. Обработка уже созданных заявок не блокируется."
        />
        <section style={{ ...adminPanelStyle, padding: '24px', maxWidth: '720px' }}>
          <div style={{ fontSize: '12px', color: '#9ca3af', letterSpacing: '1px', marginBottom: '10px' }}>ТЕКУЩЕЕ СОСТОЯНИЕ</div>
          <h2 style={{ margin: '0 0 12px', fontSize: '22px', color: loading ? '#9ca3af' : enabled ? '#4ade80' : '#ff6b6b' }}>
            {loading ? 'Загрузка…' : enabled ? 'Приём заявок включён' : 'Приём заявок выключен'}
          </h2>
          <p style={{ color: '#9ca3af', fontSize: '14px', lineHeight: 1.6, margin: '0 0 22px' }}>
            {enabled
              ? 'Пользователи могут отправлять новые заявки.'
              : 'Новые заявки заблокированы для всех пользователей, кроме Discord ID 200102286473691139.'}
            {' '}Просмотр и обработка существующих заявок через кадровый аудит продолжают работать.
          </p>
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => toggle(!enabled)}
            style={enabled ? adminDangerButtonStyle : adminPrimaryButtonStyle}
          >
            {saving ? 'СОХРАНЕНИЕ…' : enabled ? 'ВЫКЛЮЧИТЬ ПРИЁМ ЗАЯВОК' : 'ВКЛЮЧИТЬ ПРИЁМ ЗАЯВОК'}
          </button>
        </section>
      </PageLayout>
    </AdminPageGuard>
  );
}

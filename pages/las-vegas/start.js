import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function LasVegasStart() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [access, setAccess] = useState(null);

  useEffect(() => {
    if (!router.isReady) return;
    let active = true;

    fetch('/api/me')
      .then(response => response.ok ? response.json() : null)
      .then(async data => {
        if (!active) return;
        const currentUser = data?.user || null;
        setUser(currentUser);
        if (!currentUser) {
          setStatus('guest');
          return;
        }

        const accessResponse = await fetch('/api/las-vegas/access');
        if (!accessResponse.ok) {
          if (active) setStatus('error');
          return;
        }
        const access = await accessResponse.json();
        if (!active) return;
        setAccess(access);
        setStatus(access.hasAccess ? 'allowed' : 'denied');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => { active = false; };
  }, [router.isReady]);

  const login = () => {
    window.location.href = '/api/auth/start?returnTo=' + encodeURIComponent('/las-vegas/start');
  };

  const panelStyle = {
    width: 'min(560px, calc(100% - 32px))',
    margin: '12vh auto',
    padding: '36px',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '18px',
    background: 'rgba(15,18,24,.88)',
    boxShadow: '0 24px 80px rgba(0,0,0,.35)',
    color: '#f5f7fa',
    textAlign: 'center',
  };

  const buttonStyle = {
    display: 'inline-block',
    marginTop: '22px',
    padding: '13px 22px',
    borderRadius: '8px',
    border: 0,
    background: '#5865f2',
    color: '#fff',
    fontWeight: 700,
    textDecoration: 'none',
    cursor: 'pointer',
  };

  let heading = 'Las Vegas Police Department';
  let message = 'Проверяем авторизацию и доступ к серверу…';
  if (status === 'guest') message = 'Войдите через Discord, чтобы проверить доступ к подразделению Las Vegas.';
  if (status === 'allowed') message = `Доступ подтверждён. Добро пожаловать, ${user?.username || 'сотрудник'}.`;
  if (status === 'denied') message = 'У вашего Discord-аккаунта нет роли сотрудника или администратора Las Vegas.';
  if (status === 'error') message = 'Не удалось проверить доступ. Обновите страницу или попробуйте позже.';

  return (
    <main style={{ minHeight: '100vh', padding: '1px 0', background: 'radial-gradient(circle at 50% 0%, #20283b 0%, #080a0f 55%, #030405 100%)' }}>
      <section style={panelStyle}>
        <div style={{ color: '#9ba8c7', fontSize: '11px', letterSpacing: '3px', marginBottom: '14px' }}>MAJESTIC ROLE PLAY · NEVADA</div>
        <h1 style={{ margin: '0 0 14px', fontSize: 'clamp(26px, 5vw, 36px)' }}>{heading}</h1>
        <p style={{ margin: 0, color: '#b8c0cf', lineHeight: 1.7 }}>{message}</p>
        {status === 'guest' && <button onClick={login} style={buttonStyle}>Войти через Discord</button>}
        {status === 'denied' && <a href="/start" style={buttonStyle}>Перейти в Memphis</a>}
        {status === 'allowed' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 24 }}>
            <a href="/las-vegas/forms" style={buttonStyle}>Формы и заявления</a>
            <a href="/las-vegas/staff" style={buttonStyle}>Состав сотрудников</a>
            <a href="/las-vegas/passes" style={buttonStyle}>Реестр пропусков</a>
            {access?.isAdmin && <a href="/las-vegas/admin" style={buttonStyle}>Администрирование</a>}
          </div>
        )}
        {status === 'error' && <button onClick={() => router.reload()} style={buttonStyle}>Повторить проверку</button>}
      </section>
    </main>
  );
}

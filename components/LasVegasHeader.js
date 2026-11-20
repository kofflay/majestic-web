import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function LasVegasHeader({ user }) {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [avatar, setAvatar] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/las-vegas/admin/check').then(r => r.json()).then(d => { if (active) setIsAdmin(Boolean(d.isAdmin)); }).catch(() => {});
    fetch('/api/las-vegas/profile/avatar').then(r => r.ok ? r.json() : null).then(d => { if (active && d?.avatarUrl) setAvatar(d.avatarUrl); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id]);

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    router.replace('/las-vegas/start');
  };

  return (
    <header style={{ position: 'relative', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px clamp(18px, 4vw, 48px)', borderBottom: '1px solid rgba(255,255,255,.1)', background: 'rgba(5,7,11,.88)', color: '#f5f7fa' }}>
      <a href="/las-vegas/start" style={{ color: 'inherit', textDecoration: 'none', fontWeight: 800, letterSpacing: 1 }}>LVPD <span style={{ color: '#9ba8c7', fontWeight: 400 }}> / LAS VEGAS</span></a>
      <nav style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 14, fontSize: 13 }}>
        <a href="/las-vegas/forms" style={{ color: '#d5dbea' }}>Формы</a>
        <a href="/las-vegas/applications" style={{ color: '#d5dbea' }}>Заявления</a>
        <a href="/las-vegas/staff" style={{ color: '#d5dbea' }}>Состав</a>
        <a href="/las-vegas/passes" style={{ color: '#d5dbea' }}>Пропуска</a>
        {isAdmin && <a href="/las-vegas/admin" style={{ color: '#d5dbea' }}>Админка</a>}
        {user ? (
          <>
            <a href="/las-vegas/profile" style={{ color: '#d5dbea' }}>Профиль</a>
            {avatar && <img src={avatar} alt="" width="30" height="30" style={{ borderRadius: '50%', objectFit: 'cover' }} />}
            <span style={{ color: '#9ba8c7' }}>{user.username || 'Сотрудник'}</span>
            <button onClick={logout} style={{ color: '#fff', background: 'transparent', border: '1px solid rgba(255,255,255,.2)', borderRadius: 6, padding: '7px 10px', cursor: 'pointer' }}>Выйти</button>
          </>
        ) : (
          <button onClick={() => { window.location.href = '/api/auth/start?returnTo=' + encodeURIComponent(router.asPath || '/las-vegas/start'); }} style={{ color: '#fff', background: '#5865f2', border: 0, borderRadius: 6, padding: '9px 14px', cursor: 'pointer', fontWeight: 700 }}>Войти через Discord ↗</button>
        )}
      </nav>
    </header>
  );
}

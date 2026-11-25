// components/Header.js
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { hasHrAuditAccess } from '../lib/hr-audit-access';

export default function Header({ user }) {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [savedProfileAvatar, setSavedProfileAvatar] = useState('');

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }

    let active = true;
    const cacheKey = 'memphis-lspd:admin-access';
    const cacheTtl = 5 * 60 * 1000;
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.checkedAt < cacheTtl) {
        setIsAdmin(Boolean(cached.isAdmin));
        return () => { active = false; };
      }
    } catch {}

    fetch('/api/admin/check')
      .then(res => res.json())
      .then(data => {
        if (!active) return;
        const allowed = Boolean(data.isAdmin);
        setIsAdmin(allowed);
        try { window.sessionStorage.setItem(cacheKey, JSON.stringify({ isAdmin: allowed, checkedAt: Date.now() })); } catch {}
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user?.id) {
      setSavedProfileAvatar('');
      return undefined;
    }
    let active = true;
    const storageKey = `memphis-lspd:profile-avatar:${user.id}`;
    let cachedAvatar = '';
    try {
      cachedAvatar = window.sessionStorage.getItem(storageKey) || '';
      if (cachedAvatar) setSavedProfileAvatar(cachedAvatar);
    } catch {}
    if (!cachedAvatar) {
      fetch('/api/profile/avatar')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (active && data?.avatarUrl) {
            setSavedProfileAvatar(data.avatarUrl);
            try { window.sessionStorage.setItem(storageKey, data.avatarUrl); } catch {}
          }
        })
        .catch(() => {});
    }
    const handleAvatarUpdate = event => {
      if (active && typeof event.detail === 'string') {
        setSavedProfileAvatar(event.detail);
        try { window.sessionStorage.setItem(storageKey, event.detail); } catch {}
      }
    };
    window.addEventListener('profile-avatar-updated', handleAvatarUpdate);
    return () => {
      active = false;
      window.removeEventListener('profile-avatar-updated', handleAvatarUpdate);
    };
  }, [user?.id]);

  useEffect(() => {
    const closeMenu = () => setIsMenuOpen(false);
    router.events.on('routeChangeStart', closeMenu);
    return () => router.events.off('routeChangeStart', closeMenu);
  }, [router.events]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    const handleKeyDown = event => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  const profileAvatar = savedProfileAvatar || user?.avatar_url || (user?.avatar && user?.id
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : null);

  const isApplicationsActive = router.pathname === '/applications' || router.pathname === '/complaint' || router.pathname.startsWith('/forms/');

  const navItems = [
    { label: 'Заявления', path: '/applications' },
    { label: 'Внутренние отчёты', path: '/hub' },
    { label: 'Пропуска', path: '/passes' },
  ];

  const navigate = path => {
    setIsMenuOpen(false);
    router.push(path);
  };

  const handleLogout = async () => {
    setIsMenuOpen(false);
    setIsLoggingOut(true);
    try {
      await fetch('/api/logout', { method: 'POST' });
    } finally {
      router.replace('/start');
    }
  };

  const handleLogin = () => {
    setIsMenuOpen(false);
    const returnTo = router.asPath || '/start';
    window.location.href = `/api/auth/start?returnTo=${encodeURIComponent(returnTo)}`;
  };

  return (
    <>
      <header className={isMenuOpen ? 'site-header site-header--menu-open' : 'site-header'}>
        <div className="site-header__inner">
          <button
            className="brand"
            onClick={() => navigate('/start')}
            aria-label="Los Santos Police Department — на главную"
          >
            <span className="brand__mark" aria-hidden="true">
              <img className="brand__shield" src="/favicon.svg" alt="" />
            </span>
            <span className="brand__text">
              <strong>LOS SANTOS</strong>
              <small>POLICE DEPARTMENT</small>
            </span>
          </button>

          <nav
            className={isMenuOpen ? 'site-nav site-nav--open' : 'site-nav'}
            id="primary-navigation"
            aria-label="Основная навигация"
          >
            <button
              className={router.pathname === '/start' ? 'is-active' : ''}
              onClick={() => navigate('/start')}
              aria-current={router.pathname === '/start' ? 'page' : undefined}
            >
              Главная
            </button>

            {navItems.map(item => (
              <button
                key={item.path}
                className={(router.pathname === item.path || (item.path === '/applications' && isApplicationsActive)) ? 'is-active' : ''}
                onClick={() => navigate(item.path)}
                aria-current={(router.pathname === item.path || (item.path === '/applications' && isApplicationsActive)) ? 'page' : undefined}
              >
                {item.label}
              </button>
            ))}

            {isAdmin && (
              <button
                className={`site-nav__mobile-only ${router.pathname.startsWith('/admin') ? 'is-active' : ''}`}
                onClick={() => navigate('/admin')}
                aria-current={router.pathname.startsWith('/admin') ? 'page' : undefined}
              >
                Админка
              </button>
            )}
            {hasHrAuditAccess(user) && (
              <button
                className={`site-nav__mobile-only ${router.pathname === '/audit' ? 'is-active' : ''}`}
                onClick={() => navigate('/audit')}
                aria-current={router.pathname === '/audit' ? 'page' : undefined}
              >
                Обработка отчётов
              </button>
            )}
            {user && (
              <button
                className={`site-nav__mobile-only ${router.pathname === '/profile' ? 'is-active' : ''}`}
                onClick={() => navigate('/profile')}
                aria-current={router.pathname === '/profile' ? 'page' : undefined}
              >
                Профиль
              </button>
            )}
            {user && (
              <button className="site-nav__mobile-only site-nav__logout" onClick={handleLogout} disabled={isLoggingOut}>
                {isLoggingOut ? 'Выход...' : 'Выйти'}
              </button>
            )}
          </nav>

          <div className="site-header__actions">
            {isAdmin && (
            <button
              type="button"
              className={`admin-nav-btn ${router.pathname.startsWith('/admin') ? 'is-active' : ''}`}
              onClick={() => navigate('/admin')}
              aria-current={router.pathname.startsWith('/admin') ? 'page' : undefined}
            >
              Админка
            </button>
          )}
          {hasHrAuditAccess(user) && (
            <button
              type="button"
              className={`hr-audit-nav-btn ${router.pathname === '/audit' ? 'is-active' : ''}`}
              onClick={() => navigate('/audit')}
              aria-current={router.pathname === '/audit' ? 'page' : undefined}
            >
              Обработка отчётов
            </button>
          )}
          {user ? (
              <>
                <button
                  type="button"
                  className="profile-link"
                  onClick={() => navigate('/profile')}
                  aria-current={router.pathname === '/profile' ? 'page' : undefined}
                >
                  Профиль
                </button>
                <button
                  type="button"
                  className="profile-avatar-button"
                  onClick={() => navigate('/profile')}
                  aria-label="Открыть профиль"
                  title="Открыть профиль"
                >
                  {profileAvatar ? (
                    <img src={profileAvatar} alt="" />
                  ) : (
                    <span aria-hidden="true">◉</span>
                  )}
                </button>
              </>
            ) : (
              <button className="header-login" onClick={handleLogin}>Войти <span aria-hidden="true">↗</span></button>
            )}

            {user && (
              <button
                className="header-logout"
                onClick={handleLogout}
                disabled={isLoggingOut}
                aria-label="Выйти из аккаунта"
              >
                {isLoggingOut ? 'Выход...' : 'Выйти'}
              </button>
            )}

            <button
              type="button"
              className="mobile-menu-toggle"
              onClick={() => setIsMenuOpen(open => !open)}
              aria-controls="primary-navigation"
              aria-expanded={isMenuOpen}
              aria-label={isMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
            >
              <span className="mobile-menu-toggle__icon" aria-hidden="true">
                <span className="mobile-menu-toggle__line" />
                <span className="mobile-menu-toggle__line mobile-menu-toggle__line--middle" />
                <span className="mobile-menu-toggle__line" />
              </span>
            </button>
          </div>
        </div>
      </header>

      <style jsx global>{`
        .site-header {
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid rgba(129, 156, 194, .16);
          background: rgba(7, 10, 16, .88);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow: 0 10px 34px rgba(0, 0, 0, .12);
        }

        .site-header__inner {
          width: min(1440px, calc(100% - 64px));
          min-height: 84px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(185px, 1fr) auto minmax(185px, 1fr);
          align-items: center;
          gap: clamp(12px, 1.5vw, 24px);
        }

        .brand,
        .site-nav button,
        .profile-link,
        .profile-avatar-button,
        .header-login,
        .header-audit-button,
        .header-logout,
        .mobile-menu-toggle {
          border: 0;
          background: transparent;
          cursor: pointer;
          font: inherit;
        }

        .brand {
          grid-column: 1;
          justify-self: start;
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          padding: 0;
          color: var(--text, #f5f7fb);
          text-align: left;
        }

        .brand__logo {
          display: block;
          width: min(168px, 100%);
          height: auto;
        }

        .brand__mark {
          display: grid;
          place-items: center;
          flex: 0 0 42px;
          width: 42px;
          height: 42px;
          border: 1px solid rgba(197, 163, 106, .58);
          border-radius: 12px;
          background: radial-gradient(circle at 30% 20%, rgba(197, 163, 106, .2), rgba(18, 17, 15, .94) 72%);
          color: #dfc58f;
          font-size: 19px;
          box-shadow: 0 0 28px rgba(197, 163, 106, .13);
        }

        .brand__shield { width: 27px; height: 27px; display: block; object-fit: contain; }

        .brand__text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          white-space: nowrap;
          letter-spacing: .16em;
          font-family: 'Space Grotesk', sans-serif;
        }

        .brand__text strong {
          color: #f3f6fc;
          font-size: 12px;
          font-weight: 700;
        }

        .brand__text small {
          color: #78879d;
          font: 8px 'DM Mono', monospace;
          letter-spacing: .18em;
        }

        .site-nav {
          grid-column: 2;
          justify-self: center;
          display: flex;
          align-items: center;
          gap: clamp(12px, 1.35vw, 21px);
          padding: 0;
          border: 0;
          background: transparent;
        }

        .site-nav__mobile-only {
          display: none !important;
        }

        .site-nav button {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 84px;
          padding: 0 1px;
          color: #8795aa;
          font-size: 13px;
          font-weight: 500;
          line-height: 1.25;
          white-space: nowrap;
          transition: color .18s ease;
        }

        .site-nav button::after {
          position: absolute;
          right: 0;
          bottom: 19px;
          left: 0;
          height: 2px;
          border-radius: 2px;
          background: #c5a36a;
          box-shadow: 0 0 12px rgba(197, 163, 106, .28);
          content: '';
          transform: scaleX(0);
          transform-origin: center;
          transition: transform .2s ease;
        }

        .site-nav button:hover {
          color: #f4f7fc;
        }

        .site-nav button.is-active {
          color: #f4f7fc;
          font-weight: 600;
        }

        .site-nav button.is-active::after {
          transform: scaleX(1);
        }

        .site-header__actions .hr-audit-nav-btn,
        .site-header__actions .admin-nav-btn {
          min-height: 36px;
          padding: 0 12px;
          border: 1px solid transparent;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          transition: background .18s ease, border-color .18s ease, color .18s ease, transform .18s ease;
        }

        .site-header__actions .hr-audit-nav-btn {
          border-color: rgba(76, 190, 177, .38);
          background: rgba(45, 166, 153, .10);
          color: #9bded5;
        }

        .site-header__actions .hr-audit-nav-btn:hover,
        .site-header__actions .hr-audit-nav-btn.is-active {
          border-color: rgba(104, 218, 202, .72);
          background: rgba(45, 166, 153, .20);
          color: #d5fff8;
          transform: translateY(-1px);
        }

        .site-header__actions .admin-nav-btn {
          margin-left: 4px;
          border-color: rgba(207, 157, 83, .38);
          background: rgba(177, 119, 43, .10);
          color: #e6c18b;
        }

        .site-header__actions .admin-nav-btn:hover,
        .site-header__actions .admin-nav-btn.is-active {
          border-color: rgba(230, 181, 105, .76);
          background: rgba(177, 119, 43, .20);
          color: #ffe5bd;
          transform: translateY(-1px);
        }

        .site-header__actions .hr-audit-nav-btn::after,
        .site-header__actions .admin-nav-btn::after {
          content: none;
        }

        .site-header__actions {
          grid-column: 3;
          justify-self: end;
          display: flex;
          align-items: center;
          gap: clamp(7px, .8vw, 12px);
          min-width: 0;
          justify-self: end;
          flex-wrap: nowrap;
        }

        .header-audit-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 38px;
          padding: 0 14px;
          border: 1px solid rgba(91, 151, 235, .55);
          border-radius: 7px;
          background: linear-gradient(135deg, rgba(47, 105, 190, .28), rgba(32, 73, 132, .22));
          color: #c7ddff;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .01em;
          white-space: nowrap;
          transition: background .18s ease, border-color .18s ease, color .18s ease, transform .18s ease;
        }

        .header-audit-button:hover,
        .header-audit-button.is-active {
          border-color: rgba(126, 180, 255, .9);
          background: linear-gradient(135deg, rgba(54, 124, 232, .42), rgba(40, 100, 197, .34));
          color: #fff;
          transform: translateY(-1px);
        }

        .profile-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 36px;
          padding: 0 14px;
          border: 1px solid rgba(197, 163, 106, .38);
          border-radius: 6px;
          background: rgba(197, 163, 106, .10);
          color: #dfc58f;
          font-size: 12px;
          font-weight: 600;
          text-decoration: none;
          transition: background .18s ease, border-color .18s ease, color .18s ease;
        }

        .profile-link:hover,
        .profile-link[aria-current="page"] {
          border-color: rgba(223, 197, 143, .72);
          background: rgba(197, 163, 106, .18);
          color: #fff;
        }

        .profile-avatar-button {
          display: grid;
          place-items: center;
          flex: 0 0 38px;
          width: 38px;
          height: 38px;
          padding: 0;
          overflow: hidden;
          border: 1px solid rgba(92, 150, 231, .52);
          border-radius: 50%;
          background: rgba(197, 163, 106, .12);
          color: #a9caff;
          cursor: pointer;
          font-size: 19px;
          transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
        }

        .profile-avatar-button:hover {
          border-color: #dfc58f;
          box-shadow: 0 0 0 3px rgba(197, 163, 106, .13), 0 0 20px rgba(197, 163, 106, .16);
          transform: translateY(-1px);
        }

        .profile-avatar-button img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .header-login {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 40px;
          padding: 0 17px;
          border-radius: 6px;
          background: linear-gradient(135deg, #367ce8, #2864c5);
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          transition: background .18s ease, transform .18s ease, box-shadow .18s ease;
        }

        .header-login:hover {
          background: linear-gradient(135deg, #dfc58f, #b18a4e);
          box-shadow: 0 7px 22px rgba(197, 163, 106, .22);
          transform: translateY(-1px);
        }

        .header-login span {
          font-size: 15px;
          line-height: 1;
        }

        .header-logout {
          padding: 4px 0;
          color: #77869b;
          font-size: 11px;
          transition: color .18s ease;
        }

        .header-logout:hover {
          color: #f3a0a0;
        }

        .header-logout:disabled {
          cursor: wait;
          opacity: .6;
        }

        .mobile-menu-toggle {
          display: none;
          align-items: center;
          justify-content: center;
          flex: 0 0 42px;
          width: 42px;
          height: 42px;
          padding: 0;
          color: #cbd7e7;
        }

        .mobile-menu-toggle:hover {
          color: #dfc58f;
        }

        .mobile-menu-toggle__icon {
          display: flex;
          flex-direction: column;
          gap: 5px;
          width: 19px;
        }

        .mobile-menu-toggle__line {
          display: block;
          width: 19px;
          height: 2px;
          border-radius: 2px;
          background: currentColor;
          transition: transform .18s ease, opacity .18s ease;
        }

        .site-header--menu-open .mobile-menu-toggle__line:first-child {
          transform: translateY(7px) rotate(45deg);
        }

        .site-header--menu-open .mobile-menu-toggle__line--middle {
          opacity: 0;
        }

        .site-header--menu-open .mobile-menu-toggle__line:last-child {
          transform: translateY(-7px) rotate(-45deg);
        }

        .site-nav button:focus-visible,
        .brand:focus-visible,
        .profile-link:focus-visible,
        .header-audit-button:focus-visible,
        .profile-avatar-button:focus-visible,
        .header-login:focus-visible,
        .header-logout:focus-visible,
        .mobile-menu-toggle:focus-visible {
          outline: 2px solid #5b9cff;
          outline-offset: 4px;
        }

        @media (max-width: 1120px) {
          .site-header .site-header__inner {
            width: min(100% - 40px, 900px);
            min-height: 74px;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 0 14px;
            padding: 9px 0;
          }

          .brand {
            grid-column: 1;
            grid-row: 1;
          }

          .site-header__actions {
            grid-column: 2;
            grid-row: 1;
            gap: 12px;
          }

          .site-nav__mobile-only {
            display: inline-flex !important;
          }

          .site-header__actions .admin-nav-btn,
          .site-header__actions .hr-audit-nav-btn,
          .site-header__actions .profile-link,
          .site-header__actions .header-logout {
            display: none;
          }

          .site-nav__logout {
            color: #e6a0a0 !important;
          }

          .mobile-menu-toggle {
            display: inline-flex;
          }

          .site-nav {
            display: none;
            grid-column: 1 / -1;
            grid-row: 2;
            justify-self: stretch;
            width: 100%;
            margin-top: 7px;
            padding: 9px 0 2px;
            border-top: 1px solid rgba(129, 156, 194, .14);
          }

          .site-nav.site-nav--open {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 26px;
            row-gap: 0;
          }

          .site-nav button {
            justify-content: flex-start;
            min-width: 0;
            min-height: 47px;
            padding: 10px 2px;
            text-align: left;
            white-space: normal;
            font-size: 13px;
          }

          .site-nav button::after {
            right: auto;
            bottom: 5px;
            width: 34px;
            transform-origin: left center;
          }

          .site-nav button.is-active::after {
            transform: scaleX(1);
          }

          .site-header__actions .admin-nav-btn {
            margin-left: 0;
          }
        }

        @media (max-width: 560px) {
          .site-header .site-header__inner {
            width: calc(100% - 28px);
            min-height: 68px;
            gap: 0 8px;
          }

          .brand {
            gap: 0;
          }

          .brand__text {
            display: none;
          }

          .brand__mark {
            width: 39px;
            height: 39px;
            flex-basis: 39px;
          }

          .site-header__actions {
            gap: 7px;
            min-width: 0;
          }

          .site-header__actions .admin-nav-btn,
          .site-header__actions .hr-audit-nav-btn,
          .site-header__actions .profile-link,
          .site-header__actions .header-logout {
            display: none;
          }

          .header-audit-button {
            min-height: 34px;
            padding: 0 9px;
            font-size: 10px;
          }

          .profile-link {
            min-height: 34px;
            padding: 0 12px;
            font-size: 11px;
          }

          .profile-avatar-button {
            flex-basis: 34px;
            width: 34px;
            height: 34px;
          }

          .header-login {
            min-height: 38px;
            padding: 0 13px;
            font-size: 11px;
          }

          .header-logout {
            display: none;
          }

          .mobile-menu-toggle {
            flex-basis: 40px;
            width: 40px;
            height: 40px;
          }

          .site-nav.site-nav--open {
            column-gap: 18px;
          }

          .site-nav button {
            font-size: 12px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .site-nav button,
          .site-nav button::after,
          .header-login,
          .header-audit-button,
          .header-logout,
          .mobile-menu-toggle__line {
            transition: none;
          }
        }
      `}</style>
    </>
  );
}

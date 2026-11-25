import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import StaffCard from '../components/StaffCard';
import Header from '../components/Header';

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [staff, setStaff] = useState([]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.error === 'new_account') {
      setError(`Ваш Discord аккаунт создан ${router.query.days || '0'} дней назад. Требуется минимум ${router.query.min || '5'} дней.`);
    } else if (router.query.error === 'access_denied') {
      setError('Вы отклонили авторизацию.');
    } else if (router.query.error) {
      setError('Ошибка авторизации. Попробуйте снова.');
    }
  }, [router.isReady, router.query.error, router.query.days, router.query.min]);

  useEffect(() => {
    if (!router.isReady) return undefined;
    let cancelled = false;
    fetch('/api/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled) return;
        setUser(data?.user || null);
        if (data?.user) fetch('/api/check-criminal', { method: 'POST' }).catch(() => {});
      })
      .catch(() => { if (!cancelled) setUser(null); });
    return () => { cancelled = true; };
  }, [router.isReady]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/staff', { signal: controller.signal })
      .then(response => response.ok ? response.json() : [])
      .then(data => setStaff(Array.isArray(data) ? data : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div className="site-page-shell landing-page lspd-landing reference-start">
      <div className="reference-start__backdrop" aria-hidden="true" />
      <div className="reference-start__content">
        <Header user={user} />
        <main>
          <section className="reference-hero">
            <div className="reference-hero__inner">
              <div className="reference-kicker"><span>MAJESTIC ROLE PLAY -</span> <strong>MEMPHIS</strong></div>
              <h1>Los Santos<br />Police Department</h1>
              <p>Los Santos Police Department — служба, которой доверяют.<br className="reference-desktop-break" /> Защищаем граждан. Работаем честно. Действуем быстро.</p>
              {error && <div className="landing-error" role="alert">{error}</div>}
              <div className="reference-established"><span /> LSPD · LOS SANTOS · EST. 2026 <span /></div>
            </div>
          </section>

          <section className="reference-mission">
            <div className="reference-section-heading">НАША МИССИЯ</div>
            <div className="reference-mission__copy">
              <p>Los Santos Police Department служит жителям штата San Andreas, защищает общественный порядок и обеспечивает соблюдение закона. Наша работа основана на дисциплине, профессионализме и ответственности перед городом.</p>
              <p><strong>Служить и защищать.</strong> Каждый сотрудник LSPD ежедневно работает ради безопасности граждан, справедливости и доверия общества.</p>
            </div>
          </section>

          <section className="landing-command reference-command" aria-labelledby="landing-command-title">
            <div className="landing-command__eyebrow">LSPD // AUTHORIZED PERSONNEL</div>
            <h2 id="landing-command-title">Руководство департамента</h2>
            <p>Командование Los Santos Police Department</p>
            <div className="landing-command__grid">
              {staff.map(member => <StaffCard key={member.id} member={member} isAdminView={false} />)}
            </div>
          </section>
        </main>
        <footer className="landing-footer">
          <span>LSPD SYSTEM // MEMPHIS</span>
          <span className="landing-footer__credit">ЧАСТЬ ПРОЕКТА <a href="https://discord.gg/suspectfmq" target="_blank" rel="noopener noreferrer"><strong>SUSPECT FAMQ</strong></a></span>
          <span className="landing-footer__author">РАЗРАБОТКА САЙТА <a href="https://discord.com/users/200102286473691139" target="_blank" rel="noopener noreferrer"><strong>BY KOFFLAY</strong></a><span className="landing-footer__discord"><a href="https://discord.com/users/200102286473691139" target="_blank" rel="noopener noreferrer">DISCORD @kofflay</a></span></span>
          <span>SECURE ACCESS · 2026</span>
        </footer>
      </div>
    </div>
  );
}

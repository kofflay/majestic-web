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
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
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
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setStaff(Array.isArray(data) ? data : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div className="site-page-shell landing-page fib-landing reference-start">
      <div className="reference-start__backdrop" aria-hidden="true" />
      <div className="reference-start__content">
        <Header user={user} />
        <main>
          <section className="reference-hero">
            <div className="reference-hero__inner">
              <div className="reference-kicker"><span>MAJESTIC ROLE PLAY -</span> <strong>MEMPHIS</strong></div>
              <h1>Federal<br />Investigation Bureau</h1>
              <p>Федеральное бюро расследований штата San Andreas. Защита граждан,<br className="reference-desktop-break" /> борьба с преступностью и поддержание правопорядка.</p>
              {error && <div className="landing-error" role="alert">{error}</div>}
            </div>
          </section>

          <section className="reference-mission">
            <div className="reference-section-heading"><span>НАША МИССИЯ</span></div>
            <div className="reference-mission__copy">
              <p>Федеральное бюро расследований под управлением семьи <span className="suspect-family-popover" tabIndex={0}>
                  <strong>Suspect</strong>
                  <span className="suspect-family-popover__card" role="tooltip">
                    <span className="suspect-family-popover__avatar">S</span>
                    <span className="suspect-family-popover__body">
                      <strong className="suspect-family-popover__title">Suspect FamQ</strong>
                      <span className="suspect-family-popover__description">Одна из сильнейших государственных семей на текущий момент.</span>
                      <span className="suspect-family-popover__description">Создатели семьи — Lance и Etnaise. Глава семьи Nyash в настоящее время занимает пост директора FIB на 19 сервере Memphis.</span>
                      <span className="suspect-family-popover__founded">Основана 13.03.2026</span>
                      <a className="suspect-family-popover__link" href="https://discord.gg/V4khxBQqxy" target="_blank" rel="noopener noreferrer">Discord-сервер семьи</a>
                    </span>
                  </span>
                </span> стремится защищать американский народ и отстаивать Конституцию Соединенных Штатов. Мы работаем над предотвращением террористических атак, борьбой с организованной преступностью и коррупцией на всех уровнях.</p>
              <p>Наши агенты обладают высочайшей квалификацией и готовы служить закону в любое время суток, обеспечивая безопасность граждан штата San Andreas.</p>
            </div>
          </section>

          <section className="landing-command reference-command" aria-labelledby="landing-command-title">
            <h2 id="landing-command-title">Руководство</h2>
            <p>Высшее командование Федерального бюро расследований</p>
            <div className="landing-command__grid">
              {staff.map((member) => <StaffCard key={member.id} member={member} isAdminView={false} />)}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

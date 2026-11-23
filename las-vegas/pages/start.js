// pages/start.js
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

  // Session bootstrap and criminal check run once per page mount.
  useEffect(() => {
    if (!router.isReady) return undefined;
    let cancelled = false;

    fetch('/las-vegas/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setUser(data?.user || null);
        if (data?.user) {
          fetch('/las-vegas/api/check-criminal', { method: 'POST' }).catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });

    return () => { cancelled = true; };
  }, [router.isReady]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/las-vegas/api/staff', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setStaff(Array.isArray(data) ? data : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div className="site-page-shell landing-page fib-landing" style={{ position: 'relative', isolation: 'isolate', background: 'transparent' }}>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          backgroundImage: "linear-gradient(180deg, rgba(3, 7, 14, 0.50) 0%, rgba(3, 7, 14, 0.68) 55%, rgba(3, 7, 14, 0.88) 100%), url('/las-vegas/start-bg.png.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />

      {/* Контент страницы расположен поверх фонового изображения */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Header user={user} />

        <main>
          <section className="landing-hero">
            {/* Убираем старые статичные свечения, так как теперь есть LivingBackground */}
            
            <div className="landing-hero__content">
              <div className="landing-kicker"><i /> FEDERAL BUREAU OF INVESTIGATION</div>
              <h1>Истина.<br /><span>Закон.</span><br />Ответственность.</h1>
              <p>Федеральное бюро расследований.<br />Устанавливаем истину там, где другие видят лишь вопросы.</p>
              {error && <div className="landing-error" role="alert">{error}</div>}
            </div>
            <div className="landing-orbit" aria-hidden="true"><strong>24</strong><small>HOURS</small></div>
            <div className="landing-meta landing-meta--left">FBI / FIELD OFFICE</div>
            <div className="landing-meta landing-meta--center">INVESTIGATIONS · INTELLIGENCE</div>
            <div className="landing-meta landing-meta--right">SERVICE · INTEGRITY · JUSTICE</div>
          </section>

          <section className="landing-mission">
            <div className="landing-section-label"><span>01</span> НАША МИССИЯ</div>
            <div>
              <h2>За каждым делом —<br /><em>поиск истины.</em></h2>
              <p>Мы проверяем каждую деталь, сопоставляем свидетельства и восстанавливаем полную картину событий. Беспристрастность, точность и конфиденциальность — принципы, на которых строится наша работа.</p>
            </div>
            <div className="landing-quote">“</div>
          </section>

          <section className="landing-cards">
            <a href="/las-vegas/applications"><span>01</span><strong>Обращения</strong><small>Заявления и жалобы</small><b>↗</b></a>
            <a href="/las-vegas/staff"><span>02</span><strong>Руководящий состав</strong><small>Агенты и руководство</small><b>↗</b></a>
          </section>

          <section className="landing-command" aria-labelledby="landing-command-title">
            <div className="landing-command__eyebrow">TOP SECRET // CLEARANCE REQUIRED</div>
            <div className="landing-section-label"><span>03</span> РУКОВОДЯЩИЙ СОСТАВ</div>
            <h2 id="landing-command-title">Руководящий состав</h2>
            <div className="landing-command__grid">
              {staff.map((member) => (
                <StaffCard key={member.id} member={member} isAdminView={false} />
              ))}
            </div>
          </section>
        </main>
        <footer className="landing-footer">
          <span>FEDERAL BUREAU // FIELD OFFICE</span>
          <span className="landing-footer__credit">
            ЧАСТЬ ПРОЕКТА{' '}
            <a href="https://discord.com" target="_blank" rel="noopener noreferrer">
              <strong>SUSPECT FAMQ</strong>
            </a>
          </span>
          <span className="landing-footer__author">
            РАЗРАБОТКА САЙТА{' '}
            <a href="https://discord.com/users/200102286473691139" target="_blank" rel="noopener noreferrer">
              <strong>BY KOFFLAY</strong>
            </a>
            <span className="landing-footer__discord">
              <a href="https://discord.com/users/200102286473691139" target="_blank" rel="noopener noreferrer">
                DISCORD @kofflay
              </a>
            </span>
          </span>
          <span>SECURE ACCESS · 2026</span>
        </footer>
      </div>
    </div>
  );
}

//ку

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '../components/Header';

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);

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
    fetch('/las-vegas/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setUser(data?.user || null);
        if (data?.user) fetch('/las-vegas/api/check-criminal', { method: 'POST' }).catch(() => {});
      })
      .catch(() => { if (!cancelled) setUser(null); });
    return () => { cancelled = true; };
  }, [router.isReady]);

  return (
    <div className="site-page-shell landing-page portland-start">
      <Header user={user} />
      <main>
        <section className="portland-hero">
          <div className="portland-hero__inner">
            <div className="portland-kicker">
              <span>MAJESTIC ROLE PLAY -</span> <strong>PORTLAND</strong>
            </div>
            <h1>Federal<br />Investigation Bureau</h1>
            <p>Федеральное бюро расследований штата San Andreas. Защита граждан,<br className="portland-desktop-break" /> борьба с преступностью и поддержание правопорядка.</p>
            {error && <div className="landing-error" role="alert">{error}</div>}
            <div className="portland-established"><span />EST. 19 DECEMBER 2025<span /></div>
          </div>
        </section>

        <section className="portland-mission">
          <div className="portland-mission__heading"><span>НАША МИССИЯ</span></div>
          <div className="portland-mission__copy">
            <p>Федеральное бюро расследований под управлением семьи <strong>Majestic Empire</strong> стремится защищать американский народ и отстаивать Конституцию Соединенных Штатов. Мы работаем над предотвращением террористических атак, борьбой с организованной преступностью и коррупцией на всех уровнях.</p>
            <p>Наши агенты обладают высочайшей квалификацией и готовы служить закону в любое время суток, обеспечивая безопасность граждан штата San Andreas.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import StaffCard from '../../components/StaffCard';
import LasVegasHeader from '../../components/LasVegasHeader';
import LivingBackground from '../../components/LivingBackground';

export default function LasVegasStart() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const queryError = router.query.error;
    if (queryError === 'new_account') {
      setError(`Ваш Discord аккаунт создан ${router.query.days || '0'} дней назад. Требуется минимум ${router.query.min || '5'} дней.`);
    } else if (queryError === 'access_denied') {
      setError('Вы отклонили авторизацию.');
    } else if (queryError) {
      setError('Ошибка авторизации. Попробуйте снова.');
    }
  }, [router.isReady, router.query.error, router.query.days, router.query.min]);

  useEffect(() => {
    let active = true;
    fetch('/api/me')
      .then(response => response.ok ? response.json() : null)
      .then(async data => {
        if (!active) return;
        const currentUser = data?.user || null;
        setUser(currentUser);
        if (!currentUser) return;
        const accessResponse = await fetch('/api/las-vegas/access');
        if (!accessResponse.ok) return;
        const access = await accessResponse.json();
        if (!active || !access?.hasAccess) return;
        const staffResponse = await fetch('/api/las-vegas/staff');
        if (!staffResponse.ok) return;
        const staffData = await staffResponse.json();
        if (active) setStaff(Array.isArray(staffData) ? staffData : []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <div className="site-page-shell landing-page" style={{ position: 'relative' }}>
      <LivingBackground />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <LasVegasHeader user={user} />
        <main>
          <section className="landing-hero">
            <div className="landing-hero__content">
              <div className="landing-kicker"><i /> MAJESTIC ROLE PLAY <b>—</b> LAS VEGAS</div>
              <h1>Закон.<br /><span>Порядок.</span><br />Las Vegas.</h1>
              <p>Las Vegas Police Department — служба, которой доверяют.<br />Защищаем граждан. Работаем честно. Действуем быстро.</p>
              {error && <div className="landing-error" role="alert">{error}</div>}
            </div>
            <div className="landing-orbit" aria-hidden="true"><strong>24</strong><small>HOURS</small></div>
            <div className="landing-meta landing-meta--left">LVPD / 001</div>
            <div className="landing-meta landing-meta--center">EST. 2026</div>
            <div className="landing-meta landing-meta--right">LAS VEGAS, NV</div>
          </section>
          <section className="landing-mission">
            <div className="landing-section-label"><span>01</span> НАША МИССИЯ</div>
            <div>
              <h2>Служить и защищать —<br /><em>это наш выбор.</em></h2>
              <p>Мы создаём безопасный город, в котором каждый житель может чувствовать себя защищённым. Наша сила — в дисциплине, профессионализме и уважении к закону.</p>
              <p>Лас-Вегас — город ярких огней, стремительных решений и бесконечного движения. За блеском улиц стоит ежедневная работа людей, которые следят за порядком, помогают жителям и готовы прийти на помощь в любой ситуации.</p>
            </div>
            <div className="landing-quote">“</div>
          </section>
          <section className="landing-cards">
            <a href="/las-vegas/applications"><span>01</span><strong>Заявления</strong><small>Заявления и жалобы</small><b>↗</b></a>
            <a href="/las-vegas/staff"><span>02</span><strong>Состав LVPD</strong><small>Команда и руководство</small><b>↗</b></a>
            <a href="/las-vegas/forms"><span>03</span><strong>Формы</strong><small>Документы и обращения</small><b>↗</b></a>
          </section>
          {staff.length > 0 && (
            <section className="landing-command" aria-labelledby="lv-command-title">
              <div className="landing-command__eyebrow">OFFICIAL // LVPD</div>
              <div className="landing-section-label"><span>04</span> РУКОВОДСТВО</div>
              <h2 id="lv-command-title">Командование департамента</h2>
              <p>Высшее руководство Las Vegas Police Department</p>
              <div className="landing-command__grid">
                {staff.map(member => <StaffCard key={member.id} member={member} isAdminView={false} />)}
              </div>
            </section>
          )}
        </main>
        <footer className="landing-footer">
          <span>LVPD SYSTEM / LAS VEGAS</span>
          <span>MAJESTIC ROLE PLAY</span>
          <span>SECURE ACCESS · 2026</span>
        </footer>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from './Header';

const PUBLIC_FORMS = ['hiring', 'transfer-to-lspd', 'reinstatement'];

export default function FormShell({
  title,
  icon,
  accent = '#3f83f8',
  subtitle = 'Заполните обязательные поля для отправки обращения',
  backLink: customBackLink,
  user,
  children
}) {
  const router = useRouter();
  const [submissionAccess, setSubmissionAccess] = useState({ loading: true, canSubmit: true, exempt: false });
  const currentFormId = router.pathname.split('/').pop();
  const backLink = customBackLink || (PUBLIC_FORMS.includes(currentFormId) ? '/applications' : '/hub');

  useEffect(() => {
    let active = true;
    fetch('/api/submission-status')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Status unavailable');
        if (active) setSubmissionAccess({ loading: false, canSubmit: Boolean(data.canSubmit), exempt: Boolean(data.exempt) });
      })
      .catch(() => {
        if (active) setSubmissionAccess({ loading: false, canSubmit: false, exempt: false });
      });
    return () => { active = false; };
  }, []);

  const submissionsBlocked = !submissionAccess.loading && !submissionAccess.canSubmit;

  return (
    <div className="app-shell">
      {user && <Header user={user} />}
      <main className="form-container">
        <button type="button" className="back-link" onClick={() => router.push(backLink)}>
          ← Вернуться назад
        </button>
        <section className="form-card" style={{ '--form-accent': accent }}>
          <header className="form-card__header">
            {icon && (
              <span
                className="form-card__icon"
                aria-hidden="true"
                style={{ color: accent, borderColor: `${accent}66`, backgroundColor: `${accent}18` }}
              >
                {icon}
              </span>
            )}
            <div className="form-card__heading">
              <span className="form-card__index">LSPD / FORM</span>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </header>
          <div className="form-card__body">
            {submissionsBlocked && (
              <div role="status" style={{ marginBottom: '20px', padding: '14px 16px', borderRadius: '10px', border: '1px solid rgba(255,107,107,0.35)', background: 'rgba(255,107,107,0.08)', color: '#ffb4b4', lineHeight: 1.5 }}>
                Приём новых заявок временно приостановлен. Уже отправленные заявки продолжают обрабатываться.
              </div>
            )}
            <fieldset disabled={submissionsBlocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {children}
            </fieldset>
          </div>
        </section>
      </main>
    </div>
  );
}

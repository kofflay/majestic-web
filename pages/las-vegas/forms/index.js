import Link from 'next/link';

const forms = [
  ['report', 'Отчёт о повышении', 'Подать отчёт о выполненной работе'],
  ['high-rank-report', 'Отчёт старшего состава', 'Отчёт для руководящего состава'],
  ['promotion', 'Заявление на повышение', 'Запросить повышение в должности'],
  ['transfer', 'Перевод между отделами', 'Подать заявление на перевод'],
  ['transfer-to-lspd', 'Вступление в департамент', 'Заявление о переводе в подразделение'],
  ['hiring', 'Трудоустройство', 'Заявка на вступление в состав'],
  ['reinstatement', 'Восстановление', 'Запросить восстановление в должности'],
  ['resignation', 'Увольнение', 'Подать рапорт об увольнении'],
  ['weapon-request', 'Запрос вооружения', 'Запросить выдачу вооружения'],
  ['leave', 'Заявление на отпуск', 'Оформить отпуск'],
  ['recovery', 'Отработка взыскания', 'Подать отчёт об отработке взыскания'],
  ['appeal', 'Обжалование наказания', 'Подать обжалование'],
];

export default function LasVegasForms() {
  return (
    <main style={{ minHeight: '100vh', padding: '48px 20px', background: '#080a0f', color: '#f5f7fa' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <Link href="/las-vegas/start" style={{ color: '#9ba8c7', textDecoration: 'none' }}>← Las Vegas</Link>
        <p style={{ margin: '28px 0 8px', color: '#9ba8c7', letterSpacing: 3, fontSize: 11 }}>LAS VEGAS POLICE DEPARTMENT</p>
        <h1 style={{ margin: '0 0 12px', fontSize: 36 }}>Формы и заявления</h1>
        <p style={{ color: '#aeb7c7', marginBottom: 28 }}>Выберите нужную форму. Доступ к отправке проверяется сервером.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {forms.map(([slug, title, description]) => (
            <Link key={slug} href={'/las-vegas/forms/' + slug} style={{ display: 'block', padding: 22, border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, background: 'rgba(255,255,255,.035)', color: 'inherit', textDecoration: 'none' }}>
              <strong style={{ display: 'block', marginBottom: 8 }}>{title}</strong>
              <span style={{ color: '#9ba8c7', fontSize: 13 }}>{description}</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../components/PageLayout';
import AdminSectionHeader from '../components/AdminSectionHeader';
import { verifyToken } from '../lib/discord';
import { hasHrAuditAccess } from '../lib/hr-audit-access';
import { DEPARTMENTS, getDepartment } from '../lib/departments';

const panel = {
  background: 'rgba(20,21,23,.88)',
  border: '1px solid rgba(197,163,106,.22)',
  borderRadius: 6,
  padding: 22,
  marginBottom: 16,
  color: '#e5e7eb'
};
const label = { color: '#b6aa91', fontSize: 11, letterSpacing: 1, fontFamily: "'DM Mono', monospace", marginBottom: 6 };
const value = { color: '#f3f4f6', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const filterInputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 8px', background: '#151515', border: '1px solid rgba(197,163,106,.3)', borderRadius: 4, color: '#fff', fontSize: 12, fontFamily: 'inherit', colorScheme: 'dark' };
function FilterGroup({ title, options, selected, onToggle }) {
  return <div style={{ minWidth: 0 }}>
    <div style={label}>{title}</div>
    <div style={{ maxHeight: 168, minHeight: 42, overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 9, padding: '5px 7px', border: '1px solid rgba(197,163,106,.16)', borderRadius: 5, background: 'rgba(10,11,12,.5)' }}>
      {options.length ? options.map(option => <label key={option.value} style={{ display: 'flex', alignItems: 'flex-start', minWidth: 0, gap: 9, color: '#cbd5e1', fontSize: 12, lineHeight: 1.45, cursor: 'pointer' }}>
        <input className="hr-audit-filter-checkbox" type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{option.label}</span>
      </label>) : <span style={{ color: '#b6aa91', fontSize: 12 }}>Нет данных</span>}
    </div>
  </div>;
}

const button = (color) => ({
  background: color === 'green' ? 'rgba(76,175,80,.12)' : 'rgba(220,53,69,.12)',
  border: `1px solid ${color === 'green' ? 'rgba(76,175,80,.5)' : 'rgba(220,53,69,.5)'}`,
  color: color === 'green' ? '#81c784' : '#ff7b88',
  borderRadius: 4, padding: '10px 16px', cursor: 'pointer', fontWeight: 700,
  fontFamily: "'DM Mono', monospace", fontSize: 12
});

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  const user = verifyToken(req.cookies?.token);
  if (!user) {
    return { redirect: { destination: '/start', permanent: false } };
  }
  if (!hasHrAuditAccess(user)) {
    return { notFound: true };
  }
  return { props: {} };
}

const FIELD_LABELS = {
  fullName: 'Имя и статик',
  department: 'Отдел',
  currentRank: 'Текущий ранг',
  targetRank: 'Запрашиваемый ранг',
  isInstructor: 'Назначение инструктором',
  workLinks: 'Ссылки на проделанную работу',
  rankRange: 'Диапазон рангов',
  workLink: 'Ссылка на проделанную работу',
  reportLink: 'Ссылка на кадровый аудит',
  rank: 'Текущий ранг', currentDepartment: 'Текущий отдел', targetDepartment: 'Новый отдел', reason: 'Причина',
  approvalProof: 'Подтверждение одобрения', rankProof: 'Подтверждение ранга', age: 'Возраст', experience: 'Опыт',
  lawKnowledge: 'Знание законов', passport: 'Паспорт', militaryId: 'Военный билет', medical: 'Медицинская карта',
  screenshot: 'Скриншот', rankAtDismissal: 'Ранг на момент увольнения', wasWarned: 'Было ли взыскание',
  stateFractionsProof: 'Одобрение State Fractions', dbWhatIs: 'Вопросы DB', dbExperience: 'Опыт DB',
  dbExamples: 'Примеры DB', dbServers: 'Серверы DB', dbKnowledge: 'Знания DB', dbLawKnowledge: 'Знание законов DB',
  swatShooting: 'Стрельба SWAT', swatRollback: 'Откат SWAT'
};

const FORM_CATEGORY_GROUPS = [
  { title: 'КАДРОВЫЕ ПРОЦЕССЫ', items: [
    { id: 'report', label: 'Отчёты о повышении', icon: '↗' },
    { id: 'highrank', label: 'Отчёты High-Rank', icon: '◆' },
    { id: 'promotion', label: 'Запросы на повышение', icon: '↑' },
    { id: 'transfer', label: 'Перевод между отделами', icon: '⇄' },
    { id: 'transfer-to-lspd', label: 'Перевод в FIB', icon: '＋' },
    { id: 'hiring', label: 'Трудоустройство', icon: '＋' },
    { id: 'reinstatement', label: 'Восстановление', icon: '↺' },
    { id: 'resignation', label: 'Увольнение', icon: '−' }
  ]},
  { title: 'СЛУЖЕБНЫЕ ЗАПРОСЫ', items: [
    { id: 'leave', label: 'Заявления на отпуск', icon: '◷' },
    { id: 'weapon-request', label: 'Спецвооружение', icon: '⌁' },
    { id: 'recovery', label: 'Отработка взыскания', icon: '✓' }
  ]},
  { title: 'ОБРАЩЕНИЯ', items: [
    { id: 'appeal', label: 'Обжалования', icon: '⚖' },
    { id: 'complaint', label: 'Жалобы на сотрудников', icon: '!' }
  ]},
  { title: 'ДОПОЛНИТЕЛЬНО', items: [
    { id: 'premium', label: 'Заявления на премию', icon: '✦' }
  ]}
];

const STATUS_LABELS = {
  all: 'Все заявки',
  pending: 'Ожидают',
  accepted: 'Одобрены',
  rejected: 'Отклонены'
};

function displayFieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (['isInstructor', 'wasWarned'].includes(key)) return value === 'yes' ? 'Да' : value === 'no' ? 'Нет' : String(value);
  if (['department', 'currentDepartment', 'targetDepartment'].includes(key)) {
    const department = getDepartment(value);
    return department ? department.name : String(value);
  }
  return String(value);
}

function renderFieldContent(key, value) {
  if (!value) return displayFieldValue(key, value);
  const parts = String(value).split(/(https?:\/\/[^\s,]+)/gi);
  return parts.map((part, index) => /^https?:\/\//i.test(part)
    ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#81c784', textDecoration: 'underline', overflowWrap: 'anywhere' }}>{part}</a>
    : part);
}
function getActionSummary(item) {
  const data = item.data || {};
  const departmentName = value => getDepartment(value)?.name || value || 'не указан';
  const summaries = {
    report: { title: 'Отчёт о повышении', text: 'Проверяется выполненная работа и соответствие перехода на следующий ранг. При одобрении автоматически создаётся отдельный запрос на повышение.' },
    highrank: { title: 'Отчёт High-Rank', text: 'Проверяется отчёт руководящего состава. При одобрении автоматически создаётся отдельный запрос на повышение.' },
    promotion: { title: 'Запрос на повышение', text: 'Проверяется запрос на повышение. Одобрение фиксируется в кадровом аудите; новый запрос автоматически не создаётся.' },
    transfer: { title: 'Перевод между отделами', text: 'Проверяется перевод сотрудника из текущего отдела в выбранный. Одобрение фиксирует решение кадрового аудита и не создаёт запрос на повышение.' },
    'transfer-to-lspd': { title: 'Перевод в FIB', text: 'Проверяются подтверждение одобрения перевода и доказательство текущего ранга. Одобрение фиксирует кадровое решение без создания запроса на повышение.' },
    hiring: { title: 'Трудоустройство в FIB', text: 'Проверяются анкетные данные, опыт, знание законов и приложенные документы. Одобрение фиксирует решение о трудоустройстве.' },
    resignation: { title: 'Увольнение', text: 'Проверяется заявление сотрудника и приложенный скриншот планшета. Одобрение фиксирует решение об увольнении.' },
    reinstatement: { title: 'Восстановление в FIB', text: 'Проверяются ранг на момент увольнения, подтверждение ранга и сведения о взысканиях. Одобрение фиксирует решение о восстановлении.' }
  };
  const summary = summaries[item.type] || { title: item.title || 'Кадровая заявка', text: 'Проверьте данные и подтверждения, затем зафиксируйте решение кадрового аудита.' };
  const details = item.type === 'transfer'
    ? `Перевод: ${departmentName(data.currentDepartment)} → ${departmentName(data.targetDepartment)}`
    : item.type === 'report'
      ? `Отдел: ${departmentName(data.department)} · Ранг: ${data.currentRank || '—'} → ${data.targetRank || '—'}`
      : item.type === 'reinstatement'
        ? `Ранг на момент увольнения: ${data.rankAtDismissal || '—'} · Взыскание: ${data.wasWarned === 'yes' ? 'Да' : data.wasWarned === 'no' ? 'Нет' : 'Не указано'}`
        : item.type === 'highrank'
          ? `Диапазон повышения: ${data.rankRange || '—'}`
          : '';
  return { ...summary, details };
}

export default function HrAuditPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDepartments, setSelectedDepartments] = useState([]);
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [expandedItems, setExpandedItems] = useState(() => new Set());
  const [sortOrder, setSortOrder] = useState('newest');

  const load = async () => {
    setError('');
    try {
      const response = await fetch('/las-vegas/api/admin/hr-audit');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить заявки');
      setItems(data.items || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetch('/las-vegas/api/me').then(r => r.json()).then(d => setUser(d.user || null)).catch(() => {});
    load();
  }, []);

  useEffect(() => {
    if (!router.isReady || loading || !router.query.id) return;
    const requestedId = String(router.query.id);
    if (!/^[1-9][0-9]{0,11}$/.test(requestedId)) return;
    const target = document.getElementById(`audit-item-${requestedId}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [router.isReady, router.query.id, loading, items]);

  const decide = async (item, decision) => {
    const reason = reasons[item.id] || '';
    if (decision === 'rejected' && !reason.trim()) {
      setError('Для отказа обязательно укажи причину.');
      return;
    }
    if (!window.confirm(decision === 'accepted' ? `Одобрить заявку №${item.number}?` : `Отклонить заявку №${item.number}?`)) return;
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/las-vegas/api/admin/hr-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, decision, reason })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить решение');
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry));
      if (data.warning) setError(data.warning);
      else if (data.notificationPending) setError('Решение сохранено, но Discord не подтвердил уведомление. Понадобится повторная отправка.');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const retryDelivery = async item => {
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/las-vegas/api/admin/hr-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'retry-delivery' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось повторить отправку');
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry));
      if (data.warning) setError(data.warning);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const retryPersonnelAudit = async item => {
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/las-vegas/api/admin/hr-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'retry-personnel-audit' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось повторить публикацию кадровой карточки');
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry));
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const retryNotification = async item => {
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/las-vegas/api/admin/hr-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action: 'retry-notification' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось повторить уведомление');
      setItems(prev => prev.map(entry => entry.id === item.id ? data.item : entry));
      if (data.warning) setError(data.warning);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const status = item => item.status === 'pending' ? ['ОЖИДАЕТ', '#dfc58f'] : item.status === 'accepted' ? ['ОДОБРЕНО', '#81c784'] : ['ОТКЛОНЕНО', '#ff7b88'];
  const counts = items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
  const TYPE_LABELS = {
    report: 'Отчёт о повышении', highrank: 'Отчёт High-Rank', promotion: 'Запрос на повышение',
    transfer: 'Перевод между отделами', 'transfer-to-lspd': 'Перевод в FIB', hiring: 'Трудоустройство в FIB',
    resignation: 'Увольнение', reinstatement: 'Восстановление в FIB'
  };
  const uniqueValues = values => Array.from(new Set(values.filter(value => value !== null && value !== undefined && String(value).trim() !== '').map(String)));
  const departmentOptions = uniqueValues([
    ...DEPARTMENTS.map(department => department.id),
    ...items.flatMap(item => [item.data?.department, item.data?.currentDepartment, item.data?.targetDepartment])
  ]).sort((a, b) => {
    const nameA = getDepartment(a)?.name || a;
    const nameB = getDepartment(b)?.name || b;
    return nameA.localeCompare(nameB, 'ru-RU');
  });
  const toggleValue = (setter, current, value) => setter(current.includes(value) ? current.filter(entry => entry !== value) : [...current, value]);
  const resetFilters = () => {
    setDateFrom(''); setDateTo('');
    setSelectedDepartments([]); setSelectedStatuses([]);
  };
  const activeFilterCount = selectedDepartments.length + selectedStatuses.length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);
  const getSubmittedDate = item => {
    if (!item.submittedAt) return null;
    const parsed = new Date(item.submittedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const connectedCategories = ['report', 'highrank', 'promotion', 'transfer', 'transfer-to-lspd', 'hiring', 'resignation', 'reinstatement'];
  const activeCategoryLabel = activeCategory === 'all' ? 'Все заявления' : FORM_CATEGORY_GROUPS.flatMap(group => group.items).find(category => category.id === activeCategory)?.label || 'Категория';
  const visibleItems = items.filter(item => {
    if (activeCategory !== 'all' && item.type !== activeCategory) return false;
    const submitted = getSubmittedDate(item);
    const submittedDay = submitted ? new Date(submitted.getFullYear(), submitted.getMonth(), submitted.getDate()) : null;
    const fromDay = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const toDay = dateTo ? new Date(dateTo + 'T23:59:59.999') : null;
    const department = String(item.data?.department || '');
    const haystack = [item.number, item.submitter?.username, item.submitter?.id, item.reviewer?.username, item.reviewer?.id, ...Object.values(item.data || {})]
      .join(' ').toLocaleLowerCase('ru-RU');
    return (!normalizedSearch || haystack.includes(normalizedSearch))
      && (!dateFrom || (submittedDay && submittedDay >= fromDay))
      && (!dateTo || (submittedDay && submittedDay <= toDay))
      && (!selectedDepartments.length || [department, item.data?.currentDepartment, item.data?.targetDepartment].filter(Boolean).some(value => selectedDepartments.includes(String(value))))
      && (!selectedStatuses.length || selectedStatuses.includes(item.status));
  });
  const sortedVisibleItems = visibleItems.slice().sort((a, b) => {
    const dateA = getSubmittedDate(a)?.getTime() ?? 0;
    const dateB = getSubmittedDate(b)?.getTime() ?? 0;
    return sortOrder === 'oldest' ? dateA - dateB : dateB - dateA;
  });

  return (
    <PageLayout user={user}>
        <AdminSectionHeader title="Кадровый аудит" description="Единый реестр кадровых заявлений: просмотр, доставка в Discord и фиксация решений проверяющих." backHref="/" backLabel="НА ГЛАВНУЮ" />
        {error && <div role="alert" style={{ ...panel, borderColor: 'rgba(220,53,69,.5)', color: '#ff9aa4' }}>{error}</div>}
        <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12 }}>
          <div><div style={label}>ВСЕГО</div><div style={{ ...value, fontSize: 23, fontWeight: 800 }}>{items.length}</div></div>
          <div><div style={label}>ОЖИДАЮТ</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#dfc58f' }}>{counts.pending || 0}</div></div>
          <div><div style={label}>ОДОБРЕНО</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#81c784' }}>{counts.accepted || 0}</div></div>
          <div><div style={label}>ОТКЛОНЕНО</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#ff7b88' }}>{counts.rejected || 0}</div></div>
        </div>
        <div className="hr-audit-layout">
          <aside className={`hr-audit-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
            <div className="hr-audit-sidebar-head">
              {!sidebarCollapsed && <span className="hr-audit-sidebar-caption">РАЗДЕЛЫ АУДИТА</span>}
              <button type="button" className="hr-audit-collapse" onClick={() => setSidebarCollapsed(value => !value)} aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'} title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}>{sidebarCollapsed ? '»' : '«'}</button>
            </div>
            <button type="button" className={`hr-audit-nav-item${activeCategory === 'all' ? ' is-active' : ''}`} onClick={() => setActiveCategory('all')} title="Все заявления">
              <span className="hr-audit-nav-icon">▦</span>{!sidebarCollapsed && <><span className="hr-audit-nav-label">Все заявления</span><span className="hr-audit-nav-count">{items.length}</span></>}
            </button>
            {FORM_CATEGORY_GROUPS.map(group => <div className="hr-audit-nav-group" key={group.title}>
              {!sidebarCollapsed && <div className="hr-audit-nav-group-title">{group.title}</div>}
              {group.items.map(category => {
                const connected = connectedCategories.includes(category.id);
                const count = items.filter(item => item.type === category.id).length;
                return <button type="button" key={category.id} className={`hr-audit-nav-item${activeCategory === category.id ? ' is-active' : ''}`} onClick={() => setActiveCategory(category.id)} title={category.label}>
                  <span className="hr-audit-nav-icon">{category.icon}</span>
                  {!sidebarCollapsed && <><span className="hr-audit-nav-label">{category.label}</span>{connected ? <span className="hr-audit-nav-count">{count}</span> : <span className="hr-audit-nav-soon">СКОРО</span>}</>}
                </button>;
              })}
            </div>)}
            {!sidebarCollapsed && <div className="hr-audit-sidebar-note">В кадровом реестре отображаются все кадровые формы.</div>}
          </aside>
          <div className="hr-audit-main">
            <div className="hr-audit-main-heading">
              <div><div className="hr-audit-main-eyebrow">ТЕКУЩИЙ РАЗДЕЛ</div><h2>{activeCategoryLabel}</h2></div>
              <div className="hr-audit-main-total">{activeCategory === 'all' ? items.length : items.filter(item => item.type === activeCategory).length} ЗАЯВЛЕНИЙ</div>
            </div>
        <div className="hr-audit-search-panel">
          <div className="hr-audit-search-field">
            <input aria-label="Поиск по заявкам" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по номеру, имени, Discord ID…" />
            <span aria-hidden="true">⌕</span>
          </div>
          <div className="hr-audit-search-hint">Поиск применяется сразу</div>
        </div>

        <div className="hr-audit-list-toolbar">
          <div style={label}>ПОКАЗАНО: {visibleItems.length} ИЗ {items.length}</div>
          <label className="hr-audit-sort-control">СОРТИРОВКА
            <select aria-label="Сортировка заявлений" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
            </select>
          </label>
        </div>
        {loading ? <div style={panel}>Загрузка реестра…</div> : items.length === 0 && error ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>Не удалось получить список заявок. Проверьте соединение и перезагрузите страницу.</div> : activeCategory !== 'all' && !connectedCategories.includes(activeCategory) ? <div className="hr-audit-empty"><div className="hr-audit-empty-icon">⌁</div><h3>Раздел готовится к подключению</h3><p>Навигация для этой категории уже создана. Интеграция формы и её обработка будут добавлены отдельно.</p><span>ПОКА НЕТ ПОДКЛЮЧЁННЫХ ЗАЯВЛЕНИЙ</span></div> : items.length === 0 ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>Заявок пока нет. Новые кадровые заявления появятся здесь.</div> : visibleItems.length === 0 ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>По заданным условиям заявки не найдены.</div> : sortedVisibleItems.map(item => {
          const [statusText, statusColor] = status(item);
          return <section id={`audit-item-${item.id}`} key={item.id} className="hr-audit-card" style={panel}>
            <button type="button" className="hr-audit-card-summary" aria-expanded={expandedItems.has(item.id)} aria-controls={`audit-details-${item.id}`} onClick={() => setExpandedItems(prev => { const next = new Set(prev); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>
              <span className="hr-audit-card-summary-main"><strong>{TYPE_LABELS[item.type] || item.title || 'Заявка'} · №{item.number}</strong><span>{item.data?.fullName || item.submitter?.username || 'Заявитель не указан'}</span></span>
              <span className="hr-audit-card-summary-meta"><span>{item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('ru-RU') : 'Дата не указана'}</span><span className="hr-audit-card-status" style={{ color: statusColor, borderColor: statusColor }}>{statusText}</span><span className={`hr-audit-card-chevron${expandedItems.has(item.id) ? ' is-open' : ''}`}>⌄</span></span>
            </button>
            {expandedItems.has(item.id) && <div className="hr-audit-card-details" id={`audit-details-${item.id}`}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: '#fff' }}>{TYPE_LABELS[item.type] || item.title || 'Заявка'} · №{item.number}</h2>
              <span style={{ color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '5px 9px', fontSize: 11, fontWeight: 700 }}>{statusText}</span>
            </div>
            <div style={{ border: '1px solid rgba(197,163,106,.24)', borderRadius: 6, padding: 14, marginBottom: 18, background: 'rgba(197,163,106,.055)' }}>
              <div style={{ ...label, color: '#d7bd8c' }}>ЧТО ИМЕННО РАССМАТРИВАЕТСЯ</div>
              <div style={{ ...value, fontWeight: 700, marginBottom: 5 }}>{getActionSummary(item).title}</div>
              <div style={{ ...value, color: '#cbd5e1', fontSize: 13 }}>{getActionSummary(item).text}</div>
              {getActionSummary(item).details && <div style={{ ...value, color: '#e5d4b3', fontSize: 13, marginTop: 8 }}>{getActionSummary(item).details}</div>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginBottom: 18 }}>
              <div><div style={label}>ЗАЯВИТЕЛЬ</div><div style={value}>{item.data?.fullName || item.submitter?.username || 'Не указано'}</div><div style={{ ...value, color: '#9ca3af', fontSize: 12 }}>Discord: {item.submitter?.id || '—'}</div></div>
              {item.type === 'highrank' ? <>
                <div><div style={label}>ТИП ЗАЯВКИ</div><div style={value}>Повышение хай-состава</div></div>
                <div><div style={label}>ДИАПАЗОН РАНГОВ</div><div style={value}>{displayFieldValue('rankRange', item.data?.rankRange)}</div></div>
              </> : item.type === 'promotion' ? <>
                <div><div style={label}>ТИП ЗАЯВКИ</div><div style={value}>Автоматический запрос после одобрения отчёта хайранга</div></div>
                <div><div style={label}>ДИАПАЗОН РАНГОВ</div><div style={value}>{displayFieldValue('rankRange', item.data?.rankRange)}</div></div>
              </> : <>
                <div><div style={label}>ТИП ЗАЯВКИ</div><div style={value}>{TYPE_LABELS[item.type] || item.title || 'Кадровый процесс'}</div></div>
                {item.data?.department && <div><div style={label}>ОТДЕЛ</div><div style={value}>{displayFieldValue('department', item.data.department)}</div></div>}
              </>}
              <div><div style={label}>ОТПРАВЛЕНО</div><div style={value}>{item.submittedAt ? new Date(item.submittedAt).toLocaleString('ru-RU') : '—'}</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              {Object.entries(item.data || {}).filter(([key]) => item.type === 'highrank'
                ? !['fullName', 'rankRange'].includes(key)
                 : item.type === 'promotion' ? !['fullName', 'rankRange'].includes(key) : !['fullName'].includes(key)).map(([key, val]) => <div key={key}><div style={label}>{FIELD_LABELS[key] || key}</div><div style={value}>{renderFieldContent(key, val)}</div></div>)}
            </div>
            {item.status === 'pending' ? <div style={{ marginTop: 22, borderTop: '1px solid rgba(197,163,106,.16)', paddingTop: 18 }}>
              <label style={{ ...label, display: 'block' }}>ПРИЧИНА ОТКАЗА (ОБЯЗАТЕЛЬНО ПРИ ОТКЛОНЕНИИ)</label>
              <textarea value={reasons[item.id] || ''} onChange={e => setReasons(prev => ({ ...prev, [item.id]: e.target.value }))} maxLength={1000} rows={3} placeholder="Укажи причину, если отклоняешь заявку…" style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 14px', padding: 12, resize: 'vertical', background: '#151515', border: '1px solid rgba(197,163,106,.3)', borderRadius: 4, color: '#fff', font: '14px inherit' }} />
              {item.deliveryPending && <div style={{ marginBottom: 12, color: '#dfc58f' }}>{item.deliveryUnconfirmed ? 'Ответ Discord не подтверждён. Сначала вручную проверь канал, чтобы исключить дубликат.' : 'Доставка в Discord не подтверждена. Можно повторить отправку.'}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {item.deliveryPending && !item.deliveryUnconfirmed && <button disabled={busy === item.id} onClick={() => retryDelivery(item)} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ПОВТОРИТЬ ОТПРАВКУ</button>}
                <button disabled={busy === item.id || item.deliveryPending} onClick={() => decide(item, 'accepted')} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ОДОБРИТЬ</button>
                <button disabled={busy === item.id || item.deliveryPending} onClick={() => decide(item, 'rejected')} style={{ ...button('red'), opacity: busy === item.id ? .5 : 1 }}>ОТКЛОНИТЬ</button>
              </div>
            </div> : <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(197,163,106,.16)' }}>
              <div style={label}>РЕШЕНИЕ</div><div style={value}>{item.reviewer?.username} · {item.reviewer?.id} · {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString('ru-RU') : ''}</div>
              {item.reason && <><div style={{ ...label, marginTop: 12 }}>ПРИЧИНА</div><div style={value}>{item.reason}</div></>}
              {item.promotionRequest?.id && <div style={{ marginTop: 12 }}>
                <div style={label}>СВЯЗАННЫЙ ЗАПРОС НА ПОВЫШЕНИЕ</div>
                <a href={`/las-vegas/audit?id=${encodeURIComponent(item.promotionRequest.id)}`} style={{ color: '#d7bd8c', textDecoration: 'underline', fontSize: 13 }}>
                  Открыть автоматически созданный запрос №{item.promotionRequest.number || item.promotionRequest.id}
                </a>
              </div>}
              {item.status === 'accepted' && item.auditDeliveryState === 'failed' && !item.auditMessageId && !item.auditDeliveryUnconfirmed && <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: '#dfc58f' }}>Решение сохранено, но Discord отклонил кадровую карточку. Можно безопасно повторить публикацию.</span>
                <button disabled={busy === item.id} onClick={() => retryPersonnelAudit(item)} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ПОВТОРИТЬ ПУБЛИКАЦИЮ В КАДРОВЫЙ АУДИТ</button>
              </div>}
              {item.notificationPending && <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: '#dfc58f' }}>{item.auditDeliveryUnconfirmed ? 'Кадровый канал мог принять сообщение, но подтверждение не получено. Проверьте канал вручную; повтор заблокирован во избежание дубликата.' : 'Уведомление кадрового аудита ожидает отправки или подтверждения.'}</span>
                {!item.auditDeliveryUnconfirmed && <button disabled={busy === item.id} onClick={() => retryNotification(item)} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ПОВТОРИТЬ УВЕДОМЛЕНИЕ</button>}
              </div>}
            </div>}
            {Array.isArray(item.history) && item.history.length > 0 && <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(197,163,106,.16)' }}>
              <div style={{ ...label, marginBottom: 10 }}>ИСТОРИЯ ДЕЙСТВИЙ</div>
              <div className="hr-audit-history-timeline">
                {item.history.slice().reverse().map((entry, index) => <div className="hr-audit-history-entry" key={`${item.id}-history-${index}`} style={{ ...value, fontSize: 12, color: '#aeb8c7' }}>
                  <strong style={{ color: '#e5e7eb' }}>{entry.action === 'submitted' ? 'Заявка создана' : entry.action === 'accepted' ? 'Заявка одобрена' : entry.action === 'rejected' ? 'Заявка отклонена' : entry.action === 'delivered' ? 'Доставлено в Discord' : entry.action === 'delivery_attempted' ? 'Начата доставка в Discord' : entry.action === 'delivery_retry_attempted' ? 'Повтор доставки начат' : entry.action === 'delivery_retry_unconfirmed' ? 'Ответ Discord не подтверждён' : entry.action === 'delivery_pending' ? 'Ожидает подтверждения доставки' : entry.action === 'delivery_unconfirmed' ? 'Доставка не подтверждена; повтор заблокирован' : entry.action === 'notification_attempted' ? 'Начата отправка уведомления' : entry.action === 'notification_retry_attempted' ? 'Повтор уведомления начат' : entry.action === 'notification_sent' ? 'Уведомление отправлено' : entry.action === 'notification_pending' ? 'Уведомление ожидает отправки' : entry.action === 'notification_retry_failed' ? 'Повтор уведомления не удался' : entry.action === 'personnel_audit_delivery_attempted' ? 'Начата публикация в кадровый аудит' : entry.action === 'personnel_audit_sent' ? 'Карточка кадрового действия опубликована' : entry.action === 'personnel_audit_delivery_failed' ? 'Discord отклонил карточку кадрового действия' : entry.action === 'personnel_audit_delivery_unconfirmed' ? 'Доставка карточки кадрового действия не подтверждена' : entry.action === 'delivery_retry_failed' ? 'Повтор доставки не удался' : entry.action}</strong>
                  {' · '}{entry.at ? new Date(entry.at).toLocaleString('ru-RU') : 'Время не указано'}
                  {' · Discord ID: '}{entry.userId || 'не указан'}
                  {entry.reason && <div style={{ marginTop: 3, color: '#cbd5e1' }}>Причина: {entry.reason}</div>}
                </div>)}
              </div>
            </div>}

            </div>}
          </section>;
        })}
          </div>
          <aside className="hr-audit-filters" aria-label="Фильтры заявлений">
            <div className="hr-audit-filters-head"><span>ФИЛЬТРЫ</span>{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</div>
            <div className="hr-audit-filter-section">
              <div style={label}>ДАТА ПОДАЧИ</div>
              <div className="hr-audit-date-fields">
                <input aria-label="Дата от" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInputStyle}/>
                <input aria-label="Дата до" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInputStyle}/>
              </div>
            </div>
            <div className="hr-audit-filter-section"><FilterGroup title="ОТДЕЛ" options={departmentOptions.map(value => ({ value, label: displayFieldValue('department', value) }))} selected={selectedDepartments} onToggle={value => toggleValue(setSelectedDepartments, selectedDepartments, value)} /></div>
            <div className="hr-audit-filter-section"><FilterGroup title="СТАТУС" options={Object.entries(STATUS_LABELS).filter(([value]) => value !== 'all').map(([value, label]) => ({ value, label }))} selected={selectedStatuses} onToggle={value => toggleValue(setSelectedStatuses, selectedStatuses, value)} /></div>
            <button type="button" className="hr-audit-reset-filters" onClick={resetFilters} disabled={activeFilterCount === 0}>СБРОСИТЬ ФИЛЬТРЫ</button>
          </aside>
        </div>
    </PageLayout>
  );
}

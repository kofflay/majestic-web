import { useEffect, useState } from 'react';
import PageLayout from '../components/PageLayout';
import AdminSectionHeader from '../components/AdminSectionHeader';
import { verifyToken } from '../lib/discord';
import { hasHrAuditAccess } from '../lib/hr-audit-access';
import { getDepartment } from '../lib/departments';

const panel = {
  background: 'rgba(11,15,22,.72)',
  border: '1px solid rgba(148,163,184,.15)',
  borderRadius: 6,
  padding: 22,
  marginBottom: 16,
  color: '#e5e7eb'
};
const label = { color: '#7f8a9a', fontSize: 11, letterSpacing: 1, fontFamily: "'DM Mono', monospace", marginBottom: 6 };
const value = { color: '#f3f4f6', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const filterInputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 8px', background: '#080c12', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4, color: '#fff', fontSize: 12, fontFamily: 'inherit', colorScheme: 'dark' };
const chipStyle = { background: 'rgba(96,165,250,.1)', border: '1px solid rgba(96,165,250,.3)', color: '#bfdbfe', borderRadius: 4, padding: '5px 8px', cursor: 'pointer', fontSize: 11 };
function FilterGroup({ title, options, selected, onToggle }) {
  return <div>
    <div style={label}>{title}</div>
    <div style={{ maxHeight: 150, overflowY: 'auto', display: 'grid', gap: 7, padding: '3px 1px' }}>
      {options.length ? options.map(option => <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
        <span>{option.label}</span>
      </label>) : <span style={{ color: '#7f8a9a', fontSize: 12 }}>Нет данных</span>}
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
  workLink: 'Ссылка на проделанную работу'
};

const STATUS_LABELS = {
  all: 'Все заявки',
  pending: 'Ожидают',
  accepted: 'Одобрены',
  rejected: 'Отклонены'
};

function displayFieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'isInstructor') return value === 'yes' ? 'Да' : value === 'no' ? 'Нет' : String(value);
  if (key === 'department') {
    const department = getDepartment(value);
    return department ? department.name : String(value);
  }
  return String(value);
}

function renderFieldContent(key, value) {
  if (!['workLinks', 'workLink'].includes(key) || !value) return displayFieldValue(key, value);
  const parts = String(value).split(/(https?:\/\/[^\s,]+)/gi);
  return parts.map((part, index) => /^https?:\/\//i.test(part)
    ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#81c784', textDecoration: 'underline', overflowWrap: 'anywhere' }}>{part}</a>
    : part);
}

export default function HrAuditPage() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDepartments, setSelectedDepartments] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [selectedReviewers, setSelectedReviewers] = useState([]);

  const load = async () => {
    setError('');
    try {
      const response = await fetch('/api/admin/hr-audit');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить заявки');
      setItems(data.items || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => setUser(d.user || null)).catch(() => {});
    load();
  }, []);

  const decide = async (item, decision) => {
    const reason = reasons[item.id] || '';
    if (decision === 'rejected' && !reason.trim()) {
      setError('Для отказа обязательно укажи причину.');
      return;
    }
    if (!window.confirm(decision === 'accepted' ? `Одобрить заявку №${item.number}?` : `Отклонить заявку №${item.number}?`)) return;
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/api/admin/hr-audit', {
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
      const response = await fetch('/api/admin/hr-audit', {
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

  const retryNotification = async item => {
    setBusy(item.id); setError('');
    try {
      const response = await fetch('/api/admin/hr-audit', {
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

  const status = item => item.status === 'pending' ? ['ОЖИДАЕТ', '#ffb74d'] : item.status === 'accepted' ? ['ОДОБРЕНО', '#81c784'] : ['ОТКЛОНЕНО', '#ff7b88'];
  const counts = items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
  const TYPE_LABELS = {
    report: 'Отчёт о повышении',
    highrank: 'Повышение хай-состава'
  };
  const uniqueValues = values => Array.from(new Set(values.filter(value => value !== null && value !== undefined && String(value).trim() !== '').map(String)));
  const departmentOptions = uniqueValues(items.map(item => item.data?.department)).sort((a, b) => {
    const nameA = getDepartment(a)?.name || a;
    const nameB = getDepartment(b)?.name || b;
    return nameA.localeCompare(nameB, 'ru-RU');
  });
  const employeeOptions = uniqueValues(items.map(item => item.data?.fullName || item.submitter?.username || item.submitter?.id)).sort((a, b) => a.localeCompare(b, 'ru-RU'));
  const reviewerOptions = uniqueValues(items.filter(item => item.reviewer).map(item => item.reviewer.username || item.reviewer.id)).sort((a, b) => a.localeCompare(b, 'ru-RU'));
  const toggleValue = (setter, current, value) => setter(current.includes(value) ? current.filter(entry => entry !== value) : [...current, value]);
  const resetFilters = () => {
    setDateFrom(''); setDateTo('');
    setSelectedDepartments([]); setSelectedTypes([]); setSelectedStatuses([]);
    setSelectedEmployees([]); setSelectedReviewers([]);
  };
  const activeFilterCount = selectedDepartments.length + selectedTypes.length + selectedStatuses.length
    + selectedEmployees.length + selectedReviewers.length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);
  const getSubmittedDate = item => {
    if (!item.submittedAt) return null;
    const parsed = new Date(item.submittedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const visibleItems = items.filter(item => {
    const submitted = getSubmittedDate(item);
    const submittedDay = submitted ? new Date(submitted.getFullYear(), submitted.getMonth(), submitted.getDate()) : null;
    const fromDay = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const toDay = dateTo ? new Date(dateTo + 'T23:59:59.999') : null;
    const department = String(item.data?.department || '');
    const type = String(item.type || '');
    const employee = String(item.data?.fullName || item.submitter?.username || item.submitter?.id || '');
    const reviewer = String(item.reviewer?.username || item.reviewer?.id || '');
    const haystack = [item.number, item.submitter?.username, item.submitter?.id, item.reviewer?.username, item.reviewer?.id, ...Object.values(item.data || {})]
      .join(' ').toLocaleLowerCase('ru-RU');
    return (!normalizedSearch || haystack.includes(normalizedSearch))
      && (!dateFrom || (submittedDay && submittedDay >= fromDay))
      && (!dateTo || (submittedDay && submittedDay <= toDay))
      && (!selectedDepartments.length || selectedDepartments.includes(department))
      && (!selectedTypes.length || selectedTypes.includes(type))
      && (!selectedStatuses.length || selectedStatuses.includes(item.status))
      && (!selectedEmployees.length || selectedEmployees.includes(employee))
      && (!selectedReviewers.length || selectedReviewers.includes(reviewer));
  });

  return (
    <PageLayout user={user}>
        <AdminSectionHeader title="Кадровый аудит" description="Реестр отчётов на повышение: просмотр заявок, доставка в Discord и фиксация решения проверяющего." backHref="/" backLabel="НА ГЛАВНУЮ" />
        {error && <div role="alert" style={{ ...panel, borderColor: 'rgba(220,53,69,.5)', color: '#ff9aa4' }}>{error}</div>}
        <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12 }}>
          <div><div style={label}>ВСЕГО</div><div style={{ ...value, fontSize: 23, fontWeight: 800 }}>{items.length}</div></div>
          <div><div style={label}>ОЖИДАЮТ</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#ffb74d' }}>{counts.pending || 0}</div></div>
          <div><div style={label}>ОДОБРЕНО</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#81c784' }}>{counts.accepted || 0}</div></div>
          <div><div style={label}>ОТКЛОНЕНО</div><div style={{ ...value, fontSize: 23, fontWeight: 800, color: '#ff7b88' }}>{counts.rejected || 0}</div></div>
        </div>
        <div style={{ ...panel, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <input aria-label="Поиск по заявкам" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по номеру, имени, Discord ID…" style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 38px', background: '#080c12', border: '1px solid rgba(148,163,184,.25)', borderRadius: 5, color: '#fff', fontSize: 14, fontFamily: 'inherit' }} />
              <span aria-hidden="true" style={{ position: 'absolute', left: 13, top: 10, color: '#7f8a9a' }}>⌕</span>
            </div>
            <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)} style={{ ...button('green'), background: filtersOpen ? 'rgba(76,175,80,.16)' : 'transparent', color: '#e5e7eb', borderColor: filtersOpen ? 'rgba(76,175,80,.55)' : 'rgba(148,163,184,.3)', whiteSpace: 'nowrap' }}>
              ФИЛЬТРЫ{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </button>
          </div>
          {activeFilterCount > 0 && <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
            {selectedDepartments.map(value => <button key={value} onClick={() => toggleValue(setSelectedDepartments, selectedDepartments, value)} style={chipStyle}>{displayFieldValue('department', value)} ×</button>)}
            {selectedTypes.map(value => <button key={value} onClick={() => toggleValue(setSelectedTypes, selectedTypes, value)} style={chipStyle}>{TYPE_LABELS[value] || value} ×</button>)}
            {selectedStatuses.map(value => <button key={value} onClick={() => toggleValue(setSelectedStatuses, selectedStatuses, value)} style={chipStyle}>{STATUS_LABELS[value] || value} ×</button>)}
            {selectedEmployees.map(value => <button key={value} onClick={() => toggleValue(setSelectedEmployees, selectedEmployees, value)} style={chipStyle}>{value} ×</button>)}
            {selectedReviewers.map(value => <button key={value} onClick={() => toggleValue(setSelectedReviewers, selectedReviewers, value)} style={chipStyle}>Проверяющий: {value} ×</button>)}
            {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={chipStyle}>Дата: {dateFrom || '…'} — {dateTo || '…'} ×</button>}
            <button onClick={resetFilters} style={{ ...chipStyle, color: '#ff9aa4' }}>Сбросить всё</button>
          </div>}
          {filtersOpen && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.15)' }}>
            <div>
              <div style={label}>ДАТА ПОДАЧИ</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                <input aria-label="Дата от" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInputStyle}/>
                <input aria-label="Дата до" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInputStyle}/>
              </div>
            </div>
            <FilterGroup title="ОТДЕЛ" options={departmentOptions.map(value => ({ value, label: displayFieldValue('department', value) }))} selected={selectedDepartments} onToggle={value => toggleValue(setSelectedDepartments, selectedDepartments, value)} />
            <FilterGroup title="ТИП ЗАЯВКИ" options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} selected={selectedTypes} onToggle={value => toggleValue(setSelectedTypes, selectedTypes, value)} />
            <FilterGroup title="СТАТУС" options={Object.entries(STATUS_LABELS).filter(([value]) => value !== 'all').map(([value, label]) => ({ value, label }))} selected={selectedStatuses} onToggle={value => toggleValue(setSelectedStatuses, selectedStatuses, value)} />
            <FilterGroup title="СОТРУДНИК" options={employeeOptions.map(value => ({ value, label: value }))} selected={selectedEmployees} onToggle={value => toggleValue(setSelectedEmployees, selectedEmployees, value)} />
            <FilterGroup title="ПРОВЕРЯЮЩИЙ" options={reviewerOptions.map(value => ({ value, label: value }))} selected={selectedReviewers} onToggle={value => toggleValue(setSelectedReviewers, selectedReviewers, value)} />
          </div>}
        </div>

        <div style={{ ...label, margin: '0 0 12px 4px' }}>ПОКАЗАНО: {visibleItems.length} ИЗ {items.length}</div>
        {loading ? <div style={panel}>Загрузка реестра…</div> : items.length === 0 && error ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>Не удалось получить список заявок. Проверьте соединение и перезагрузите страницу.</div> : items.length === 0 ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>Заявок пока нет. Новые отчёты на повышение появятся здесь.</div> : visibleItems.length === 0 ? <div style={{ ...panel, textAlign: 'center', color: '#9ca3af' }}>По заданным условиям заявки не найдены.</div> : visibleItems.map(item => {
          const [statusText, statusColor] = status(item);
          return <section key={item.id} style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: '#fff' }}>{item.type === 'highrank' ? 'Повышение хай-состава' : 'Отчёт о повышении'} · №{item.number}</h2>
              <span style={{ color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '5px 9px', fontSize: 11, fontWeight: 700 }}>{statusText}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginBottom: 18 }}>
              <div><div style={label}>ЗАЯВИТЕЛЬ</div><div style={value}>{item.data?.fullName || item.submitter?.username || 'Не указано'}</div><div style={{ ...value, color: '#9ca3af', fontSize: 12 }}>Discord: {item.submitter?.id || '—'}</div></div>
              {item.type === 'highrank' ? <>
                <div><div style={label}>ТИП ЗАЯВКИ</div><div style={value}>Повышение хай-состава</div></div>
                <div><div style={label}>ДИАПАЗОН РАНГОВ</div><div style={value}>{displayFieldValue('rankRange', item.data?.rankRange)}</div></div>
              </> : <>
                <div><div style={label}>ОТДЕЛ</div><div style={value}>{displayFieldValue('department', item.data?.department)}</div></div>
                <div><div style={label}>ТЕКУЩИЙ / НОВЫЙ РАНГ</div><div style={value}>{item.data?.currentRank || '—'} → {item.data?.targetRank || '—'}</div></div>
              </>}
              <div><div style={label}>ОТПРАВЛЕНО</div><div style={value}>{item.submittedAt ? new Date(item.submittedAt).toLocaleString('ru-RU') : '—'}</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              {Object.entries(item.data || {}).filter(([key]) => item.type === 'highrank'
                ? !['fullName', 'rankRange'].includes(key)
                : !['fullName', 'department', 'currentRank', 'targetRank'].includes(key)).map(([key, val]) => <div key={key}><div style={label}>{FIELD_LABELS[key] || key}</div><div style={value}>{renderFieldContent(key, val)}</div></div>)}
            </div>
            {item.status === 'pending' ? <div style={{ marginTop: 22, borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 18 }}>
              <label style={{ ...label, display: 'block' }}>ПРИЧИНА ОТКАЗА (ОБЯЗАТЕЛЬНО ПРИ ОТКЛОНЕНИИ)</label>
              <textarea value={reasons[item.id] || ''} onChange={e => setReasons(prev => ({ ...prev, [item.id]: e.target.value }))} maxLength={1000} rows={3} placeholder="Укажи причину, если отклоняешь заявку…" style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 14px', padding: 12, resize: 'vertical', background: '#080c12', border: '1px solid rgba(148,163,184,.25)', borderRadius: 4, color: '#fff', font: '14px inherit' }} />
              {item.deliveryPending && <div style={{ marginBottom: 12, color: '#ffb74d' }}>Доставка в Discord не подтверждена. При сетевом сбое сообщение могло быть принято; перед повтором проверь канал отдела.</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {item.deliveryPending && <button disabled={busy === item.id} onClick={() => retryDelivery(item)} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ПОВТОРИТЬ ОТПРАВКУ</button>}
                <button disabled={busy === item.id || item.deliveryPending} onClick={() => decide(item, 'accepted')} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ОДОБРИТЬ</button>
                <button disabled={busy === item.id || item.deliveryPending} onClick={() => decide(item, 'rejected')} style={{ ...button('red'), opacity: busy === item.id ? .5 : 1 }}>ОТКЛОНИТЬ</button>
              </div>
            </div> : <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.12)' }}>
              <div style={label}>РЕШЕНИЕ</div><div style={value}>{item.reviewer?.username} · {item.reviewer?.id} · {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString('ru-RU') : ''}</div>
              {item.reason && <><div style={{ ...label, marginTop: 12 }}>ПРИЧИНА</div><div style={value}>{item.reason}</div></>}
              {item.notificationPending && <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: '#ffb74d' }}>Уведомление Discord ожидает повторной отправки.</span>
                <button disabled={busy === item.id} onClick={() => retryNotification(item)} style={{ ...button('green'), opacity: busy === item.id ? .5 : 1 }}>ПОВТОРИТЬ УВЕДОМЛЕНИЕ</button>
              </div>}
            </div>}
            {Array.isArray(item.history) && item.history.length > 0 && <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.12)' }}>
              <div style={{ ...label, marginBottom: 10 }}>ИСТОРИЯ ДЕЙСТВИЙ</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {item.history.slice().reverse().map((entry, index) => <div key={`${item.id}-history-${index}`} style={{ ...value, fontSize: 12, color: '#aeb8c7' }}>
                  <strong style={{ color: '#e5e7eb' }}>{entry.action === 'submitted' ? 'Заявка создана' : entry.action === 'accepted' ? 'Заявка одобрена' : entry.action === 'rejected' ? 'Заявка отклонена' : entry.action === 'delivered' ? 'Доставлено в Discord' : entry.action === 'delivery_attempted' ? 'Начата доставка в Discord' : entry.action === 'delivery_retry_attempted' ? 'Повтор доставки начат' : entry.action === 'delivery_retry_unconfirmed' ? 'Ответ Discord не подтверждён' : entry.action === 'delivery_pending' ? 'Ожидает подтверждения доставки' : entry.action === 'notification_attempted' ? 'Начата отправка уведомления' : entry.action === 'notification_retry_attempted' ? 'Повтор уведомления начат' : entry.action === 'notification_sent' ? 'Уведомление отправлено' : entry.action === 'notification_pending' ? 'Уведомление ожидает отправки' : entry.action === 'notification_retry_failed' ? 'Повтор уведомления не удался' : entry.action === 'delivery_retry_failed' ? 'Повтор доставки не удался' : entry.action}</strong>
                  {' · '}{entry.at ? new Date(entry.at).toLocaleString('ru-RU') : 'Время не указано'}
                  {' · Discord ID: '}{entry.userId || 'не указан'}
                  {entry.reason && <div style={{ marginTop: 3, color: '#cbd5e1' }}>Причина: {entry.reason}</div>}
                </div>)}
              </div>
            </div>}
          </section>;
        })}
    </PageLayout>
  );
}

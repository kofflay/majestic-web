// pages/profile.js
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { DEPARTMENTS } from '../lib/departments';
import PageLayout from '../components/PageLayout';

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ fullName: '', department: '' });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingDept, setEditingDept] = useState(false);
  const [newName, setNewName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingDepartment, setSavingDepartment] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [historyDetails, setHistoryDetails] = useState(null);
  const [historyDetailsLoading, setHistoryDetailsLoading] = useState(false);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    fetch('/api/me')
      .then(response => response.json())
      .then(data => {
        if (!data.user) {
          router.push('/');
          return;
        }
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => router.replace('/'));

    fetch('/api/profile')
      .then(response => response.json())
      .then(data => {
        const nextProfile = data?.profile || { fullName: '', department: '' };
        setProfile(nextProfile);
        setNewName(nextProfile.fullName || '');
      })
      .catch(() => window.toast?.error('Не удалось загрузить данные профиля.'));

    fetch('/api/profile/avatar')
      .then(response => response.json())
      .then(data => {
        if (data?.avatarUrl) setAvatarUrl(data.avatarUrl);
      })
      .catch(() => window.toast?.error('Не удалось загрузить фото профиля.'));

    fetch('/api/stats')
      .then(response => response.json())
      .then(data => {
        setHistory(Array.isArray(data?.history) ? data.history : []);
      })
      .catch(() => window.toast?.error('Не удалось загрузить историю обращений.'))
      .finally(() => setHistoryLoading(false));
  }, []);

  const saveName = async () => {
    const value = newName.trim();
    if (!value) {
      window.toast.error('Укажите имя и фамилию.');
      return;
    }

    setSavingName(true);
    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить имя.');
      setProfile(data.profile);
      setNewName(data.profile?.fullName || value);
      setEditingName(false);
      window.toast.success('Имя сохранено!');
    } catch (error) {
      window.toast.error(error.message || 'Не удалось сохранить имя.');
    } finally {
      setSavingName(false);
    }
  };

  const saveDepartment = async (departmentId) => {
    setSavingDepartment(true);
    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department: departmentId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить отдел.');
      setProfile(data.profile);
      setEditingDept(false);
      window.toast.success(departmentId ? 'Отдел обновлён!' : 'Отдел убран');
    } catch (error) {
      window.toast.error(error.message || 'Не удалось обновить отдел.');
    } finally {
      setSavingDepartment(false);
    }
  };

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      window.toast.error('Выберите файл изображения.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      window.toast.error('Исходный файл слишком большой. Максимум 10 МБ.');
      return;
    }

    setSavingAvatar(true);
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 12000 || bitmap.height > 12000) {
        bitmap.close?.();
        throw new Error('Слишком большое разрешение изображения.');
      }

      const size = 512;
      const crop = Math.min(bitmap.width, bitmap.height);
      const sx = (bitmap.width - crop) / 2;
      const sy = (bitmap.height - crop) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        bitmap.close?.();
        throw new Error('Не удалось обработать изображение.');
      }

      context.drawImage(bitmap, sx, sy, crop, crop, 0, 0, size, size);
      bitmap.close?.();
      let avatar = canvas.toDataURL('image/jpeg', 0.84);
      if (avatar.length > 340000) avatar = canvas.toDataURL('image/jpeg', 0.72);
      if (avatar.length > 340000) avatar = canvas.toDataURL('image/jpeg', 0.6);
      if (avatar.length > 340000) {
        throw new Error('Выберите другое фото: его не удалось сжать до допустимого размера.');
      }

      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить фото.');
      setAvatarUrl(data.avatarUrl);
      window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: data.avatarUrl }));
      window.toast.success('Фото профиля обновлено!');
    } catch (error) {
      window.toast.error(error.message || 'Не удалось обработать изображение.');
    } finally {
      setSavingAvatar(false);
    }
  };

  const openHistoryDetails = async (item) => {
    setSelectedHistory(item);
    setHistoryDetails(null);
    if (!item.auditNumber) return;
    setHistoryDetailsLoading(true);
    try {
      const response = await fetch(`/api/my-submission?id=${encodeURIComponent(item.auditNumber)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить обращение.');
      setHistoryDetails(data.item);
    } catch (error) {
      window.toast?.error(error.message || 'Не удалось загрузить обращение.');
    } finally {
      setHistoryDetailsLoading(false);
    }
  };

  useEffect(() => {
    if (!router.isReady || historyLoading) return;
    const auditNumber = String(router.query.audit || '');
    if (!/^[1-9]\d{0,11}$/.test(auditNumber)) return;
    const historyItem = history.find(entry => String(entry.auditNumber || '') === auditNumber);
    if (historyItem) openHistoryDetails(historyItem);
  }, [router.isReady, router.query.audit, historyLoading, history]);

  const copyId = async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      window.toast.success('ID скопирован!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.toast.error('Не удалось скопировать ID. Проверьте разрешения браузера.');
    }
  };

  if (loading || !user) {
    return <div className="profile-loading" aria-label="Загрузка профиля"><span /></div>;
  }

  const currentDept = DEPARTMENTS.find(department => department.id === profile.department);
  const displayedAvatar = avatarUrl || (
    user.avatar
      ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=256'
      : 'https://cdn.discordapp.com/embed/avatars/0.png'
  );

  return (
    <PageLayout user={user}>
      <main className="profile-page">
        <header className="profile-heading">
          <div className="profile-heading__eyebrow">
            <span className="profile-heading__eyebrow-line" />
            ЛИЧНЫЙ КАБИНЕТ / СОТРУДНИК
          </div>
          <div className="profile-heading__row">
            <div>
              <h1>Личное дело</h1>
              <p>Ваш аккаунт, служебные данные и история обращений.</p>
            </div>
            <div className="profile-session">
              <span className="profile-session__dot" />
              СЕССИЯ АКТИВНА
            </div>
          </div>
        </header>

        <section className="profile-overview" aria-label="Основная информация профиля">
          <article className="profile-identity">
            <div className="profile-card-topline">
              <span>01 / ИДЕНТИФИКАЦИЯ</span>
              <span className="profile-card-topline__symbol">◈</span>
            </div>

            <div className="profile-identity__main">
              <div className="profile-avatar-wrap">
                <div className="profile-avatar-ring">
                  <img src={displayedAvatar} alt="Фото профиля" />
                </div>
                <span className="profile-avatar-status" title="Аккаунт авторизован" />
              </div>

              <div className="profile-identity__name">
                <span className="profile-kicker">DISCORD ACCOUNT</span>
                <h2>{user.global_name || user.username}</h2>
                <p>@{user.username}</p>
              </div>
            </div>

            <div className="profile-identity__photo">
              <button
                type="button"
                className="profile-button profile-button--secondary"
                onClick={() => avatarInputRef.current?.click()}
                disabled={savingAvatar}
              >
                <span aria-hidden="true">↥</span>
                {savingAvatar ? 'ОБРАБОТКА ФОТО...' : 'ИЗМЕНИТЬ ФОТО'}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                hidden
              />
              <span>Фото хранится в профиле и не синхронизируется с Discord повторно.</span>
            </div>

            <div className="profile-id-block">
              <div>
                <span className="profile-kicker">УНИКАЛЬНЫЙ ID</span>
                <strong>{user.id}</strong>
              </div>
              <button
                type="button"
                className={copied ? 'profile-copy-button is-copied' : 'profile-copy-button'}
                onClick={copyId}
                aria-label="Скопировать Discord ID"
                title="Скопировать ID"
              >
                {copied ? '✓' : '⧉'}
              </button>
            </div>
            <div className="profile-identity__foot">LOS SANTOS POLICE DEPARTMENT</div>
          </article>

          <article className="profile-record">
            <div className="profile-card-topline">
              <span>02 / СЛУЖЕБНАЯ ЗАПИСЬ</span>
              <span className="profile-record__reference">PERSONNEL FILE</span>
            </div>

            <div className="profile-record__intro">
              <span className="profile-kicker">ИНФОРМАЦИЯ СОТРУДНИКА</span>
              <h2>Служебные данные</h2>
              <p>Поддерживайте информацию в личном деле в актуальном состоянии.</p>
            </div>

            <div className="profile-field">
              <div className="profile-field__label">
                <span className="profile-field__index">A</span>
                <span>ИМЯ, ФАМИЛИЯ И СТАТИК</span>
              </div>
              {editingName ? (
                <div className="profile-editor">
                  <input
                    type="text"
                    value={newName}
                    onChange={event => setNewName(event.target.value)}
                    placeholder="Например: Sanya Suspect 270726"
                    maxLength={80}
                    autoFocus
                  />
                  <div className="profile-editor__actions">
                    <button
                      type="button"
                      className="profile-button profile-button--primary"
                      onClick={saveName}
                      disabled={savingName}
                    >
                      {savingName ? 'СОХРАНЕНИЕ...' : 'СОХРАНИТЬ'}
                    </button>
                    <button
                      type="button"
                      className="profile-button profile-button--secondary"
                      onClick={() => { setEditingName(false); setNewName(profile.fullName || ''); }}
                      disabled={savingName}
                    >
                      ОТМЕНА
                    </button>
                  </div>
                </div>
              ) : (
                <div className="profile-field__value">
                  <strong className={profile.fullName ? '' : 'is-empty'}>
                    {profile.fullName || 'Не указано'}
                  </strong>
                  <button
                    type="button"
                    className="profile-text-button"
                    onClick={() => setEditingName(true)}
                  >
                    ИЗМЕНИТЬ
                  </button>
                </div>
              )}
            </div>

            <div className="profile-field">
              <div className="profile-field__label">
                <span className="profile-field__index">B</span>
                <span>ТЕКУЩЕЕ ПОДРАЗДЕЛЕНИЕ</span>
              </div>
              {editingDept ? (
                <div className="profile-departments">
                  <div className="profile-departments__grid">
                    {DEPARTMENTS.map(department => (
                      <button
                        type="button"
                        key={department.id}
                        className={profile.department === department.id ? 'profile-department is-selected' : 'profile-department'}
                        onClick={() => saveDepartment(department.id)}
                        disabled={savingDepartment}
                      >
                        <span>{department.emoji}</span>
                        <strong>{department.name}</strong>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="profile-text-button profile-departments__cancel"
                    onClick={() => setEditingDept(false)}
                    disabled={savingDepartment}
                  >
                    ОТМЕНА
                  </button>
                </div>
              ) : (
                <div className="profile-field__value">
                  <strong className={currentDept ? '' : 'is-empty'}>
                    {currentDept ? (
                      <><span className="profile-department-emoji">{currentDept.emoji}</span>{currentDept.name}</>
                    ) : 'Не выбрано'}
                  </strong>
                  <div className="profile-field__actions">
                    {currentDept && (
                      <button
                        type="button"
                        className="profile-text-button profile-text-button--danger"
                        onClick={() => saveDepartment('')}
                        disabled={savingDepartment}
                      >
                        УБРАТЬ
                      </button>
                    )}
                    <button
                      type="button"
                      className="profile-text-button"
                      onClick={() => setEditingDept(true)}
                    >
                      {currentDept ? 'СМЕНИТЬ' : 'ВЫБРАТЬ'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="profile-record__note">
              <span aria-hidden="true">i</span>
              Изменения сохраняются в вашем профиле автоматически после подтверждения.
            </div>
          </article>
        </section>

        <section className="profile-history" aria-label="История обращений">
          <div className="profile-history__header">
            <div>
              <div className="profile-card-topline">
                <span>03 / ЖУРНАЛ АКТИВНОСТИ</span>
                <span className="profile-record__reference">LAST 10 ENTRIES</span>
              </div>
              <h2>История обращений</h2>
              <p>Последние заявки и действия, отправленные через портал.</p>
            </div>
            <div className="profile-history__count">
              <strong>{historyLoading ? '—' : String(Math.min(history.length, 10)).padStart(2, '0')}</strong>
              <span>ЗАПИСЕЙ</span>
            </div>
          </div>

          <div className="profile-history__list">
            {historyLoading ? (
              <div className="profile-history__empty">
                <span className="profile-history__loader" />
                Загрузка истории...
              </div>
            ) : history.length === 0 ? (
              <div className="profile-history__empty">
                <span className="profile-history__empty-mark">—</span>
                <div>
                  <strong>История пока пуста</strong>
                  <p>Когда вы отправите обращение через портал, оно появится здесь.</p>
                </div>
              </div>
            ) : (
              history.slice(0, 10).map((item, index) => {
                const stage = item.status === 'accepted' ? 'accepted' : item.status === 'rejected' ? 'rejected' : 'pending';
                const stageLabel = stage === 'accepted' ? 'ОДОБРЕНО' : stage === 'rejected' ? 'ОТКЛОНЕНО' : 'В ОБРАБОТКЕ';
                const date = item.date && !Number.isNaN(new Date(item.date).getTime())
                  ? new Date(item.date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
                  : 'Дата неизвестна';

                return (
                  <button
                    type="button"
                    className="profile-history-row"
                    key={item.id || (item.type || 'request') + '-' + index}
                    onClick={() => openHistoryDetails(item)}
                    aria-label={`Открыть обращение: ${item.title || 'Обращение'}`}
                  >
                    <div className={`profile-history-row__marker is-${stage}`}>
                      {stage === 'accepted' ? '✓' : stage === 'rejected' ? '×' : '…'}
                    </div>
                    <div className="profile-history-row__content">
                      <strong>{item.title || 'Обращение'}</strong>
                      <span>{date}</span>
                    </div>
                    <span className={`profile-status is-${stage}`}>
                      <i />
                      {stageLabel}
                    </span>
                    <span className="profile-history-row__open">ОТКРЫТЬ ↗</span>
                  </button>
                );
              })
            )}
          </div>
        </section>
        {selectedHistory && (
          <div className="profile-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedHistory(null); }}>
            <section className="profile-request-modal" role="dialog" aria-modal="true" aria-labelledby="profile-request-title">
              <div className="profile-request-modal__topline">
                <button type="button" className="profile-request-modal__back" onClick={() => setSelectedHistory(null)}>← К ИСТОРИИ</button>
                <span>ЛИЧНЫЙ КАБИНЕТ / КАРТОЧКА ОБРАЩЕНИЯ</span>
              </div>
              {historyDetailsLoading ? (
                <div className="profile-request-modal__loading"><span className="profile-history__loader" />Загрузка полной карточки...</div>
              ) : historyDetails ? (
                <>
                  <header className="profile-request-modal__header">
                    <div>
                      <span className="profile-request-modal__eyebrow">{historyDetails.typeLabel || 'ОБРАЩЕНИЕ'}{historyDetails.number ? ` · №${historyDetails.number}` : ''}</span>
                      <h2 id="profile-request-title">{historyDetails.title || historyDetails.typeLabel || selectedHistory.title || 'Обращение'}</h2>
                      <span className="profile-request-modal__date">Подано: {historyDetails.submittedAt ? new Date(historyDetails.submittedAt).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }) : 'дата неизвестна'}</span>
                    </div>
                    <div className="profile-request-modal__actions">
                      {historyDetails.discordUrl && <a className="profile-request-discord-link" href={historyDetails.discordUrl} target="_blank" rel="noopener noreferrer">ОТКРЫТЬ В DISCORD ↗</a>}
                      <div className={`profile-request-modal__status is-${historyDetails.status}`}>
                        <span className="profile-request-modal__status-dot" />
                        {historyDetails.statusLabel || 'Статус неизвестен'}
                      </div>
                    </div>
                  </header>

                  {historyDetails.isHrAudit && (
                    <section className="profile-request-section">
                      <div className="profile-request-section__heading"><span>01 / ПРОЦЕСС РАССМОТРЕНИЯ</span><span>{historyDetails.status === 'pending' ? 'В ПРОЦЕССЕ' : 'ЗАВЕРШЕНО'}</span></div>
                      <div className="profile-request-timeline">
                        {(historyDetails.timeline || []).map((entry, index) => (
                          <div className={`profile-request-timeline__item ${entry.action === 'accepted' ? 'is-accepted' : entry.action === 'rejected' ? 'is-rejected' : ''}`} key={entry.action + '-' + index}>
                            <span className="profile-request-timeline__marker">{entry.action === 'accepted' ? '✓' : entry.action === 'rejected' ? '×' : '•'}</span>
                            <div><strong>{entry.label}</strong><span>{entry.at ? new Date(entry.at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Время не указано'}</span></div>
                          </div>
                        ))}
                        {historyDetails.status === 'pending' && !historyDetails.deliveryPending && (
                          <div className="profile-request-timeline__item is-current"><span className="profile-request-timeline__marker">…</span><div><strong>Ожидает решения проверяющего</strong><span>Результат появится здесь после рассмотрения</span></div></div>
                        )}
                        {historyDetails.deliveryPending && <p className="profile-request-modal__hint">Обращение сохранено, но доставка в Discord ещё не подтверждена. Рассмотрение пока не началось.</p>}
                      </div>
                    </section>
                  )}

                  <section className="profile-request-section">
                    <div className="profile-request-section__heading"><span>{historyDetails.isHrAudit ? '02' : '01'} / ЗАПОЛНЕННЫЕ ДАННЫЕ</span><span>{Object.keys(historyDetails.data || {}).length} ПОЛЕЙ</span></div>
                    {Object.keys(historyDetails.data || {}).length ? (
                      <div className="profile-request-modal__fields">
                        {Object.entries(historyDetails.data).map(([key, value]) => {
                          const label = historyDetails.fieldLabels?.[key] || key.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').replace(/^./, letter => letter.toUpperCase());
                          const links = String(value).match(/https?:\/\/[^\s,]+/g) || [];
                          return (
                            <div className="profile-request-modal__field" key={key}>
                              <span>{label}</span>
                              <p>{String(value) || '—'}</p>
                              {links.map((link, linkIndex) => <a key={linkIndex} href={link.replace(/[),.!?;:]+$/, '')} target="_blank" rel="noopener noreferrer">ОТКРЫТЬ ССЫЛКУ ↗</a>)}
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="profile-request-modal__hint">Для этой старой записи подробные заполненные данные не сохранились.</p>}
                  </section>

                  {historyDetails.reason && (
                    <section className="profile-request-section profile-request-section--reason">
                      <div className="profile-request-section__heading"><span>РЕШЕНИЕ ПРОВЕРЯЮЩЕГО</span><span>ОТКЛОНЕНО</span></div>
                      <h3>Причина отказа</h3>
                      <p>{historyDetails.reason}</p>
                    </section>
                  )}
                  {historyDetails.isHrAudit && historyDetails.status === 'accepted' && (
                    <div className="profile-request-result is-accepted">Обращение подтверждено. Решение зафиксировано в кадровом аудите.</div>
                  )}
                  <button type="button" className="profile-button profile-button--secondary profile-request-modal__close" onClick={() => setSelectedHistory(null)}>ВЕРНУТЬСЯ К ИСТОРИИ</button>
                </>
              ) : (
                <>
                  <h2 id="profile-request-title">{selectedHistory.title || 'Обращение'}</h2>
                  <p className="profile-request-modal__hint">Подробности этой старой записи не сохранились или больше недоступны. Новые обращения будут открываться с полной карточкой и всеми заполненными данными.</p>
                  <button type="button" className="profile-button profile-button--secondary profile-request-modal__close" onClick={() => setSelectedHistory(null)}>ВЕРНУТЬСЯ К ИСТОРИИ</button>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </PageLayout>
  );
}

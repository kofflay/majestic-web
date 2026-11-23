import { verifyToken } from '../../../lib/discord';
import { hasHrAuditAccess } from '../../../lib/hr-audit-access';
import { kv } from '../../../lib/redis.js';
import { getDepartment, getReportWebhook, getTransferWebhook } from '../../../lib/departments';
import { acquireHrAuditLock } from '../../../lib/hr-audit-locks';
import { writeSystemLog } from '../../../lib/system-logs';

const AUDIT_IDS_KEY = 'lspd:hr-audit:ids';
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const AUDIT_ITEM_ID_PATTERN = /^[1-9]\d{0,11}$/;

const SAVE_DECISION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local current = cjson.decode(raw)
if current.type ~= 'report' and current.type ~= 'highrank' and current.type ~= 'promotion' and current.type ~= 'transfer' and current.type ~= 'transfer-to-lspd' and current.type ~= 'hiring' and current.type ~= 'resignation' and current.type ~= 'reinstatement' then return -2 end
if current.status ~= 'pending' then return 0 end
if current.deliveryPending ~= false then return -3 end
if tostring(current.id) ~= ARGV[2] then return -2 end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;

function validItemId(id) {
  return AUDIT_ITEM_ID_PATTERN.test(String(id ?? ''));
}

function historyOf(item) {
  return Array.isArray(item.history) ? item.history : [];
}

function getAuditWebhook(item) {
  if (item?.type === 'highrank') return process.env.WEBHOOK_HIGH_RANK_REPORT || null;
  if (item?.type === 'promotion') return process.env.WEBHOOK_PROMOTION || null;
  if (item?.type === 'report') {
    const department = getDepartment(item.data?.department);
    return department ? getReportWebhook(department.id) : null;
  }
  if (item?.type === 'transfer') return getTransferWebhook(item.data?.targetDepartment) || null;
  const envByType = {
    'transfer-to-lspd': 'WEBHOOK_TRANSFER_TO_LSPD',
    hiring: 'WEBHOOK_HIRING',
    resignation: 'WEBHOOK_RESIGNATION',
    reinstatement: 'WEBHOOK_REINSTATEMENT'
  };
  return envByType[item?.type] ? process.env[envByType[item.type]] || null : null;
}

function isSupportedAuditItem(item) {
  return Boolean(item && ['report', 'highrank', 'promotion', 'transfer', 'transfer-to-lspd', 'hiring', 'resignation', 'reinstatement'].includes(item.type));
}

function webhookUrlWithWait(webhook) {
  const url = new URL(webhook);
  url.searchParams.set('wait', 'true');
  return url.toString();
}


async function createPromotionFromApprovedReport(item, reviewer, auditMessageId) {
  const itemKey = `lspd:hr-audit:item:${item.id}`;
  const auditWebhook = process.env.WEBHOOK_AUDIT_URL || '';
  const promotionWebhook = process.env.WEBHOOK_PROMOTION || '';
  if (!auditWebhook || !promotionWebhook) {
    await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_webhook_missing', message: 'Не настроен вебхук кадрового аудита или запроса на повышение', auditId: item.id, auditType: item.type });
    return { success: false, reason: 'promotion_webhook_missing' };
  }

  const parentBefore = await kv.get(itemKey).catch(() => null);
  const promotionRef = parentBefore?.promotionRequest || null;
  let promotionId = promotionRef?.id ? String(promotionRef.id) : '';
  if (!promotionId) {
    promotionId = String(await kv.get(`lspd:hr-audit:promotion-from-highrank:${item.id}`).catch(() => '') || '');
  }
  let promotion = promotionId
    ? await kv.get(`lspd:hr-audit:item:${promotionId}`).catch(() => null)
    : null;
  if (promotion?.deliveryPending === false && promotion?.deliveryMessageId) {
    return { success: true, item: promotion };
  }
  if (promotion?.deliveryUnconfirmed) {
    return { success: false, reason: 'promotion_delivery_unconfirmed' };
  }

  const auditMessageUrl = promotion?.auditMessageUrl || promotionRef?.auditMessageUrl || await (async () => {
    const auditMessageUrl = new URL(auditWebhook);
    auditMessageUrl.search = '';
    auditMessageUrl.hash = '';
    auditMessageUrl.pathname = `${auditMessageUrl.pathname.replace(/\/$/, '')}/messages/${auditMessageId}`;
    const [messageResponse, webhookResponse] = await Promise.all([
      fetch(auditMessageUrl.toString(), { method: 'GET', signal: AbortSignal.timeout(15000) }),
      fetch(auditWebhook, { method: 'GET', signal: AbortSignal.timeout(15000) })
    ]);
    if (!messageResponse.ok || !webhookResponse.ok) throw new Error('Не удалось получить ссылку на сообщение кадрового аудита');
    const [message, webhookInfo] = await Promise.all([messageResponse.json(), webhookResponse.json()]);
    const guildId = String(webhookInfo.guild_id || '');
    const channelId = String(message.channel_id || webhookInfo.channel_id || '');
    if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId)) throw new Error('Discord не вернул сервер или канал кадрового аудита');
    return `https://discord.com/channels/${guildId}/${channelId}/${auditMessageId}`;
  })();

  const reviewerId = String(reviewer?.id || '');
  const applicantId = String(item.submitter?.id || '');
  if (!DISCORD_ID_PATTERN.test(reviewerId) || !DISCORD_ID_PATTERN.test(applicantId)) {
    return { success: false, reason: 'promotion_user_id_invalid' };
  }

  if (!promotion) {
    const data = {
      fullName: String(item.data?.fullName || '').trim(),
      rankRange: (item.type === 'report' ? [item.data?.currentRank, item.data?.targetRank].filter(Boolean).join(' → ') : item.data?.rankRange || '').trim(),
      reportLink: auditMessageUrl
    };
    const submittedAt = new Date().toISOString();
    const title = 'Запрос на повышение';
    const embed = {
      title,
      color: 0x3498DB,
      fields: [
        { name: 'Имя Фамилия + Статик', value: data.fullName.slice(0, 1024), inline: false },
        { name: ' Диапазон рангов', value: data.rankRange.slice(0, 1024), inline: false },
        { name: ' Ссылка на отчет', value: data.reportLink, inline: false },
        { name: 'Отправитель', value: `<@${applicantId}>`, inline: true },
        { name: 'Discord ID', value: applicantId, inline: true }
      ],
      footer: { text: 'Suspect Forms • Запрос на повышение' },
      timestamp: submittedAt
    };
    const allocation = await kv.eval(
      `
local existing = redis.call('GET', KEYS[4])
if existing then return {tonumber(existing), 0} end
local current = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
local latest = tonumber(redis.call('LINDEX', KEYS[3], 0) or '0') or 0
if latest > current then redis.call('SET', KEYS[1], tostring(latest)) end
local number = redis.call('INCR', KEYS[1])
local item = cjson.decode(ARGV[1])
item.id = tostring(number)
item.number = number
redis.call('SET', KEYS[2] .. tostring(number), cjson.encode(item))
redis.call('LPUSH', KEYS[3], tostring(number))
redis.call('SET', KEYS[4], tostring(number))
return {number, 1}
`,
      ['lspd:hr-audit:sequence', 'lspd:hr-audit:item:', 'lspd:hr-audit:ids', `lspd:hr-audit:promotion-from-highrank:${item.id}`],
      [JSON.stringify({
        id: '', number: 0, type: 'promotion', title, status: 'pending',
        deliveryPending: true, submittedAt,
        submitter: { id: applicantId, username: item.submitter?.username || 'Unknown' },
        data, sourceAuditId: String(item.id), sourceAuditType: item.type,
        ...(item.type === 'highrank' ? { sourceHighrankId: String(item.id), sourceHighrankNumber: item.number } : { sourceReportId: String(item.id), sourceReportNumber: item.number }),
        auditMessageId: String(auditMessageId), auditMessageUrl,
        history: [{ action: 'submitted', at: submittedAt, userId: 'system' }]
      })]
    );
    if (!Array.isArray(allocation) || allocation.length < 2) throw new Error('Не удалось создать запись запроса на повышение');
    const promotionId = String(allocation[0]);
    promotion = await kv.get(`lspd:hr-audit:item:${promotionId}`);
    if (!promotion || promotion.type !== 'promotion' || String(promotion.sourceAuditId || promotion.sourceHighrankId || '') !== String(item.id) || (promotion.sourceAuditType && promotion.sourceAuditType !== item.type)) {
      throw new Error('Запись запроса на повышение не найдена после создания');
    }
    const parent = await kv.get(itemKey);
    await kv.set(itemKey, { ...parent, promotionRequest: { id: promotion.id, number: promotion.number, auditMessageUrl } });
  }

  if (!promotion.deliveryPending) return { success: true, item: promotion };
  if (promotion.deliveryUnconfirmed) return { success: false, reason: 'promotion_delivery_unconfirmed' };

  const payload = {
    username: 'Suspect Forms',
    content: `<@&1514608894679191597> <@${applicantId}>`,
    embeds: [{
      title: ` Запрос на повышение №${promotion.number}`,
      color: 0x4CAF50,
      description: `[Открыть запрос для одобрения или отклонения](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/las-vegas/audit?id=${promotion.id})`,
      fields: [
        { name: 'Имя Фамилия + Статик', value: promotion.data.fullName.slice(0, 1024), inline: false },
        { name: ' Диапазон рангов', value: promotion.data.rankRange.slice(0, 1024), inline: false },
        { name: ' Ссылка на отчет', value: promotion.data.reportLink, inline: false },
        { name: 'Отправитель', value: `<@${applicantId}>`, inline: true },
        { name: 'Discord ID', value: applicantId, inline: true }
      ],
      footer: { text: 'Suspect Forms • Запрос на повышение' },
      timestamp: promotion.submittedAt
    }],
    allowed_mentions: { roles: ['1514608894679191597'], users: [applicantId] }
  };
  const attemptAt = new Date().toISOString();
  promotion = {
    ...promotion,
    discordPayload: payload,
    deliveryAttempts: (Number(promotion.deliveryAttempts) || 0) + 1,
    lastDeliveryAttemptAt: attemptAt,
    history: [...historyOf(promotion), { action: 'delivery_attempted', at: attemptAt, userId: 'system' }]
  };
  await kv.set(`lspd:hr-audit:item:${promotion.id}`, promotion);

  let response;
  try {
    const url = new URL(promotionWebhook);
    url.searchParams.set('wait', 'true');
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url.toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
      });
      if (response.status !== 429 || attempt === 2) break;
      const retryAfter = Number.parseFloat(response.headers.get('Retry-After'));
      const delaySeconds = Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 1), 10) : 2;
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    }
  } catch (error) {
    const latest = await kv.get(`lspd:hr-audit:item:${promotion.id}`).catch(() => promotion);
    await kv.set(`lspd:hr-audit:item:${promotion.id}`, {
      ...latest, deliveryUnconfirmed: true,
      history: [...historyOf(latest), { action: 'delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
    }).catch(() => {});
    await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_delivery_unconfirmed', message: 'Не удалось подтвердить отправку запроса на повышение; автоматический повтор остановлен во избежание дубликата', auditId: item.id, auditType: 'promotion', details: String(error?.message || error).slice(0, 1000) });
    return { success: false, reason: 'promotion_delivery_unconfirmed' };
  }
  if (!response.ok) {
    const details = (await response.text()).slice(0, 1200);
    const latest = await kv.get(`lspd:hr-audit:item:${promotion.id}`).catch(() => promotion);
    await kv.set(`lspd:hr-audit:item:${promotion.id}`, {
      ...latest, deliveryPending: true, deliveryUnconfirmed: false,
      history: [...historyOf(latest), { action: 'delivery_failed', at: new Date().toISOString(), userId: 'system' }]
    });
    await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_delivery_failed', message: 'Discord не принял запрос на повышение; повтор будет выполнен при следующей обработке', auditId: item.id, auditType: 'promotion', httpStatus: response.status, details });
    return { success: false, reason: 'promotion_delivery_failed' };
  }
  let message = null;
  try { message = await response.json(); } catch {}
  const messageId = String(message?.id || '');
  if (!/^\d{17,20}$/.test(messageId)) {
    const latest = await kv.get(`lspd:hr-audit:item:${promotion.id}`).catch(() => promotion);
    await kv.set(`lspd:hr-audit:item:${promotion.id}`, {
      ...latest, deliveryPending: true, deliveryUnconfirmed: true,
      history: [...historyOf(latest), { action: 'delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
    });
    return { success: false, reason: 'promotion_message_id_missing' };
  }
  const deliveredAt = new Date().toISOString();
  const latest = await kv.get(`lspd:hr-audit:item:${promotion.id}`).catch(() => promotion);
  const delivered = {
    ...latest, deliveryPending: false, deliveryUnconfirmed: false,
    deliveryMessageId: messageId, deliveredAt, discordPayload: null,
    history: [...historyOf(latest), { action: 'delivered', at: deliveredAt, userId: 'system' }]
  };
  try {
    await kv.set(`lspd:hr-audit:item:${promotion.id}`, delivered);
  } catch (saveError) {
    const persisted = await kv.get(`lspd:hr-audit:item:${promotion.id}`).catch(() => null);
    if (!(persisted?.deliveryPending === false && persisted?.deliveryMessageId === messageId)) {
      await kv.set(`lspd:hr-audit:item:${promotion.id}`, {
        ...(persisted || promotion),
        deliveryPending: true,
        deliveryUnconfirmed: true,
        history: [...historyOf(persisted || promotion), { action: 'delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
      }).catch(() => {});
      await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_delivery_state_unconfirmed', message: 'Discord принял запрос на повышение, но сохранение ID сообщения не подтверждено; повтор остановлен во избежание дубликата', auditId: item.id, auditType: 'promotion', details: String(saveError?.message || saveError).slice(0, 1000) });
      return { success: false, reason: 'promotion_delivery_unconfirmed' };
    }
  }
  const parent = await kv.get(itemKey);
  await kv.set(itemKey, {
    ...parent,
    promotionRequest: { id: delivered.id, number: delivered.number, auditMessageUrl, deliveryMessageId: messageId, deliveredAt }
  });
  return { success: true, item: delivered };
}

async function publishPersonnelAudit(item, reviewer, decision) {
  const webhook = process.env.WEBHOOK_AUDIT_URL || '';
  if (!webhook) return { success: false, reason: 'audit_webhook_not_configured' };
  const itemKey = `lspd:hr-audit:item:${item.id}`;
  const latest = await kv.get(itemKey).catch(() => null) || item;
  if (latest.auditMessageId) return { success: true, messageId: latest.auditMessageId };
  if (latest.auditDeliveryUnconfirmed) return { success: false, reason: 'audit_delivery_unconfirmed' };
  if (latest.auditDeliveryState === 'attempting') {
    await kv.set(itemKey, {
      ...latest, auditDeliveryUnconfirmed: true, auditDeliveryState: 'unconfirmed',
      history: [...historyOf(latest), { action: 'personnel_audit_delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
    }).catch(() => {});
    return { success: false, reason: 'audit_delivery_unconfirmed' };
  }
  const applicantId = String(item.submitter?.id || '');
  const reviewerId = String(reviewer?.id || '');
  const data = item.data || {};
  const titles = {
    promotion: 'ПОВЫШЕНИЕ СОТРУДНИКА',
    transfer: 'ПЕРЕВОД СОТРУДНИКА МЕЖДУ ОТДЕЛАМИ',
    'transfer-to-lspd': 'ПЕРЕВОД СОТРУДНИКА В FIB',
    hiring: 'ТРУДОУСТРОЙСТВО В FIB',
    resignation: 'УВОЛЬНЕНИЕ СОТРУДНИКА',
    reinstatement: 'ВОССТАНОВЛЕНИЕ СОТРУДНИКА В FIB'
  };
  const labels = {
    fullName: 'Имя и статик', rankRange: 'Диапазон рангов', reportLink: 'Одобренный отчёт',
    rank: 'Текущий ранг', currentDepartment: 'Текущий отдел', targetDepartment: 'Новый отдел', reason: 'Причина перевода',
    approvalProof: 'Подтверждение одобрения', rankProof: 'Подтверждение ранга', age: 'Возраст', experience: 'Опыт',
    lawKnowledge: 'Знание законов', passport: 'Паспорт', militaryId: 'Военный билет', medical: 'Медицинская карта',
    screenshot: 'Скриншот планшета', rankAtDismissal: 'Ранг на момент увольнения', wasWarned: 'Было ли взыскание',
    stateFractionsProof: 'Одобрение State Fractions', department: 'Отдел', currentRank: 'Текущий ранг', targetRank: 'Новый ранг',
    isInstructor: 'Назначение инструктором', workLinks: 'Ссылки на проделанную работу', workLink: 'Ссылка на проделанную работу'
  };
  const fields = Object.entries(data).map(([key, raw]) => {
    let value = raw;
    if (['department', 'currentDepartment', 'targetDepartment'].includes(key)) value = getDepartment(raw)?.name || raw;
    if (['isInstructor', 'wasWarned'].includes(key)) value = raw === 'yes' ? 'Да' : raw === 'no' ? 'Нет' : raw;
    if (value && typeof value === 'object') value = JSON.stringify(value);
    return { name: labels[key] || key, value: String(value ?? '—').slice(0, 1024) || '—', inline: false };
  });
  fields.push(
    { name: 'Заявитель', value: /^\d{17,20}$/.test(applicantId) ? '<@' + applicantId + '>' : 'Discord ID не указан', inline: true },
    { name: 'Рассмотрел', value: '<@' + reviewerId + '>', inline: true },
    { name: 'Решение', value: decision === 'accepted' ? 'Одобрено' : 'Отклонено', inline: true },
    { name: 'Заявка', value: '№' + item.number, inline: true }
  );
  const auditUrl = `${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/las-vegas/audit?id=${encodeURIComponent(item.id)}`;
  const payload = {
    username: 'Suspect Forms',
    content: '<@' + reviewerId + '> рассмотрел кадровую заявку сотрудника ' + ( /^\d{17,20}$/.test(applicantId) ? '<@' + applicantId + '>' : '' ),
    embeds: [{
      title: (titles[item.type] || item.title || 'КАДРОВОЕ ДЕЙСТВИЕ') + ' — ОДОБРЕНО',
      color: 0x4CAF50,
      description: `[Открыть запись кадрового аудита №${item.number}](${auditUrl})`,
      fields: fields.slice(0, 25),
      timestamp: item.resolvedAt || new Date().toISOString(),
      footer: { text: `Suspect Forms • HR Audit • Заявка №${item.number}` }
    }],
    allowed_mentions: { users: [applicantId, reviewerId].filter(value => /^\d{17,20}$/.test(value)) }
  };
  const attemptedAt = new Date().toISOString();
  const attempted = {
    ...latest, auditDeliveryState: 'attempting', auditDeliveryAttemptedAt: attemptedAt,
    history: [...historyOf(latest), { action: 'personnel_audit_delivery_attempted', at: attemptedAt, userId: 'system' }]
  };
  await kv.set(itemKey, attempted);
  let response;
  try {
    response = await fetch(webhookUrlWithWait(webhook), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    const at = new Date().toISOString();
    await kv.set(itemKey, { ...attempted, auditDeliveryUnconfirmed: true, auditDeliveryState: 'unconfirmed', history: [...historyOf(attempted), { action: 'personnel_audit_delivery_unconfirmed', at, userId: 'system' }] }).catch(() => {});
    await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_delivery_unconfirmed', message: 'Не удалось подтвердить публикацию кадрового действия; повтор остановлен во избежание дубликата', auditId: item.id, auditType: item.type, details: String(error?.message || error).slice(0, 1000) });
    return { success: false, reason: 'audit_delivery_unconfirmed' };
  }
  if (!response.ok) {
    const details = (await response.text()).slice(0, 1500);
    const at = new Date().toISOString();
    await kv.set(itemKey, { ...attempted, auditDeliveryState: 'failed', auditDeliveryUnconfirmed: false, history: [...historyOf(attempted), { action: 'personnel_audit_delivery_failed', at, userId: 'system' }] });
    await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_delivery_failed', message: 'Discord отклонил карточку кадрового действия', auditId: item.id, auditType: item.type, httpStatus: response.status, details });
    return { success: false, reason: `audit_http_${response.status}` };
  }
  let message = null;
  try { message = await response.json(); } catch {}
  const messageId = String(message?.id || '');
  if (!/^\d{17,20}$/.test(messageId)) {
    const at = new Date().toISOString();
    await kv.set(itemKey, { ...attempted, auditDeliveryUnconfirmed: true, auditDeliveryState: 'unconfirmed', history: [...historyOf(attempted), { action: 'personnel_audit_delivery_unconfirmed', at, userId: 'system' }] }).catch(() => {});
    return { success: false, reason: 'audit_delivery_unconfirmed' };
  }
  const sentAt = new Date().toISOString();
  const sent = { ...attempted, auditMessageId: messageId, auditSentAt: sentAt, auditDeliveryState: 'sent', auditDeliveryUnconfirmed: false, history: [...historyOf(attempted), { action: 'personnel_audit_sent', at: sentAt, userId: 'system' }] };
  try {
    await kv.set(itemKey, sent);
  } catch (error) {
    const persisted = await kv.get(itemKey).catch(() => null);
    if (persisted?.auditMessageId !== messageId) {
      await kv.set(itemKey, { ...(persisted || attempted), auditDeliveryUnconfirmed: true, auditDeliveryState: 'unconfirmed' }).catch(() => {});
      return { success: false, reason: 'audit_delivery_unconfirmed' };
    }
  }
  return { success: true, messageId };
}
async function sendDecision(item, reviewer, decision, reason) {
  const webhook = getAuditWebhook(item);
  const applicantId = String(item.submitter?.id || '');
  const reviewerId = String(reviewer?.id || '');

  if (!webhook) {
    await writeSystemLog({ level: 'error', category: 'discord', event: 'webhook_not_configured', message: 'Вебхук для уведомления о решении не настроен', auditId: item.id, auditType: item.type, decision });
    return { success: false, messageId: null, reason: 'webhook_not_configured' };
  }
  if (!DISCORD_ID_PATTERN.test(reviewerId)) {
    await writeSystemLog({ level: 'error', category: 'discord', event: 'reviewer_invalid', message: 'Не удалось отправить уведомление: некорректный Discord ID проверяющего', auditId: item.id, auditType: item.type, decision });
    return { success: false, messageId: null, reason: 'reviewer_invalid' };
  }

  const accepted = decision === 'accepted';

  if (item.type === 'promotion') {
    const messageId = String(item.deliveryMessageId || '');
    if (!/^\d{17,20}$/.test(messageId) || !webhook) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_source_message_missing', message: 'Нет исходной карточки запроса на повышение для обновления', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: null, reason: 'promotion_source_message_missing' };
    }
    const messageUrl = new URL(webhook);
    messageUrl.search = '';
    messageUrl.hash = '';
    messageUrl.pathname = `${messageUrl.pathname.replace(/\/$/, '')}/messages/${messageId}`;
    let original;
    try {
      const response = await fetch(messageUrl.toString(), { method: 'GET', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return { success: false, messageId: null, reason: `promotion_message_http_${response.status}` };
      original = await response.json();
    } catch (error) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_message_lookup_failed', message: 'Не удалось получить карточку запроса на повышение', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1000) });
      return { success: false, messageId: null, reason: 'promotion_message_lookup_failed' };
    }
    const data = item.data || {};
    const fieldValue = value => (typeof value === 'string' ? value.trim() : '').slice(0, 1024) || 'Не указано';
    const fields = [
      { name: 'Имя Фамилия + Статик', value: fieldValue(data.fullName), inline: false },
      { name: ' Диапазон рангов', value: fieldValue(data.rankRange), inline: false },
      { name: ' Ссылка на отчет', value: fieldValue(data.reportLink), inline: false },
      { name: 'Отправитель', value: DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : 'Discord ID не указан', inline: true },
      { name: 'Discord ID', value: fieldValue(applicantId), inline: true },
      { name: 'Решение', value: accepted ? 'Одобрено' : 'Отклонено', inline: true },
      { name: accepted ? 'Одобрил' : 'Отклонил', value: `<@${reviewerId}>`, inline: true },
      { name: 'Discord ID проверяющего', value: reviewerId, inline: true },
      ...(!accepted && reason ? [{ name: 'Причина отказа', value: fieldValue(reason), inline: false }] : [])
    ];
    const previousEmbed = Array.isArray(original.embeds) ? original.embeds[0] || {} : {};
    const embed = {
      ...(previousEmbed.author ? { author: previousEmbed.author } : {}),
      title: `Запрос на повышение №${item.number} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
      color: accepted ? 0x4CAF50 : 0xDC3545,
      description: `[Открыть запрос в кадровом реестре](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/las-vegas/audit?id=${item.id})`,
      fields,
      footer: { text: 'Suspect Forms • Запрос на повышение' },
      timestamp: item.resolvedAt || new Date().toISOString()
    };
    try {
      const response = await fetch(messageUrl.toString(), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `Запрос на повышение №${item.number}: ${accepted ? 'одобрен' : 'отклонён'}.`,
          embeds: [embed],
          allowed_mentions: { users: [applicantId, reviewerId].filter(value => DISCORD_ID_PATTERN.test(value)) }
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        const details = (await response.text()).slice(0, 1500);
        await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_card_update_failed', message: 'Discord не обновил карточку запроса на повышение', auditId: item.id, auditType: item.type, decision, httpStatus: response.status, details });
        return { success: false, messageId: null, reason: `promotion_update_http_${response.status}` };
      }
      if (accepted) {
        const auditResult = await publishPersonnelAudit(item, reviewer, decision);
        return { success: auditResult.success, messageId: auditResult.messageId || messageId, reason: auditResult.reason || null };
      }
      return { success: true, messageId };
    } catch (error) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'promotion_card_update_failed', message: 'Не удалось обновить карточку запроса на повышение', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1000) });
      return { success: false, messageId: null, reason: 'promotion_card_update_failed' };
    }
  }


  // Approved high-rank and regular promotion reports share the personnel-audit
  // workflow. Other form types never create a promotion request.
  if (['highrank', 'report'].includes(item.type) && accepted) {
    const auditWebhook = process.env.WEBHOOK_AUDIT_URL || null;

    const reportData = item.data && typeof item.data === 'object' ? item.data : {};
    const fieldValue = (value, fallback = 'Не указано') => {
      const text = typeof value === 'string' ? value.trim() : '';
      return (text || fallback).slice(0, 1024);
    };
    const applicantName = fieldValue(reportData.fullName);
    const rankRange = item.type === 'report' ? fieldValue(reportData.currentRank) + ' → ' + fieldValue(reportData.targetRank) : fieldValue(reportData.rankRange);
    const originalMessageId = String(item.deliveryMessageId || '');
    const reportWebhook = getAuditWebhook(item);

    if (!/^\d{17,20}$/.test(originalMessageId) || !reportWebhook) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'highrank_source_message_missing', message: 'Нет исходного сообщения HR-отчёта для обновления карточки кадрового аудита', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: null, reason: 'highrank_source_message_missing' };
    }

    let reportMessageId = item.approvedReportMessageId || originalMessageId;
    let reportMessageUrl = item.approvedReportMessageUrl || null;

    if (!item.approvedReportSentAt || !reportMessageUrl) {
      const messageUrl = new URL(reportWebhook);
      messageUrl.search = '';
      messageUrl.hash = '';
      messageUrl.pathname = `${messageUrl.pathname.replace(/\/$/, '')}/messages/${originalMessageId}`;

      let sourceMessage;
      let webhookInfo;
      try {
        const [sourceResponse, webhookResponse] = await Promise.all([
          fetch(messageUrl.toString(), { method: 'GET', signal: AbortSignal.timeout(15000) }),
          fetch(reportWebhook, { method: 'GET', signal: AbortSignal.timeout(15000) })
        ]);
        if (!sourceResponse.ok || !webhookResponse.ok) {
          const failed = !sourceResponse.ok ? sourceResponse : webhookResponse;
          const details = (await failed.text()).slice(0, 2000);
          await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Не удалось получить исходную HR-карточку или данные вебхука', auditId: item.id, auditType: item.type, decision, httpStatus: failed.status, details });
          return { success: false, messageId: null, reason: `discord_http_${failed.status}` };
        }
        sourceMessage = await sourceResponse.json();
        webhookInfo = await webhookResponse.json();
      } catch (error) {
        await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось получить исходную HR-карточку', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
        return { success: false, messageId: null, reason: 'source_message_lookup_failed' };
      }

      const guildId = String(webhookInfo.guild_id || '');
      const channelId = String(sourceMessage.channel_id || webhookInfo.channel_id || '');
      if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId)) {
        await writeSystemLog({ level: 'error', category: 'discord', event: 'highrank_source_link_unavailable', message: 'Discord не вернул сервер или канал исходной HR-карточки', auditId: item.id, auditType: item.type, decision });
        return { success: false, messageId: null, reason: 'source_link_unavailable' };
      }

      const originalEmbed = Array.isArray(sourceMessage.embeds) ? sourceMessage.embeds[0] || {} : {};
      const profileReportUrl = item.type === 'highrank'
        ? `[Открыть отчёт в личном кабинете](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/las-vegas/profile?audit=${encodeURIComponent(item.id)})`
        : `[Открыть заявку в кадровом аудите №${item.number}](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/las-vegas/audit?id=${encodeURIComponent(item.id)})`;
      const updatedEmbed = {
        ...(originalEmbed.url ? { url: originalEmbed.url } : {}),
        ...(originalEmbed.author?.name ? { author: { name: originalEmbed.author.name, ...(originalEmbed.author.url ? { url: originalEmbed.author.url } : {}), ...(originalEmbed.author.icon_url ? { icon_url: originalEmbed.author.icon_url } : {}) } } : {}),
        ...(originalEmbed.image?.url ? { image: { url: originalEmbed.image.url } } : {}),
        ...(originalEmbed.thumbnail?.url ? { thumbnail: { url: originalEmbed.thumbnail.url } } : {}),
        title: `${item.type === 'highrank' ? 'Отчёт на повышение хай-состава' : 'Отчёт о повышении'} №${item.number} — ОДОБРЕНО`,
        color: 0x4CAF50,
        description: profileReportUrl,
        fields: [
          { name: ' Имя Фамилия + Статик', value: applicantName, inline: false },
          ...(item.type === 'highrank' ? [
            { name: ' Диапазон повышения', value: rankRange, inline: true },
            { name: ' Ссылка на проделанную работу', value: fieldValue(reportData.workLink), inline: false }
          ] : [
            { name: ' Отдел', value: fieldValue(getDepartment(reportData.department)?.name || reportData.department), inline: true },
            { name: ' Текущий ранг', value: fieldValue(reportData.currentRank), inline: true },
            { name: ' Новый ранг', value: fieldValue(reportData.targetRank), inline: true },
            { name: ' Ссылки на проделанную работу', value: fieldValue(reportData.workLinks), inline: false },
            { name: ' Инструктор', value: reportData.isInstructor === 'yes' ? 'Да' : 'Нет', inline: true }
          ]),
          { name: ' Отправитель', value: DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : 'Discord ID не указан', inline: true },
          { name: ' Discord ID', value: fieldValue(applicantId, 'Не указан'), inline: true },
          { name: ' Решение', value: 'Одобрено', inline: true },
          { name: ' Проверил', value: `<@${reviewerId}>`, inline: true }
        ],
        footer: { text: 'Suspect Forms • HR Audit', ...(originalEmbed.footer?.icon_url ? { icon_url: originalEmbed.footer.icon_url } : {}) },
        timestamp: item.resolvedAt || new Date().toISOString()
      };

      let patchResponse;
      try {
        patchResponse = await fetch(messageUrl.toString(), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `Решение по ${item.type === 'highrank' ? 'отчёту High-Rank' : 'отчёту о повышении'} №${item.number} принято: одобрено.`, embeds: [updatedEmbed] }),
          signal: AbortSignal.timeout(15000)
        });
      } catch (error) {
        await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось обновить исходную HR-карточку', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
        return { success: false, messageId: null, reason: 'hr_card_update_failed' };
      }
      if (!patchResponse.ok) {
        const details = (await patchResponse.text()).slice(0, 2000);
        await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Discord отклонил обновление исходной HR-карточки', auditId: item.id, auditType: item.type, decision, httpStatus: patchResponse.status, details });
        return { success: false, messageId: null, reason: `discord_http_${patchResponse.status}` };
      }

      reportMessageId = originalMessageId;
      reportMessageUrl = `https://discord.com/channels/${guildId}/${channelId}/${originalMessageId}`;
      const stageOneAt = new Date().toISOString();
      const latest = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
      const stageOneSaved = {
        ...(latest || item),
        approvedReportMessageId: reportMessageId,
        approvedReportMessageUrl: reportMessageUrl,
        approvedReportSentAt: stageOneAt,
        history: [...historyOf(latest || item), { action: 'approved_report_updated', at: stageOneAt, userId: 'system' }]
      };
      try {
        await kv.set(`lspd:hr-audit:item:${item.id}`, stageOneSaved);
      } catch (saveError) {
        const persisted = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
        if (persisted?.approvedReportMessageId !== reportMessageId || persisted?.approvedReportMessageUrl !== reportMessageUrl) {
          await writeSystemLog({ level: 'error', category: 'discord', event: 'approved_report_state_save_failed', message: 'Исходная HR-карточка обновлена, но состояние этапа не удалось подтвердить; автоматический повтор остановлен', auditId: item.id, auditType: item.type, decision, details: String(saveError?.message || saveError).slice(0, 1000) });
          return { success: false, messageId: reportMessageId, reason: 'approved_report_state_save_failed' };
        }
      }
    }

    const latestBeforeAudit = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
    if (latestBeforeAudit?.auditMessageId) {
      const promotionResult = await createPromotionFromApprovedReport(item, reviewer, latestBeforeAudit.auditMessageId);
      return {
        success: promotionResult.success,
        messageId: latestBeforeAudit.auditMessageId,
        approvedReportMessageId: reportMessageId,
        auditMessageId: latestBeforeAudit.auditMessageId,
        reason: promotionResult.reason || null
      };
    }

    if (latestBeforeAudit?.auditDeliveryUnconfirmed === true || latestBeforeAudit?.auditDeliveryState === 'attempting') {
      await kv.set(`lspd:hr-audit:item:${item.id}`, {
        ...(latestBeforeAudit || item), auditDeliveryUnconfirmed: true, auditDeliveryState: 'unconfirmed',
        history: [...historyOf(latestBeforeAudit || item), { action: 'personnel_audit_delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
      }).catch(() => {});
      await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_delivery_unconfirmed', message: 'Доставка карточки кадрового аудита не подтверждена; повторная публикация остановлена во избежание дубликата', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: reportMessageId, reason: 'audit_delivery_unconfirmed' };
    }

    if (!auditWebhook) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_webhook_not_configured', message: 'Не настроен WEBHOOK_AUDIT_URL для кадрового аудита', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: reportMessageId, reason: 'audit_webhook_not_configured' };
    }

    const auditEmbed = {
      title: item.type === 'highrank' ? ' ОТЧЁТ О ПОВЫШЕНИИ СОТРУДНИКА (HIGH-RANK)' : ' ОТЧЁТ О ПОВЫШЕНИИ СОТРУДНИКА',
      color: 0x4CAF50,
      fields: [
        { name: ' Причина повышения', value: reportMessageUrl, inline: false },
        ...(item.type === 'highrank' ? [{ name: ' Диапазон повышения', value: rankRange, inline: true }] : [
          { name: ' Отдел', value: fieldValue(getDepartment(reportData.department)?.name || reportData.department), inline: true },
          { name: ' Повышен с ранга', value: fieldValue(reportData.currentRank), inline: true },
          { name: ' Повышен до ранга', value: fieldValue(reportData.targetRank), inline: true }
        ]),
        { name: ' Повышен', value: `<@${applicantId}>`, inline: true },
        { name: 'Имя Фамилия + Статик', value: applicantName, inline: false },
        { name: ' Discord ID', value: DISCORD_ID_PATTERN.test(applicantId) ? applicantId : 'Не указан', inline: true },
        { name: ' Повышает', value: `<@${reviewerId}>`, inline: true },
        { name: ' Discord ID проверяющего', value: reviewerId, inline: true },
        { name: ' Дата повышения', value: new Date(item.resolvedAt || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }), inline: true }
      ],
      timestamp: item.resolvedAt || new Date().toISOString(),
      footer: { text: `Suspect Forms • HR Audit • Заявка №${item.number}` }
    };

    // Brief pause after the HR card update before publishing the personnel audit.
    await new Promise(resolve => setTimeout(resolve, 2000));

    const auditAttemptAt = new Date().toISOString();
    const latestBeforeAuditSend = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => item);
    const auditAttempted = {
      ...(latestBeforeAuditSend || item), auditDeliveryState: 'attempting', auditDeliveryAttemptedAt: auditAttemptAt,
      history: [...historyOf(latestBeforeAuditSend || item), { action: 'personnel_audit_delivery_attempted', at: auditAttemptAt, userId: 'system' }]
    };
    await kv.set(`lspd:hr-audit:item:${item.id}`, auditAttempted);

    let auditResponse;
    try {
      auditResponse = await fetch(webhookUrlWithWait(auditWebhook), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Suspect Forms',
          content: `<@${reviewerId}> повышает <@${applicantId}>`,
          embeds: [auditEmbed]
        }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      const latest = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => item);
      await kv.set(`lspd:hr-audit:item:${item.id}`, {
        ...(latest || item), auditDeliveryUnconfirmed: true,
        history: [...historyOf(latest || item), { action: 'personnel_audit_delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
      }).catch(() => {});
      await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось подтвердить отправку карточки во второй канал кадрового аудита; автоматический повтор остановлен', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
      return { success: false, messageId: reportMessageId, reason: 'audit_delivery_unconfirmed' };
    }
    if (!auditResponse.ok) {
      const details = (await auditResponse.text()).slice(0, 2000);
      const failedAt = new Date().toISOString();
      await kv.set(`lspd:hr-audit:item:${item.id}`, {
        ...(await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => auditAttempted)), auditDeliveryState: 'failed', auditDeliveryUnconfirmed: false,
        history: [...historyOf(await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => auditAttempted)), { action: 'personnel_audit_delivery_failed', at: failedAt, userId: 'system' }]
      }).catch(() => {});
      await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Discord отклонил публикацию карточки в кадровый аудит', auditId: item.id, auditType: item.type, decision, httpStatus: auditResponse.status, details });
      return { success: false, messageId: reportMessageId, reason: `audit_http_${auditResponse.status}` };
    }

    let auditMessage = null;
    try { auditMessage = await auditResponse.json(); } catch {}
    const auditMessageId = String(auditMessage?.id || '');
    if (!/^\d{17,20}$/.test(auditMessageId)) {
      const latest = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => item);
      await kv.set(`lspd:hr-audit:item:${item.id}`, {
        ...(latest || item), auditDeliveryUnconfirmed: true,
        history: [...historyOf(latest || item), { action: 'personnel_audit_delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
      }).catch(() => {});
      await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_message_metadata_missing', message: 'Discord принял карточку кадрового аудита, но не вернул ID сообщения; автоматический повтор остановлен', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: reportMessageId, reason: 'audit_delivery_unconfirmed' };
    }
    const stageTwoAt = new Date().toISOString();
    const latestAfterAudit = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
    try {
      await kv.set(`lspd:hr-audit:item:${item.id}`, {
        ...(latestAfterAudit || item),
        auditMessageId, auditDeliveryState: 'sent', auditDeliveryUnconfirmed: false,
        auditSentAt: stageTwoAt,
        history: [...historyOf(latestAfterAudit || item), { action: 'personnel_audit_sent', at: stageTwoAt, userId: 'system' }]
      });
    } catch (saveError) {
      const persisted = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
      if (persisted?.auditMessageId !== auditMessageId) {
        await kv.set(`lspd:hr-audit:item:${item.id}`, {
          ...(persisted || latestAfterAudit || item), auditDeliveryUnconfirmed: true, auditDeliveryState: 'unconfirmed',
          history: [...historyOf(persisted || latestAfterAudit || item), { action: 'personnel_audit_delivery_unconfirmed', at: new Date().toISOString(), userId: 'system' }]
        }).catch(() => {});
        await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_state_save_failed', message: 'Карточка кадрового аудита отправлена, но ID не удалось подтвердить в реестре; повтор остановлен во избежание дубликата', auditId: item.id, auditType: item.type, decision, details: String(saveError?.message || saveError).slice(0, 1000) });
        return { success: false, messageId: reportMessageId, reason: 'audit_delivery_unconfirmed' };
      }
    }

    await writeSystemLog({ level: 'info', category: 'discord', event: 'highrank_audit_report_sent', message: 'HR-карточка обновлена, карточка кадрового аудита отправлена', auditId: item.id, auditType: item.type, decision });
    const promotionResult = await createPromotionFromApprovedReport(item, reviewer, auditMessageId);
    return {
      success: promotionResult.success,
      messageId: auditMessageId,
      approvedReportMessageId: reportMessageId,
      auditMessageId,
      reason: promotionResult.reason || null
    };
  }
  const profileReportUrl = `[Открыть заявку в кадровом аудите №${item.number}](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/las-vegas/audit?id=${encodeURIComponent(item.id)})`;

  // Update the original Discord card for every HR form using PATCH.
  if (item.type !== 'promotion') {
    const originalMessageId = String(item.deliveryMessageId || '');
    if (!/^\d{17,20}$/.test(originalMessageId)) {
      await writeSystemLog({
        level: 'error', category: 'discord', event: 'original_message_id_missing',
        message: 'Нельзя обновить карточку HR-заявки: отсутствует ID исходного сообщения',
        auditId: item.id, auditType: item.type, decision
      });
      return { success: false, messageId: null, reason: 'original_message_id_missing' };
    }

    const messageUrl = new URL(webhook);
    messageUrl.search = '';
    messageUrl.hash = '';
    messageUrl.pathname = `${messageUrl.pathname.replace(/\/$/, '')}/messages/${originalMessageId}`;

    let response;
    try {
      response = await fetch(messageUrl.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 2000);
        await writeSystemLog({
          level: 'error', category: 'discord', event: 'discord_http_error',
          message: 'Не удалось получить исходную карточку HR-заявки из Discord',
          auditId: item.id, auditType: item.type, decision,
          httpStatus: response.status, details: responseBody
        });
        return { success: false, messageId: null, reason: `discord_http_${response.status}` };
      }

      const originalMessage = await response.json();
      const embeds = Array.isArray(originalMessage.embeds) ? originalMessage.embeds : [];
      const originalEmbed = embeds[0] || {};
      const reportData = item.data && typeof item.data === 'object' ? item.data : {};
      const fieldValue = (value, fallback = 'Не указано') => {
        const text = typeof value === 'string' ? value.trim() : '';
        return (text || fallback).slice(0, 1024);
      };
      const fieldLabels = {
        fullName: 'Имя и статик', department: 'Отдел', currentRank: 'Текущий ранг', targetRank: 'Запрашиваемый ранг',
        isInstructor: 'Назначение инструктором', workLinks: 'Ссылки на проделанную работу', rankRange: 'Диапазон рангов',
        workLink: 'Ссылка на проделанную работу', reportLink: 'Ссылка на отчёт', rank: 'Текущий ранг',
        currentDepartment: 'Текущий отдел', targetDepartment: 'Новый отдел', reason: 'Причина',
        approvalProof: 'Подтверждение одобрения', rankProof: 'Подтверждение ранга', age: 'Возраст', experience: 'Опыт',
        lawKnowledge: 'Знание законов', passport: 'Паспорт', militaryId: 'Военный билет', medical: 'Медицинская карта',
        screenshot: 'Скриншот', rankAtDismissal: 'Ранг на момент увольнения', wasWarned: 'Было ли взыскание',
        stateFractionsProof: 'Одобрение State Fractions', dbWhatIs: 'Вопросы DB', dbExperience: 'Опыт DB',
        dbExamples: 'Примеры DB', dbServers: 'Серверы DB', dbKnowledge: 'Знания DB', dbLawKnowledge: 'Знание законов DB',
        swatShooting: 'Стрельба SWAT', swatRollback: 'Откат SWAT'
      };
      const submittedFields = Object.entries(reportData).map(([key, rawValue]) => {
        let value = rawValue;
        if (['department', 'currentDepartment', 'targetDepartment'].includes(key)) value = getDepartment(rawValue)?.name || rawValue;
        if (['isInstructor', 'wasWarned'].includes(key)) value = rawValue === 'yes' ? 'Да' : rawValue === 'no' ? 'Нет' : rawValue;
        if (value && typeof value === 'object') value = JSON.stringify(value);
        return { name: fieldLabels[key] || key, value: fieldValue(String(value ?? '')), inline: false };
      });
      const decisionFields = [
        ...submittedFields,
        { name: 'Отправитель', value: DISCORD_ID_PATTERN.test(applicantId) ? '<@' + applicantId + '>' : 'Discord ID не указан', inline: true },
        { name: 'Discord ID', value: fieldValue(applicantId, 'Не указан'), inline: true },
        { name: 'Решение', value: accepted ? 'Одобрено' : 'Отклонено', inline: true },
        { name: 'Проверил', value: '<@' + reviewerId + '>', inline: true },
        ...(!accepted && reason ? [{ name: 'Причина отказа', value: fieldValue(reason), inline: false }] : [])
      ].slice(0, 25);
      const updatedEmbed = {
        ...(originalEmbed.url ? { url: originalEmbed.url } : {}),
        ...(originalEmbed.author?.name ? {
          author: {
            name: originalEmbed.author.name,
            ...(originalEmbed.author.url ? { url: originalEmbed.author.url } : {}),
            ...(originalEmbed.author.icon_url ? { icon_url: originalEmbed.author.icon_url } : {})
          }
        } : {}),
        ...(originalEmbed.image?.url ? { image: { url: originalEmbed.image.url } } : {}),
        ...(originalEmbed.thumbnail?.url ? { thumbnail: { url: originalEmbed.thumbnail.url } } : {}),
        title: `${item.title || 'Заявка'} №${item.number} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
        color: accepted ? 0x4CAF50 : 0xDC3545,
        description: profileReportUrl,
        fields: decisionFields,
        footer: {
          text: 'Suspect Forms • HR Audit',
          ...(originalEmbed.footer?.icon_url ? { icon_url: originalEmbed.footer.icon_url } : {})
        },
        timestamp: new Date().toISOString()
      };

      const content = `Решение по заявке №${item.number} («${item.title || 'Заявка'}») принято: ${accepted ? 'одобрено' : 'отклонено'}.`;
      response = await fetch(messageUrl.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          embeds: [updatedEmbed]
        }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      console.error('HR audit Discord original message update failed:', {
        auditId: String(item.id), auditType: item.type, decision,
        errorName: error?.name || 'Error',
        errorMessage: String(error?.message || error).slice(0, 500)
      });
      await writeSystemLog({
        level: 'error', category: 'discord',
        event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error',
        message: 'Не удалось обновить исходную карточку HR-заявки в Discord',
        auditId: item.id, auditType: item.type, decision,
        details: String(error?.message || error).slice(0, 1200)
      });
      return { success: false, messageId: null, reason: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error' };
    }

    if (!response.ok) {
      let responseBody = '';
      try { responseBody = (await response.text()).slice(0, 2000); } catch {}
      console.error('HR audit Discord rejected original message update:', {
        auditId: String(item.id), auditType: item.type, decision,
        httpStatus: response.status, responseBody
      });
      await writeSystemLog({
        level: 'error', category: 'discord', event: 'discord_http_error',
        message: 'Discord отклонил обновление исходной карточки HR-заявки',
        auditId: item.id, auditType: item.type, decision,
        httpStatus: response.status, details: responseBody
      });
      return { success: false, messageId: null, reason: `discord_http_${response.status}` };
    }

    // Every approved HR action is also recorded in the personnel audit channel.
    // Rejected applications only update their original card, matching the High-Rank flow.
    if (accepted) {
      const auditResult = await publishPersonnelAudit(item, reviewer, decision);
      return { success: auditResult.success, messageId: auditResult.messageId || originalMessageId, reason: auditResult.reason || null };
    }
    return { success: true, messageId: originalMessageId };
  }

  const fields = [
    {
      name: 'Заявитель',
      value: DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : 'Discord ID не указан',
      inline: true
    },
    { name: 'Рассмотрел', value: `<@${reviewerId}>`, inline: true },
    ...(reason ? [{ name: 'Причина отказа', value: reason, inline: false }] : [])
  ];
  const content = [
    DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : null,
    `<@${reviewerId}>`
  ].filter(Boolean).join(' ');

  let response;
  try {
    response = await fetch(webhookUrlWithWait(webhook), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Suspect Forms',
        content,
        embeds: [{
          title: `${item.title || 'Заявка'} №${item.number} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
          color: accepted ? 0x4CAF50 : 0xDC3545,
          description: auditUrl,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: 'Suspect Forms • HR Audit' }
        }],
        allowed_mentions: {
          users: [applicantId, reviewerId].filter(value => DISCORD_ID_PATTERN.test(value))
        }
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    console.error('HR audit Discord decision request failed:', {
      auditId: String(item.id), auditType: item.type, decision,
      errorName: error?.name || 'Error',
      errorMessage: String(error?.message || error).slice(0, 500)
    });
    await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось установить соединение с Discord при отправке уведомления', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
    return { success: false, messageId: null, reason: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error' };
  }

  if (!response.ok) {
    let responseBody = '';
    try { responseBody = (await response.text()).slice(0, 2000); } catch {}
    console.error('HR audit Discord rejected decision notification:', {
      auditId: String(item.id), auditType: item.type, decision,
      httpStatus: response.status, responseBody
    });
    await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Discord отклонил уведомление о решении', auditId: item.id, auditType: item.type, decision, httpStatus: response.status, details: responseBody });
    return { success: false, messageId: null, reason: `discord_http_${response.status}` };
  }
  let message = null;
  try { message = await response.json(); } catch {}
  await writeSystemLog({ level: 'info', category: 'discord', event: 'decision_notification_sent', message: 'Уведомление о решении успешно отправлено в Discord', auditId: item.id, auditType: item.type, decision, httpStatus: response.status });
  return { success: true, messageId: typeof message?.id === 'string' ? message.id : null };
}
async function recordNotificationAttempt(itemKey, item, userId, action) {
  const at = new Date().toISOString();
  const attempted = {
    ...item,
    notificationAttempts: (Number.isSafeInteger(item.notificationAttempts) ? item.notificationAttempts : 0) + 1,
    lastNotificationAttemptAt: at,
    history: [...historyOf(item), { action, at, userId: String(userId) }]
  };
  await kv.set(itemKey, attempted);
  return attempted;
}

async function recordDeliveryAttempt(itemKey, item, userId, action) {
  const at = new Date().toISOString();
  const attempted = {
    ...item,
    deliveryAttempts: (Number.isSafeInteger(item.deliveryAttempts) ? item.deliveryAttempts : 0) + 1,
    lastDeliveryAttemptAt: at,
    history: [...historyOf(item), { action, at, userId: String(userId) }]
  };
  await kv.set(itemKey, attempted);
  return attempted;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req.cookies?.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!hasHrAuditAccess(user)) {
    return res.status(403).json({ error: 'Доступ разрешён только уполномоченному проверяющему' });
  }

  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');

  if (req.method === 'GET') {
    try {
      const ids = await kv.lrange(AUDIT_IDS_KEY, 0, -1);
      const safeIds = Array.isArray(ids) ? ids.filter(validItemId) : [];
      const items = await Promise.all(safeIds.map(id => kv.get(`lspd:hr-audit:item:${id}`)));
      return res.status(200).json({
        items: items.filter(isSupportedAuditItem)
      });
    } catch (error) {
      console.error('HR audit list failed:', error);
      return res.status(500).json({ error: 'Не удалось загрузить кадровый реестр' });
    }
  }

  const { id, decision, reason, action } = req.body || {};
  if (!validItemId(id)) {
    return res.status(400).json({ error: 'Некорректный номер заявки' });
  }
  const itemKey = `lspd:hr-audit:item:${id}`;

  if (action === 'retry-notification') {
    let lock;
    try {
      lock = await acquireHrAuditLock('notification', id);
      if (!lock) {
        return res.status(409).json({ error: 'Уведомление уже обрабатывается. Обновите список позже.' });
      }

      const item = await kv.get(itemKey);
      if (!item || !isSupportedAuditItem(item) || String(item.id) !== String(id)) {
        return res.status(404).json({ error: 'Заявка не найдена' });
      }
      if (!['accepted', 'rejected'].includes(item.status) || item.notificationPending !== true) {
        return res.status(409).json({ error: 'Для этой заявки нет ожидающего уведомления' });
      }
      if (!item.reviewer || !DISCORD_ID_PATTERN.test(String(item.reviewer.id || ''))) {
        return res.status(409).json({ error: 'В записи отсутствуют данные проверяющего; уведомление нельзя безопасно повторить' });
      }
      if (!getAuditWebhook(item)) {
        return res.status(503).json({ error: 'Вебхук для этой категории заявки не настроен. Решение сохранено; повтор уведомления пока недоступен.' });
      }

      const attempted = await recordNotificationAttempt(
        itemKey, item, user.id, 'notification_retry_attempted'
      );
      let result = { success: false, messageId: null };
      try {
        result = await sendDecision(attempted, attempted.reviewer, attempted.status, attempted.reason || '');
      } catch (error) {
        console.error('HR audit Discord notification retry failed:', {
          auditId: String(attempted.id), auditType: attempted.type, decision: attempted.status,
          errorName: error?.name || 'Error',
          errorMessage: String(error?.message || error).slice(0, 500)
        });
      }

      const at = new Date().toISOString();
      const latestAfterSend = await kv.get(itemKey).catch(() => null);
      const stateAfterSend = latestAfterSend || attempted;
      const updated = {
        ...stateAfterSend,
        notificationPending: !result.success,
        ...(result.success ? {
          notificationSentAt: at,
          notificationMessageId: result.messageId || attempted.notificationMessageId || null
        } : {}),
        history: [...historyOf(stateAfterSend), {
          action: result.success ? 'notification_sent' : 'notification_retry_failed',
          at,
          userId: String(user.id)
        }]
      };

      try {
        await kv.set(itemKey, updated);
      } catch (saveError) {
        console.error('HR audit notification result could not be saved:', saveError);
        const persisted = await kv.get(itemKey).catch(() => null);
        const persistedResult = persisted
          && persisted.status === attempted.status
          && persisted.resolvedAt === attempted.resolvedAt
          && persisted.notificationPending === false
          && persisted.notificationSentAt === at
          && historyOf(persisted).some(entry => entry.action === 'notification_sent' && entry.at === at);
        if (persistedResult) {
          return res.status(200).json({
            success: true,
            item: persisted,
            notificationPending: false
          });
        }
        if (result.success) {
          return res.status(200).json({
            success: true,
            item: attempted,
            notificationPending: true,
            warning: 'Discord подтвердил отправку, но реестр не подтвердил обновление. Перед повторной отправкой проверьте канал отдела.'
          });
        }
        throw saveError;
      }

      if (!result.success) {
        return res.status(502).json({ error: 'Discord не подтвердил ответ. Перед повтором проверьте канал отдела: сообщение могло быть принято.' });
      }
      return res.status(200).json({ success: true, item: updated, notificationPending: false });
    } catch (error) {
      console.error('HR audit notification retry failed:', error);
      return res.status(500).json({ error: 'Не удалось повторить уведомление' });
    } finally {
      await lock?.release();
    }
  }

  if (action === 'retry-delivery') {
    let lock;
    try {
      lock = await acquireHrAuditLock('delivery', id);
      if (!lock) {
        return res.status(409).json({ error: 'Отправка уже выполняется. Обновите список позже.' });
      }

      const item = await kv.get(itemKey);
      if (!item || !isSupportedAuditItem(item) || String(item.id) !== String(id)) {
        return res.status(404).json({ error: 'Заявка не найдена' });
      }
      if (item.deliveryUnconfirmed === true) {
        return res.status(409).json({ error: 'Ответ Discord не подтверждён. Сначала вручную проверьте канал, чтобы не создать дубликат.' });
      }
      if (item.status !== 'pending' || item.deliveryPending !== true || !item.discordPayload) {
        return res.status(409).json({ error: 'Для этой заявки нет ожидающей доставки' });
      }

      const webhook = getAuditWebhook(item);
      if (!webhook) return res.status(503).json({ error: 'Вебхук для этой категории заявки не настроен' });

      const attempted = await recordDeliveryAttempt(
        itemKey, item, user.id, 'delivery_retry_attempted'
      );
      let response;
      try {
        const retryPayload = { ...attempted.discordPayload };
        const retryUrl = new URL(webhook);
        if (retryPayload.thread_id) {
          retryUrl.searchParams.set('thread_id', String(retryPayload.thread_id));
          delete retryPayload.thread_id;
        }
        retryUrl.searchParams.set('wait', 'true');
        response = await fetch(retryUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryPayload),
          signal: AbortSignal.timeout(15000)
        });
      } catch (deliveryError) {
        console.error('HR audit delivery retry could not be confirmed:', deliveryError);
        const at = new Date().toISOString();
        const updated = {
          ...attempted,
          deliveryUnconfirmed: true,
          history: [...historyOf(attempted), {
            action: 'delivery_retry_unconfirmed',
            at,
            userId: String(user.id)
          }]
        };
        await kv.set(itemKey, updated).catch(saveError => {
          console.error('HR audit uncertain delivery history could not be saved:', saveError);
        });
        return res.status(502).json({
          error: 'Не удалось подтвердить ответ Discord. Перед повтором проверьте канал отдела: сообщение могло быть принято.'
        });
      }

      if (!response.ok) {
        const at = new Date().toISOString();
        const updated = {
          ...attempted,
          deliveryUnconfirmed: false,
          history: [...historyOf(attempted), {
            action: 'delivery_retry_failed',
            at,
            userId: String(user.id)
          }]
        };
        await kv.set(itemKey, updated);
        return res.status(502).json({ error: 'Discord не принял сообщение. Можно повторить позже.' });
      }

      let message = null;
      try { message = await response.json(); } catch {}
      const deliveredAt = new Date().toISOString();
      const messageId = typeof message?.id === 'string' ? message.id : '';
      if (!/^\d{17,20}$/.test(messageId)) {
        const uncertain = {
          ...attempted,
          deliveryPending: true,
          deliveryUnconfirmed: true,
          history: [...historyOf(attempted), { action: 'delivery_retry_unconfirmed', at: deliveredAt, userId: String(user.id) }]
        };
        await kv.set(itemKey, uncertain);
        return res.status(502).json({ error: 'Discord принял запрос, но не вернул ID сообщения. Проверьте канал вручную; повторная отправка заблокирована во избежание дубликата.' });
      }
      const updated = {
        ...attempted,
        deliveryPending: false,
        deliveryUnconfirmed: false,
        discordPayload: null,
        deliveredAt,
        deliveryMessageId: messageId,
        history: [...historyOf(attempted), {
          action: 'delivered',
          at: deliveredAt,
          userId: String(user.id)
        }]
      };

      try {
        await kv.set(itemKey, updated);
      } catch (saveError) {
        console.error('Discord accepted the HR audit delivery but Redis state update failed:', saveError);
        const persisted = await kv.get(itemKey).catch(() => null);
        if (persisted?.deliveryPending === false && persisted.deliveredAt === deliveredAt && persisted.deliveryMessageId === messageId) {
          return res.status(200).json({ success: true, item: persisted });
        }
        const uncertain = {
          ...(persisted || attempted), deliveryPending: true, deliveryUnconfirmed: true,
          history: [...historyOf(persisted || attempted), {
            action: 'delivery_retry_unconfirmed', at: new Date().toISOString(), userId: String(user.id)
          }]
        };
        await kv.set(itemKey, uncertain).catch(() => {});
        return res.status(200).json({
          success: true,
          item: uncertain,
          warning: 'Discord подтвердил отправку, но реестр не подтвердил ID сообщения. Повтор заблокирован; сначала проверьте канал отдела.'
        });
      }
      return res.status(200).json({ success: true, item: updated });
    } catch (error) {
      console.error('HR audit delivery retry failed:', error);
      return res.status(500).json({ error: 'Не удалось повторить отправку' });
    } finally {
      await lock?.release();
    }
  }

  if (!['accepted', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Некорректное решение' });
  }
  const cleanReason = decision === 'rejected' && typeof reason === 'string' ? reason.trim() : '';
  if (decision === 'rejected' && !cleanReason) {
    return res.status(400).json({ error: 'Для отказа обязательно укажите причину' });
  }
  if (decision === 'rejected' && cleanReason.length > 1000) {
    return res.status(400).json({ error: 'Причина слишком длинная' });
  }

  let lock;
  try {
    lock = await acquireHrAuditLock('notification', id);
    if (!lock) {
      return res.status(409).json({ error: 'Уведомление по этой заявке уже обрабатывается. Обновите список позже.' });
    }

    const item = await kv.get(itemKey);
    if (!item || !isSupportedAuditItem(item) || String(item.id) !== String(id)) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    if (item.status !== 'pending') {
      return res.status(409).json({ error: 'По этой заявке уже принято решение' });
    }
    if (item.deliveryPending === true) {
      return res.status(409).json({ error: 'Сначала необходимо подтвердить доставку заявки в Discord' });
    }

    const resolvedAt = new Date().toISOString();
    const notificationAttemptAt = new Date().toISOString();
    const decisionRecord = {
      ...item,
      status: decision,
      reason: decision === 'rejected' ? cleanReason : null,
      reviewer: { id: String(user.id), username: user.username || 'Unknown' },
      resolvedAt,
      notificationPending: true,
      history: [
        ...historyOf(item),
        {
          action: decision,
          at: resolvedAt,
          userId: String(user.id),
          reason: decision === 'rejected' ? cleanReason : null
        },
        {
          action: 'notification_attempted',
          at: notificationAttemptAt,
          userId: String(user.id)
        }
      ]
    };

    // Persist the irreversible decision before contacting Discord.
    let saved;
    try {
      saved = await kv.eval(
        SAVE_DECISION_SCRIPT,
        [itemKey],
        [JSON.stringify(decisionRecord), String(id)]
      );
    } catch (commitError) {
      // Redis may have committed the script even when the client lost its reply.
      const persisted = await kv.get(itemKey).catch(() => null);
      const decisionWasCommitted = persisted
        && isSupportedAuditItem(persisted)
        && persisted.status === decision
        && persisted.resolvedAt === resolvedAt
        && String(persisted.reviewer?.id || '') === String(user.id);
      if (!decisionWasCommitted) throw commitError;
      saved = 1;
    }
    if (saved === -1) return res.status(404).json({ error: 'Заявка не найдена' });
    if (saved === -2) return res.status(404).json({ error: 'Запись кадрового аудита повреждена или не является поддерживаемой заявкой' });
    if (saved === -3) return res.status(409).json({ error: 'Сначала необходимо подтвердить доставку заявки в Discord' });
    if (saved !== 1) return res.status(409).json({ error: 'По этой заявке уже принято решение' });

    let result = { success: false, messageId: null };
    try {
      result = await sendDecision(decisionRecord, decisionRecord.reviewer, decision, cleanReason);
    } catch (error) {
      console.error('HR audit Discord notification failed:', {
        auditId: String(decisionRecord.id), auditType: decisionRecord.type, decision,
        errorName: error?.name || 'Error',
        errorMessage: String(error?.message || error).slice(0, 500)
      });
    }

    const notificationAt = new Date().toISOString();
    const latestAfterSend = await kv.get(itemKey).catch(() => null);
    const stateAfterSend = latestAfterSend || decisionRecord;
    const updated = {
      ...stateAfterSend,
      notificationPending: !result.success,
      ...(result.success ? {
        notificationSentAt: notificationAt,
        notificationMessageId: result.messageId
      } : {}),
      history: [...historyOf(stateAfterSend), {
        action: result.success ? 'notification_sent' : 'notification_pending',
        at: notificationAt,
        userId: String(user.id)
      }]
    };

    try {
      await kv.set(itemKey, updated);
    } catch (saveError) {
      console.error('HR audit decision was saved but notification state update failed:', saveError);
      const persisted = await kv.get(itemKey).catch(() => null);
      const finalAction = result.success ? 'notification_sent' : 'notification_pending';
      const persistedFinalState = persisted
        && persisted.status === decision
        && persisted.resolvedAt === resolvedAt
        && persisted.notificationPending === !result.success
        && historyOf(persisted).some(entry => entry.action === finalAction && entry.at === notificationAt);
      if (persistedFinalState) {
        return res.status(200).json({
          success: true,
          item: persisted,
          notificationPending: !result.success,
          ...(!result.success ? {
            warning: 'Решение сохранено, но Discord не подтвердил уведомление. Перед повторной отправкой проверьте канал отдела: сообщение могло быть принято.'
          } : {})
        });
      }
      return res.status(200).json({
        success: true,
        item: decisionRecord,
        notificationPending: true,
        warning: 'Решение сохранено. Состояние уведомления не удалось подтвердить; перед повторной отправкой проверьте канал отдела.'
      });
    }

    return res.status(200).json({
      success: true,
      item: updated,
      notificationPending: !result.success,
      ...(!result.success ? {
        warning: result.reason === 'webhook_not_configured'
          ? 'Решение сохранено, но вебхук для этой категории заявки не настроен. После настройки его можно будет отправить повторно.'
          : 'Решение сохранено, но Discord не подтвердил уведомление. Перед повторной отправкой проверьте канал отдела: сообщение могло быть принято.'
      } : {})
    });
  } catch (error) {
    console.error('HR audit decision failed:', error);
    return res.status(500).json({ error: 'Не удалось сохранить решение' });
  } finally {
    await lock?.release();
  }
}

import { verifyToken } from '../../../lib/discord';
import { SUPER_ADMIN_ID } from '../../../lib/admins';
import { kv } from '../../../lib/redis.js';
import { getDepartment, getReportWebhook } from '../../../lib/departments';
import { acquireHrAuditLock } from '../../../lib/hr-audit-locks';

const AUDIT_IDS_KEY = 'lspd:hr-audit:ids';
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const AUDIT_ITEM_ID_PATTERN = /^[1-9]\d{0,11}$/;

const SAVE_DECISION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local current = cjson.decode(raw)
if current.type ~= 'report' and current.type ~= 'highrank' then return -2 end
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
  if (item?.type === 'report') {
    const department = getDepartment(item.data?.department);
    return department ? getReportWebhook(department.id) : null;
  }
  return null;
}

function isSupportedAuditItem(item) {
  return Boolean(item && ['report', 'highrank'].includes(item.type));
}

function webhookUrlWithWait(webhook) {
  const url = new URL(webhook);
  url.searchParams.set('wait', 'true');
  return url.toString();
}

async function sendDecision(item, reviewer, decision, reason) {
  const webhook = getAuditWebhook(item);
  const applicantId = String(item.submitter?.id || '');
  const reviewerId = String(reviewer?.id || '');

  if (!webhook) return { success: false, messageId: null, reason: 'webhook_not_configured' };
  if (!DISCORD_ID_PATTERN.test(reviewerId)) {
    return { success: false, messageId: null, reason: 'reviewer_invalid' };
  }

  const accepted = decision === 'accepted';
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

  const response = await fetch(webhookUrlWithWait(webhook), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'LSPD Forms',
      content,
      embeds: [{
        title: `${item.type === 'highrank' ? 'Отчёт на повышение хай-состава' : 'Отчёт на повышение'} №${item.number} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
        color: accepted ? 0x4CAF50 : 0xDC3545,
        description: `[Открыть заявку на сайте](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/audit)`,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'LSPD HR Audit' }
      }],
      allowed_mentions: {
        users: [applicantId, reviewerId].filter(value => DISCORD_ID_PATTERN.test(value))
      }
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) return { success: false, messageId: null };
  let message = null;
  try { message = await response.json(); } catch {}
  return {
    success: true,
    messageId: typeof message?.id === 'string' ? message.id : null
  };
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
  if (String(user.id) !== SUPER_ADMIN_ID) {
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
        return res.status(503).json({ error: 'Вебхук отдела не настроен. Решение сохранено; повтор уведомления пока недоступен.' });
      }

      const attempted = await recordNotificationAttempt(
        itemKey, item, user.id, 'notification_retry_attempted'
      );
      let result = { success: false, messageId: null };
      try {
        result = await sendDecision(attempted, attempted.reviewer, attempted.status, attempted.reason || '');
      } catch (error) {
        console.error('HR audit Discord notification retry failed:', error);
      }

      const at = new Date().toISOString();
      const updated = {
        ...attempted,
        notificationPending: !result.success,
        ...(result.success ? {
          notificationSentAt: at,
          notificationMessageId: result.messageId || attempted.notificationMessageId || null
        } : {}),
        history: [...historyOf(attempted), {
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
      if (item.status !== 'pending' || item.deliveryPending !== true || !item.discordPayload) {
        return res.status(409).json({ error: 'Для этой заявки нет ожидающей доставки' });
      }

      const webhook = getAuditWebhook(item);
      if (!webhook) return res.status(503).json({ error: 'Вебхук отдела не настроен' });

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
      const updated = {
        ...attempted,
        deliveryPending: false,
        discordPayload: null,
        deliveredAt,
        deliveryMessageId: typeof message?.id === 'string' ? message.id : null,
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
        if (persisted?.deliveryPending === false && persisted.deliveredAt === deliveredAt) {
          return res.status(200).json({ success: true, item: persisted });
        }
        return res.status(200).json({
          success: true,
          item: attempted,
          warning: 'Discord подтвердил отправку, но реестр не подтвердил обновление. Перед повторной отправкой проверьте канал отдела.'
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
    if (saved === -2) return res.status(404).json({ error: 'Запись кадрового аудита повреждена или не является отчётом' });
    if (saved === -3) return res.status(409).json({ error: 'Сначала необходимо подтвердить доставку заявки в Discord' });
    if (saved !== 1) return res.status(409).json({ error: 'По этой заявке уже принято решение' });

    let result = { success: false, messageId: null };
    try {
      result = await sendDecision(decisionRecord, decisionRecord.reviewer, decision, cleanReason);
    } catch (error) {
      console.error('HR audit Discord notification failed:', error);
    }

    const notificationAt = new Date().toISOString();
    const updated = {
      ...decisionRecord,
      notificationPending: !result.success,
      ...(result.success ? {
        notificationSentAt: notificationAt,
        notificationMessageId: result.messageId
      } : {}),
      history: [...historyOf(decisionRecord), {
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
          ? 'Решение сохранено, но вебхук отдела не настроен. После настройки его можно будет отправить повторно.'
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

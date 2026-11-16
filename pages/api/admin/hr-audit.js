import { verifyToken } from '../../../lib/discord';
import { SUPER_ADMIN_ID } from '../../../lib/admins';
import { kv } from '../../../lib/redis.js';
import { getReportWebhook } from '../../../lib/departments';

const AUDIT_IDS_KEY = 'lspd:hr-audit:ids';
const SAVE_DECISION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local current = cjson.decode(raw)
if current.status ~= 'pending' then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;

async function sendDecision(item, reviewer, decision, reason) {
  const webhook = getReportWebhook(item.data?.department);
  if (!webhook) return false;
  const accepted = decision === 'accepted';
  const fields = [
    { name: 'Заявитель', value: `<@${item.submitter.id}>`, inline: true },
    { name: 'Рассмотрел', value: `<@${reviewer.id}>`, inline: true },
    ...(reason ? [{ name: 'Причина отказа', value: reason.slice(0, 1024), inline: false }] : [])
  ];
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'LSPD Forms',
      content: `<@${item.submitter.id}> <@${reviewer.id}>`,
      embeds: [{
        title: `Отчёт на повышение №${item.number} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
        color: accepted ? 0x4CAF50 : 0xDC3545,
        description: `[Открыть заявку на сайте](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/admin/hr-audit)`,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'LSPD HR Audit' }
      }],
      allowed_mentions: { users: [String(item.submitter.id), String(reviewer.id)] }
    })
  });
  return response.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req.cookies.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (String(user.id) !== SUPER_ADMIN_ID) return res.status(403).json({ error: 'Доступ разрешён только владельцу тестовой версии' });

  if (req.method === 'GET') {
    try {
      const ids = await kv.lrange(AUDIT_IDS_KEY, 0, 199);
      const items = await Promise.all(ids.map(id => kv.get(`lspd:hr-audit:item:${id}`)));
      return res.status(200).json({ items: items.filter(Boolean) });
    } catch (error) {
      console.error('HR audit list failed:', error);
      return res.status(500).json({ error: 'Не удалось загрузить кадровый реестр' });
    }
  }

  const { id, decision, reason, action } = req.body || {};
  if (action === 'retry-notification') {
    if (!/^\d{1,12}$/.test(String(id || ''))) return res.status(400).json({ error: 'Некорректный номер заявки' });
    const lockKey = `lspd:hr-audit:notification-lock:${id}`;
    try {
      const locked = await kv.set(lockKey, String(user.id), { nx: true, ex: 60 });
      if (locked !== 'OK') return res.status(409).json({ error: 'Уведомление уже отправляется. Обновите список позже.' });
      const itemKey = `lspd:hr-audit:item:${id}`;
      const item = await kv.get(itemKey);
      if (!item) return res.status(404).json({ error: 'Заявка не найдена' });
      if (!['accepted', 'rejected'].includes(item.status) || !item.notificationPending) {
        return res.status(409).json({ error: 'Для этой заявки нет ожидающего уведомления' });
      }
      const reviewer = item.reviewer || { id: String(user.id), username: user.username || 'Unknown' };
      const sent = await sendDecision(item, reviewer, item.status, item.reason || '');
      if (!sent) return res.status(502).json({ error: 'Discord не принял уведомление. Повторите позже.' });
      const updated = { ...item, notificationPending: false, notificationSentAt: new Date().toISOString() };
      await kv.set(itemKey, updated);
      return res.status(200).json({ success: true, item: updated });
    } catch (error) {
      console.error('HR audit notification retry failed:', error);
      return res.status(500).json({ error: 'Не удалось повторить уведомление' });
    } finally {
      await kv.del(lockKey).catch(() => {});
    }
  }

  if (action === 'retry-delivery') {
    if (!/^\d{1,12}$/.test(String(id || ''))) return res.status(400).json({ error: 'Некорректный номер заявки' });
    const lockKey = `lspd:hr-audit:delivery-lock:${id}`;
    try {
      const locked = await kv.set(lockKey, String(user.id), { nx: true, ex: 60 });
      if (locked !== 'OK') return res.status(409).json({ error: 'Отправка уже выполняется. Обновите список позже.' });
      const itemKey = `lspd:hr-audit:item:${id}`;
      const item = await kv.get(itemKey);
      if (!item) return res.status(404).json({ error: 'Заявка не найдена' });
      if (item.status !== 'pending' || !item.deliveryPending || !item.discordPayload) {
        return res.status(409).json({ error: 'Для этой заявки нет ожидающей отправки' });
      }
      const webhook = getReportWebhook(item.data?.department);
      if (!webhook) return res.status(503).json({ error: 'Вебхук отдела не настроен' });
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.discordPayload)
      });
      if (!response.ok) return res.status(502).json({ error: 'Discord пока не принял сообщение. Можно повторить позже.' });
      const updated = { ...item, deliveryPending: false, discordPayload: null, deliveredAt: new Date().toISOString() };
      await kv.set(itemKey, updated);
      return res.status(200).json({ success: true, item: updated });
    } catch (error) {
      console.error('HR audit delivery retry failed:', error);
      return res.status(500).json({ error: 'Не удалось повторить отправку' });
    } finally {
      await kv.del(lockKey).catch(() => {});
    }
  }
  if (!/^\d{1,12}$/.test(String(id || ''))) return res.status(400).json({ error: 'Некорректный номер заявки' });
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Некорректное решение' });
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (decision === 'rejected' && !cleanReason) return res.status(400).json({ error: 'Для отказа обязательно укажите причину' });
  if (cleanReason.length > 1000) return res.status(400).json({ error: 'Причина слишком длинная' });

  try {
    const itemKey = `lspd:hr-audit:item:${id}`;
    const item = await kv.get(itemKey);
    if (!item) return res.status(404).json({ error: 'Заявка не найдена' });
    if (item.status !== 'pending') return res.status(409).json({ error: 'По этой заявке уже принято решение' });
    if (item.deliveryPending) return res.status(409).json({ error: 'Сначала необходимо доставить заявку в Discord' });

    const resolvedAt = new Date().toISOString();
    const updated = {
      ...item,
      status: decision,
      reason: decision === 'rejected' ? cleanReason : null,
      reviewer: { id: String(user.id), username: user.username || 'Unknown' },
      resolvedAt,
      history: [...(Array.isArray(item.history) ? item.history : []), {
        action: decision,
        at: resolvedAt,
        userId: String(user.id),
        reason: decision === 'rejected' ? cleanReason : null
      }],
      notificationPending: true
    };

    // Redis compare-and-set prevents two concurrent requests from resolving the same item.
    const saved = await kv.eval(SAVE_DECISION_SCRIPT, [itemKey], [JSON.stringify(updated)]);
    if (saved === -1) return res.status(404).json({ error: 'Заявка не найдена' });
    if (saved !== 1) return res.status(409).json({ error: 'По этой заявке уже принято решение' });

    let notified = false;
    try { notified = await sendDecision(updated, user, decision, cleanReason); }
    catch (error) { console.error('HR audit Discord notification failed:', error); }
    if (notified) {
      updated.notificationPending = false;
      await kv.set(itemKey, updated);
    }
    return res.status(200).json({ success: true, item: updated, notificationPending: !notified });
  } catch (error) {
    console.error('HR audit decision failed:', error);
    return res.status(500).json({ error: 'Не удалось сохранить решение' });
  }
}

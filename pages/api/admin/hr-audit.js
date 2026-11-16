import { verifyToken } from '../../../lib/discord';
import { SUPER_ADMIN_ID } from '../../../lib/admins';
import { kv } from '../../../lib/redis.js';
import { getReportWebhook } from '../../../lib/departments';

const AUDIT_IDS_KEY = 'lspd:hr-audit:ids';
const LOCK_SECONDS = 15;

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
      content: `Отчёт №${item.number}: ${accepted ? 'одобрил' : 'отклонил'} <@${reviewer.id}>. Автор отчёта: <@${item.submitter.id}>.`,
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

  const { id, decision, reason } = req.body || {};
  if (!/^\d{1,12}$/.test(String(id || ''))) return res.status(400).json({ error: 'Некорректный номер заявки' });
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Некорректное решение' });
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (decision === 'rejected' && !cleanReason) return res.status(400).json({ error: 'Для отказа обязательно укажите причину' });
  if (cleanReason.length > 1000) return res.status(400).json({ error: 'Причина слишком длинная' });

  const lockKey = `lspd:hr-audit:lock:${id}`;
  try {
    const locked = await kv.set(lockKey, String(user.id), { nx: true, ex: LOCK_SECONDS });
    if (locked !== 'OK') return res.status(409).json({ error: 'Заявка уже обрабатывается. Обновите страницу.' });

    const itemKey = `lspd:hr-audit:item:${id}`;
    const item = await kv.get(itemKey);
    if (!item) return res.status(404).json({ error: 'Заявка не найдена' });
    if (item.status !== 'pending') return res.status(409).json({ error: 'По этой заявке уже принято решение' });

    const updated = {
      ...item,
      status: decision,
      reason: decision === 'rejected' ? cleanReason : null,
      reviewer: { id: String(user.id), username: user.username || 'Unknown' },
      resolvedAt: new Date().toISOString(),
      history: [...(Array.isArray(item.history) ? item.history : []), {
        action: decision,
        at: new Date().toISOString(),
        userId: String(user.id),
        reason: decision === 'rejected' ? cleanReason : null
      }],
      notificationPending: true
    };
    await kv.set(itemKey, updated);

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
  } finally {
    await kv.del(lockKey).catch(() => {});
  }
}

import { verifyToken } from '../../../lib/discord';
import { SUPER_ADMIN_ID } from '../../../lib/admins';
import { kv } from '../../../lib/redis.js';
import { getReportWebhook } from '../../../lib/departments';
import { HR_FORM_TYPES, getHrFormDisplayTitle } from '../../../lib/hr-forms';

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
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '');
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'LSPD Forms',
      content: `${getHrFormDisplayTitle(item.formType || 'promotion_report', item.number)}: ${accepted ? 'одобрил' : 'отклонил'} <@${reviewer.id}>. Автор отчёта: <@${item.submitter.id}>.`,
      embeds: [{
        title: `${getHrFormDisplayTitle(item.formType || 'promotion_report', item.number)} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
        color: accepted ? 0x4CAF50 : 0xDC3545,
        description: `[Открыть заявку на сайте](${baseUrl}/admin/hr-audit/${item.number})`,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'LSPD HR Audit' }
      }],
      allowed_mentions: { users: [String(item.submitter.id), String(reviewer.id)] }
    })
  });
  return response.ok;
}

function matchesFilters(item, query) {
  const type = String(query.type || 'promotion_report');
  if (item.formType && item.formType !== type) return false;
  if (!item.formType && type !== 'promotion_report') return false;
  if (query.status && item.status !== query.status) return false;
  if (query.department && String(item.data?.department || '') !== String(query.department)) return false;
  if (query.search) {
    const needle = String(query.search).trim().toLowerCase();
    const haystack = [item.number, item.submitter?.username, item.submitter?.id, item.data?.fullName, item.data?.department]
      .filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req.cookies.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (String(user.id) !== SUPER_ADMIN_ID) return res.status(403).json({ error: 'Доступ разрешён только владельцу тестовой версии' });

  if (req.method === 'GET') {
    try {
      const requestedType = String(req.query.type || 'promotion_report');
      const config = HR_FORM_TYPES[requestedType];
      if (!config) return res.status(400).json({ error: 'Неизвестный тип формы' });
      if (req.query.id) {
        if (!/^\d{1,12}$/.test(String(req.query.id))) return res.status(400).json({ error: 'Некорректный номер записи' });
        const item = await kv.get(config.itemKey(req.query.id));
        if (!item || (item.formType && item.formType !== requestedType)) return res.status(404).json({ error: 'Запись не найдена' });
        return res.status(200).json({ item: { ...item, formType: item.formType || 'promotion_report' } });
      }
      const ids = await kv.lrange(config.idsKey, 0, 499);
      const items = await Promise.all(ids.map(id => kv.get(config.itemKey(id))));
      const filtered = items.filter(Boolean).map(item => ({
        ...item,
        formType: item.formType || 'promotion_report'
      })).filter(item => matchesFilters(item, { ...req.query, type: requestedType }));
      return res.status(200).json({ items: filtered });
    } catch (error) {
      console.error('HR audit list failed:', error);
      return res.status(500).json({ error: 'Не удалось загрузить кадровый реестр' });
    }
  }


  if (req.body?.action === 'comment') {
    const id = String(req.body.id || '');
    const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';
    if (!/^\\d{1,12}$/.test(id)) return res.status(400).json({ error: 'Некорректный номер заявки' });
    if (!comment || comment.length > 2000) return res.status(400).json({ error: 'Комментарий должен содержать от 1 до 2000 символов' });
    const lockKey = `lspd:hr-audit:lock:${id}`;
    try {
      const locked = await kv.set(lockKey, String(user.id), { nx: true, ex: LOCK_SECONDS });
      if (locked !== 'OK') return res.status(409).json({ error: 'Заявка сейчас обрабатывается. Повторите позже.' });
      const itemKey = HR_FORM_TYPES.promotion_report.itemKey(id);
      const item = await kv.get(itemKey);
      if (!item) return res.status(404).json({ error: 'Заявка не найдена' });
      const at = new Date().toISOString();
      const entry = { id: `${at}-${String(user.id)}`, comment, at, author: { id: String(user.id), username: user.username || 'Unknown' } };
      const updated = {
        ...item,
        comments: [...(Array.isArray(item.comments) ? item.comments : []), entry],
        history: [...(Array.isArray(item.history) ? item.history : []), { action: 'commented', at, userId: String(user.id) }]
      };
      await kv.set(itemKey, updated);
      return res.status(200).json({ success: true, item: updated });
    } catch (error) {
      console.error('HR audit comment failed:', error);
      return res.status(500).json({ error: 'Не удалось сохранить комментарий' });
    } finally {
      await kv.del(lockKey).catch(() => {});
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

    const itemKey = HR_FORM_TYPES.promotion_report.itemKey(id);
    const item = await kv.get(itemKey);
    if (!item) return res.status(404).json({ error: 'Заявка не найдена' });
    if (item.status !== 'pending') return res.status(409).json({ error: 'По этой заявке уже принято решение' });

    const resolvedAt = new Date().toISOString();
    const updated = {
      ...item,
      formType: item.formType || 'promotion_report',
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

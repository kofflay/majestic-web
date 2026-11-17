import { verifyToken } from '../../lib/discord';
import { kv } from '../../lib/redis.js';

const FIELD_LABELS = {
  fullName: 'Имя и статик',
  department: 'Подразделение',
  currentRank: 'Текущий ранг',
  targetRank: 'Запрашиваемый ранг',
  isInstructor: 'Назначение инструктором',
  workLinks: 'Ссылки на проделанную работу',
  rankRange: 'Диапазон рангов',
  workLink: 'Ссылка на проделанную работу'
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyToken(req.cookies?.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  const id = String(req.query.id || '');
  if (!/^[1-9]\\d{0,11}$/.test(id)) {
    return res.status(400).json({ error: 'Некорректный номер обращения' });
  }

  try {
    const item = await kv.get(`lspd:hr-audit:item:${id}`);
    if (!item || !['report', 'highrank'].includes(item.type) || String(item.submitter?.id || '') !== String(user.id)) {
      return res.status(404).json({ error: 'Обращение не найдено' });
    }

    const statusLabels = {
      pending: 'На рассмотрении',
      accepted: 'Одобрено',
      rejected: 'Отклонено'
    };
    const data = {};
    for (const [key, value] of Object.entries(item.data || {})) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        data[key] = String(value);
      }
    }

    return res.status(200).json({
      item: {
        number: Number(item.number),
        status: item.status,
        statusLabel: statusLabels[item.status] || 'Статус неизвестен',
        data,
        fieldLabels: FIELD_LABELS,
        reason: item.status === 'rejected' ? String(item.reason || '') : '',
        submittedAt: item.submittedAt || null,
        resolvedAt: item.resolvedAt || null
      }
    });
  } catch (error) {
    console.error('Employee submission detail failed:', error);
    return res.status(500).json({ error: 'Не удалось загрузить обращение' });
  }
}

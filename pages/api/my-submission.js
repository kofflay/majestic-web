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
  const referenceId = String(req.query.ref || '');
  if (id && !/^[1-9]\\d{0,11}$/.test(id)) return res.status(400).json({ error: 'Некорректный номер обращения' });
  if (!id && !/^[a-z0-9-]{8,80}$/i.test(referenceId)) return res.status(400).json({ error: 'Некорректная ссылка на обращение' });

  try {
    let item = null;
    let isHrAudit = false;
    if (id) {
      item = await kv.get(`lspd:hr-audit:item:${id}`);
      if (!item || !['report', 'highrank'].includes(item.type) || String(item.submitter?.id || '') !== String(user.id)) {
        return res.status(404).json({ error: 'Обращение не найдено' });
      }
      isHrAudit = true;
    } else {
      const entries = await kv.lrange('lspd:submissions:all', 0, 199);
      for (const raw of Array.isArray(entries) ? entries : []) {
        let candidate = raw;
        if (typeof raw === 'string') {
          try { candidate = JSON.parse(raw); } catch { continue; }
        }
        if (String(candidate?.id || '') === referenceId && String(candidate?.userId || '') === String(user.id)) {
          item = candidate;
          break;
        }
      }
      if (!item) return res.status(404).json({ error: 'Подробности обращения не найдены' });
    }

    const statusLabels = { pending: 'На рассмотрении', accepted: 'Одобрено', rejected: 'Отклонено' };
    const data = {};
    for (const [key, value] of Object.entries(item.data || {})) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') data[key] = String(value);
    }

    return res.status(200).json({
      item: {
        number: isHrAudit ? Number(item.number) : null,
        isHrAudit,
        type: item.type,
        title: item.title || '',
        status: isHrAudit ? item.status : 'sent',
        statusLabel: isHrAudit ? (statusLabels[item.status] || 'Статус неизвестен') : 'Отправлено в Discord',
        data,
        fieldLabels: FIELD_LABELS,
        reason: isHrAudit && item.status === 'rejected' ? String(item.reason || '') : '',
        submittedAt: isHrAudit ? item.submittedAt || null : item.date || null,
        resolvedAt: isHrAudit ? item.resolvedAt || null : null
      }
    });
  } catch (error) {
    console.error('Employee submission detail failed:', error);
    return res.status(500).json({ error: 'Не удалось загрузить обращение' });
  }
}

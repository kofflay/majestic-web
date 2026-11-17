import { verifyToken } from '../../lib/discord';
import { kv } from '../../lib/redis.js';
import { getDepartment, getReportWebhook } from '../../lib/departments';

const FIELD_LABELS = {
  fullName: 'Имя и статик',
  department: 'Подразделение',
  currentRank: 'Текущий ранг',
  targetRank: 'Запрашиваемый ранг',
  isInstructor: 'Назначение инструктором',
  workLinks: 'Ссылки на проделанную работу',
  rankRange: 'Диапазон рангов',
  workLink: 'Ссылка на проделанную работу',
  rank: 'Текущий ранг',
  currentDepartment: 'Текущий отдел',
  targetDepartment: 'Запрашиваемый отдел',
  reason: 'Причина',
  comment: 'Комментарий',
  description: 'Описание',
  age: 'Возраст',
  experience: 'Опыт',
  lawKnowledge: 'Знание законов',
  passport: 'Паспорт',
  militaryId: 'Военный билет',
  medical: 'Медицинская карта',
  screenshot: 'Скриншот',
  rankAtDismissal: 'Ранг на момент увольнения',
  rankProof: 'Подтверждение ранга',
  approvalProof: 'Подтверждение одобрения',
  wasWarned: 'Было ли увольнение после Ban/Warn',
  stateFractionsProof: 'Одобрение State Fractions',
  weapon: 'Запрашиваемое вооружение',
  participants: 'Участники',
  complainantName: 'Имя заявителя',
  targetName: 'Имя сотрудника',
  incidentDate: 'Дата происшествия',
  evidence: 'Доказательства',
  startDate: 'Дата начала',
  endDate: 'Дата окончания',
  reportLink: 'Ссылка на отчёт',
  leaveType: 'Тип отпуска'
};

const TYPE_LABELS = {
  report: 'Отчёт о повышении',
  highrank: 'Отчёт на повышение хай-состава',
  transfer: 'Заявление на перевод',
  resignation: 'Заявление на увольнение',
  reinstatement: 'Заявление на восстановление',
  'transfer-to-lspd': 'Перевод в LSPD',
  hiring: 'Заявление на трудоустройство',
  'weapon-request': 'Запрос на вооружение',
  premium: 'Заявка на премию',
  complaint: 'Жалоба',
  leave: 'Заявление на отпуск',
  promotion: 'Запрос на повышение'
};


function getAuditWebhook(item) {
  if (item?.type === 'highrank') return process.env.WEBHOOK_HIGH_RANK_REPORT || null;
  if (item?.type === 'promotion') return process.env.WEBHOOK_PROMOTION || null;
  if (item?.type === 'report') {
    const department = getDepartment(item.data?.department);
    return department ? getReportWebhook(department.id) : null;
  }
  return null;
}

async function getDiscordMessageUrl(item) {
  const savedUrl = [item?.discordMessageUrl, item?.approvedReportMessageUrl, item?.auditMessageUrl]
    .find(value => /^https:\/\/discord(?:app)?\.com\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}$/i.test(String(value || '')));
  if (savedUrl) return savedUrl;
  const messageId = String(item?.deliveryMessageId || '');
  const webhook = getAuditWebhook(item);
  if (!/^\d{17,20}$/.test(messageId) || !webhook) return null;
  try {
    const response = await fetch(webhook, { method: 'GET', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const info = await response.json();
    const guildId = String(info?.guild_id || '');
    const channelId = String(info?.channel_id || '');
    return /^\d{17,20}$/.test(guildId) && /^\d{17,20}$/.test(channelId)
      ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
      : null;
  } catch {
    return null;
  }
}

function safeData(source) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    }
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyToken(req.cookies?.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  const id = String(req.query.id || '');
  const referenceId = String(req.query.ref || '');
  if (id && !/^[1-9][0-9]{0,11}$/.test(id)) return res.status(400).json({ error: 'Некорректный номер обращения' });
  if (!id && !/^[a-z0-9-]{8,80}$/i.test(referenceId)) return res.status(400).json({ error: 'Некорректная ссылка на обращение' });

  try {
    let item;
    let isHrAudit = false;
    if (id) {
      item = await kv.get(`lspd:hr-audit:item:${id}`);
      if (!item || !['report', 'highrank', 'promotion'].includes(item.type) || String(item.submitter?.id || '') !== String(user.id)) {
        return res.status(404).json({ error: 'Обращение не найдено' });
      }
      isHrAudit = true;
    } else {
      item = await kv.get(`lspd:submission:detail:${user.id}:${referenceId}`);
      if (!item || String(item.userId || '') !== String(user.id) || String(item.id || '') !== referenceId) {
        return res.status(404).json({ error: 'Подробности обращения не найдены' });
      }
    }

    const discordUrl = isHrAudit ? await getDiscordMessageUrl(item) : null;

    const statusLabels = {
      pending: item.deliveryPending === true ? 'Ожидает отправки в Discord' : 'На рассмотрении',
      accepted: 'Одобрено',
      rejected: 'Отклонено'
    };
    const timeline = isHrAudit
      ? (Array.isArray(item.history) ? item.history : [])
          .filter(entry => ['submitted', 'delivered', 'accepted', 'rejected'].includes(entry?.action))
          .map(entry => ({
            action: entry.action,
            at: entry.at || null,
            label: entry.action === 'submitted' ? 'Обращение подано'
              : entry.action === 'delivered' ? 'Доставлено в Discord'
              : entry.action === 'accepted' ? 'Обращение одобрено'
              : 'Обращение отклонено'
          }))
      : [{ action: 'delivered', at: item.date || null, label: 'Отправлено в Discord' }];

    return res.status(200).json({
      item: {
        number: isHrAudit ? Number(item.number) : null,
        isHrAudit,
        type: item.type,
        typeLabel: TYPE_LABELS[item.type] || item.title || 'Обращение',
        title: item.title || '',
        status: isHrAudit ? item.status : 'sent',
        statusLabel: isHrAudit ? (statusLabels[item.status] || 'Статус неизвестен') : 'Отправлено в Discord',
        deliveryPending: isHrAudit && item.deliveryPending === true,
        data: safeData(item.data),
        fieldLabels: FIELD_LABELS,
        reason: isHrAudit && item.status === 'rejected' ? String(item.reason || '') : '',
        submittedAt: isHrAudit ? item.submittedAt || null : item.date || null,
        resolvedAt: isHrAudit ? item.resolvedAt || null : null,
        timeline,
        discordUrl
      }
    });
  } catch (error) {
    console.error('Employee submission detail failed:', error);
    return res.status(500).json({ error: 'Не удалось загрузить обращение' });
  }
}

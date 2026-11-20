import { kv } from '../../../../lib/redis.js';
import { verifyToken } from '../../../../lib/discord';

export default async function handler(req, res) {
  const user = verifyToken(req.cookies.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await getLasVegasAccess(user)).isStaff) return res.status(403).json({ error: 'Нет доступа к Las Vegas' });

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Формируем массив последних 7 дней
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      days.push({
        date: dateStr,
        label: date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', ''),
        isToday: dateStr === todayStr
      });
    }

    // Параллельно тянем статистику
    const [total, todayCount, history, ...dailyCounts] = await Promise.all([
      kv.get('lasvegas:stats:total') || 0,
      kv.get(`lasvegas:stats:${todayStr}`) || 0,
      kv.lrange(`lasvegas:history:${user.id}`, 0, 49),
      ...days.map(d => kv.get(`lasvegas:stats:${d.date}`) || 0)
    ]);

    // Формируем график
    const chart = days.map((day, i) => ({
      label: day.label,
      date: day.date,
      count: parseInt(dailyCounts[i]) || 0,
      isToday: day.isToday
    }));

    // Максимум для шкалы графика
    const maxCount = Math.max(...chart.map(d => d.count), 1);

    const parsedHistory = history.map(raw => {
      let item = raw;
      try { item = JSON.parse(raw); } catch {}
      return item && typeof item === 'object' ? item : null;
    }).filter(Boolean);

    const enrichedHistory = await Promise.all(parsedHistory.map(async item => {
      const auditNumber = String(item.auditNumber || '');
      if (!/^[1-9][0-9]{0,11}$/.test(auditNumber)) {
        return { ...item, status: item.status === 'accepted' || item.status === 'rejected' ? item.status : 'pending' };
      }
      const audit = await kv.get(`lasvegas:hr-audit:item:${auditNumber}`).catch(() => null);
      if (!audit || String(audit.submitter?.id || '') !== String(user.id)) {
        return { ...item, status: 'pending' };
      }
      return {
        ...item,
        status: ['pending', 'accepted', 'rejected'].includes(audit.status) ? audit.status : 'pending',
        date: audit.submittedAt || item.date
      };
    }));

    res.status(200).json({
      total: Number.parseInt(total, 10) || 0,
      today: Number.parseInt(todayCount, 10) || 0,
      history: enrichedHistory,
      chart,
      maxCount
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
}

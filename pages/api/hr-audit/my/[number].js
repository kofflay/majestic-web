import { verifyToken } from '../../../../lib/discord';
import { kv } from '../../../../lib/redis.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = verifyToken(req.cookies.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const number = String(req.query.number || '');
  if (!/^\\d{1,12}$/.test(number)) return res.status(400).json({ error: 'Некорректный номер отчёта.' });

  try {
    const item = await kv.get('lspd:hr-audit:item:' + number);
    if (!item || String(item.submitter?.id) !== String(user.id)) {
      return res.status(404).json({ error: 'Отчёт не найден.' });
    }
    return res.status(200).json({
      item: {
        id: item.id,
        number: item.number,
        title: 'Отчёт о повышении №' + item.number,
        formType: item.formType || 'promotion_report',
        status: item.status,
        submittedAt: item.submittedAt,
        resolvedAt: item.resolvedAt || null,
        reason: item.reason || null,
        data: item.data || {}
      }
    });
  } catch (error) {
    console.error('Personal HR report detail failed:', error);
    return res.status(503).json({ error: 'Не удалось загрузить отчёт.' });
  }
}

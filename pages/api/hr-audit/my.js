import { verifyToken } from '../../../lib/discord';
import { kv } from '../../../lib/redis.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = verifyToken(req.cookies.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const ids = await kv.lrange('lspd:hr-audit:ids', 0, -1);
    const records = await Promise.all(ids.map(id => kv.get('lspd:hr-audit:item:' + id)));
    const items = records.filter(item => item && String(item.submitter?.id) === String(user.id))
      .map(item => ({
        id: item.id,
        number: item.number,
        formType: item.formType || 'promotion_report',
        title: 'Отчёт о повышении №' + item.number,
        status: item.status,
        submittedAt: item.submittedAt,
        resolvedAt: item.resolvedAt || null,
        reason: item.reason || null
      }));
    return res.status(200).json({ items });
  } catch (error) {
    console.error('Personal HR audit list failed:', error);
    return res.status(503).json({ error: 'Не удалось загрузить статусы отчётов.' });
  }
}

import { verifyToken } from '../../../lib/discord';
import { hasAdminAccess, isSuperAdmin } from '../../../lib/admins';
import { kv } from '../../../lib/redis.js';

const SYSTEM_LOG_KEY = 'lspd:system:events';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  const user = verifyToken(req.cookies?.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!isSuperAdmin(user) || !(await hasAdminAccess(user))) {
    return res.status(403).json({ error: 'Только владелец супер-админки может просматривать системные логи' });
  }

  try {
    const entries = await kv.lrange(SYSTEM_LOG_KEY, 0, 99);
    const logs = (Array.isArray(entries) ? entries : []).map(entry => {
      try { return typeof entry === 'string' ? JSON.parse(entry) : entry; }
      catch { return null; }
    }).filter(Boolean);
    return res.status(200).json({ logs });
  } catch (error) {
    console.error('System log read failed:', error?.message || error);
    return res.status(500).json({ error: 'Не удалось загрузить системные логи' });
  }
}

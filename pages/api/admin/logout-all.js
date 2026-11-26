import { verifySessionToken, createToken, SESSION_VERSION_KEY } from '../../../lib/discord';
import { isSuperAdmin } from '../../../lib/admins';
import { kv } from '../../../lib/redis.js';
import { logAdminAction } from '../../../lib/admin-audit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const user = await verifySessionToken(req.cookies?.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Только супер-администратор может завершить все сессии' });

  try {
    await kv.set(SESSION_VERSION_KEY, '1', { nx: true });
    const nextVersion = await kv.incr(SESSION_VERSION_KEY);
    const token = createToken({ ...user, sessionVersion: nextVersion }, nextVersion);
    const secure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`);
    await logAdminAction(user, {
      action: 'auth.logout_all',
      description: 'Завершил все пользовательские сессии',
      targetId: 'all'
    }).catch(error => console.error('Global logout audit log failed:', error));
    return res.status(200).json({ success: true, sessionVersion: nextVersion });
  } catch (error) {
    console.error('Global session revocation failed:', error);
    return res.status(500).json({ error: 'Не удалось завершить все сессии' });
  }
}

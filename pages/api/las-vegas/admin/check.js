// pages/api/admin/check.js
import { verifyToken } from '../../../../lib/discord';
import { hasLasVegasAdminAccess, getLasVegasAccess } from '../../../../lib/las-vegas-access';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const user = verifyToken(req.cookies.token);
  if (!user) {
    return res.status(200).json({ isAdmin: false, isSuperAdmin: false });
  }

  const roles = (await getLasVegasAccess(user)).roles || [];
  const admin = await hasLasVegasAdminAccess(user);

  return res.status(200).json({
    isAdmin: admin,
    isSuperAdmin: (await getLasVegasAccess(user)).isSuperAdmin && admin,
    userId: user.id,
    roles,
  });
}

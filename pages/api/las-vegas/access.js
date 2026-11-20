import { verifyToken } from '../../../lib/discord';
import { getLasVegasAccess } from '../../../lib/las-vegas-access';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req.cookies.token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const access = await getLasVegasAccess(user);
  return res.status(200).json({
    hasAccess: access.isMember,
    isStaff: access.isStaff,
    isAdmin: access.isAdmin,
    isSuperAdmin: access.isSuperAdmin,
  });
}

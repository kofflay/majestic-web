import { verifySessionToken } from '../../lib/discord';

export default async function handler(req, res) {
  const token = req.cookies.token;
  if (!token) return res.status(200).json({ user: null });
  
  const user = await verifySessionToken(token);
  res.status(200).json({ user: user || null });
}

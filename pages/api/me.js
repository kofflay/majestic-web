import { verifySessionToken } from '../../lib/discord';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const token = req.cookies.token;
  if (!token) return res.status(200).json({ user: null });
  
  const user = await verifySessionToken(token);
  if (!user) {
    res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  }
  res.status(200).json({ user: user || null });
}

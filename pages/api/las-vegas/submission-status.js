import { verifyToken } from '../../../../lib/discord';
import { getSubmissionGate, SUBMISSION_GATE_EXEMPT_ID } from '../../../../lib/submission-gate';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = verifyToken(req.cookies.token);
    const { enabled } = await getSubmissionGate();
    const exempt = String(user?.id || '') === SUBMISSION_GATE_EXEMPT_ID;
    return res.status(200).json({
      enabled,
      exempt,
      canSubmit: enabled || exempt,
    });
  } catch (error) {
    console.error('Submission status lookup failed:', error);
    return res.status(503).json({ error: 'Не удалось проверить доступность приёма заявок' });
  }
}

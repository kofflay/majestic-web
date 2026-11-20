import { verifyToken } from '../../../../lib/discord';
import { getLasVegasAccess } from '../../../../lib/las-vegas-access';
import { kv } from '../../../../lib/redis.js';
import { getLasVegasSubmissionGate, LV_SUBMISSION_GATE_KEY } from '../../../../lib/las-vegas-submission-gate';
import { logAdminAction } from '../../../../lib/las-vegas-admin-audit';

export default async function handler(req, res) {
  const user = verifyToken(req.cookies.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await getLasVegasAccess(user)).isSuperAdmin) {
    return res.status(403).json({ error: 'Нет доступа к управлению приёмом заявок' });
  }

  try {
    if (req.method === 'GET') {
      const gate = await getSubmissionGate();
      return res.status(200).json(gate);
    }

    if (req.method === 'POST') {
      const enabled = req.body?.enabled;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Параметр enabled должен быть true или false' });
      }
      await kv.set(SUBMISSION_GATE_KEY, enabled);
      await logAdminAction(user, {
        action: enabled ? 'submissions.enable' : 'submissions.disable',
        description: enabled ? 'Включил приём новых заявок' : 'Выключил приём новых заявок',
      });
      return res.status(200).json({ success: true, enabled });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Submission gate admin API failed:', error);
    return res.status(503).json({ error: 'Не удалось получить или изменить состояние приёма заявок' });
  }
}

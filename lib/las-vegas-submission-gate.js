import { kv } from './redis.js';

export const LV_SUBMISSION_GATE_KEY = 'lasvegas:submissions:enabled';
export const LV_SUBMISSION_GATE_EXEMPT_ID = '200102286473691139';

export async function getLasVegasSubmissionGate() {
  const stored = await kv.get(LV_SUBMISSION_GATE_KEY);
  const enabled = stored === null || stored === true || stored === 'true';
  return { enabled };
}

export async function canSubmitToLasVegas(userId) {
  const { enabled } = await getLasVegasSubmissionGate();
  return enabled || String(userId || '') === LV_SUBMISSION_GATE_EXEMPT_ID;
}

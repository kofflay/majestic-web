import { kv } from './redis.js';

export const SUBMISSION_GATE_KEY = 'lspd:submissions:enabled';
export const SUBMISSION_GATE_EXEMPT_ID = '200102286473691139';

export async function getSubmissionGate() {
  const stored = await kv.get(SUBMISSION_GATE_KEY);
  // Missing setting keeps current behavior: submissions are enabled.
  // Any unexpected stored value fails closed.
  const enabled = stored === null || stored === true || stored === 'true';
  return { enabled };
}

export async function canSubmitDuringGate(userId) {
  const { enabled } = await getSubmissionGate();
  return enabled || String(userId || '') === SUBMISSION_GATE_EXEMPT_ID;
}

import { kv } from './redis.js';

export async function recordSubmissionHistory(userId, { type, title, status, auditNumber = null, referenceId = null }) {
  if (!userId) return null;
  const entry = {
    type: String(type || 'unknown').slice(0, 40),
    title: String(title || 'Заявка').slice(0, 180),
    date: new Date().toISOString(),
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: status === 'sent' ? 'sent' : status === 'delivery_pending' ? 'delivery_pending' : 'not_sent',
    ...(typeof referenceId === 'string' && /^[a-z0-9-]{8,80}$/i.test(referenceId) ? { referenceId } : {}),
    ...(Number.isSafeInteger(Number(auditNumber)) && Number(auditNumber) > 0 ? { auditNumber: Number(auditNumber) } : {}),
  };
  try {
    const key = 'lasvegas:history:' + userId;
    await kv.lpush(key, JSON.stringify(entry));
    await kv.ltrim(key, 0, 49);
    return entry;
  } catch (error) {
    console.error('Submission history storage error:', error);
    return null;
  }
}
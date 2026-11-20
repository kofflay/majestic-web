import { kv } from './redis.js';

const SYSTEM_LOG_KEY = 'lspd:system:events';
const SYSTEM_LOG_LIMIT = 1000;

function cleanText(value, maxLength = 1500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLength);
}

export async function writeSystemLog({
  level = 'info',
  category = 'system',
  event,
  message,
  auditId,
  auditType,
  decision,
  httpStatus,
  details
} = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    level: ['info', 'warn', 'error'].includes(level) ? level : 'info',
    category: cleanText(category, 40),
    event: cleanText(event, 100),
    message: cleanText(message, 500),
    ...(auditId ? { auditId: cleanText(auditId, 30) } : {}),
    ...(auditType ? { auditType: cleanText(auditType, 30) } : {}),
    ...(decision ? { decision: cleanText(decision, 30) } : {}),
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    ...(details ? { details: cleanText(details, 2000) } : {})
  };

  try {
    await kv.lpush(SYSTEM_LOG_KEY, JSON.stringify(entry));
    await kv.ltrim(SYSTEM_LOG_KEY, 0, SYSTEM_LOG_LIMIT - 1);
    return true;
  } catch (error) {
    console.error('[SystemLogs] Could not persist event:', error?.message || error);
    return false;
  }
}

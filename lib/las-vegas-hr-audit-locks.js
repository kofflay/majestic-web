import { randomUUID } from 'crypto';
import { kv } from './redis.js';

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const LOCK_KINDS = new Set(['delivery', 'notification']);

export async function acquireHrAuditLock(kind, id, ttlSeconds = 90) {
  const normalizedId = String(id ?? '');
  if (!LOCK_KINDS.has(kind)) {
    throw new TypeError('Unsupported HR audit lock kind');
  }
  if (!/^[1-9]\d{0,11}$/.test(normalizedId)) {
    throw new TypeError('Invalid HR audit item id');
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 300) {
    throw new TypeError('Invalid HR audit lock duration');
  }

  const key = `lasvegas:hr-audit:${kind}-lock:${normalizedId}`;
  const token = randomUUID();
  const result = await kv.set(key, token, { nx: true, ex: ttlSeconds });
  if (result !== 'OK') return null;

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await kv.eval(RELEASE_LOCK_SCRIPT, [key], [token]);
      } catch (error) {
        // The finite Redis TTL is the fallback if the explicit release fails.
        console.error('HR audit lock release failed:', error);
      }
    }
  };
}

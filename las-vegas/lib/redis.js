import { createClient } from 'redis';

let redisClient = null;
let connectionPromise = null;

function serializeValue(value) {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  if (value === null || typeof value === 'object') {
    const serialized = JSON.stringify(value);

    if (typeof serialized !== 'string') {
      throw new TypeError('Redis value cannot be serialized');
    }

    return serialized;
  }

  throw new TypeError(`Unsupported Redis value type: ${typeof value}`);
}

// Повторяет автоматическую десериализацию @upstash/redis.
function deserializeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      try {
        return deserializeValue(item);
      } catch {
        return item;
      }
    });
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    const parsed = JSON.parse(value);

    if (
      typeof parsed === 'number' &&
      parsed.toString() !== value
    ) {
      return value;
    }

    return parsed;
  } catch {
    return value;
  }
}

// Поведение HGETALL в @upstash/redis имеет отдельную обработку.
function deserializeHashValue(value) {
  if (typeof value !== 'string') return value;

  try {
    if (
      !Number.isNaN(Number(value)) &&
      !Number.isSafeInteger(value)
    ) {
      return value;
    }

    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error('REDIS_URL is not configured');
  }

  redisClient = createClient({ url });

  redisClient.on('error', (error) => {
    console.error('[Redis] Client error:', error.message);
  });

  return redisClient;
}

async function getConnectedClient() {
  const client = getClient();

  if (!connectionPromise) {
    connectionPromise = client.connect().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  await connectionPromise;

  return client;
}

function normalizeKeys(keys) {
  return keys.flat().map((key) => String(key));
}

export const kv = {
  async get(key) {
    const client = await getConnectedClient();
    const result = await client.get(String(key));

    return deserializeValue(result);
  },

  async mget(keys) {
    const normalized = normalizeKeys(keys || []);
    if (normalized.length === 0) return [];
    const client = await getConnectedClient();
    const results = await client.mGet(normalized);
    return results.map((value) => deserializeValue(value));
  },

  async set(key, value, options = {}) {
    const client = await getConnectedClient();

    const redisOptions = {};

    if (options.ex !== undefined && options.px !== undefined) {
      throw new Error('Specify either EX or PX, not both');
    }

    if (options.ex !== undefined) {
      const seconds = Number(options.ex);

      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error('Invalid EX value');
      }

      redisOptions.expiration = {
        type: 'EX',
        value: seconds,
      };
    }

    if (options.px !== undefined) {
      const milliseconds = Number(options.px);

      if (!Number.isInteger(milliseconds) || milliseconds <= 0) {
        throw new Error('Invalid PX value');
      }

      redisOptions.expiration = {
        type: 'PX',
        value: milliseconds,
      };
    }

    if (options.nx && options.xx) {
      throw new Error('NX and XX cannot be used together');
    }

    if (options.nx) {
      redisOptions.condition = 'NX';
    } else if (options.xx) {
      redisOptions.condition = 'XX';
    }

    if (options.keepTtl) {
      if (redisOptions.expiration) {
        throw new Error('keepTtl cannot be combined with EX or PX');
      }

      redisOptions.expiration = 'KEEPTTL';
    }

    const result = await client.set(
      String(key),
      serializeValue(value),
      redisOptions
    );

    return deserializeValue(result);
  },

  async del(...keys) {
    const client = await getConnectedClient();
    const normalized = normalizeKeys(keys);

    if (normalized.length === 0) return 0;

    return client.del(normalized);
  },

  async incr(key) {
    const client = await getConnectedClient();
    return client.incr(String(key));
  },

  async ttl(key) {
    const client = await getConnectedClient();
    return client.ttl(String(key));
  },

  async hget(key, field) {
    const client = await getConnectedClient();

    const result = await client.hGet(
      String(key),
      String(field)
    );

    return deserializeValue(result);
  },

  async hgetall(key) {
    const client = await getConnectedClient();

    const result = await client.hGetAll(String(key));
    const entries = Object.entries(result);

    if (entries.length === 0) return null;

    return Object.fromEntries(
      entries.map(([field, value]) => [
        field,
        deserializeHashValue(value),
      ])
    );
  },

  async hdel(key, ...fields) {
    const client = await getConnectedClient();

    return client.hDel(
      String(key),
      fields.flat().map(String)
    );
  },

  async lpush(key, ...values) {
    const client = await getConnectedClient();

    const normalized = values.flat().map(serializeValue);

    if (normalized.length === 0) {
      throw new Error('LPUSH requires at least one value');
    }

    return client.lPush(String(key), normalized);
  },

  async lrange(key, start, stop) {
    const client = await getConnectedClient();

    const result = await client.lRange(
      String(key),
      start,
      stop
    );

    return deserializeValue(result);
  },

  async ltrim(key, start, stop) {
    const client = await getConnectedClient();

    return client.lTrim(
      String(key),
      start,
      stop
    );
  },

  async sadd(key, ...members) {
    const client = await getConnectedClient();

    return client.sAdd(
      String(key),
      members.flat().map(serializeValue)
    );
  },

  async srem(key, ...members) {
    const client = await getConnectedClient();

    return client.sRem(
      String(key),
      members.flat().map(serializeValue)
    );
  },

  async smembers(key) {
    const client = await getConnectedClient();

    const result = await client.sMembers(String(key));

    return deserializeValue(result);
  },

  async sismember(key, member) {
    const client = await getConnectedClient();

    const result = await client.sIsMember(
      String(key),
      serializeValue(member)
    );

    // @upstash/redis возвращает числовой результат 0 или 1.
    return result ? 1 : 0;
  },

  async eval(script, keys = [], args = []) {
    const client = await getConnectedClient();

    const result = await client.eval(String(script), {
      keys: keys.map(String),
      arguments: args.map(serializeValue),
    });

    return deserializeValue(result);
  },
};

export async function disconnectRedis() {
  if (redisClient?.isOpen) {
    await redisClient.quit();
  }

  redisClient = null;
  connectionPromise = null;
}

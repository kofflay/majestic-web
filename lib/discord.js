import jwt from 'jsonwebtoken';
import { kv } from './redis.js';

export const SESSION_VERSION_KEY = 'auth:session_version';

export async function getSessionVersion() {
  const value = await kv.get(SESSION_VERSION_KEY);
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

export async function getDiscordToken(code) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;

  try {
    response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        scope: 'identify guilds guilds.members.read'
      })
    });
  } catch (error) {
    const failure = new Error('Discord token exchange request failed');
    failure.oauthStage = 'token_exchange';
    failure.oauthCategory = error?.name === 'AbortError' ? 'timeout' : 'network_error';
    throw failure;
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    const failure = new Error('Discord token endpoint returned an invalid response');
    failure.oauthStage = 'token_exchange';
    failure.oauthCategory = 'invalid_provider_response';
    failure.httpStatus = response.status;
    throw failure;
  }

  if (!response.ok) {
    const failure = new Error('Discord rejected the authorization code');
    failure.oauthStage = 'token_exchange';
    failure.oauthCategory = typeof payload?.error === 'string' ? payload.error.slice(0, 60) : 'provider_error';
    failure.httpStatus = response.status;
    throw failure;
  }

  if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) {
    const failure = new Error('Discord token response did not contain an access token');
    failure.oauthStage = 'token_exchange';
    failure.oauthCategory = 'missing_access_token';
    failure.httpStatus = response.status;
    throw failure;
  }

  return payload;
}

export async function getDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!response.ok) {
    throw new Error('Failed to get user');
  }
  
  return response.json();
}

export function isAccountOldEnough(user, minDays = 90) {
  const discordEpoch = 1420070400000;
  const userId = BigInt(user.id);
  const timestamp = Number(userId >> 22n) + discordEpoch;
  const accountAge = Date.now() - timestamp;
  const accountAgeDays = accountAge / (1000 * 60 * 60 * 24);
  
  return {
    oldEnough: accountAgeDays >= minDays,
    ageDays: Math.floor(accountAgeDays),
    created: new Date(timestamp).toISOString()
  };
}

export function createToken(user, sessionVersion = 1) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      avatar: user.avatar,
      discriminator: user.discriminator || '0',
      roles: user.roles || [],
      guildRoles: user.guildRoles || {},
      sessionVersion
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}


export async function verifySessionToken(token) {
  const user = verifyToken(token);
  if (!user || !Number.isSafeInteger(Number(user.sessionVersion))) return null;
  try {
    const currentVersion = await getSessionVersion();
    return Number(user.sessionVersion) === currentVersion ? user : null;
  } catch (error) {
    console.error('[AUTH] Session version lookup failed:', error?.message || error);
    return null;
  }
}

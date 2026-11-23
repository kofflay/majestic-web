// pages/api/auth.js
import { createHash, timingSafeEqual } from 'crypto';
import { getDiscordToken, getDiscordUser, createToken, isAccountOldEnough } from '../../lib/discord';
import { fetchUserGuildRoles } from '../../lib/security';
import { kv } from '../../lib/redis.js';
import { getDiscordAvatarUrl } from '../../lib/avatar';

const GUILD_ID = '1514608894666735717'; // Las Vegas Discord server
const OAUTH_COOKIE_PATH = '/las-vegas/api/auth';
const APP_PATH = '/las-vegas';
const CALLBACK_LOCK_TTL_SECONDS = 10 * 60;

function safeReturnTo(encodedValue) {
  const fallback = `${APP_PATH}/start`;
  if (
    typeof encodedValue !== 'string' ||
    encodedValue.length > 4096 ||
    !/^[A-Za-z0-9_-]+$/.test(encodedValue)
  ) return fallback;

  const decodedValue = Buffer.from(encodedValue, 'base64url').toString('utf8');
  if (Buffer.from(decodedValue, 'utf8').toString('base64url') !== encodedValue) return fallback;
  if (
    decodedValue.length > 2048 ||
    !decodedValue.startsWith('/') ||
    decodedValue.startsWith('//') ||
    decodedValue.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(decodedValue)
  ) return fallback;

  try {
    const base = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://localhost');
    const target = new URL(decodedValue, base);
    if (target.origin !== base.origin) return fallback;
    const decodedPath = decodeURIComponent(target.pathname);
    if (decodedPath.includes('\\') || /[\u0000-\u001f\u007f]/.test(decodedPath)) return fallback;
    const normalizedPath = '/' + decodedPath.split('/').filter(Boolean).join('/');
    if (normalizedPath === '/dashboard' || normalizedPath === APP_PATH) return fallback;
    const appPath = normalizedPath.startsWith(APP_PATH + '/') ? normalizedPath : `${APP_PATH}${normalizedPath}`;
    return `${appPath}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

function statesMatch(received, expected) {
  if (
    typeof received !== 'string' ||
    typeof expected !== 'string' ||
    !/^[a-f0-9]{64}$/.test(received) ||
    !/^[a-f0-9]{64}$/.test(expected)
  ) {
    return false;
  }

  const receivedBuffer = Buffer.from(received, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer);
}

function clearOAuthCookies(req) {
  const secure = process.env.NODE_ENV === 'production' ||
    req.headers['x-forwarded-proto'] === 'https';
  const secureFlag = secure ? '; Secure' : '';
  const clearCookie = `Path=${OAUTH_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;

  return [
    `oauth_state=; ${clearCookie}`,
    `oauth_return_to=; ${clearCookie}`,
  ];
}

function redirectWithClearedCookies(req, res, destination) {
  res.setHeader('Set-Cookie', clearOAuthCookies(req));
  return res.redirect(destination);
}


function getOAuthCallbackKey(code) {
  // Store only a digest: the one-time authorization code must never appear in KV keys or logs.
  const digest = createHash('sha256').update(code).digest('hex');
  return `oauth:callback:${digest}`;
}

function logOAuthFailure(req, error) {
  const requestId = req.headers['x-vercel-id'] || req.headers['x-request-id'] || null;
  console.error('[AUTH] OAuth callback failed', {
    requestId: typeof requestId === 'string' ? requestId.slice(0, 160) : null,
    stage: error?.oauthStage || 'callback',
    category: error?.oauthCategory || 'unexpected_error',
    httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, state } = req.query;
  const expectedState = req.cookies.oauth_state;

  // OAuth callback is accepted only for a login started in this browser.
  if (!statesMatch(state, expectedState)) {
    return redirectWithClearedCookies(req, res, `${APP_PATH}/?error=oauth_state`);
  }

  const redirectTo = safeReturnTo(req.cookies.oauth_return_to);

  if (error) {
    return redirectWithClearedCookies(req, res, `${APP_PATH}/?error=access_denied`);
  }

  if (typeof code !== 'string' || !code) {
    return redirectWithClearedCookies(req, res, `${APP_PATH}/?error=no_code`);
  }

  const callbackKey = getOAuthCallbackKey(code);
  let callbackLockAcquired = false;

  try {
    // Claim this one-time code atomically before contacting Discord. Parallel callback
    // requests therefore cannot exchange the same code more than once.
    const lockResult = await kv.set(callbackKey, 'processing', {
      ex: CALLBACK_LOCK_TTL_SECONDS,
      nx: true,
    });

    if (lockResult !== 'OK') {
      let existingStatus = await kv.get(callbackKey);

      // A parallel callback may still be finishing. Briefly wait for its final state
      // rather than racing it with a second token exchange.
      for (let attempt = 0; existingStatus === 'processing' && attempt < 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 150));
        existingStatus = await kv.get(callbackKey);
      }

      if (existingStatus === 'completed') {
        return redirectWithClearedCookies(req, res, redirectTo);
      }
      if (existingStatus === 'failed') {
        return redirectWithClearedCookies(req, res, `${APP_PATH}/?error=auth_failed`);
      }
      return redirectWithClearedCookies(req, res, `${APP_PATH}/?error=oauth_in_progress`);
    }

    callbackLockAcquired = true;

    const tokenData = await getDiscordToken(code);
    const user = await getDiscordUser(tokenData.access_token);

    const accountCheck = isAccountOldEnough(user, 5);
    if (!accountCheck.oldEnough) {
      await kv.set(callbackKey, 'failed', { ex: CALLBACK_LOCK_TTL_SECONDS });
      callbackLockAcquired = false;
      return redirectWithClearedCookies(
        req,
        res,
        `${APP_PATH}/?error=new_account&days=${accountCheck.ageDays}&min=5`
      );
    }

    // 1. Получаем список всех серверов пользователя.
    let userGuildIds = null;
    try {
      const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (guildsRes.ok) {
        const guilds = await guildsRes.json();
        if (Array.isArray(guilds)) {
          userGuildIds = guilds.map(g => g.id);
          console.log(`[АВТОРИЗАЦИЯ] Получено ${userGuildIds.length} серверов.`);
        }
      } else {
        console.error('[АВТОРИЗАЦИЯ] Ошибка получения серверов:', guildsRes.status);
      }
    } catch (e) {
      console.error('[АВТОРИЗАЦИЯ] Ошибка получения серверов:', {
        category: 'guild_list_request_failed',
        name: e?.name || 'Error',
      });
    }

    await kv.set(`oauth:token:${user.id}`, tokenData.access_token, { ex: 7 * 24 * 3600 });
    if (Array.isArray(userGuildIds)) {
      await kv.set(`user:guilds:${user.id}`, userGuildIds, { ex: 7 * 24 * 3600 });
    }

    // Build a fresh role snapshot for this guild only. Never merge cached role
    // snapshots from the previous server: stale role IDs must not grant access.
    const roleSnapshot = Array.isArray(userGuildIds)
      ? await fetchUserGuildRoles(tokenData.access_token, userGuildIds)
      : { guildRoles: { [GUILD_ID]: [] }, failedGuilds: [] };
    const guildRoles = { [GUILD_ID]: Array.isArray(roleSnapshot.guildRoles[GUILD_ID])
      ? roleSnapshot.guildRoles[GUILD_ID]
      : [] };
    const userRoles = guildRoles[GUILD_ID];

    if (roleSnapshot.rateLimited && roleSnapshot.retryAfterSeconds > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil(roleSnapshot.retryAfterSeconds));
      await kv.set(`discord:role_cooldown:${user.id}`, Date.now() + retryAfterSeconds * 1000, {
        ex: retryAfterSeconds,
      }).catch(() => {});
    }

    if (roleSnapshot.failedGuilds.length > 0) {
      console.warn('[АВТОРИЗАЦИЯ] Не удалось получить роли на части серверов:', {
        failedCount: roleSnapshot.failedGuilds.length,
        rateLimited: roleSnapshot.rateLimited === true,
      });
    }

    await kv.set(`user:guild_roles:${user.id}`, guildRoles, { ex: 7 * 24 * 3600 });
    await kv.set(`user:roles:${user.id}`, userRoles, { ex: 7 * 24 * 3600 });
    await kv.set(`user:info:${user.id}`, { username: user.username, avatar: user.avatar }, { ex: 7 * 24 * 3600 });

    // Discord-фото фиксируется при первом входе и не перезаписывает выбор пользователя.
    try {
      const avatarKey = `lspd:profile-avatar:${user.id}`;
      const savedAvatar = await kv.get(avatarKey);
      if (!savedAvatar) {
        await kv.set(avatarKey, { source: 'discord', url: getDiscordAvatarUrl(user), updatedAt: Date.now() }, { nx: true });
      }
    } catch (avatarError) {
      console.error('[АВТОРИЗАЦИЯ] Не удалось сохранить первоначальный аватар Discord:', {
        category: 'avatar_storage_failed',
        name: avatarError?.name || 'Error',
      });
    }

    // 5. Создаем сессию, фиксируем успешную обработку и очищаем временные OAuth cookies.
    const jwtToken = createToken({ ...user, roles: userRoles, guildRoles });
    await kv.set(callbackKey, 'completed', { ex: CALLBACK_LOCK_TTL_SECONDS });
    callbackLockAcquired = false;
    const secure = process.env.NODE_ENV === 'production' ||
      req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
      ...clearOAuthCookies(req),
      `token=${jwtToken}; Path=${APP_PATH}; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`,
    ]);
    return res.redirect(redirectTo);

  } catch (authError) {
    if (callbackLockAcquired) {
      try {
        // The authorization code is one-use. Keep the failed marker briefly so a
        // refresh or parallel callback cannot submit the same code again.
        await kv.set(callbackKey, 'failed', { ex: CALLBACK_LOCK_TTL_SECONDS });
      } catch {
        // The original error is more useful than a secondary KV marker failure.
      }
    }

    logOAuthFailure(req, authError);
    return redirectWithClearedCookies(req, res, `${APP_PATH}/?error=auth_failed`);
  }
}

// Discord guild and role snapshot configuration for the Las Vegas instance.
export const CRIM_GUILDS = [];

export const LSPD_GUILD_ID = '1514608894666735717';

export function getRoleGuildIds() {
  return [LSPD_GUILD_ID];
}

export async function fetchUserGuildRoles(accessToken, userGuildIds) {
  const userGuildSet = new Set(Array.isArray(userGuildIds) ? userGuildIds : []);
  const guildRoles = {};
  const failedGuilds = [];

  if (!userGuildSet.has(LSPD_GUILD_ID)) {
    guildRoles[LSPD_GUILD_ID] = [];
    return { guildRoles, failedGuilds, rateLimited: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://discord.com/api/users/@me/guilds/${LSPD_GUILD_ID}/member`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal }
    );
    if (response.status === 404) {
      guildRoles[LSPD_GUILD_ID] = [];
    } else if (response.status === 429) {
      const payload = await response.json().catch(() => ({}));
      const retryAfter = Number(response.headers.get('retry-after')) || Number(payload.retry_after) || 5;
      failedGuilds.push({ guildId: LSPD_GUILD_ID, status: 429 });
      return { guildRoles, failedGuilds, rateLimited: true, retryAfterSeconds: retryAfter };
    } else if (!response.ok) {
      failedGuilds.push({ guildId: LSPD_GUILD_ID, status: response.status });
    } else {
      const member = await response.json();
      guildRoles[LSPD_GUILD_ID] = Array.isArray(member.roles) ? member.roles : [];
    }
  } catch (error) {
    failedGuilds.push({
      guildId: LSPD_GUILD_ID,
      reason: error?.name === 'AbortError' ? 'timeout' : 'network_error',
    });
  } finally {
    clearTimeout(timeout);
  }

  return { guildRoles, failedGuilds, rateLimited: false };
}

export async function checkCriminalActivity() {
  return {
    alerts: [],
    complete: true,
    checkedGuilds: 0,
    totalGuilds: 0,
    failedGuilds: [],
    guildRoles: {},
    retryAfterSeconds: 0,
  };
}

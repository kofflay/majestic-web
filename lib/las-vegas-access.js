import { kv } from './redis.js';

export const LV_GUILD_ID = '1182356767234068481';
export const LV_STAFF_ROLE_ID = '1397291237567889582';
export const LV_ADMIN_ROLE_IDS = [
  '1182356767343120481',
  '1182356767343120480',
];
export const LV_SUPER_ADMIN_ID = '200102286473691139';

export async function getLasVegasAccess(user) {
  const userId = String(user?.id || '');
  if (!userId) {
    return { isMember: false, isStaff: false, isAdmin: false, isSuperAdmin: false };
  }

  let guildRoles = null;
  try {
    guildRoles = await kv.get(`user:guild_roles:${userId}`);
  } catch (error) {
    console.error('Las Vegas role lookup failed:', error);
    return { isMember: false, isStaff: false, isAdmin: false, isSuperAdmin: false };
  }

  const roles = Array.isArray(guildRoles?.[LV_GUILD_ID])
    ? guildRoles[LV_GUILD_ID].map(String)
    : [];
  const isSuperAdmin = userId === LV_SUPER_ADMIN_ID;
  const isAdmin = isSuperAdmin || LV_ADMIN_ROLE_IDS.some(roleId => roles.includes(roleId));
  const isStaff = isAdmin || roles.includes(LV_STAFF_ROLE_ID);

  return { isMember: isStaff, isStaff, isAdmin, isSuperAdmin, roles };
}

export async function hasLasVegasAccess(user) {
  const access = await getLasVegasAccess(user);
  return access.isMember;
}

export async function hasLasVegasAdminAccess(user) {
  const access = await getLasVegasAccess(user);
  return access.isAdmin;
}

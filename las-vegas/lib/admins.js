import { kv } from './redis.js';

export const ADMINS = [];
// No legacy-server admin roles: configure current Las Vegas admin role IDs here when confirmed.
export const ADMIN_ROLE_IDS = [];
export const SUPER_ADMIN_ID = '200102286473691139';
const DENIED_ADMINS_KEY = 'lspd:admin_denied_ids';

export function isAdmin(userId) {
  return ADMINS.includes(String(userId || ''));
}

export function isSuperAdmin(userOrId) {
  const userId = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  return String(userId || '') === SUPER_ADMIN_ID;
}

export async function hasAdminAccess(user) {
  const userId = String(user?.id || '');
  if (!userId) return false;

  if (isSuperAdmin(userId)) return true;

  try {
    const denied = await kv.sismember(DENIED_ADMINS_KEY, userId);
    if (denied) return false;
  } catch (error) {
    console.error('Admin deny-list lookup failed:', error);
    return false;
  }

  if (isAdmin(userId)) return true;
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  if (roles.some(roleId => ADMIN_ROLE_IDS.includes(roleId))) return true;

  try {
    const manualAdmins = await kv.get('lspd:manual_admins');
    return Array.isArray(manualAdmins) && manualAdmins.includes(userId);
  } catch (error) {
    console.error('Admin access lookup failed:', error);
    return false;
  }
}

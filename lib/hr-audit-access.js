import { SUPER_ADMIN_ID } from './admins';

export const HR_AUDIT_ROLE_IDS = [
  "1541095679160615012",
  "1514608894679191597"
];

export function hasHrAuditAccess(user) {
  if (!user?.id) return false;
  if (String(user.id) === SUPER_ADMIN_ID) return true;
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  return HR_AUDIT_ROLE_IDS.some(roleId => roles.includes(roleId));
}

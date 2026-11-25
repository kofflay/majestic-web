const SUPER_ADMIN_ID = '200102286473691139';

export const HR_AUDIT_ROLE_IDS = ['1563222369655459941'];

export function hasHrAuditAccess(user) {
  if (!user?.id) return false;
  if (String(user.id) === SUPER_ADMIN_ID) return true;
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  return HR_AUDIT_ROLE_IDS.some(roleId => roles.includes(roleId));
}

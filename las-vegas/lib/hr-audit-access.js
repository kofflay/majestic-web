const SUPER_ADMIN_ID = '200102286473691139';

export const HR_AUDIT_ROLE_IDS = [];

export function hasHrAuditAccess(user) {
  return Boolean(user?.id && String(user.id) === SUPER_ADMIN_ID);
}

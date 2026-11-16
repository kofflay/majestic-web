import { SUPER_ADMIN_ID } from './admins';

// Future HR staff role can be added here without changing route handlers.
export function canReviewHrAudit(user) {
  return Boolean(user?.id && String(user.id) === String(SUPER_ADMIN_ID));
}

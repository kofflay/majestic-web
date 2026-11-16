// Configuration reserved for the future approved-document delivery flow.
// Keep this webhook separate from the department report/decision notification webhooks.
export const HR_AUDIT_DOCUMENT_CHANNEL_ID = '1514608895597740128';

export function getHrAuditDocumentWebhook() {
  return process.env.WEBHOOK_HR_AUDIT || null;
}

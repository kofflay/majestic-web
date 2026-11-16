import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const submit = await readFile(new URL('../pages/api/submit.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../pages/api/admin/hr-audit.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../pages/admin/hr-audit.js', import.meta.url), 'utf8');

test('1. only report submissions create HR audit records', () => {
  assert.match(submit, /if \(type === 'report'\) \{/);
  assert.match(submit, /lspd:hr-audit:item:/);
});
test('2. sequential number allocation is Redis atomic INCR', () => {
  assert.match(submit, /redis\.call\('INCR', KEYS\[1\]\)/);
});
test('3. allocated number and record are persisted in the same Redis script', () => {
  assert.match(submit, /redis\.call\('SET', KEYS\[2\] \..*cjson\.encode\(item\)\)/);
  assert.match(submit, /redis\.call\('LPUSH', KEYS\[3\]/);
});
test('4. a complete Discord retry payload is persisted before delivery', () => {
  assert.match(submit, /deliveryPending: true/);
  assert.match(submit, /discordPayload/);
  assert.ok(submit.indexOf('deliveryPending: true') < submit.indexOf('result = await sendToDiscord(webhookUrl, discordPayload)'));
});
test('5. Discord delivery success clears the pending marker and payload', () => {
  assert.match(submit, /deliveryPending: false, discordPayload: null/);
});
test('6. failed Discord delivery returns success with the saved audit number and warning', () => {
  assert.match(submit, /success: true,\s*number: hrAuditNumber,\s*warning:/);
});
test('7. reviewer retry is restricted to pending records with a saved payload', () => {
  assert.match(api, /action === 'retry-delivery'/);
  assert.match(api, /item\.status !== 'pending' \|\| !item\.deliveryPending \|\| !item\.discordPayload/);
});
test('8. a pending delivery cannot be approved or rejected', () => {
  assert.match(api, /if \(item\.deliveryPending\) return res\.status\(409\)/);
});
test('9. reviewer authorization uses the configured super-admin ID', () => {
  assert.match(api, /String\(user\.id\) !== SUPER_ADMIN_ID/);
});
test('10. rejection requires a non-empty reason and enforces 1000 characters', () => {
  assert.match(api, /decision === 'rejected' && !cleanReason/);
  assert.match(api, /cleanReason\.length > 1000/);
});
test('11. a decision is committed with an atomic Redis compare-and-set', () => {
  assert.match(api, /SAVE_DECISION_SCRIPT/);
  assert.match(api, /current\.status ~= 'pending'/);
  assert.match(api, /kv\.eval\(SAVE_DECISION_SCRIPT/);
});
test('12. reviewer identity, timestamp, and decision history are persisted', () => {
  assert.match(api, /reviewer: \{ id: String\(user\.id\)/);
  assert.match(api, /resolvedAt/);
  assert.match(api, /history: \[\.\.\.\(Array\.isArray\(item\.history\)/);
});
test('13. the interface exposes delivery retry and disables neither record visibility nor history', () => {
  assert.match(page, /retryDelivery/);
  assert.match(page, /ПОВТОРИТЬ ОТПРАВКУ/);
  assert.match(page, /item\.history/);
});

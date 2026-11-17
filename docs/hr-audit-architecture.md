# HR audit — architecture sketch

## Scope

The register is created for `/api/submit` requests with `type === 'report'` (department promotion report) and `type === 'highrank'` (senior-staff promotion report). The separate “Запрос на повышение” form sends `type === 'promotion'` and must never create an HR audit record.

## Creation and numbering

1. The department report form creates a request ID and keeps it in `sessionStorage` until the server confirms the request. The high-rank form remains unchanged; the server calculates a short-lived fingerprint from the authenticated user and submitted fields.
2. The API scopes its idempotency key to the authenticated Discord user. Department reports use the stable client request ID; the existing high-rank form is left unchanged, so high-rank reports use a payload fingerprint with a 10-minute duplicate window.
3. One Redis Lua script checks the idempotency key, increments the global sequence, writes the full audit item, pushes its number into the register index, and stores the idempotency key for 30 days for department reports and 10 minutes for high-rank reports.
4. A repeat request with the same ID returns the existing record number. It does not allocate a second number or send a second Discord message.
5. The stored record includes the submitted fields, submitter identity, timestamp, initial history, status, and a Discord retry payload.

Redis keys:

- `lspd:hr-audit:sequence` — global monotonically increasing number.
- `lspd:hr-audit:item:<number>` — complete record.
- `lspd:hr-audit:ids` — newest-first record index.
- `lspd:hr-audit:request:<discord-user-id>:<request-id>` — request idempotency key.

## Delivery and decisions

- Department report delivery and decision notifications use the existing report webhook for the selected department.
- High-rank report delivery and decision notifications use `WEBHOOK_HIGH_RANK_REPORT`.
- If initial delivery fails, the record remains `pending` with `deliveryPending: true` and retains the exact payload for a reviewer retry.
- A decision is blocked until initial delivery is confirmed.
- A decision is written with Redis compare-and-set: only a record whose current status is `pending` can transition to `accepted` or `rejected`.
- Rejection requires a trimmed reason of 1–1000 characters.
- A decision notification failure does not revert the decision. It sets `notificationPending: true` and exposes a separate retry action.
- Retry locks use unique ownership tokens; a request can release only the lock it acquired.
- Each submission, delivery, decision, and notification attempt is added to the record history.

## Authorization

- The page uses server-side JWT verification and returns not-found to any authenticated user other than Discord ID `200102286473691139`.
- The API independently verifies the session JWT and checks the same reviewer ID for every read and write.
- The JWT is issued by the existing Discord OAuth login flow; client-side navigation visibility is not treated as authorization.

## Future approved document

The document flow is intentionally not implemented until its template and content are agreed.

- Dedicated environment variable: `WEBHOOK_HR_AUDIT`.
- Destination channel: `1514608895597740128`.
- The dedicated configuration helper is `lib/hr-audit-config.js`.
- The document sender must use only this dedicated webhook. It must never fall back to the department webhook.
- Missing `WEBHOOK_HR_AUDIT` must not block saving or approving an audit record.

## Known design boundary

Discord webhook delivery and Redis persistence cannot be made one distributed atomic transaction. If Discord accepts a message but the subsequent Redis status update fails, the record may still look pending. The interface warns the reviewer to inspect the corresponding Discord channel before retrying. This edge case must be exercised deliberately during the live-project verification after the agreed transfer to `main`.

# Las Vegas deployment settings

Las Vegas uses an isolated Redis namespace (`lasvegas:*`) and separate Discord webhook environment variables. Do not point these variables at Memphis webhooks or reuse Memphis channel/thread IDs.

## Discord

- `LV_DISCORD_GUILD_ID=1182356767234068481`
- Staff role: `1397291237567889582`
- Admin roles: `1182356767343120481`, `1182356767343120480`
- Super-admin Discord user ID is inherited from the Memphis owner account: `200102286473691139`

The existing OAuth app and callback are shared. The current OAuth scope includes `guilds.members.read`; the role snapshot process now includes the Las Vegas guild and stores its roles in `user:guild_roles:<discord-user-id>`. The user must be a member of the Las Vegas guild.

## Required webhook variables

Set the matching Las Vegas Discord webhook URLs in the deployment environment:

- `LV_WEBHOOK_PROMOTION`
- `LV_WEBHOOK_HIGH_RANK_REPORT`
- `LV_WEBHOOK_RESIGNATION`
- `LV_WEBHOOK_REINSTATEMENT`
- `LV_WEBHOOK_TRANSFER_TO_LSPD`
- `LV_WEBHOOK_HIRING`
- `LV_WEBHOOK_WEAPON_REQUEST`
- `LV_WEBHOOK_LEAVE`
- `LV_WEBHOOK_PREMIUM`
- `LV_WEBHOOK_COMPLAINT_PUBLIC`
- `LV_WEBHOOK_COMPLAINT_PRIVATE`
- `LV_WEBHOOK_RECOVERY`

Department forms additionally read `LV_WEBHOOK_REPORT_<DEPARTMENT_ID>` and `LV_WEBHOOK_TRANSFER_<DEPARTMENT_ID>` (uppercase department ID).

## Optional role pings and channels

- `LV_HIGH_RANK_ROLE_ID` — required to submit the high-rank report form.
- `LV_ROLE_PING` — ping used by recovery/appeal submissions.
- `LV_ROLE_PING_ADMIN`, `LV_ROLE_PING_HIGH_RANK`, `LV_ROLE_PING_STAFF`, `LV_ROLE_PING_HIRING`, `LV_ROLE_PING_COMPLAINT` — optional pings for general forms.
- `LV_DEPARTMENT_ROLE_<DEPARTMENT_ID>` — optional department ping.
- `LV_LEAVE_THREAD_OOC`, `LV_LEAVE_THREAD_IC` — optional Discord forum thread IDs for leave forms.

Do not add webhook URLs or bot tokens to Git. Configure them in the hosting provider's environment settings.

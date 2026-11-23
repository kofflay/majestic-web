# Las Vegas test environment

Las Vegas is the isolated test instance of Majestic Web.

Public route: https://suspect-famq.ru/las-vegas/start

## Source and workflow

- Experimental features are developed on branch `test/las-vegas`.
- Application source remains under `las-vegas/`.
- Next.js `basePath` is `/las-vegas`; do not remove it or manually prefix Next.js-managed links twice.
- The active GitHub Actions workflow is `.github/workflows/deploy-las-vegas.yml` at the repository root. Workflows nested inside this app folder are not active GitHub Actions workflows.
- Pushes to `test/las-vegas` and pull requests to `main` run Las Vegas tests and a standalone build.
- The main production workflow ignores changes limited to `las-vegas/**`, so test-only changes do not deploy Memphis.

## Required isolated runtime configuration

Create the Las Vegas environment file on the VPS outside the repository and outside the Memphis service, for example `/etc/majestic-las-vegas/las-vegas.env`.

Configure these values independently from production:

- `NEXT_PUBLIC_SITE_URL=https://suspect-famq.ru` (origin only; no path suffix).
- `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` from a dedicated Las Vegas OAuth application.
- `DISCORD_REDIRECT_URI=https://suspect-famq.ru/las-vegas/api/auth`, registered exactly in that Discord application.
- A unique high-entropy `JWT_SECRET`.
- `REDIS_URL` pointing to a dedicated Redis instance/database not used by Memphis.
- All `WEBHOOK_*` values pointing only to Las Vegas test channels.

Never copy the Memphis environment file or reuse its Redis endpoint, JWT secret, OAuth credentials, or webhook URLs.

## VPS isolation requirements before enabling deployment

The deployment job is deliberately gated. It will not deploy unless the repository Actions variable `LAS_VEGAS_DEPLOY_READY` is exactly `true` and a manual workflow dispatch has `deploy=true`.

Before setting that variable, provision and verify:

1. A dedicated unprivileged service account and systemd service for Las Vegas, not the Memphis service.
2. Dedicated application port (for example `127.0.0.1:3100`) and release/state directories under `/var/lib/las-vegas-deploy/`.
3. A root-owned, narrowly scoped helper at `/usr/local/sbin/las-vegas-deploy` that only manages the Las Vegas service and directories. It must never stop, restart, enable, disable, or edit Memphis services, paths, ports, or Nginx upstreams.
4. An Nginx `location ^~ /las-vegas/` inside the existing HTTPS virtual host that proxies to the dedicated Las Vegas port while preserving the `/las-vegas` URI prefix.
5. A dedicated environment file readable only by the Las Vegas service account and root.
6. Separate GitHub Actions secrets: `LAS_VEGAS_DEPLOY_HOST`, `LAS_VEGAS_DEPLOY_USER`, `LAS_VEGAS_DEPLOY_SSH_KEY`, and `LAS_VEGAS_DEPLOY_KNOWN_HOSTS`.

Only after the public `/las-vegas/start` route is confirmed to reach the isolated service should `LAS_VEGAS_DEPLOY_READY=true` be added to repository Actions variables.

## Safety

The copied deployment scripts previously stored in this directory were Memphis scripts: they managed `memphis-lspd.service`, `/var/lib/memphis-deploy`, and the Memphis Nginx upstream. They must not be used for Las Vegas. The canonical Memphis deployment scripts remain in the repository root `scripts/` directory.

# Las Vegas test environment

Las Vegas is the isolated test instance of Majestic Web.

Public route: https://suspect-famq.ru/las-vegas/start

## Source and workflow

- Experimental features are developed on branch test/las-vegas.
- Application source remains under las-vegas/.
- Next.js basePath is /las-vegas; do not remove it or manually prefix Next.js-managed links twice.
- The active GitHub Actions workflow is .github/workflows/deploy-las-vegas.yml at the repository root. Workflows nested inside this app folder are not active GitHub Actions workflows.
- Pushes to test/las-vegas and pull requests to main run Las Vegas tests and a standalone build.
- The main production workflow ignores changes limited to las-vegas/**, so test-only changes do not deploy Memphis.
- The VPS installation runbook is las-vegas/ops/VPS_SETUP.md.

## Isolated runtime

Use /etc/majestic-las-vegas/las-vegas.env on the VPS. Set NEXT_PUBLIC_SITE_URL=https://suspect-famq.ru (origin only), a dedicated Discord OAuth application with callback https://suspect-famq.ru/las-vegas/api/auth, a unique JWT_SECRET, a Redis endpoint/database not shared with Memphis keys, and Las Vegas-only WEBHOOK_* values.

Never copy the Memphis environment file or reuse its Redis endpoint, JWT secret, OAuth credentials, or webhook URLs.

## VPS deployment boundary

- systemd: majestic-las-vegas.service, user/group lasvegas:lasvegas, Node.js 24, bind 127.0.0.1:3100.
- Releases: /var/lib/las-vegas-deploy/; helper: /usr/local/sbin/las-vegas-deploy.
- Nginx: include las-vegas/ops/las-vegas-nginx-location.conf inside the existing HTTPS virtual host before the generic Memphis location /. The snippet preserves the /las-vegas URI prefix.
- GitHub Actions deploy remains gated by LAS_VEGAS_DEPLOY_READY=true and a manual workflow_dispatch with deploy=true.
- Enable the readiness variable after all isolated VPS prerequisites pass. The first workflow deployment then validates the public route and automatically requests a Las Vegas-only rollback on health-check failure.
- Separate GitHub Actions secrets are required: LAS_VEGAS_DEPLOY_HOST, LAS_VEGAS_DEPLOY_USER, LAS_VEGAS_DEPLOY_SSH_KEY, and LAS_VEGAS_DEPLOY_KNOWN_HOSTS.

The helper is intentionally scoped to Las Vegas. It never manages memphis-lspd.service, /var/lib/memphis-deploy, or the Memphis Nginx upstream.

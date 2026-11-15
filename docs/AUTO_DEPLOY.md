# Automatic production deployment

## Trigger and safety gates

A push to `main` runs the deployment workflow. It installs dependencies, runs the Node test suite, builds the Next.js standalone release, and only then connects to the VPS over SSH.

Pull requests to `main` run validation and build checks only; they never deploy. Older queued commits are skipped when `main` has already advanced. Deployments are serialized.

The workflow uploads a commit-specific archive to `/var/lib/memphis-deploy/incoming`, runs the restricted root helper, then checks both `http://127.0.0.1:3000/start` on the VPS and the public `https://suspect-famq.ru/start` URL. A failed health check requests rollback to the previous release.

## One-time VPS provisioning

The existing SSH account can upload files to `/var/lib/memphis-deploy/incoming`, but it does not have passwordless sudo. The installer therefore needs to be run once by an administrator from a trusted, root-owned copy of these two repository files:

- `scripts/memphis-deploy`
- `scripts/install-memphis-deploy.sh`

Copy both files into a trusted directory on the VPS (for example, `/root/memphis-deploy-setup/`). Do not run the installer from the deploy user's writable `incoming` directory.

From a root shell, run:

```bash
bash /root/memphis-deploy-setup/install-memphis-deploy.sh /root/memphis-deploy-setup/memphis-deploy
```

The installer verifies the existing `memphis-lspd.service`, the `memphis` service account, the external environment file, the current local health check, and the upload account. It installs a root-owned helper and grants the upload account passwordless sudo for that helper only. It does not restart or modify the live application.

## First automatic deployment

On the first successful push to `main`, the helper creates a versioned release under `/var/lib/memphis-deploy/releases/<commit-sha>` and an atomic `current` symlink. It adds a systemd drop-in that starts Next.js through the standalone `server.js` entry point on `127.0.0.1:3000`, while retaining the existing `/etc/memphis-lspd/memphis.env` environment file.

The original `/opt/memphis-lspd` directory is left in place and is used as the first rollback target. Subsequent rollback targets are previous versioned releases. The helper keeps the five most recent releases and always retains the immediately previous release.

The application stores profile and avatar data in Redis; these are not stored in the release directories.

## Manual rollback

After provisioning, an administrator can request rollback to the last recorded working release with:

```bash
sudo /usr/local/sbin/memphis-deploy --rollback
```

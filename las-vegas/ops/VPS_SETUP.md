# Provision the isolated Las Vegas VPS runtime

This runbook matches the GitHub Actions workflow in the repository root. It does not modify the Memphis service or its Nginx upstream.

## Fixed Las Vegas runtime boundaries

| Component | Las Vegas value |
|---|---|
| systemd unit | majestic-las-vegas.service |
| service user/group | lasvegas:lasvegas |
| Node.js | major version 24 |
| listen address | 127.0.0.1:3100 |
| environment | /etc/majestic-las-vegas/las-vegas.env |
| release storage | /var/lib/las-vegas-deploy/releases/ |
| active release | /var/lib/las-vegas-deploy/current |
| incoming archive | /var/lib/las-vegas-deploy/incoming/ |
| root helper | /usr/local/sbin/las-vegas-deploy |
| public route | https://suspect-famq.ru/las-vegas/ |

Do not point any of these paths, ports, users, units, Redis credentials, OAuth credentials, or webhooks at Memphis.

## 1. Verify prerequisites

- The VPS has /usr/bin/node at major version 24.
- The HTTPS virtual host for suspect-famq.ru remains the existing Memphis virtual host.
- Redis is separately provisioned for Las Vegas (a separate instance is preferred; a separately ACL-restricted database is acceptable only if it cannot read or write Memphis keys).
- A dedicated Discord OAuth application exists. Register https://suspect-famq.ru/las-vegas/api/auth as its exact redirect URI.
- The Las Vegas webhook variables point only to test channels.

## 2. Create separate service and deployment identities

Run once as an administrator. If these names already exist, inspect them rather than recreating them.

    sudo groupadd --system lasvegas
    sudo useradd --system --gid lasvegas --home-dir /var/lib/majestic-las-vegas \
      --no-create-home --shell /usr/sbin/nologin lasvegas

    sudo groupadd --system las-vegas-deploy
    sudo useradd --create-home --shell /bin/bash lvdeploy
    sudo usermod -aG las-vegas-deploy lvdeploy

The Next.js service runs as lasvegas; GitHub Actions connects as lvdeploy. They must remain separate accounts.

## 3. Create isolated directories and environment

    sudo install -d -o root -g lasvegas -m 0751 /var/lib/las-vegas-deploy
    sudo install -d -o root -g lasvegas -m 0750 /var/lib/las-vegas-deploy/releases
    sudo install -d -o lvdeploy -g las-vegas-deploy -m 2770 /var/lib/las-vegas-deploy/incoming

    sudo install -d -o root -g lasvegas -m 0750 /etc/majestic-las-vegas
    sudo install -o root -g lasvegas -m 0640 /dev/null /etc/majestic-las-vegas/las-vegas.env
    sudoedit /etc/majestic-las-vegas/las-vegas.env

Populate the environment file with the values from las-vegas/.env.example. Use a unique JWT_SECRET, dedicated Discord OAuth credentials, the dedicated Redis endpoint, and Las Vegas-only webhook URLs. Keep NEXT_PUBLIC_SITE_URL=https://suspect-famq.ru (origin only, no path suffix). Never copy the Memphis environment file.

    sudo chown root:lasvegas /etc/majestic-las-vegas/las-vegas.env
    sudo chmod 0640 /etc/majestic-las-vegas/las-vegas.env
    sudo stat -c '%U:%G %a %n' /etc/majestic-las-vegas/las-vegas.env

Expected owner/mode: root:lasvegas 640.

## 4. Install the Las Vegas service and deployment helper

From a checkout of this repository at the reviewed branch/commit:

    sudo install -o root -g root -m 0755 las-vegas/scripts/las-vegas-deploy \
      /usr/local/sbin/las-vegas-deploy
    sudo install -o root -g root -m 0644 las-vegas/ops/majestic-las-vegas.service \
      /etc/systemd/system/majestic-las-vegas.service
    sudo systemctl daemon-reload
    sudo systemctl enable majestic-las-vegas.service

Do not start the service yet; the first release is activated by the gated workflow.

## 5. Configure the Nginx path route

Install the location snippet:

    sudo install -D -o root -g root -m 0644 \
      las-vegas/ops/las-vegas-nginx-location.conf \
      /etc/nginx/snippets/las-vegas-location.conf

In the existing HTTPS server block for suspect-famq.ru (currently /etc/nginx/sites-enabled/memphis-lspd in the supplied configuration), add this include before the existing generic location / Memphis proxy:

    include /etc/nginx/snippets/las-vegas-location.conf;

Do not replace or edit location /, the Memphis upstream, the Memphis port 3000, TLS certificate directives, or the HTTP-to-HTTPS redirect. The snippet uses proxy_pass http://127.0.0.1:3100; without a URI suffix so the /las-vegas prefix is preserved for Next.js basePath.

    sudo nginx -t
    sudo systemctl reload nginx

## 6. Give GitHub Actions a restricted SSH account

Install the public key of a dedicated GitHub Actions SSH key pair into /home/lvdeploy/.ssh/authorized_keys. Keep the private key only in GitHub Actions secrets. Ensure the SSH user can write only to the incoming directory through group membership.

    sudo install -d -o lvdeploy -g lvdeploy -m 0700 /home/lvdeploy/.ssh
    sudo install -o lvdeploy -g lvdeploy -m 0600 /dev/null /home/lvdeploy/.ssh/authorized_keys
    sudo usermod -aG las-vegas-deploy lvdeploy
    sudo visudo -f /etc/sudoers.d/las-vegas-deploy

The sudoers file must contain only this command allowance:

    lvdeploy ALL=(root) NOPASSWD: /usr/local/sbin/las-vegas-deploy *

Then run:

    sudo chmod 0440 /etc/sudoers.d/las-vegas-deploy
    sudo visudo -cf /etc/sudoers

The helper is root-owned and accepts only --check, --rollback, --commit followed by a 40-character SHA, or a 40-character Git commit SHA. It is deliberately scoped to the Las Vegas service and paths.

## 7. Configure GitHub repository secrets

In repository Settings → Secrets and variables → Actions, add:

- LAS_VEGAS_DEPLOY_HOST: VPS hostname or IP.
- LAS_VEGAS_DEPLOY_USER: lvdeploy.
- LAS_VEGAS_DEPLOY_SSH_KEY: base64-encoded private SSH key (the workflow decodes it).
- LAS_VEGAS_DEPLOY_KNOWN_HOSTS: pinned known-hosts line(s). Verify the SSH host fingerprint through a trusted channel before saving; do not blindly trust an unverified ssh-keyscan result.

The SSH user must be able to SCP to /var/lib/las-vegas-deploy/incoming/ and run the sudo-allowed helper commands.

## 8. Verify readiness, then enable the first deployment

Run:

    sudo /usr/local/sbin/las-vegas-deploy --check
    sudo systemctl cat majestic-las-vegas.service
    sudo nginx -t

The helper checks the separate app account, Node.js, environment permissions, release/incoming directories, service unit, and Nginx snippet. Confirm the Nginx include is inside the HTTPS server block and the service points only to port 3100.

Once all these host prerequisites pass, set repository Actions variable LAS_VEGAS_DEPLOY_READY=true. This gate must be enabled before the first release can be deployed; the workflow itself performs the first public health check after activating that release.

Then open Actions → Build and deploy Las Vegas, select the main branch, choose workflow_dispatch, and set deploy=true. The workflow builds the app, uploads the artifact, activates only the Las Vegas systemd service, checks https://suspect-famq.ru/las-vegas/start, and asks the helper to roll back Las Vegas if the public health check fails.

## Rollback and boundaries

- Manual Las Vegas rollback: sudo /usr/local/sbin/las-vegas-deploy --rollback.
- Memphis remains memphis-lspd.service on 127.0.0.1:3000 behind the generic Nginx location /.
- This helper never invokes, stops, restarts, or edits Memphis services or paths.
- Do not set the GitHub readiness variable until the separate identities, paths, environment, service, SSH permissions, and Nginx route have been verified.

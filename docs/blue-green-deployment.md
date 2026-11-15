# Blue-green production deployment

The production Nginx site proxies to a named localhost upstream. The deploy helper starts the candidate release on the idle port (3000 or 3001), checks `/start`, switches Nginx with a graceful reload, and waits for the external health check before marking the release active. The previous release remains available for rollback.

## One-time VPS upgrade

The staging workflow uploads two installer files (owned by the unprivileged deploy account until copied into a root-owned directory) to:

`/var/lib/memphis-deploy/incoming/bootstrap-bluegreen/`

Run the following from a root shell on the VPS after that workflow succeeds:

```bash
install -d -o root -g root -m 0700 /root/memphis-bluegreen
install -o root -g root -m 0600 /var/lib/memphis-deploy/incoming/bootstrap-bluegreen/memphis-deploy /root/memphis-bluegreen/memphis-deploy
install -o root -g root -m 0600 /var/lib/memphis-deploy/incoming/bootstrap-bluegreen/upgrade-memphis-bluegreen.sh /root/memphis-bluegreen/upgrade-memphis-bluegreen.sh
bash /root/memphis-bluegreen/upgrade-memphis-bluegreen.sh /root/memphis-bluegreen/memphis-deploy
```

The installer validates the currently running service and the exact Nginx proxy directive, backs up the old helper and site configuration, installs a hardened systemd slot template, and changes Nginx to a localhost upstream initially targeting port 3000. It performs an Nginx configuration test and a graceful reload; it does not restart the currently running application or edit its environment file.

## Per-release flow

1. The workflow uploads the standalone build archive.
2. The helper extracts it into an immutable release directory and starts it on the unused slot.
3. The new slot must pass its local health check before Nginx is switched.
4. Nginx performs a graceful reload to the candidate slot. The workflow checks the public `/start` route.
5. Only after the public check passes does the helper commit the release pointer and systemd boot state.
6. A failed health check switches Nginx back to the old slot. The helper also supports `--rollback` after a release has been committed.

The deploy account retains only the existing restricted sudo entry for the root-owned `/usr/local/sbin/memphis-deploy` helper.

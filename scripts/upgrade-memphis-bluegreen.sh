#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly BASE="/var/lib/memphis-deploy"
readonly HELPER_DEST="/usr/local/sbin/memphis-deploy"
readonly TEMPLATE_DEST="/etc/systemd/system/memphis-lspd-slot@.service"
readonly UPSTREAM_DIR="/etc/nginx/conf.d"
readonly UPSTREAM_FILE="$UPSTREAM_DIR/memphis-lspd-upstream.conf"
readonly SITE_FILE="/etc/nginx/sites-available/memphis-lspd"
readonly SITE_LINK="/etc/nginx/sites-enabled/memphis-lspd"
readonly MAIN_SERVICE="memphis-lspd.service"
readonly MARKER="# Managed by majestic-web blue-green deployment. Do not edit."

[[ "$EUID" -eq 0 ]] || { echo "Run this upgrade from a root shell or with sudo." >&2; exit 1; }

SCRIPT_OWNER="$(stat -c '%u' "${BASH_SOURCE[0]}")"
SCRIPT_MODE="$(stat -c '%a' "${BASH_SOURCE[0]}")"
[[ "$SCRIPT_OWNER" == "0" ]] || { echo "The upgrade script must be root-owned." >&2; exit 1; }
(( (8#$SCRIPT_MODE & 022) == 0 )) || { echo "The upgrade script must not be group/world writable." >&2; exit 1; }

if [[ "$#" -eq 0 ]]; then
  HELPER_SOURCE="$(dirname "$0")/memphis-deploy"
else
  HELPER_SOURCE="$1"
fi
[[ -f "$HELPER_SOURCE" && ! -L "$HELPER_SOURCE" ]] || { echo "Usage: sudo bash upgrade-memphis-bluegreen.sh /root/path/memphis-deploy" >&2; exit 1; }
[[ "$(stat -c '%u' "$HELPER_SOURCE")" == "0" ]] || { echo "The new deploy helper must be root-owned." >&2; exit 1; }
HELPER_MODE="$(stat -c '%a' "$HELPER_SOURCE")"
(( (8#$HELPER_MODE & 022) == 0 )) || { echo "The deploy helper must not be group/world writable." >&2; exit 1; }
grep -Fq "blue-green release cutover with nginx" "$HELPER_SOURCE" || { echo "The helper does not contain the expected blue-green implementation." >&2; exit 1; }

[[ -d "$BASE/incoming" && -L "$BASE/current" ]] || { echo "The existing automatic deployment directories are missing." >&2; exit 1; }
id memphis >/dev/null 2>&1 || { echo "Application account 'memphis' is missing." >&2; exit 1; }
[[ -f /etc/memphis-lspd/memphis.env ]] || { echo "The production environment file is missing." >&2; exit 1; }
[[ -f /etc/nginx/nginx.conf && -d "$UPSTREAM_DIR" && -f "$SITE_FILE" ]] || { echo "Expected Nginx configuration files are missing." >&2; exit 1; }
[[ "$(readlink -f "$SITE_LINK" 2>/dev/null || true)" == "$SITE_FILE" ]] || { echo "The active Memphis Nginx site symlink is unexpected." >&2; exit 1; }
grep -Fq 'include /etc/nginx/conf.d/*.conf;' /etc/nginx/nginx.conf || { echo "Nginx does not include /etc/nginx/conf.d/*.conf in its HTTP configuration." >&2; exit 1; }
[[ ! -e "$UPSTREAM_FILE" ]] || { echo "$UPSTREAM_FILE already exists; inspect it before upgrading." >&2; exit 1; }

SERVICE_USER="$(systemctl show "$MAIN_SERVICE" --property=User --value 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show "$MAIN_SERVICE" --property=Group --value 2>/dev/null || true)"
WORKING_DIRECTORY="$(systemctl show "$MAIN_SERVICE" --property=WorkingDirectory --value 2>/dev/null || true)"
EXEC_START="$(systemctl show "$MAIN_SERVICE" --property=ExecStart --value 2>/dev/null || true)"
ENV_FILES="$(systemctl show "$MAIN_SERVICE" --property=EnvironmentFiles --value 2>/dev/null || true)"
[[ "$SERVICE_USER" == "memphis" && "$SERVICE_GROUP" == "memphis" ]] || { echo "Unexpected Memphis service account." >&2; exit 1; }
[[ "$WORKING_DIRECTORY" == "$BASE/current" ]] || { echo "The current service is not running from the managed current release symlink." >&2; exit 1; }
[[ "$EXEC_START" == *"$BASE/current/server.js"* ]] || { echo "The current service command does not match the managed standalone server." >&2; exit 1; }
[[ "$ENV_FILES" == *"/etc/memphis-lspd/memphis.env"* ]] || { echo "The expected external environment file is not configured." >&2; exit 1; }
systemctl is-active --quiet "$MAIN_SERVICE" || { echo "The current Memphis service is not active." >&2; exit 1; }
systemctl is-active --quiet nginx || { echo "Nginx is not active." >&2; exit 1; }
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/start -o /dev/null || { echo "The current local /start check failed." >&2; exit 1; }

PROXY_LINE_COUNT="$(grep -Ec '^[[:space:]]*proxy_pass http://127\.0\.0\.1:3000;[[:space:]]*$' "$SITE_FILE" || true)"
[[ "$PROXY_LINE_COUNT" == "1" ]] || { echo "Expected exactly one direct Nginx proxy_pass to 127.0.0.1:3000; refusing to edit the site." >&2; exit 1; }
grep -Fq "memphis_lspd_backend" "$SITE_FILE" && { echo "The Nginx site already references a managed upstream; inspect it before upgrading." >&2; exit 1; }

readonly BACKUP_DIR="$BASE/backups/blue-green-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
cp -a "$HELPER_DEST" "$BACKUP_DIR/memphis-deploy.before"
cp -a "$SITE_FILE" "$BACKUP_DIR/memphis-lspd.nginx.before"

rollback_upgrade() {
  local code="$?"
  trap - ERR
  if [[ -f "$BACKUP_DIR/memphis-lspd.nginx.before" ]]; then
    cp -a "$BACKUP_DIR/memphis-lspd.nginx.before" "$SITE_FILE"
  fi
  rm -f "$UPSTREAM_FILE" "$TEMPLATE_DEST"
  if [[ -f "$BACKUP_DIR/memphis-deploy.before" ]]; then
    install -o root -g root -m 0750 "$BACKUP_DIR/memphis-deploy.before" "$HELPER_DEST"
  fi
  systemctl daemon-reload >/dev/null 2>&1 || true
  nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
  echo "Blue-green upgrade failed; the previous helper and Nginx route were restored." >&2
  exit "$code"
}
trap rollback_upgrade ERR

install -d -o root -g memphis -m 0750 "$BASE/slots"
cat > "$TEMPLATE_DEST" <<EOF
$MARKER
[Unit]
Description=Memphis LSPD Next.js slot on port %i
Wants=memphis-xray-http-test.service
After=network-online.target memphis-xray-http-test.service

[Service]
Type=simple
User=memphis
Group=memphis
WorkingDirectory=$BASE/slots/%i
EnvironmentFile=/etc/memphis-lspd/memphis.env
Environment=HOSTNAME=127.0.0.1
Environment=PORT=%i
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $BASE/slots/%i/server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
KillSignal=SIGTERM
UMask=0027
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true
ReadWritePaths=$BASE/releases
EOF
chown root:root "$TEMPLATE_DEST"
chmod 0644 "$TEMPLATE_DEST"

install -o root -g root -m 0750 "$HELPER_SOURCE" "$HELPER_DEST"

cat > "$UPSTREAM_FILE" <<'EOF'
upstream memphis_lspd_backend {
    server 127.0.0.1:3000;
}
EOF
chown root:root "$UPSTREAM_FILE"
chmod 0644 "$UPSTREAM_FILE"

temporary_site="$(mktemp /etc/nginx/sites-available/.memphis-lspd.XXXXXX)"
python3 - "$SITE_FILE" "$temporary_site" <<'PY'
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text()
old = "proxy_pass http://127.0.0.1:3000;"
new = "proxy_pass http://memphis_lspd_backend;"
if source.count(old) != 1:
    raise SystemExit("The Memphis Nginx proxy directive changed during installation.")
pathlib.Path(sys.argv[2]).write_text(source.replace(old, new))
PY
chown --reference="$SITE_FILE" "$temporary_site"
chmod --reference="$SITE_FILE" "$temporary_site"
mv -f "$temporary_site" "$SITE_FILE"

nginx -t
systemctl daemon-reload
systemctl reload nginx
"$HELPER_DEST" --check

trap - ERR

echo
echo "Blue-green deployment is installed."
echo "Nginx now uses a managed upstream and can switch between ports 3000 and 3001 with a graceful reload."
echo "The currently running Memphis service, application release and environment file were not restarted or changed."
echo "The next successful push to main will start and health-check the new release before switching traffic."
echo "Backups are stored in: $BACKUP_DIR"

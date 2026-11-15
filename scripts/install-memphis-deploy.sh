#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly BASE="/var/lib/memphis-deploy"
readonly INCOMING="$BASE/incoming"
readonly SERVICE="memphis-lspd.service"
readonly HELPER_DEST="/usr/local/sbin/memphis-deploy"
readonly SUDOERS_DEST="/etc/sudoers.d/memphis-lspd-deploy"

[[ "$EUID" -eq 0 ]] || { echo "Run this installer from a root shell or with sudo." >&2; exit 1; }

HELPER_SOURCE="${1:-$(dirname "$0")/memphis-deploy}"
[[ -f "$HELPER_SOURCE" && ! -L "$HELPER_SOURCE" ]] || {
  echo "Usage: sudo bash install-memphis-deploy.sh /trusted/path/to/memphis-deploy" >&2
  exit 1
}
grep -Fq "Managed by majestic-web automatic deployment" "$HELPER_SOURCE" || {
  echo "The helper file does not contain the expected deployment marker." >&2
  exit 1
}

[[ -d "$INCOMING" ]] || { echo "Missing $INCOMING; SSH upload setup is not ready." >&2; exit 1; }
DEPLOY_USER="$(stat -c '%U' "$INCOMING")"
[[ -n "$DEPLOY_USER" && "$DEPLOY_USER" != "root" ]] || {
  echo "The incoming directory must be owned by a dedicated non-root deploy user." >&2
  exit 1
}
id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "Deploy account '$DEPLOY_USER' does not exist." >&2; exit 1; }
runuser -u "$DEPLOY_USER" -- test -w "$INCOMING" || {
  echo "Deploy account '$DEPLOY_USER' cannot write to $INCOMING." >&2
  exit 1
}
id memphis >/dev/null 2>&1 || { echo "Application account 'memphis' does not exist." >&2; exit 1; }

SERVICE_USER="$(systemctl show "$SERVICE" --property=User --value 2>/dev/null || true)"
SERVICE_GROUP="$(systemctl show "$SERVICE" --property=Group --value 2>/dev/null || true)"
WORKING_DIRECTORY="$(systemctl show "$SERVICE" --property=WorkingDirectory --value 2>/dev/null || true)"
EXEC_START="$(systemctl show "$SERVICE" --property=ExecStart --value 2>/dev/null || true)"
ENV_FILES="$(systemctl show "$SERVICE" --property=EnvironmentFiles --value 2>/dev/null || true)"
DROPIN_PATHS="$(systemctl show "$SERVICE" --property=DropInPaths --value 2>/dev/null || true)"

[[ "$SERVICE_USER" == "memphis" && "$SERVICE_GROUP" == "memphis" ]] || {
  echo "Unexpected service account: User='$SERVICE_USER' Group='$SERVICE_GROUP'." >&2
  exit 1
}
[[ "$WORKING_DIRECTORY" == "/opt/memphis-lspd" ]] || {
  echo "Unexpected service working directory: '$WORKING_DIRECTORY'." >&2
  exit 1
}
[[ "$EXEC_START" == *"/opt/memphis-lspd/node_modules/next/dist/bin/next start"* ]] || {
  echo "The active service command differs from the expected legacy Next.js command." >&2
  exit 1
}
[[ "$ENV_FILES" == *"/etc/memphis-lspd/memphis.env"* ]] || {
  echo "The expected external environment file is not configured on the service." >&2
  exit 1
}
[[ -z "$DROPIN_PATHS" ]] || {
  echo "The service already has systemd drop-ins: $DROPIN_PATHS" >&2
  echo "Inspect these before provisioning the automatic deployment override." >&2
  exit 1
}
systemctl is-active --quiet "$SERVICE" || {
  echo "The existing Memphis service is not active; refusing to enable automatic deployment." >&2
  exit 1
}
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/start -o /dev/null || {
  echo "The existing /start health check failed; refusing to enable automatic deployment." >&2
  exit 1
}

if [[ -e /etc/systemd/system/memphis-lspd.service.d/90-memphis-auto-deploy.conf ]]; then
  echo "A deployment service override already exists; inspect it before running this installer." >&2
  exit 1
fi

install -o root -g root -m 0750 "$HELPER_SOURCE" "$HELPER_DEST"
install -d -o root -g memphis -m 0750 "$BASE/releases"

temporary_sudoers="$(mktemp /etc/sudoers.d/.memphis-lspd-deploy.XXXXXX)"
trap 'rm -f "$temporary_sudoers"' EXIT
printf '%s ALL=(root) NOPASSWD: %s *\n' "$DEPLOY_USER" "$HELPER_DEST" > "$temporary_sudoers"
chown root:root "$temporary_sudoers"
chmod 0440 "$temporary_sudoers"
visudo -cf "$temporary_sudoers" >/dev/null
mv -f "$temporary_sudoers" "$SUDOERS_DEST"
trap - EXIT

visudo -cf /etc/sudoers >/dev/null
runuser -u "$DEPLOY_USER" -- sudo -n "$HELPER_DEST" --check

echo
echo "Automatic deployment is now provisioned for account '$DEPLOY_USER'."
echo "No running service, application directory, environment file or live release was modified."
echo "The next successful push to main will deploy through isolated release directories."

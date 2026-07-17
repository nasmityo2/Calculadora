#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/var/www/calculadora
RELEASES="$APP_ROOT/releases"
SHARED="$APP_ROOT/shared"
CURRENT="$APP_ROOT/current"
PREVIOUS="$APP_ROOT/previous"
ENV_FILE=/etc/dayzo/calculadora.env
ARTIFACT=${1:?Uso: deploy.sh /ruta/dayzo-release.tar.gz}
RELEASE="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)"

pm2_dayzo() {
  sudo -u dayzo -H pm2 "$@"
}

test -f "$ARTIFACT"
test -f "$ENV_FILE"
install -d -m 0750 -o dayzo -g dayzo "$RELEASES" "$SHARED/data"
install -d -m 0700 -o dayzo -g dayzo /var/backups/dayzo/daily

if [[ -L "$CURRENT" ]]; then
  old_release=$(readlink -f "$CURRENT")
  ln -sfn "$old_release" "$PREVIOUS"
  sudo -u dayzo env \
    DATA_DIR="$SHARED/data" \
    BACKUP_DIR=/var/backups/dayzo/daily \
    BACKUP_RETENTION_DAYS=7 \
    npm --prefix "$CURRENT" run backup
fi

install -d -m 0750 -o dayzo -g dayzo "$RELEASE"
tar -xzf "$ARTIFACT" -C "$RELEASE"
ln -s "$SHARED/data" "$RELEASE/data"
chown -R dayzo:dayzo "$RELEASE"

sudo -u dayzo npm --prefix "$RELEASE" ci --omit=dev

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export NODE_ENV=production HOST=127.0.0.1 DATA_DIR="$SHARED/data"
sudo -u dayzo --preserve-env=NODE_ENV,HOST,PORT,DATA_DIR,SESSION_SECRET,BCV_TLS_FALLBACK \
  npm --prefix "$RELEASE" run preflight

ln -sfn "$RELEASE" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$CURRENT"

rollback() {
  if [[ -L "$PREVIOUS" ]]; then
    ln -sfn "$(readlink -f "$PREVIOUS")" "$APP_ROOT/current.next"
    mv -Tf "$APP_ROOT/current.next" "$CURRENT"
    pm2_dayzo reload "$CURRENT/ecosystem.config.cjs" --update-env || true
  fi
}
trap rollback ERR

if pm2_dayzo describe calculadora >/dev/null 2>&1; then
  pm2_dayzo reload "$CURRENT/ecosystem.config.cjs" --update-env
else
  pm2_dayzo start "$CURRENT/ecosystem.config.cjs" --env production
fi

for _ in {1..20}; do
  if curl -fsS http://127.0.0.1:3001/health-internal >/dev/null; then
    trap - ERR
    pm2_dayzo save
    echo "Deploy DAYZO completado: $RELEASE"
    exit 0
  fi
  sleep 1
done

echo "Health check no quedó listo; ejecutando rollback." >&2
false

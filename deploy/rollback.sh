#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/var/www/calculadora
CURRENT="$APP_ROOT/current"
PREVIOUS="$APP_ROOT/previous"
ENV_FILE=/etc/dayzo/calculadora.env

test -L "$PREVIOUS"
test -f "$ENV_FILE"
target=$(readlink -f "$PREVIOUS")
test -d "$target"

current_target=$(readlink -f "$CURRENT")
ln -sfn "$current_target" "$APP_ROOT/rollback-from"
ln -sfn "$target" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$CURRENT"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export NODE_ENV=production HOST=127.0.0.1 DATA_DIR="$APP_ROOT/shared/data"

sudo -u dayzo -H pm2 reload "$CURRENT/ecosystem.config.cjs" --update-env
curl -fsS http://127.0.0.1:3001/health-internal >/dev/null
sudo -u dayzo -H pm2 save
echo "Rollback DAYZO completado: $target"

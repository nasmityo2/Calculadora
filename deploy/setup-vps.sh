#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Ejecuta como root." >&2; exit 1; }

id dayzo >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin dayzo
install -d -m 0750 -o dayzo -g dayzo /var/www/calculadora/{releases,shared/data}
install -d -m 0700 -o dayzo -g dayzo /var/backups/dayzo/daily
install -d -m 0750 -o root -g dayzo /etc/dayzo

if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
cat >/etc/sysctl.d/99-dayzo-memory.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=75
EOF
sysctl --system >/dev/null

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

install -m 0644 deploy/logrotate-dayzo /etc/logrotate.d/dayzo
install -m 0644 deploy/dayzo-backup.service /etc/systemd/system/dayzo-backup.service
install -m 0644 deploy/dayzo-backup.timer /etc/systemd/system/dayzo-backup.timer
systemctl daemon-reload
systemctl enable --now dayzo-backup.timer

echo "VPS base listo. Instala nginx-dayzo.conf, crea /etc/dayzo/calculadora.env (0640 root:dayzo) y ejecuta deploy.sh."

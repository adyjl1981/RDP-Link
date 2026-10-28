#!/usr/bin/env bash
# Optional systemd setup for the existing Docker Compose deployment.
set -euo pipefail
REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
UNIT=/etc/systemd/system/rdp-link.service
MARKER='# Managed by RDP-Link setup.sh'
INSTALL_USER=${SUDO_USER:-$(id -un)}

unit_text() {
    local repo=$REPO_DIR docker_bin
    [[ $INSTALL_USER =~ ^[a-zA-Z_][a-zA-Z0-9_-]*\$?$ && $INSTALL_USER != root ]] || {
        echo 'Run setup as the non-root account that runs Docker (sudo is requested when needed).' >&2; return 1;
    }
    docker_bin=$(command -v docker)
    # Reject paths containing systemd specifiers or other unusual characters.
    [[ $repo =~ ^[a-zA-Z0-9/._\ -]+$ && $docker_bin =~ ^[a-zA-Z0-9/._-]+$ ]] || {
        echo 'Repository/Docker path contains unsupported characters.' >&2; return 1;
    }
    cat <<UNIT_TEXT
$MARKER
[Unit]
Description=RDP-Link Web Remote Desktop
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=$INSTALL_USER
WorkingDirectory=$repo
ExecStart=$docker_bin compose up -d
ExecStop=$docker_bin compose stop
TimeoutStartSec=0
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT_TEXT
}

case "${1:-}" in
    --print-unit) unit_text; exit ;;
    --disable)
        if [[ ! -e $UNIT ]]; then echo 'No RDP-Link boot service is installed.'; exit; fi
        grep -qxF "$MARKER" "$UNIT" || { echo "Refusing to remove unmanaged $UNIT" >&2; exit 1; }
        sudo systemctl disable --now rdp-link.service
        sudo rm -- "$UNIT"
        sudo systemctl daemon-reload
        echo 'Boot service removed; the Compose stack has been stopped. Start manually with docker compose up -d.'
        exit ;;
    '') ;;
    *) echo "Usage: $0 [--print-unit|--disable]" >&2; exit 1 ;;
esac

answer=''
read -r -p 'Start RDP-Link automatically when this machine boots? [y/N] ' answer || true
case "$answer" in y|Y|yes|YES|Yes) ;; *) echo 'Boot service unchanged. Use docker compose up -d to start manually.'; exit ;; esac

[[ -f $REPO_DIR/compose.yaml && -f $REPO_DIR/.env ]] || {
    echo 'Complete the README Docker/.env setup first.' >&2; exit 1;
}
if [[ -e $UNIT ]] && ! grep -qxF "$MARKER" "$UNIT"; then
    echo "Refusing to overwrite unmanaged $UNIT; review it manually first." >&2; exit 1
fi
# Validate Docker access as the service account before changing system configuration.
if [[ $(id -un) == "$INSTALL_USER" ]]; then
    docker compose version >/dev/null
    docker info >/dev/null
    (cd "$REPO_DIR" && docker compose config --quiet)
else
    sudo -u "$INSTALL_USER" docker compose version >/dev/null
    sudo -u "$INSTALL_USER" docker info >/dev/null
    (cd "$REPO_DIR" && sudo -u "$INSTALL_USER" docker compose config --quiet)
fi
tmp=$(mktemp)
trap 'rm -f -- "$tmp"' EXIT
unit_text > "$tmp"
verify_dir=$(mktemp -d)
trap 'rm -f -- "$tmp"; rm -rf -- "$verify_dir"' EXIT
cp "$tmp" "$verify_dir/rdp-link.service"
systemd-analyze verify "$verify_dir/rdp-link.service"
sudo install -o root -g root -m 0644 "$tmp" "$UNIT"
sudo systemctl daemon-reload
sudo systemctl enable --now rdp-link.service
echo 'RDP-Link boot service enabled and started.'

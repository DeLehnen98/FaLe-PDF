#!/bin/bash
# FaLe Mail – first boot of a fresh Ubuntu 24.04 server. Started once by cloud-init (mail/cloud-init.yaml).
# Idempotent: safe to re-run (`/usr/local/lib/fale-mail/firstboot.sh`). All secrets are generated HERE and
# stay on this machine (root-only files); nothing secret is ever printed or sent anywhere.
set -euo pipefail
umask 077
exec > >(tee -a /var/log/fale-mail-firstboot.log) 2>&1
echo "[firstboot] start $(date -Is)"

# shellcheck source=/dev/null
. /etc/fale-mail/pins.env
LIB=/usr/local/lib/fale-mail
AGENT="$LIB/fale-mail-agent.py"
export DEBIAN_FRONTEND=noninteractive

randpw() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }

# ---------------------------------------------------------------- 1. OS hardening
apt-get update -q
apt-get install -y -q --no-install-recommends unattended-upgrades ufw unbound restic git python3-cryptography \
  openssl ca-certificates curl xz-utils
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52fale-mail <<'EOF'
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}"; "${distro_id}:${distro_codename}-security"; "${distro_id}ESMApps:${distro_codename}-apps-security"; "${distro_id}ESM:${distro_codename}-infra-security"; };
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

# Firewall: mail + HTTPS only. Port 80 stays closed (ACME uses TLS-ALPN-01 on 443), 4190/110/143/995 closed.
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
for p in 25 465 587 993 443; do ufw allow "$p/tcp"; done
if [ "${FALE_SSH:-off}" = "on" ]; then ufw limit 22/tcp; fi
ufw --force enable

# SSH: off by default (management is GitOps-only; break-glass = provider web console / rescue system).
if [ "${FALE_SSH:-off}" != "on" ]; then
  systemctl disable --now ssh.socket ssh.service 2>/dev/null || true
  apt-get purge -y -q openssh-server || true
fi
passwd -l root >/dev/null 2>&1 || true

cat > /etc/sysctl.d/60-fale-mail.conf <<'EOF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.tcp_syncookies = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
EOF
sysctl --system >/dev/null

# Own validating resolver: DNSSEC (enables DANE) and DNSBL queries that public resolvers get refused for.
cat > /etc/unbound/unbound.conf.d/fale-mail.conf <<'EOF'
server:
  interface: 127.0.0.1
  interface: ::1
  access-control: 127.0.0.0/8 allow
  access-control: ::1/128 allow
  hide-identity: yes
  hide-version: yes
  qname-minimisation: yes
  prefetch: yes
EOF
systemctl enable --now unbound
systemctl restart unbound
mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nDNS=127.0.0.1 ::1\nDNSStubListener=no\nDomains=~.\n' > /etc/systemd/resolved.conf.d/fale-mail.conf
systemctl restart systemd-resolved
ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf

# ---------------------------------------------------------------- 2. Stalwart (pinned, hash-verified)
case "$(uname -m)" in
  x86_64) ARCH=x86_64; SRV_SHA="$STALWART_SHA256_X86_64"; CLI_SHA="$CLI_SHA256_X86_64" ;;
  aarch64) ARCH=aarch64; SRV_SHA="$STALWART_SHA256_AARCH64"; CLI_SHA="$CLI_SHA256_AARCH64" ;;
  *) echo "unsupported architecture"; exit 1 ;;
esac
install_bin() { # url sha256 binary-name
  local tmp; tmp=$(mktemp -d)
  curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/a" "$1"
  echo "$2  $tmp/a" | sha256sum -c --quiet
  mkdir "$tmp/x"; tar -xf "$tmp/a" -C "$tmp/x"
  install -m 0755 "$(find "$tmp/x" -type f -name "$3" | head -n1)" "/usr/local/bin/$3"
  rm -rf "$tmp"
}
if [ "$(/usr/local/bin/stalwart --version 2>/dev/null || true)" != "$STALWART_VERSION" ]; then
  install_bin "https://github.com/stalwartlabs/stalwart/releases/download/v$STALWART_VERSION/stalwart-$ARCH-unknown-linux-gnu.tar.gz" "$SRV_SHA" stalwart
fi
if ! /usr/local/bin/stalwart-cli --version 2>/dev/null | grep -q "$CLI_VERSION"; then
  install_bin "https://github.com/stalwartlabs/cli/releases/download/v$CLI_VERSION/stalwart-cli-$ARCH-unknown-linux-gnu.tar.xz" "$CLI_SHA" stalwart-cli
fi

id stalwart >/dev/null 2>&1 || useradd --system --home-dir /var/lib/stalwart --shell /usr/sbin/nologin stalwart
install -d -o root -g stalwart -m 0770 /etc/stalwart
install -d -o stalwart -g stalwart -m 0700 /var/lib/stalwart
install -d -o root -g root -m 0700 /etc/fale-mail
install -d -o root -g root -m 0755 /var/lib/fale-mail /var/lib/fale-mail/web /var/lib/fale-mail/web/src
install -d -o stalwart -g stalwart -m 0755 /var/lib/fale-mail/web/unpack

# ---------------------------------------------------------------- 3. secrets (generated here, root-only)
if [ ! -s /etc/fale-mail/agent.env ]; then
  ADMIN_PW=$(randpw 40)
  printf 'STALWART_URL=http://127.0.0.1:8080\nSTALWART_USER=admin\nSTALWART_PASSWORD=%s\n' "$ADMIN_PW" > /etc/fale-mail/agent.env
  printf 'STALWART_RECOVERY_ADMIN=admin:%s\n' "$ADMIN_PW" > /etc/stalwart/stalwart.env
  unset ADMIN_PW
fi
chown root:stalwart /etc/stalwart/stalwart.env; chmod 0640 /etc/stalwart/stalwart.env; chmod 0600 /etc/fale-mail/agent.env
[ -s /etc/fale-mail/restic.pass ] || { randpw 48 > /etc/fale-mail/restic.pass; chmod 0600 /etc/fale-mail/restic.pass; }
[ -s /etc/fale-mail/owner-secrets.env ] || { printf 'POSTMASTER_PASSWORD=%s\nKONTO_PASSWORD=%s\n' "$(randpw 32)" "$(randpw 32)" > /etc/fale-mail/owner-secrets.env; chmod 0600 /etc/fale-mail/owner-secrets.env; }
touch /etc/fale-mail/allowed_signers
python3 "$AGENT" keygen

# ---------------------------------------------------------------- 4. systemd units
cat > /etc/systemd/system/stalwart.service <<'EOF'
[Unit]
Description=Stalwart Mail Server (FaLe Mail)
After=network-online.target unbound.service
Wants=network-online.target

[Service]
User=stalwart
Group=stalwart
EnvironmentFile=/etc/stalwart/stalwart.env
ExecStart=/usr/local/bin/stalwart --config /etc/stalwart/config.json
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/etc/stalwart /var/lib/stalwart /var/lib/fale-mail/web/unpack /var/backups/fale-mail
ReadOnlyPaths=/var/lib/fale-mail/web

[Install]
WantedBy=multi-user.target
EOF
install -d -o stalwart -g stalwart -m 0700 /var/backups/fale-mail
mk_timer() { # name, OnCalendar/OnUnitActiveSec line, agent subcommand
  printf '[Unit]\nDescription=FaLe Mail agent: %s\nAfter=stalwart.service\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 %s %s\nNice=10\n' \
    "$3" "$AGENT" "$3" > "/etc/systemd/system/$1.service"
  printf '[Unit]\nDescription=FaLe Mail agent timer: %s\n\n[Timer]\n%s\nRandomizedDelaySec=60\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n' \
    "$3" "$2" > "/etc/systemd/system/$1.timer"
}
mk_timer fale-mail-gitops "OnBootSec=2min
OnUnitActiveSec=10min" gitops
mk_timer fale-mail-status "OnBootSec=3min
OnUnitActiveSec=15min" status
mk_timer fale-mail-backup "OnCalendar=*-*-* 03:30:00" backup
systemctl daemon-reload

# ---------------------------------------------------------------- 5. Stalwart bootstrap (non-interactive)
wait_admin() { for _ in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/ || true)" != "000" ] && return 0; sleep 2; done; return 1; }
set -a
# shellcheck source=/dev/null
. /etc/fale-mail/agent.env
set +a
export NO_PROXY=127.0.0.1
if [ ! -s /etc/stalwart/config.json ]; then
  systemctl enable --now stalwart
  wait_admin
  cat > /etc/fale-mail/bootstrap.ndjson <<EOF
{"@type":"update","object":"Bootstrap","value":{"serverHostname":"$MAIL_HOST","defaultDomain":"$MAIL_DOMAIN","generateDkimKeys":true,"requestTlsCertificate":false,"dnsServer":{"@type":"Manual"},"directory":{"@type":"Internal"},"dataStore":{"@type":"RocksDb","path":"/var/lib/stalwart/"},"tracer":{"@type":"Stdout","level":"info","ansi":false,"multiline":false,"lossy":false,"enable":true,"eventsPolicy":"exclude","events":{}}}}
EOF
  stalwart-cli apply --quiet --file /etc/fale-mail/bootstrap.ndjson
  for _ in $(seq 1 30); do [ -s /etc/stalwart/config.json ] && break; sleep 2; done
  [ -s /etc/stalwart/config.json ] || { echo "[firstboot] bootstrap did not write config.json"; exit 1; }
fi
systemctl enable stalwart
systemctl restart stalwart
wait_admin

# Mailboxes: postmaster (+ abuse@, hallo@, report addresses) and konto (sender for login codes / notifications).
# Passwords are generated here and sealed to the owner's phone on pairing (docs/FALE-MAIL.md#pairing).
DOMAIN_ID=$(stalwart-cli query Domain --json | python3 -c "import sys,json;print(next(d['id'] for d in map(json.loads,filter(str.strip,sys.stdin)) if d.get('name')=='$MAIL_DOMAIN'))")
create_mailbox() { # name, description, secret-var, aliases...
  local name=$1 desc=$2 var=$3; shift 3
  stalwart-cli query Account --json | grep -q "\"$name@$MAIL_DOMAIN\"" && return 0
  PW=$(sed -n "s/^$var=//p" /etc/fale-mail/owner-secrets.env) python3 - "$DOMAIN_ID" "$name" "$desc" "$@" > /etc/fale-mail/account.json <<'EOF'
import json, os, sys
d, name, desc, aliases = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
print(json.dumps({"name": name, "domainId": d, "description": desc, "roles": {"@type": "User"},
                  "credentials": {"0": {"@type": "Password", "secret": os.environ["PW"]}},
                  "aliases": {str(i): {"name": a, "domainId": d, "enabled": True} for i, a in enumerate(aliases)}}))
EOF
  stalwart-cli create Account/User --file /etc/fale-mail/account.json >/dev/null
  rm -f /etc/fale-mail/account.json
}
create_mailbox postmaster "Postmaster / Abuse / Support" POSTMASTER_PASSWORD abuse hostmaster security hallo dmarc-reports tls-reports
create_mailbox konto "Transactional sender (login codes, notifications)" KONTO_PASSWORD notfall noreply

# ---------------------------------------------------------------- 6. GitOps + status, then timers
python3 "$AGENT" gitops || echo "[firstboot] first gitops run failed – the timer retries every 10 min"
systemctl restart stalwart
wait_admin
python3 "$AGENT" status || true
systemctl enable --now fale-mail-gitops.timer fale-mail-status.timer fale-mail-backup.timer
touch /var/lib/fale-mail/firstboot.done
echo "[firstboot] done $(date -Is)"

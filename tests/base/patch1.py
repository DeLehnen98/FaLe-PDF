p='/home/claude/FalePDF/mail/server/firstboot.sh'; s=open(p).read()
old_start=s.index('# Postmaster mailbox')
old_end=s.index('# ---------------------------------------------------------------- 6.')
new='''# Mailboxes: postmaster (+ abuse@, hallo@, report addresses) and konto (sender for login codes / notifications).
# Passwords are generated here and sealed to the owner's phone on pairing (docs/FALE-MAIL.md#pairing).
DOMAIN_ID=$(stalwart-cli query Domain --json | python3 -c "import sys,json;print(next(d['id'] for d in map(json.loads,filter(str.strip,sys.stdin)) if d.get('name')=='$MAIL_DOMAIN'))")
create_mailbox() { # name, description, secret-var, aliases...
  local name=$1 desc=$2 var=$3; shift 3
  stalwart-cli query Account --json | grep -q "\\"$name@$MAIL_DOMAIN\\"" && return 0
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

'''
s=s[:old_start]+new+s[old_end:]
old='''[ -s /etc/fale-mail/owner-secrets.env ] || { printf 'POSTMASTER_PASSWORD=%s\\n' "$(randpw 32)" > /etc/fale-mail/owner-secrets.env; chmod 0600 /etc/fale-mail/owner-secrets.env; }'''
assert old in s
s=s.replace(old,'''[ -s /etc/fale-mail/owner-secrets.env ] || { printf 'POSTMASTER_PASSWORD=%s\\nKONTO_PASSWORD=%s\\n' "$(randpw 32)" "$(randpw 32)" > /etc/fale-mail/owner-secrets.env; chmod 0600 /etc/fale-mail/owner-secrets.env; }''')
open(p,'w').write(s)
p='/home/claude/FalePDF/mail/server/fale-mail-agent.py'; s=open(p).read()
old='''            "resticPassword": restic,'''
new='''            "transactional": {"user": f"konto@{MAIL_DOMAIN}", "password": secrets.get("KONTO_PASSWORD"),
                              "smtp": f"{MAIL_HOST}:465 (implicit TLS)", "use": "Supabase Auth custom SMTP, FaLe One notifications"},
            "resticPassword": restic,'''
assert old in s; s=s.replace(old,new); open(p,'w').write(s)
print("patched")

#!/bin/bash
set -uo pipefail
S=$1; R=$S/sim
python3 -I $S/lo-up.py
mount --bind $R/varlib /var/lib/fale-mail
mkdir -p /var/lib/fale-mail/web/src /var/lib/fale-mail/web/unpack
export PATH=$S/cli/stalwart-cli-x86_64-unknown-linux-gnu:$S/stalwart:$PATH
export FALE_MAIL_ETC=$R/etc-fale FALE_MAIL_VAR=/var/lib/fale-mail FALE_MAIL_REPO=file://$R/repo
export FALE_MAIL_CLI=$S/cli/stalwart-cli-x86_64-unknown-linux-gnu/stalwart-cli FALE_MAIL_SERVER_BIN=$S/stalwart/stalwart
AGENT=/home/claude/FalePDF/mail/server/fale-mail-agent.py
PW=SimAdminPw0123456789abcdefABCDEF
printf 'STALWART_URL=http://127.0.0.1:8080\nSTALWART_USER=admin\nSTALWART_PASSWORD=%s\n' $PW > $R/etc-fale/agent.env
printf 'POSTMASTER_PASSWORD=SimPostmaster0123456789\n' > $R/etc-fale/owner-secrets.env
echo SimResticPass > $R/etc-fale/restic.pass
python3 $AGENT keygen
start() { STALWART_RECOVERY_ADMIN=admin:$PW stalwart --config $R/etc-stalwart/config.json >> $R/server.log 2>&1 & SPID=$!; for i in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)" != 000 ] && return 0; sleep 0.5; done; echo "server did not start"; }
export STALWART_URL=http://127.0.0.1:8080 STALWART_USER=admin STALWART_PASSWORD=$PW
start
cat > $R/bootstrap.ndjson <<B
{"@type":"update","object":"Bootstrap","value":{"serverHostname":"mail.fale.network","defaultDomain":"fale.network","generateDkimKeys":true,"requestTlsCertificate":false,"dnsServer":{"@type":"Manual"},"directory":{"@type":"Internal"},"dataStore":{"@type":"RocksDb","path":"$R/data/"},"tracer":{"@type":"Stdout","level":"info","ansi":false,"multiline":false,"lossy":false,"enable":true,"eventsPolicy":"exclude","events":{}}}}
B
stalwart-cli apply --quiet --file $R/bootstrap.ndjson && echo "BOOTSTRAP ok"
sleep 1; [ -s $R/etc-stalwart/config.json ] && echo "config.json written"
kill $SPID; wait $SPID 2>/dev/null; start; echo "normal mode http 8080: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)"
printf 'KONTO_PASSWORD=SimKonto0123456789xyz\n' >> $R/etc-fale/owner-secrets.env
sed -n '/^# Mailboxes/,/^create_mailbox konto/p' /home/claude/FalePDF/mail/server/firstboot.sh | sed "s#/etc/fale-mail#$R/etc-fale#g" > $R/mb.sh
MAIL_DOMAIN=fale.network bash -e $R/mb.sh && echo "MAILBOXES ok"; MAIL_DOMAIN=fale.network bash -e $R/mb.sh && echo "MAILBOXES idempotent"
stalwart-cli query Account 2>&1 | grep -E 'postmaster|konto'
echo "== gitops #1"; python3 $AGENT gitops; echo "rc=$?"
kill $SPID; wait $SPID 2>/dev/null; start
echo "== listeners after restart:"; grep -o 'listenerId = "[a-z-]*", localIp = [0-9.:]*, localPort = [0-9]*' $R/server.log | tail -7 | tr '\n' ';'; echo
echo "== status"; python3 $AGENT status; echo "rc=$?"
sleep 2
curl -s http://127.0.0.1:8080/fale/status.json > $R/status.json; python3 -c "
import json; s=json.load(open('$R/status.json')); print('status keys:', sorted(s)); print('dkim:', [(d['selector'],d['algorithm'],len(d['value'])) for d in s.get('dkim',[])]); print('gitops:', s['gitops']); print('tls:', s['tls']); print('queue', s.get('queue'), 'err', s.get('stalwartError'))"
curl --noproxy "*" -sk -o /dev/null -w 'https 443 /fale/: %{http_code}\n' --resolve mail.fale.network:443:127.0.0.1 https://mail.fale.network/fale/
# pairing + sealed secret
cd $R/repo && node --input-type=module -e "
import { generateKeyPair, seal } from '$R/repo/mail/tools/seal.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const kp = await generateKeyPair();
const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
writeFileSync('$R/owner-priv.json', JSON.stringify(priv));
mkdirSync('mail/config/pairing', {recursive:true}); mkdirSync('mail/config/sealed', {recursive:true});
writeFileSync('mail/config/pairing/owner.json', JSON.stringify({v:'fale-pair-1', role:'owner', name:'owner', jwk: kp.jwk}));
const st = JSON.parse((await import('node:fs')).readFileSync('$R/status.json','utf8'));
writeFileSync('mail/config/sealed/backup.json', JSON.stringify(await seal(st.sealPublicKey.jwk, JSON.stringify({name:'backup', env:{RESTIC_REPOSITORY:'s3:https://fsn1.example.invalid/bucket', AWS_ACCESS_KEY_ID:'SIMKEYID', AWS_SECRET_ACCESS_KEY:'simsecret'}}))));
" && git add -A && git -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -qm pair && echo "committed pairing+sealed"
cd /
echo "== gitops #2"; python3 $AGENT gitops; echo "rc=$?"
sleep 2
curl -s http://127.0.0.1:8080/fale/pairing/owner.json > $R/owner-box.json
node --input-type=module -e "
import { unseal } from '$R/repo/mail/tools/seal.mjs';
import { readFileSync } from 'node:fs';
const pj = JSON.parse(readFileSync('$R/owner-priv.json','utf8'));
const priv = await crypto.subtle.importKey('jwk', pj, {name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
const {kty,crv,x,y} = pj;
const p = JSON.parse(await unseal(priv, {kty,crv,x,y}, JSON.parse(readFileSync('$R/owner-box.json','utf8'))));
console.log('PAIRING decrypted:', p.admin.user, p.admin.password === '$PW' ? 'admin-pw-match' : 'MISMATCH', p.postmaster.password ? 'pm-ok':'pm-missing', p.resticPassword==='SimResticPass'?'restic-ok':'restic-bad', p.transactional.password==='SimKonto0123456789xyz'?'konto-ok':'konto-bad');
"
echo "backup.env: $(cut -d= -f1 $R/etc-fale/backup.env | tr '\n' ' ')"
# tamper test: change plan without manifest
cd $R/repo && echo '{"@type":"update","object":"Http","value":{"enableHsts":false}}' >> mail/config/stalwart.ndjson && git -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -qam tamper; cd /
echo "== gitops #3 (tampered)"; python3 $AGENT gitops; echo "rc=$?"
python3 -c "import json;print(json.load(open('/var/lib/fale-mail/state.json'))['gitops']['error'])"
# forbidden object test
cd $R/repo && git -c commit.gpgsign=false -c user.email=t@t -c user.name=t revert --no-edit HEAD >/dev/null && echo '{"@type":"upsert","object":"Account","value":{"a":{"name":"evil"}}}' >> mail/config/stalwart.ndjson && node mail/tools/build.mjs >/dev/null && git add -A && git -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -qm evil; cd /
echo "== gitops #4 (forbidden object)"; python3 $AGENT gitops; echo "rc=$?"
python3 -c "import json;print(json.load(open('/var/lib/fale-mail/state.json'))['gitops']['error'])"
kill $SPID

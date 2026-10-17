#!/bin/bash
S=$1; R=$S/sim; python3 -I $S/lo-up.py
export PATH=$S/cli/stalwart-cli-x86_64-unknown-linux-gnu:$S/stalwart:$PATH
PW=SimAdminPw0123456789abcdefABCDEF
STALWART_RECOVERY_ADMIN=admin:$PW stalwart --config $R/etc-stalwart/config.json > /dev/null 2>&1 & SPID=$!
sleep 4
export STALWART_URL=http://127.0.0.1:8080 STALWART_USER=admin STALWART_PASSWORD=$PW
MAIL_DOMAIN=fale.network bash -ex $R/mb.sh 2>&1 | tail -8; echo "rc=${PIPESTATUS[0]}"
kill $SPID

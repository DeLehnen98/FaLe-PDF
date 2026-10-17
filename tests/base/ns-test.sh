#!/bin/bash
S=$1; T=$S/srv3; C=$S/cli/stalwart-cli-x86_64-unknown-linux-gnu/stalwart-cli
python3 -I /home/claude/FalePDF/tests/base/lo-up.py
STALWART_RECOVERY_ADMIN=admin:testpw123456 $S/stalwart/stalwart --config $T/etc/config.json > $T/out3.txt 2>&1 &
sleep 4
sleep 3

export STALWART_URL=http://127.0.0.1:8080 STALWART_USER=admin STALWART_PASSWORD=testpw123456
$C -k snapshot --quiet --allow-unresolved Tenant,Certificate,Directory,DnsServer AcmeProvider NetworkListener > $T/snap3.ndjson 2>&1
$C -k query Task 2>&1 | head -6
$C -k query Certificate 2>&1 | head -4
kill %1

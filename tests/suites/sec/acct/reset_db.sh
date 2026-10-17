#!/bin/bash
# reset_db.sh <dbname> – fresh DB with the Supabase stub + all migrations (each in one transaction, like the CI workflow)
set -euo pipefail
DB=${1:-fale_acct}
SP=$(dirname "$0")
P="env PGOPTIONS=-cclient_min_messages=warning psql -h /tmp/faleacct -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB with (force)" >/dev/null
$P -d postgres -c "create database $DB" >/dev/null
$P -d $DB -f $SP/supabase_stub.sql >/dev/null
for f in $(ls /home/claude/FalePDF/supabase/migrations/*.sql | sort); do
  $P -d $DB --single-transaction -f "$f" >/dev/null || { echo "FAILED: $f"; exit 1; }
done
# server secret for the secret-gated RPCs (tests use this value)
$P -d $DB -c "insert into private.fale_secrets(name, secret_sha256) values ('rpc', encode(extensions.digest('test-rpc-secret-0123456789abcdefghijklmnop', 'sha256'), 'hex')) on conflict (name) do update set secret_sha256 = excluded.secret_sha256" >/dev/null
echo "db $DB ready"

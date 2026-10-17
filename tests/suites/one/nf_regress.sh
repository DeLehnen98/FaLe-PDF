#!/bin/bash
# Runs the existing FaLe One / account / share suites on the Notfallzugang port range (8930–8939) with own DBs.
S=/home/claude/FalePDF/tests/suites
cd $S/one
sed -e 's/const PORT = 8914;/const PORT = 8932;/' test_one_api.mjs > _nfr_one_api.mjs
sed -e 's/const PORT = 8912;/const PORT = 8930;/' -e 's/S3_PORT = 8916/S3_PORT = 8936/' test_one_s3.mjs > _nfr_one_s3.mjs
cd $S/acct
sed -e 's/const PORT = 8814;/const PORT = 8932;/' test_account_api.mjs > _nfr_account_api.mjs
run() { local name=$1; shift; local out; out=$("$@" 2>&1 | tail -3 | tr '\n' ' '); echo "$name: $out"; }
cd $S/one
run one_crypto node --no-warnings test_one_crypto.mjs
run one_unit node --no-warnings test_one_unit.mjs
run nf_crypto node --no-warnings test_nf_crypto.mjs
PGDB=fale_nfr_api run one_api timeout 600 node --no-warnings _nfr_one_api.mjs
PGDB=fale_nfr_s3 run one_s3 timeout 600 node --no-warnings _nfr_one_s3.mjs
run nf_api timeout 600 node --no-warnings test_nf_api.mjs
cd $S/acct
PGDB=fale_nfr_acct run account_api timeout 600 node --no-warnings _nfr_account_api.mjs
PGDB=fale_nfr_sql run account_sql timeout 600 node --no-warnings test_sql.mjs
cd $S
run share_api timeout 600 node --no-warnings test_share_api.mjs

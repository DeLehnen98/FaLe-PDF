#!/bin/bash
# runs all browser suites sequentially under the CSP servers; summary in rerun.summary
cd "$(dirname "$0")"
: > rerun.summary
for t in test_share test_full test_protools test_pdfplus test_extras; do
  start=$(date +%s)
  timeout 1500 python3 $t.py > logs2_$t.log 2>&1
  rc=$?
  res=$(grep -E "^[0-9]+/[0-9]+ passed|passed, [0-9]+ failed|^[0-9]+ passed" logs2_$t.log | tail -1)
  echo "$t rc=$rc $(( $(date +%s) - start ))s $res" >> rerun.summary
done
echo DONE >> rerun.summary

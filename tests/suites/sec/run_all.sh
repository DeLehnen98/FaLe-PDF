#!/bin/bash
# runs all browser suites sequentially under the CSP servers; summary in runall.summary
cd "$(dirname "$0")"
: > runall.summary
for t in test_xss test_full test_office test_extras test_protools test_pdfplus test_ocr test_ai test_share test_account; do
  start=$(date +%s)
  timeout 1500 python3 $t.py > logs_$t.log 2>&1
  rc=$?
  res=$(grep -E "^[0-9]+/[0-9]+ passed|passed, [0-9]+ failed|^[0-9]+ passed" logs_$t.log | tail -1)
  echo "$t rc=$rc $(( $(date +%s) - start ))s $res" >> runall.summary
done
echo DONE >> runall.summary

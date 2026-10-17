#!/bin/bash
cd "$(dirname "$0")"
export FULL_URL=http://localhost:8890/ EXTRAS_URL=http://127.0.0.1:8890/ SEC_URL=http://127.0.0.1:8890/ NATIVE_URL=http://127.0.0.1:8890/ PPLUS_PORT=8891 PT_PORT=8892
: > mine.summary
for t in ${@:-test_native test_full test_extras test_protools test_pdfplus test_xss}; do
  start=$(date +%s)
  timeout 1800 python3 $t.py > mine_$t.log 2>&1
  rc=$?
  res=$(grep -E "^[0-9]+/[0-9]+ passed|passed, [0-9]+ failed|^[0-9]+ passed" mine_$t.log | tail -1)
  echo "$t rc=$rc $(( $(date +%s) - start ))s $res" >> mine.summary
done
echo DONE >> mine.summary

#!/bin/bash
# office3 regression: existing browser suites under the CSP servers (ports as in sec/run_all.sh); summary in reg.summary
O=/home/claude/FalePDF/tests/suites/office3
cd /home/claude/FalePDF/tests/suites/sec
: > $O/reg.summary
for t in test_xss test_full test_office test_extras test_protools test_pdfplus test_ai; do
  start=$(date +%s)
  timeout 1500 python3 $t.py > $O/reg_$t.log 2>&1
  rc=$?
  res=$(grep -E "^[0-9]+/[0-9]+ passed|passed, [0-9]+ failed|^[0-9]+ passed" $O/reg_$t.log | tail -1)
  echo "$t rc=$rc $(( $(date +%s) - start ))s $res" >> $O/reg.summary
done
cd /home/claude/FalePDF/tests/suites
start=$(date +%s); OFFICE_URL=http://127.0.0.1:8850/ timeout 1500 python3 office2/test_office2.py > $O/reg_office2_all.log 2>&1; echo "office2 all rc=$? $(( $(date +%s) - start ))s $(grep -E 'passed' $O/reg_office2_all.log | tail -1)" >> $O/reg.summary
echo DONE >> $O/reg.summary

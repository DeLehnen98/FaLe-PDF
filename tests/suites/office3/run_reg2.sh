#!/bin/bash
O=/home/claude/FalePDF/tests/suites/office3
cd /home/claude/FalePDF/tests/suites/sec
: > $O/reg2.summary
for t in test_full test_extras test_protools test_pdfplus; do
  start=$(date +%s)
  timeout 1500 python3 $t.py > $O/reg2_$t.log 2>&1
  rc=$?
  res=$(grep -aE "^[0-9]+/[0-9]+ passed|passed, [0-9]+ failed|^[0-9]+ passed" $O/reg2_$t.log | tail -1)
  echo "$t rc=$rc $(( $(date +%s) - start ))s $res" >> $O/reg2.summary
done
cd $O
start=$(date +%s); timeout 900 python3 test_office3_ui.py > $O/reg2_ui.log 2>&1; echo "office3 ui rc=$? $(( $(date +%s) - start ))s $(grep -a 'passed ·' $O/reg2_ui.log | tail -1)" >> $O/reg2.summary
echo DONE >> $O/reg2.summary

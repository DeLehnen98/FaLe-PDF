#!/bin/bash
S=/home/claude/FalePDF/tests/suites
O=$S/office4
: > $O/reg.summary
run() { local name=$1; shift; local start=$(date +%s); timeout 1500 "$@" > $O/reg_$name.log 2>&1; local rc=$?; echo "$name rc=$rc $(( $(date +%s) - start ))s $(grep -aE 'passed|PASS.*FAIL|failed' $O/reg_$name.log | tail -1)" >> $O/reg.summary; }
cd $S/office4 && run office4 python3 test_office4.py
cd $S/office2 && run formula node test_formula.mjs
cd $S/office2 && OFFICE_URL=http://127.0.0.1:8880/ run office2 python3 test_office2.py
cd $S/sec && OFFICE_URL=http://127.0.0.1:8880/ run sec_office python3 test_office.py
cd $S/office3 && OFFICE_URL=http://127.0.0.1:8880/ run office3_ui python3 test_office3_ui.py
cd $S/sec && EXTRAS_URL=http://127.0.0.1:8880/ run sec_extras python3 test_extras.py
cd $S/sec && SEC_URL=http://127.0.0.1:8880/ run sec_xss python3 test_xss.py
echo DONE >> $O/reg.summary

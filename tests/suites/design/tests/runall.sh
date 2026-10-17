#!/bin/bash
cd "$(dirname "$0")"
for t in test_full test_office test_extras test_protools test_pdfplus; do
  echo "=== $t $(date +%T)" ; timeout 2400 python3 $t.py > log_$t.txt 2>&1; echo "exit $?"; tail -5 log_$t.txt
done

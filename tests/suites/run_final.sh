#!/bin/bash
cd "$(dirname "$0")"
timeout 2400 python3 test_i18n.py all > run_all.log 2>&1
cd de_suites && timeout 1500 python3 test_full.py > r_full.log 2>&1

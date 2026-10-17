#!/bin/bash
cd "$(dirname "$0")"
timeout 1800 python3 test_i18n.py phone > run_phone.log 2>&1
timeout 600 python3 test_i18n.py switch > run_switch.log 2>&1

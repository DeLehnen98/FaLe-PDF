#!/bin/bash
# syntax-check ES modules
cd /home/claude/FalePDF
fail=0
for f in js/*.js js/office/*.js js/extras/*.js; do
  cp "$f" /home/claude/FalePDF/tests/base/chk/x.mjs
  out=$(node --check /home/claude/FalePDF/tests/base/chk/x.mjs 2>&1) || { echo "== $f"; echo "$out" | head -6; fail=1; }
done
[ $fail = 0 ] && echo "all ok"

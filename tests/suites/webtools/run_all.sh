#!/usr/bin/env bash
# FaLe Werkzeuge – full test run. Starts the Vercel-like server on :8710 (the offline test uses its own
# server on :8711 and stops it), runs every test_*.py and prints a summary. Exit code 1 on any failure.
#   ./run_all.sh               all suites
#   ./run_all.sh merge hub     only test_merge.py and test_hub.py
set -u
cd "$(dirname "$0")"
[ -d fixtures ] && [ -f fixtures/photos.pdf ] || { python3 make_fixtures.py && node make_fixtures.mjs && (cd fixtures &&
  qpdf --encrypt geheim geheim 256 -- text3.pdf encrypted_aes256.pdf &&
  qpdf --allow-weak-crypto --encrypt geheim owner 128 --use-aes=n -- text5.pdf encrypted_rc4.pdf &&
  qpdf --encrypt "" owner 256 --print=none -- text3.pdf restricted.pdf); }
[ -d fixtures/org ] || python3 org_make_fixtures.py
ls fixtures/conv_* >/dev/null 2>&1 || python3 conv_make_fixtures.py
ls fixtures/edit_* >/dev/null 2>&1 || python3 edit_make_fixtures.py
[ -f fixtures/sec_form_enc.pdf ] || { node sec_fixtures.mjs && (cd fixtures && qpdf --encrypt geheim geheim 256 -- sec_form.pdf sec_form_enc.pdf); }
[ -d fixtures/img ] || python3 img_make_fixtures.py
[ -f fixtures/uni_v1.pdf ] || node uni_fixtures.mjs; [ -f fixtures/uni_doc.docx ] || python3 uni_make_fixtures.py
[ -f fixtures/aud1/photo_a85.pdf ] || python3 aud1_make_fixtures.py small
[ -f fixtures/new_note_side.jpg ] || python3 new_make_fixtures.py
[ -f fixtures/aud2/hard_form.pdf ] || python3 aud2_make_fixtures.py
[ -f fixtures/bg/bg_mug.jpg ] || python3 bg_make_fixtures.py
[ -f fixtures/einv/zugferd.pdf ] || node einv_make_fixtures.mjs
# hand-made inputs without a generator (synthetic, committed in fixtures_static/)
cp -r --update=none fixtures_static/. fixtures/
rm -rf out && mkdir -p out shots
node server.mjs 8710 > out/server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in $(seq 1 50); do curl -s -o /dev/null http://127.0.0.1:8710/werkzeuge/ && break; sleep 0.1; done
if [ $# -gt 0 ]; then TESTS=$(for n in "$@"; do echo "test_$n.py"; done); else TESTS=$(ls test_*.py); fi
pass=0; fail=0; failed=""
if [ $# -eq 0 ]; then
  if node img_meta_unit.mjs > out/img_units.log 2>&1 && node img_qr_unit.mjs >> out/img_units.log 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed img_units"; fi
fi
for t in $TESTS; do
  if timeout 900 python3 "$t" > "out/${t%.py}.log" 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed $t"; fi
  head -c 4000 "out/${t%.py}.log"
done
echo "== $pass passed, $fail failed${failed:+:$failed}"
[ $fail -eq 0 ]

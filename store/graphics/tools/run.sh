#!/usr/bin/env bash
# Regenerate all store graphics from the real app (see ../README.md).
# Needs: Node (build), Python 3 with playwright + Pillow + numpy + opencv + reportlab + openpyxl + python-docx + python-pptx,
# and a Chromium for Playwright. Usage: store/graphics/tools/run.sh   (from the repository root)
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PYTHONDONTWRITEBYTECODE=1
WORK="${FALE_SHOTS_WORK:-/tmp/fale-store-shots}"; export FALE_SHOTS_WORK="$WORK"
PORT="${FALE_SHOTS_PORT:-8802}"; export FALE_SHOTS_URL="http://127.0.0.1:$PORT/"
T=store/graphics/tools

node scripts/vercel-build.mjs
rm -rf "$WORK/site" "$WORK/raw"; mkdir -p "$WORK"; cp -r dist "$WORK/site"
# the web build puts the start page at / and the app at /app/ (a Vercel rewrite) – the captures need the app at /
cp "$WORK/site/app/index.html" "$WORK/site/index.html"
python3 "$T/gen_demo.py" "$WORK/site/demo"           # fictional demo files (DE + EN) + fake camera stream
(cd "$WORK/site" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER=$!; trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
cd "$T"
for l in de en; do
  python3 capture.py $l phone home sign scan ocr ai sheet letters reminders privacy
  python3 capture.py $l tab7 home sign ai
  python3 capture.py $l tab10 home viewer doc
  python3 capture.py $l desktop home files viewer doc sheet
done
MORE="fr es it pt nl pl tr uk ru zh ja ko hi id"
for l in $MORE; do python3 capture.py $l phone home sign scan ocr sheet reminders privacy; done
python3 compose.py phone,tab7,tab10 de,en
python3 compose.py phone "$(echo $MORE | tr ' ' ',')"
python3 brand.py
python3 desktop.py   # Microsoft Store desktop screenshots + manifest screenshots (after compose.py: uses phone/de)

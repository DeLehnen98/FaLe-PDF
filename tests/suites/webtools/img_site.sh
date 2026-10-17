#!/usr/bin/env bash
# Sandbox build for the image tools (agent img): copies network/ into img-site/, keeps only the
# reference specs + the img specs (other agents' half-finished specs can't break the build), builds the
# pages there and (re)starts the Vercel-like server on :8760 with that root.
set -e
cd "$(dirname "$0")"
SITE=$PWD/img-site
mkdir -p "$SITE"
rm -rf "$SITE/network"; cp -a /home/claude/FalePDF/network "$SITE/network"
KEEP="merge-pdf compress-pdf jpg-to-pdf compress-image resize-image convert-image png-to-jpg jpg-to-png webp-to-jpg heic-to-jpg remove-exif scan-to-pdf passport-photo qr-code cancellation-letter"
for f in "$SITE"/network/tools/webtools/specs/*.json; do
  id=$(basename "$f" .json); case " $KEEP " in *" $id "*) ;; *) rm "$f";; esac
done
python3 - "$SITE/network/tools/webtools/specs" <<'PY'
import json, sys, pathlib
d = pathlib.Path(sys.argv[1]); ids = {f.stem for f in d.glob('*.json')}
for f in d.glob('*.json'):
    sp = json.loads(f.read_text())
    for k in ('related', 'next'): sp[k] = [x for x in sp.get(k, []) if x in ids]
    f.write_text(json.dumps(sp, ensure_ascii=False, indent=2))
PY
python3 "$SITE/network/tools/build_pages.py" >/dev/null
python3 "$SITE/network/tools/webtools/build.py" 2>&1 | grep -v "^network/\|bytes$" | tail -5
if [ -f img-server.pid ]; then kill "$(cat img-server.pid)" 2>/dev/null || true; fi
node server.mjs 8760 "$SITE/network" > out/img-server.log 2>&1 &
echo $! > img-server.pid
for i in $(seq 1 50); do curl -s -o /dev/null http://127.0.0.1:8760/werkzeuge/ && break; sleep 0.1; done
echo "img site ready on :8760"

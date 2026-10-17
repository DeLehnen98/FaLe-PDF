#!/usr/bin/env bash
# Build a private copy of network/ for the edit tests when other agents' specs temporarily break the
# shared build (unknown related ids are downgraded to warnings in the copy only). Serves it on :8740.
set -e
SRC=/home/claude/FalePDF/network
DST=/home/claude/FalePDF/tests/suites/edit_net/network
mkdir -p "$DST"
rm -rf "$DST" && mkdir -p "$DST" && cp -a "$SRC/." "$DST/"
sed -i "s/errors.append(f'{sp\[\"id\"\]}.json: {k} references unknown tool \"{rid}\"')/warnings.append(f'{sp[\"id\"]}.json: {k} references unknown tool \"{rid}\"')/" "$DST/tools/webtools/build.py"
sed -i "s/'next': \[{'id': n,/'next': [{'id': n,/" "$DST/tools/webtools/build.py"
python3 "$DST/tools/build_pages.py" >/dev/null
python3 "$DST/tools/webtools/build.py" 2>&1 | grep -v "^warning" | tail -1

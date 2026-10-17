#!/bin/sh
# Copy the live source tree into a private test copy (other agents edit in parallel); fix raw U+2028/U+2029 in JS of the copy only.
M=/home/claude/FalePDF/tests/suites/office2
python3 - <<'PY'
import os, shutil
SRC='/home/claude/FalePDF'; DST='/home/claude/FalePDF/tests/suites/office2/site'
skip={'node_modules','.git','android','dist','supabase','api'}
seen=set()
for root, dirs, files in os.walk(SRC):
    dirs[:] = [d for d in dirs if d not in skip]
    rel = os.path.relpath(root, SRC)
    os.makedirs(os.path.join(DST, rel), exist_ok=True)
    for f in files:
        s = os.path.join(root, f); d = os.path.join(DST, rel, f)
        seen.add(os.path.normpath(d))
        if not os.path.exists(d) or os.path.getmtime(s) > os.path.getmtime(d) or os.path.getsize(s) != os.path.getsize(d):
            shutil.copy2(s, d)
            if f.endswith('.js'):
                t = open(d, encoding='utf-8').read()
                if '\u2028' in t or '\u2029' in t:
                    open(d, 'w', encoding='utf-8').write(t.replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')); print('fixed', os.path.join(rel, f))
for root, dirs, files in os.walk(DST):
    for f in files:
        p = os.path.normpath(os.path.join(root, f))
        if p not in seen: os.remove(p)
PY

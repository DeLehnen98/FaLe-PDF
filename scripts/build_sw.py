"""Regenerate the precache list in sw.js and bump its version.

Run after changing any app file:  python3 scripts/build_sw.py
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"scripts", ".git", "node_modules"}
SKIP_FILES = {"sw.js", "README.md"}

files = []
h = hashlib.sha256()
for p in sorted(ROOT.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(ROOT).as_posix()
    if rel.split("/")[0] in SKIP_DIRS or rel in SKIP_FILES or p.name.startswith("."):
        continue
    files.append("./" + rel)
    h.update(rel.encode())
    h.update(p.read_bytes())

files.insert(0, "./")
sw = ROOT / "sw.js"
src = sw.read_text(encoding="utf-8")
block = "const ASSETS = " + json.dumps(files, indent=2, ensure_ascii=False) + ";"
src = re.sub(r"(// ASSETS-START[^\n]*\n).*?(\n// ASSETS-END)", lambda m: m.group(1) + block + m.group(2), src, flags=re.S)
src = re.sub(r"const VERSION = '[^']*';", f"const VERSION = 'v1.0.0-{h.hexdigest()[:10]}';", src)
sw.write_text(src, encoding="utf-8")
total = sum((ROOT / f[2:]).stat().st_size for f in files[1:])
print(f"{len(files)} assets, {total / 1e6:.1f} MB, version {h.hexdigest()[:10]}")

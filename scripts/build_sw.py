"""Regenerate the precache list in sw.js and bump its version.

Run after changing any app file:  python3 scripts/build_sw.py
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# same exclusions as scripts/vercel-build.mjs: server code, migrations, docs and native/build folders are not
# served as static files – listing them made cache.addAll() fail (404) and the service worker never installed
SKIP_DIRS = {"scripts", ".git", "node_modules", "api", "supabase", "network", "docs", "store", "android", "ios", "ios-native", "dist", "tests", "e2e-out", "ios-e2e-out", "site", "mail",
             "screenshots", "one-android", "one"}  # manifest screenshots: only for the browser's install dialog, never needed offline
SKIP_FILES = {"sw.js", "README.md", "SECURITY.md", "package.json", "package-lock.json", "vercel.json", "capacitor.config.json"}

files = []
h = hashlib.sha256()
for p in sorted(ROOT.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(ROOT).as_posix()
    if rel.split("/")[0] in SKIP_DIRS or rel in SKIP_FILES or any(part.startswith(".") for part in rel.split("/")):
        continue
    if rel.startswith("vendor/tesseract/") or rel == "vendor/MANIFEST.json":  # OCR is cached on first use
        continue
    # UI dictionaries: only the device's language is loaded – cached on first use (same rule as vercel-build.mjs)
    if re.fullmatch(r"js/i18n/[a-z]{2}\.js", rel) and rel != "js/i18n/en.js":
        h.update(rel.encode()); h.update(p.read_bytes())  # still part of the version: a changed dictionary must reach the cache
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

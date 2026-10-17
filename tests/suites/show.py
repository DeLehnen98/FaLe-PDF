import json, sys, subprocess
d = json.loads(subprocess.run(['node','/home/claude/FalePDF/scripts/i18n-extract.mjs','--json'],capture_output=True,text=True).stdout)
files = sys.argv[1:]
seen=set()
for m in d['missing']:
    if any(m['file'].endswith(f) or (f.endswith('/') and m['file'].startswith(f)) for f in files):
        if m['key'] in seen: continue
        seen.add(m['key'])
        print(m['key'])
print('#count', len(seen), file=sys.stderr)

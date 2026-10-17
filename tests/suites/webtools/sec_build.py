"""Lenient local build for testing while other agents' specs are mid-edit: copies all specs to a temp dir,
drops related/next references to tools that don't exist (in the copy only) and runs build.py against it."""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path
ROOT = Path('/home/claude/FalePDF')
subprocess.run([sys.executable, str(ROOT / 'network/tools/build_pages.py')], check=True, stdout=subprocess.DEVNULL)
src = ROOT / 'network/tools/webtools/specs'
tmp = Path(tempfile.mkdtemp(prefix='secspecs'))
specs = {}
for p in src.glob('*.json'):
    try:
        specs[p.name] = json.loads(p.read_text())
    except Exception as e:
        print('skip unreadable', p.name, e)
ids = {sp.get('id') for sp in specs.values()}
for name, sp in specs.items():
    for k in ('related', 'next'):
        sp[k] = [r for r in sp.get(k, []) if r in ids]
    (tmp / name).write_text(json.dumps(sp, ensure_ascii=False))
code = f"import sys; sys.dont_write_bytecode = True; sys.argv=['build.py']; sys.path.insert(0, {str(ROOT / 'network/tools/webtools')!r}); import runpy, pathlib; g = runpy.run_path({str(ROOT / 'network/tools/webtools/build.py')!r}, run_name='not_main'); g['SPECS'] = pathlib.Path({str(tmp)!r}); "
# build.py reads SPECS as a module global; re-run main with the patched global
code += "import types; f = g['main']; f.__globals__['SPECS'] = pathlib.Path(%r); f()" % str(tmp)
r = subprocess.run([sys.executable, "-B", "-c", code], capture_output=True, text=True)
print((r.stdout + r.stderr)[-600:])
shutil.rmtree(tmp)

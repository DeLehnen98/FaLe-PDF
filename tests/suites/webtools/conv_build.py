"""Build the tool pages like build.py, but tolerate related/next references to tools that other agents
have not added yet (they are dropped for this build only). Used by agent `conv` while specs are in flux."""
import json, sys, importlib.util
sys.dont_write_bytecode = True
from pathlib import Path
B = Path('/home/claude/FalePDF/network/tools/webtools/build.py')
sys.path.insert(0, str(B.parent)); sys.path.insert(0, str(B.parent.parent))
spec = importlib.util.spec_from_file_location('wtbuild', B)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
orig_loads = json.loads
ids = set()
for f in m.SPECS.glob('*.json'):
    try: ids.add(orig_loads(f.read_text(encoding='utf-8')).get('id'))
    except Exception: pass
def loads(s, *a, **k):
    d = orig_loads(s, *a, **k)
    if isinstance(d, dict) and 'id' in d and 'de' in d:
        for key in ('related', 'next'):
            if key in d: d[key] = [r for r in d[key] if r in ids]
    return d
m.json.loads = loads
m.main()

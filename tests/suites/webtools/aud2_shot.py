import os, sys; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite
path, name = sys.argv[1], sys.argv[2]
w, h = (int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '390x844').split('x'))
files = sys.argv[4:]
with Suite('aud2-shot') as s:
    page = s.open(s.context('phone', 'de' if '/werkzeuge/' in path else 'en', viewport={'width': w, 'height': h}), path)
    if files: s.pick(page, *files); s.wait_ready(page, len(files))
    page.wait_for_timeout(1000)
    page.screenshot(path=f'out/{name}.png')

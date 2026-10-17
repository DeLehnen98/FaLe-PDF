import sys
from wtlib import Suite
with Suite('conv-dbg') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, sys.argv[1])
    page.on('console', lambda m: print('CONSOLE', m.type, m.text[:500]))
    s.pick(page, *sys.argv[2].split(','))
    s.wait_ready(page, len(sys.argv[2].split(',')))
    s.run(page)

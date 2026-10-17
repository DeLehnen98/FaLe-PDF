import os, subprocess; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite
with Suite('aud2-protect') as s:
    page = s.open(s.context('phone', 'de'), '/werkzeuge/pdf-mit-passwort-schuetzen/')
    s.pick(page, 'sec_private.pdf'); s.wait_ready(page, 1)
    for e in page.locator('input[type=password]:visible').all(): e.fill('Sommer-2026!')
    o = s.run_and_download(page)
    b = o.read_bytes()
    for sec in (b'Mustermann', b'Druckertreiber', b'Falke', b'erika', b'Kontonummer'): print(sec, sec in b)
    print(subprocess.run(['qpdf', '--show-encryption', '--password=Sommer-2026!', str(o)], capture_output=True, text=True).stdout[:300])

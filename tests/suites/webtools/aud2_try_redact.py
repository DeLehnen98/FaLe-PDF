import os, subprocess; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite, OUT
with Suite('aud2-try-redact') as s:
    page = s.open(s.context('desktop', 'de'), '/werkzeuge/pdf-schwaerzen/')
    s.pick(page, 'aud2/redact_traps.pdf'); s.wait_ready(page, 1); page.wait_for_selector('.sec-page canvas')
    page.fill('#sec-red-term', 'Geheimnis'); page.press('#sec-red-term', 'Enter')
    page.locator('.sec-chip', has_text='E-Mail-Adressen').click()
    page.wait_for_timeout(1500)
    print([t for t in page.locator('.sec-hit').all_inner_texts()])
    out = s.run_and_download(page)
    q = OUT / 'aud2_red_q.pdf'
    subprocess.run(['qpdf', '--qdf', '--object-streams=disable', str(out), str(q)])
    b = q.read_bytes()
    for sec in (b'Geheimnis', b'geheimnis', b'Erika'): print(sec, sec in b)

"""aud1: every organize/convert tool works offline after ONE visit – including the parts that are only
imported when the tool runs (lazy libs, ZIP download). Own server on :8781, stopped after the warm-up."""
import os
os.environ['WT_PORT'] = '8781'
from wtlib import Suite

A = 'aud1/'
TOOLS = [  # path, files, setup (python on `page`), zip?
    ('/werkzeuge/pdf-zusammenfuegen/', ['text3.pdf', 'landscape.jpg'], None),
    ('/werkzeuge/pdf-komprimieren/', ['text3.pdf', 'photos.pdf'], 'zip'),
    ('/werkzeuge/bild-in-pdf/', ['landscape.jpg', 'alpha.png'], None),
    ('/werkzeuge/pdf-teilen/', ['text5.pdf'], "page.locator('#wt-opt-ranges').fill('1-2, 3-5')|zip"),
    ('/werkzeuge/pdf-seiten-loeschen/', ['text5.pdf'], "page.locator('#wt-opt-pages').fill('2')"),
    ('/werkzeuge/pdf-seiten-extrahieren/', ['text5.pdf'], "page.locator('#wt-opt-pages').fill('1, 3')"),
    ('/werkzeuge/pdf-seiten-sortieren/', ['text5.pdf'], None),
    ('/werkzeuge/pdf-drehen/', ['text5.pdf'], "page.locator('.pg-btn').first.click()"),
    ('/werkzeuge/leere-seiten-entfernen/', [A + 'scanned.pdf'], None),
    ('/werkzeuge/pdf-seiten-mischen/', ['text3.pdf', 'text5.pdf'], None),
    ('/werkzeuge/doppelseiten-teilen/', [A + 'mixed_rot.pdf'], None),
    ('/werkzeuge/pdf-reparieren/', ['text3.pdf'], None),
    ('/werkzeuge/pdf-graustufen/', ['real/huawei-cover-picture.pdf', 'photos.pdf'], 'zip'),
    ('/werkzeuge/pdf-in-jpg/', ['text3.pdf'], 'zip'),
    ('/werkzeuge/pdf-in-png/', ['text3.pdf'], 'zip'),
    ('/werkzeuge/bilder-aus-pdf-extrahieren/', [A + 'scanned.pdf'], 'zip'),
    ('/werkzeuge/pdf-in-text/', [A + 'rich.pdf'], None),
    ('/werkzeuge/pdf-in-markdown/', [A + 'rich.pdf'], None),
    ('/werkzeuge/pdf-in-word/', [A + 'rich.pdf'], None),
    ('/werkzeuge/pdf-in-excel/', ['conv_tables.pdf'], None),
    ('/werkzeuge/pdf-in-powerpoint/', ['text3.pdf'], None),
    ('/werkzeuge/word-in-pdf/', ['conv_doc.docx', A + 'office/math_real.docx'], 'zip'),
    ('/werkzeuge/excel-in-pdf/', ['conv_sheet.xlsx'], None),
    ('/werkzeuge/powerpoint-in-pdf/', ['conv_slides.pptx'], None),
    ('/werkzeuge/text-in-pdf/', ['conv_text.txt', 'conv_text.md'], 'zip'),
]

with Suite('aud1-offline-all') as s:
    assert s.proc, 'needs its own server (port 8781 must be free)'
    ctx = s.context('phone', 'de')
    for path, _, _ in TOOLS:
        page = s.open(ctx, path)
        page.wait_for_function("() => document.documentElement.dataset.wtOffline === 'ready'", timeout=90000)
        page.close()
    s.proc.kill(); s.proc.wait(); s.proc = None
    ctx.set_offline(True)
    for path, files, setup in TOOLS:
        page = s.open(ctx, path)
        s.pick(page, *files)
        s.wait_ready(page, len(files), timeout=60000)
        page.wait_for_timeout(500)
        actions = (setup or '').split('|')
        for a in actions:
            if a and a != 'zip':
                eval(a)
                page.wait_for_timeout(300)
        if s.run(page, timeout=120000):
            s.download(page, 0)
            if 'zip' in actions:
                try:
                    p = s.download_click(page, page.locator('.wt-result-actions button').first)
                    s.expect(p.suffix == '.zip' and p.stat().st_size > 100, f'{path}: offline ZIP {p.name}')
                except Exception as e:
                    s.fails.append(f'{path}: ZIP download offline failed: {str(e)[:120]}')
        page.close()
    # a password-protected PDF offline (the decryption module is loaded lazily)
    page = s.open(ctx, '/werkzeuge/pdf-komprimieren/')
    s.pick(page, 'encrypted_aes256.pdf')
    s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    s.wait_ready(page, 1)
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')", timeout=20000)
    if s.run(page):
        s.download(page, 0)
    page.close()
    # requests that failed offline show up as console errors / page errors (Suite fails on those)
    ctx.set_offline(False)

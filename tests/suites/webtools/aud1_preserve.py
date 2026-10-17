"""aud1: what survives each structural tool? links, bookmarks, form fields, attachments, metadata, layers.
Input: fixtures/aud1/rich.pdf (3 pages: 2 URI links + 1 internal link + mailto, 5 bookmarks, 2 fields, 1 attachment,
Title "Vertrag Müller"). usage: python3 aud1_preserve.py [tool ...]  (prints a table; no pass/fail)"""
import os, sys
os.environ.setdefault('WT_PORT', '8780')
from pypdf import PdfReader
from wtlib import Suite

A = 'aud1/'


def inspect(path):
    r = PdfReader(str(path))
    links = sum(1 for p in r.pages for a in (p.get('/Annots') or []) if a.get_object().get('/Subtype') == '/Link')
    def count(o):
        return sum(1 + (count(x) if isinstance(x, list) else 0) for x in o if not isinstance(x, list)) + sum(count(x) for x in o if isinstance(x, list)) - sum(1 for x in o if isinstance(x, list)) * 0
    def flat(o):
        n = 0
        for x in o:
            n += flat(x) if isinstance(x, list) else 1
        return n
    try: outl = flat(r.outline)
    except Exception: outl = -1
    fields = len(r.get_fields() or {})
    try: att = len(r.attachments)
    except Exception: att = -1
    title = (r.metadata or {}).get('/Title')
    ocg = '/OCProperties' in r.trailer['/Root']
    return dict(pages=len(r.pages), links=links, outline=outl, fields=fields, attach=att, title=title, ocg=ocg)


CASES = [
    ('merge-pdf', '/werkzeuge/pdf-zusammenfuegen/', [A + 'rich.pdf', 'text3.pdf'], None),
    ('compress-pdf', '/werkzeuge/pdf-komprimieren/', [A + 'rich.pdf'], "page.locator('input[name=\"wt-opt-level\"][value=\"lossless\"]').check()"),
    ('compress-pdf', '/werkzeuge/pdf-komprimieren/', [A + 'rich.pdf'], None),
    ('split-pdf', '/werkzeuge/pdf-teilen/', [A + 'rich.pdf'], "page.locator('#wt-opt-ranges').fill('1-2, 3')"),
    ('delete-pages', '/werkzeuge/pdf-seiten-loeschen/', [A + 'rich.pdf'], "page.locator('#wt-opt-pages').fill('2')"),
    ('extract-pages', '/werkzeuge/pdf-seiten-extrahieren/', [A + 'rich.pdf'], "page.locator('#wt-opt-pages').fill('1, 3')"),
    ('organize-pdf', '/werkzeuge/pdf-seiten-sortieren/', [A + 'rich.pdf'], None),
    ('rotate-pdf', '/werkzeuge/pdf-drehen/', [A + 'rich.pdf'], "page.locator('.pg-btn').first.click()"),
    ('alternate-mix', '/werkzeuge/pdf-seiten-mischen/', [A + 'rich.pdf', 'text3.pdf'], None),
    ('repair-pdf', '/werkzeuge/pdf-reparieren/', [A + 'rich.pdf'], None),
    ('grayscale-pdf', '/werkzeuge/pdf-graustufen/', [A + 'rich.pdf'], None),
    ('merge-pdf', '/werkzeuge/pdf-zusammenfuegen/', [A + 'layers.pdf', 'text3.pdf'], None),
    ('compress-pdf', '/werkzeuge/pdf-komprimieren/', [A + 'layers.pdf'], None),
    ('alternate-mix', '/werkzeuge/pdf-seiten-mischen/', [A + 'layers.pdf', 'text3.pdf'], None),
    ('extract-pages', '/werkzeuge/pdf-seiten-extrahieren/', [A + 'layers.pdf'], "page.locator('#wt-opt-pages').fill('1')"),
]
sel = sys.argv[1:]
print('input rich:', inspect(Suite.__init__ and (__import__('wtlib').FIX / 'aud1/rich.pdf')))
print('input layers:', inspect(__import__('wtlib').FIX / 'aud1/layers.pdf'))
with Suite('aud1-preserve') as s:
    ctx = s.context('desktop', 'de')
    for tool, path, files, setup in CASES:
        if sel and tool not in sel:
            continue
        page = s.open(ctx, path)
        s.pick(page, *files)
        s.wait_ready(page, len(files))
        page.wait_for_timeout(800)
        if setup:
            eval(setup)
            page.wait_for_timeout(400)
        if not s.run(page):
            print(tool, 'FAILED'); page.close(); continue
        n = page.locator('.wt-output').count()
        for i in range(min(n, 2)):
            p = s.download(page, i)
            print(f'{tool:18} {p.name[:40]:40} {inspect(p)}')
        page.close()
    s.fails = [f for f in s.fails if 'tool error' not in f]

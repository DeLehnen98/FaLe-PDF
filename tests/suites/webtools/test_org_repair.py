"""repair-pdf: bad xref offsets, missing trailer, truncated file (pdf.js can't open it), broken page tree,
damaged object headers – each result opens cleanly (qpdf, pdftotext) and the report is honest."""
from wtlib import Suite
from org_testlib import page_texts, all_outputs, shots, dark_shot

PATHS = {'de': '/werkzeuge/pdf-reparieren/', 'en': '/en/tools/repair-pdf/'}
CASES = {  # fixture: (min pages, lossless claim allowed)
    'org_badxref.pdf': (12, True),
    'org_notrailer.pdf': (12, True),
    'org_badtree.pdf': (12, True),
    'org_badobj.pdf': (12, None),
    'org_trunc.pdf': (8, False),
}

with Suite('repair-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'repair', 'initial', top=None)
        s.pick(page, 'org/org_badxref.pdf')
        s.wait_ready(page, 1)
        shots(s, page, v, 'repair', 'configured')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
            t = page_texts(out)
            s.expect(len(t) == 12 and t[11].startswith('Seite 12'), f'{v}: pages {len(t)}')
            note = page.locator('.wt-out-note').inner_text()
            s.expect(('verlustfrei' in note) if v.lang == 'de' else ('lossless' in note), f'{v}: report {note!r}')
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'repair_result', top='.wt-result')
                dark_shot(s, page, 'repair')
        s.check_page(page)
        page.close()

    # all damage kinds at once (batch)
    page = s.open(s.context('desktop', 'de'), PATHS['de'])
    s.pick(page, *[f'org/{f}' for f in CASES])
    s.wait_ready(page, len(CASES))
    s.expect(page.locator('.wt-file.is-error').count() == 0, 'damaged PDFs must be accepted by the repair tool')
    if s.run(page, timeout=240000):
        outs = all_outputs(s, page)
        notes = page.locator('.wt-out-note').all_inner_texts()
        names = page.locator('.wt-output .wt-file-name').all_inner_texts()
        for name, note in zip(names, notes):
            src = name.replace(' (repariert)', '')
            mn, lossless = CASES[src]
            o = next(x for x in outs if x.name == name)
            ok, msg = s.qpdf_check(o)
            s.expect(ok, f'{src}: qpdf {msg}')
            t = page_texts(o)
            s.expect(len(t) >= mn and t[0].startswith('Seite 1'), f'{src}: {len(t)} pages, first {t[:1]}')
            if lossless is True:
                s.expect('verlustfrei' in note, f'{src}: should be lossless: {note}')
            if lossless is False:
                s.expect('verlustfrei' not in note and 'verloren' in note, f'{src}: must not claim lossless: {note}')
    s.check_page(page)
    page.close()

    # not a PDF at all → clear message instead of an empty result
    page = s.open(s.context('phone', 'en'), PATHS['en'])
    s.pick(page, 'broken.pdf')
    page.wait_for_timeout(1500)
    from org_testlib import error_text
    s.wait_ready(page, 1)
    s.primary(page).click()
    s.expect('too badly damaged' in error_text(page), 'nothing to rescue → clear message')
    page.close()

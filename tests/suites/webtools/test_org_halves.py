"""split-halves: book scan with off-centre gutter, cover kept, /Rotate 90 and 270 pages, rtl, top|bottom, preview."""
from wtlib import Suite
from org_testlib import toggle, page_texts, shots, dark_shot, error_text

PATHS = {'de': '/werkzeuge/doppelseiten-teilen/', 'en': '/en/tools/split-pdf-pages-in-half/'}


def first_words(path):
    return [' '.join(x.split()[:2]) for x in page_texts(path)]


with Suite('split-halves') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'halves', 'initial', top=None)
        s.pick(page, 'org/org_book.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.sh-line', timeout=20000)
        cap = page.locator('.sh-nav .pg-status').inner_text()
        import re as _re
        pct = int(_re.search(r'(\d+) %', cap).group(1)) if _re.search(r'(\d+) %', cap) else 0
        s.expect(40 <= pct <= 50 and pct != 50, f'{v}: preview should find the off-centre gutter (≈45 %): {cap!r}')
        shots(s, page, v, 'halves', 'configured', top='.sh-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            w = first_words(out)
            s.expect(w == ['Umschlag', 'Buchseite 2', 'Buchseite 3', 'Buchseite 4', 'Buchseite 5', 'Rueckseite'], f'{v}: pages {w}')
            # each half contains only its own page's text (cut in the gutter, not through text)
            tx = page_texts(out)
            s.expect('Buchseite 3' not in tx[1] and 'Buchseite 2' not in tx[2], f'{v}: halves separated')
            ok, msg = s.qpdf_check(out); s.expect(ok, msg)
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'halves_result', top='.wt-result')
                dark_shot(s, page, 'halves')
        s.check_page(page)
        page.close()

    # rotated spreads (/Rotate 90 and 270) + right-to-left
    page = s.open(s.context('desktop', 'en'), PATHS['en'])
    s.pick(page, 'org/org_book_rot.pdf'); s.wait_ready(page, 1)
    page.wait_for_selector('.sh-line', timeout=20000)
    out = s.run_and_download(page)
    if out:
        w = first_words(out)
        s.expect(w == ['Gedreht1 Links', 'Gedreht1 Rechts', 'Gedreht2 Links', 'Gedreht2 Rechts'], f'rotated spreads: {w}')
    page.locator('.wt-restart button').first.click()
    toggle(page, 'rtl', True)
    out = s.run_and_download(page)
    if out:
        w = first_words(out)
        s.expect(w == ['Gedreht1 Rechts', 'Gedreht1 Links', 'Gedreht2 Rechts', 'Gedreht2 Links'], f'rtl: {w}')
    s.check_page(page)
    page.close()

    # top | bottom on portrait pages, middle without auto; landscape-only file → explanation
    page = s.open(s.context('phone', 'de'), PATHS['de'])
    s.pick(page, 'text3.pdf'); s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-direction"][value="horizontal"]').check()
    toggle(page, 'auto', False)
    out = s.run_and_download(page)
    if out:
        sz = s.page_sizes(out)
        s.expect(len(sz) == 6 and abs(sz[0][1] - 841.89 / 2) < 1, f'top|bottom halves: {sz[:2]}')
        s.expect(page_texts(out)[0].startswith('Text Seite 1') or 'Seite 1' in page_texts(out)[0], 'top half has the title')
    page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-direction"][value="vertical"]').check()
    s.primary(page).click()
    s.expect('Keine Seite passt' in error_text(page), 'portrait file + left|right → explanation')
    s.check_page(page)
    page.close()

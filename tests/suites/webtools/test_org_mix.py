"""alternate-mix: two files (reverse backs), one file with both halves, three files, chunk, uneven stacks."""
from wtlib import Suite
from org_testlib import toggle, page_texts, wait_grid, shots, dark_shot

PATHS = {'de': '/werkzeuge/pdf-seiten-mischen/', 'en': '/en/tools/alternate-mix-pdf/'}
GOOD = ['Vorderseite 1', 'Rueckseite 1', 'Vorderseite 2', 'Rueckseite 2', 'Vorderseite 3', 'Rueckseite 3']


def labels(page):
    return page.evaluate("() => [...document.querySelectorAll('.pg-card .pg-badge')].map(b => b.textContent)")


with Suite('alternate-mix') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'mix', 'initial', top=None)
        s.pick(page, 'org/org_fronts.pdf', 'org/org_backs.pdf')
        s.wait_ready(page, 2)
        wait_grid(page, 6)
        exp = ['V1', 'R1', 'V2', 'R2', 'V3', 'R3'] if v.lang == 'de' else ['F1', 'B1', 'F2', 'B2', 'F3', 'B3']
        s.expect(labels(page) == exp, f'{v}: preview labels {labels(page)}')
        shots(s, page, v, 'mix', 'configured', top='.pg-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            s.expect(page_texts(out) == GOOD, f'{v}: order {page_texts(out)}')
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'mix_result', top='.wt-result')
                dark_shot(s, page, 'mix')
        s.check_page(page)
        page.close()

    # one file: fronts then reversed backs
    page = s.open(s.context('phone', 'en'), PATHS['en'])
    s.pick(page, 'org/org_duplex.pdf'); s.wait_ready(page, 1); wait_grid(page, 6)
    out = s.run_and_download(page)
    if out:
        s.expect(page_texts(out) == GOOD, f'one-file duplex: {page_texts(out)}')
    # reverse off → backs in their stored order
    page.locator('.wt-restart button').first.click()
    toggle(page, 'reverse', False)
    out = s.run_and_download(page)
    if out:
        s.expect(page_texts(out)[1] == 'Rueckseite 3', f'reverse off: {page_texts(out)}')
    s.check_page(page)
    page.close()

    # three files, two pages per turn, uneven lengths (3/3/2) → note + rest at the end
    page = s.open(s.context('desktop', 'de'), PATHS['de'])
    s.pick(page, 'org/org_fronts.pdf', 'org/org_backs.pdf', 'org/org_c.pdf'); s.wait_ready(page, 3); wait_grid(page, 8)
    toggle(page, 'reverse', False)
    page.locator('#wt-opt-chunk').fill('2')
    page.wait_for_timeout(300)
    s.expect(page.locator('.pg-status.is-warn').is_visible(), 'uneven stacks warning')
    out = s.run_and_download(page)
    if out:
        t = page_texts(out)
        s.expect(t == ['Vorderseite 1', 'Vorderseite 2', 'Rueckseite 3', 'Rueckseite 2', 'Drittens 1', 'Drittens 2', 'Vorderseite 3', 'Rueckseite 1'], f'3 files chunk 2: {t}')
    s.check_page(page)
    page.close()

"""remove-blank-pages: detection (blank, scanner noise, dust, page number at the edge) vs content (short line,
scan with text), manual override, threshold slider, result."""
from wtlib import Suite
from org_testlib import page_texts, wait_grid, tap, info, shots, dark_shot, error_text, dismiss_error

PATHS = {'de': '/werkzeuge/leere-seiten-entfernen/', 'en': '/en/tools/remove-blank-pages/'}
# fixture kinds: content, blank, content, noise, pagenum, content, blank, content-scan, shortline, dust
DETECT = [2, 4, 5, 7, 10]


def marked(page):
    return page.evaluate("() => [...document.querySelectorAll('.pg-card')].map((c, i) => c.classList.contains('is-sel') ? i + 1 : 0).filter(Boolean)")


def wait_scan(page):
    page.wait_for_function("() => document.querySelectorAll('.pg-card').length === 10 && ![...document.querySelectorAll('.pg-sub')].some(x => x.textContent === '…') && document.querySelector('.pg-meter')?.hidden", timeout=60000)


with Suite('remove-blank-pages') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'blank', 'initial', top=None)
        s.pick(page, 'org/org_blank.pdf')
        s.wait_ready(page, 1)
        wait_grid(page, 10)
        wait_scan(page)
        s.expect(marked(page) == DETECT, f'{v}: detected {marked(page)} != {DETECT}')
        s.expect(info(page).startswith('5 '), f'{v}: info {info(page)!r}')
        # keep page 5 (page number) by tapping it
        tap(page, v, page.locator('.pg-hit').nth(4))
        s.expect(marked(page) == [2, 4, 7, 10], f'{v}: manual override {marked(page)}')
        shots(s, page, v, 'blank', 'configured', top='.pg-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            tx = page_texts(out)
            s.expect(len(tx) == 6, f'{v}: 6 pages left, got {len(tx)}')
            s.expect(tx[0].startswith('Inhalt 1') and tx[1].startswith('Inhalt 2') and tx[2].strip() == '5' and 'Notiz' in tx[5], f'{v}: kept pages {tx}')
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'blank_result', top='.wt-result')
                dark_shot(s, page, 'blank')
        s.check_page(page)
        page.close()

    # threshold: higher → the short line counts as blank too; "Auto" restores; none → explanation
    page = s.open(s.context('desktop', 'en'), PATHS['en'])
    s.pick(page, 'org/org_blank.pdf'); s.wait_ready(page, 1); wait_grid(page, 10); wait_scan(page)
    page.locator('#wt-opt-threshold').fill('0.2')
    page.locator('#wt-opt-threshold').dispatch_event('change')
    page.wait_for_timeout(200)
    s.expect(marked(page) == [2, 4, 5, 7, 9, 10], f'threshold 0.2 also marks the short line: {marked(page)}')
    page.locator('.pg-btn[data-id="none"]').click()
    s.expect(marked(page) == [], 'none')
    s.primary(page).click()
    s.expect('No page is marked' in error_text(page), 'nothing marked → explanation')
    dismiss_error(page)
    page.locator('.pg-btn[data-id="auto"]').click()
    s.expect(marked(page) == [2, 4, 5, 7, 9, 10], f'auto restores: {marked(page)}')
    s.check_page(page)
    page.close()

    # a document without blank pages
    page = s.open(s.context('phone', 'de'), PATHS['de'])
    s.pick(page, 'text5.pdf'); s.wait_ready(page, 1); wait_grid(page, 5)
    page.wait_for_function("() => document.querySelector('.pg-meter')?.hidden", timeout=30000)
    s.expect('Keine leeren Seiten' in info(page), f'no blank pages: {info(page)!r}')
    page.close()

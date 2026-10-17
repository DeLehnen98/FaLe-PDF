"""rotate-pdf: per-page button, selection rotation, orientation filters, lossless /Rotate change."""
from wtlib import Suite
from org_testlib import page_texts, rotations, wait_grid, wait_thumbs, tap, info, shots, dark_shot, error_text, dismiss_error

PATHS = {'de': '/werkzeuge/pdf-drehen/', 'en': '/en/tools/rotate-pdf/'}
ORIG = [0, 0, 0, 0, 0, 0, 90, 0, 0, 0, 0, 0]

with Suite('rotate-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'rotate', 'initial', top=None)
        s.pick(page, 'org/org_mixed.pdf')
        s.wait_ready(page, 1)
        wait_grid(page, 12)
        wait_thumbs(page, 3)
        tap(page, v, page.locator('.pg-tool').nth(0))           # page 1 → 90
        tap(page, v, page.locator('.pg-tool').nth(1))           # page 2 → 90
        tap(page, v, page.locator('.pg-tool').nth(1))           # page 2 → 180
        s.expect(page.locator('.pg-card').nth(1).locator('.pg-sub').inner_text() == '180°', f'{v}: caption shows 180°')
        # landscape pages (3 and 8 are landscape, 7 is shown landscape via /Rotate; page 1 is landscape now)
        lbl = 'Alle Querformat-Seiten auswählen' if v.lang == 'de' else 'Select all landscape pages'
        page.wait_for_function("() => true")
        page.wait_for_timeout(600)  # page sizes load in the background
        tap(page, v, page.locator(f'.pg-btn[aria-label="{lbl}"]'))
        sel = page.evaluate("() => [...document.querySelectorAll('.pg-card')].map((c, i) => c.classList.contains('is-sel') ? i + 1 : 0).filter(Boolean)")
        s.expect(sel == [1, 3, 7, 8], f'{v}: landscape selection {sel}')
        right = 'Rotate 90° left' if v.lang == 'en' else '90° nach links drehen'
        tap(page, v, page.locator(f'.pg-btn[aria-label="{right}"]'))  # −90 for 1, 3, 7, 8
        shots(s, page, v, 'rotate', 'configured', top='.pg-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            r = rotations(out)
            exp = ORIG[:]
            exp[0] = 0; exp[1] = 180; exp[2] = 270; exp[6] = 0; exp[7] = 270
            s.expect(r == exp, f'{v}: rotations {r} != {exp}')
            s.expect(page_texts(out)[1].startswith('Seite 2'), f'{v}: text kept')
            ok, msg = s.qpdf_check(out); s.expect(ok, msg)
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'rotate_result', top='.wt-result')
                dark_shot(s, page, 'rotate')
        s.check_page(page)
        page.close()

    # nothing rotated → hint; all pages with the toolbar; keyboard R on a focused page
    page = s.open(s.context('desktop', 'en'), PATHS['en'])
    s.pick(page, 'text3.pdf'); s.wait_ready(page, 1); wait_grid(page, 3)
    s.primary(page).click()
    s.expect('Rotate at least one page' in error_text(page), 'no-op must explain')
    dismiss_error(page)
    page.locator('.pg-btn[aria-label="Rotate 180°"]').click()
    page.locator('.pg-hit').nth(2).focus()
    page.keyboard.press('r')
    out = s.run_and_download(page)
    if out:
        s.expect(rotations(out) == [180, 180, 270], f'all 180 + keyboard: {rotations(out)}')
    s.check_page(page)
    page.close()

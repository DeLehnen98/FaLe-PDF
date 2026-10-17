"""split-pdf: tap cuts ↔ ranges text, every N, single, bookmarks (names), size limit, odd/even, ZIP, password."""
from wtlib import Suite
from org_testlib import page_texts, wait_grid, wait_thumbs, tap, info, shots, dark_shot, all_outputs, error_text, dismiss_error

PATHS = {'de': '/werkzeuge/pdf-teilen/', 'en': '/en/tools/split-pdf/'}


def mode(page, m):
    page.locator(f'input[name="wt-opt-mode"][value="{m}"]').check()


def again(page):
    page.locator('.wt-restart button').first.click()


with Suite('split-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'split', 'initial', top=None)
        s.pick(page, 'org/org_mixed.pdf')
        s.wait_ready(page, 1)
        wait_grid(page, 12)
        wait_thumbs(page, 3)
        # cut after page 3 by tapping the page, after page 8 with the scissors
        tap(page, v, page.locator('.pg-hit').nth(2))
        tap(page, v, page.locator('.pg-cut').nth(7))
        field = page.locator('#wt-opt-ranges')
        s.expect(field.input_value() == '1-3, 4-8, 9-12', f'{v}: ranges {field.input_value()!r}')
        s.expect(page.locator('.pg-card.is-cut').count() == 2, f'{v}: two cuts shown')
        s.expect(info(page).startswith('3 '), f'{v}: info {info(page)!r}')
        # remove the second cut again
        tap(page, v, page.locator('.pg-hit').nth(7))
        s.expect(field.input_value() == '1-3, 4-12', f'{v}: uncut {field.input_value()!r}')
        tap(page, v, page.locator('.pg-hit').nth(7))
        shots(s, page, v, 'split', 'configured', top='.pg-stage')
        s.check_page(page)
        if s.run(page):
            outs = all_outputs(s, page)
            s.expect([len(page_texts(o)) for o in outs] == [3, 5, 4], f'{v}: part sizes {[o.name for o in outs]}')
            s.expect(page_texts(outs[1])[0].startswith('Seite 4'), f'{v}: part 2 starts with page 4')
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'split_result', top='.wt-result')
                dark_shot(s, page, 'split')
        s.check_page(page)
        if v.device == 'desktop':
            # typed ranges → grid follows
            again(page)
            field.fill('1-2, 3 5, 6-')
            page.wait_for_timeout(200)
            s.expect(page.locator('.pg-card.pg-gstart').count() == 3, f'{v}: 3 parts tinted')
            if s.run(page):
                outs = all_outputs(s, page)
                s.expect([len(page_texts(o)) for o in outs] == [2, 2, 7], f'{v}: typed parts')
                s.expect([x.split()[1] for x in page_texts(outs[1])] == ['3', '5'], f'{v}: scattered pages in one part')
            # bookmarks: names from titles
            again(page); mode(page, 'bookmarks')
            page.wait_for_timeout(300)
            s.expect(page.locator('.pg-card.is-cut').count() == 2, f'{v}: bookmark cuts shown in the grid')
            if s.run(page):
                outs = all_outputs(s, page)
                names = [o.name for o in outs]
                s.expect(names == ['1 Kapitel Eins.pdf', '2 Kapitel Zwei.pdf', '3 Anhang Tabellen Daten.pdf'] or len(names) == 3 and names[0].startswith('1 Kapitel'), f'{v}: bookmark names {names}')
                s.expect([len(page_texts(o)) for o in outs] == [4, 5, 3], f'{v}: bookmark part sizes')
            # odd / even
            again(page); mode(page, 'oddeven')
            if s.run(page):
                outs = all_outputs(s, page)
                s.expect(len(outs) == 2 and [x.split()[1] for x in page_texts(outs[1])] == ['2', '4', '6', '8', '10', '12'], f'{v}: even file')
        page.close()

    # every N + single on a long file; size limit
    page = s.open(s.context('desktop', 'de'), PATHS['de'])
    s.pick(page, 'org/org_150.pdf'); s.wait_ready(page, 1); wait_grid(page, 150)
    mode(page, 'every'); page.locator('#wt-opt-every').fill('40')
    page.wait_for_timeout(200)
    s.expect(info(page).startswith('4 Dateien'), f'every 40 → 4 files: {info(page)!r}')
    if s.run(page):
        outs = all_outputs(s, page)
        s.expect([len(page_texts(o)) for o in outs] == [40, 40, 40, 30], 'every 40 sizes')
    again(page); mode(page, 'single')
    if s.run(page, timeout=180000):
        s.expect(page.locator('.wt-output').count() == 150, 'single pages: 150 outputs')
        s.expect('Seite 150' in page.locator('.wt-output').last.inner_text(), 'last single page name')
    page.close()

    page = s.open(s.context('phone', 'de'), PATHS['de'])
    s.pick(page, 'photos.pdf'); s.wait_ready(page, 1); wait_grid(page, 3)
    mode(page, 'size'); page.locator('#wt-opt-maxMb').fill('2.5')
    if s.run(page, timeout=180000):
        outs = all_outputs(s, page)
        sizes = [o.stat().st_size for o in outs]
        s.expect(sum(len(page_texts(o)) for o in outs) == 3 and len(outs) >= 2, f'size split parts {sizes}')
        over = [x for x in sizes if x > 2.5 * 1024 * 1024]
        notes = page.locator('.wt-note').all_inner_texts()
        s.expect(not over or any('größer' in n for n in notes), f'files above the limit need a note: {sizes} {notes}')
    s.check_page(page)
    page.close()

    # no cut → explanation; password-protected input keeps password
    page = s.open(s.context('phone', 'en'), PATHS['en'])
    s.pick(page, 'encrypted_aes256.pdf'); s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    wait_grid(page, 3)
    s.primary(page).click()
    s.expect('Set at least one cut' in error_text(page), 'no cut must explain')
    dismiss_error(page)
    page.locator('.pg-hit').nth(0).tap()
    if s.run(page):
        outs = all_outputs(s, page)
        s.expect(len(outs) == 2 and all(s.pdf_info(o)['_rc'] != 0 for o in outs), 'parts are password protected')
        s.expect(len(page_texts(outs[1], 'geheim')) == 2, 'second part has 2 pages')
    page.close()

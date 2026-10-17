"""organize-pdf: long-press drag (touch) / mouse drag, keyboard move, rotate, duplicate, delete, undo/redo,
blank page with neighbour size, insert another PDF at the selection, reverse, zoom, 300+ pages."""
from wtlib import Suite
from org_testlib import page_texts, rotations, wait_grid, wait_thumbs, tap, info, shots, dark_shot, long_press_drag, mouse_drag

PATHS = {'de': '/werkzeuge/pdf-seiten-sortieren/', 'en': '/en/tools/organize-pdf/'}
L = {
    'de': dict(dup='Auswahl duplizieren', dele='Auswahl löschen', undo='Rückgängig', redo='Wiederholen', rotr='Auswahl nach rechts drehen', blank='Leere Seite einfügen (nach der Auswahl)', none='Auswahl aufheben', rev='Reihenfolge umkehren', ins='Seiten aus einer anderen PDF einfügen', zin='Größere Vorschau', fwd='Auswahl nach vorne verschieben'),
    'en': dict(dup='Duplicate selection', dele='Delete selection', undo='Undo', redo='Redo', rotr='Rotate selection right', blank='Insert a blank page (after the selection)', none='Clear selection', rev='Reverse order', ins='Insert pages from another PDF', zin='Larger thumbnails', fwd='Move selection forward'),
}


def nums(page):
    return page.evaluate("() => [...document.querySelectorAll('.pg-card')].map(c => c.querySelector('.pg-hit').getAttribute('aria-label'))")


def btn(page, label):
    return page.locator(f'.pg-btn[aria-label="{label}"]')


with Suite('organize-pdf') as s:
    for v in s.variants():
        t = L[v.lang]
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'organize', 'initial', top=None)
        s.pick(page, 'text5.pdf')
        s.wait_ready(page, 1)
        wait_grid(page, 5)
        wait_thumbs(page, 5)
        cards = page.locator('.pg-card .pg-hit')
        # drag page 1 behind page 3
        target = page.locator('.pg-card').nth(2).bounding_box()
        dst = (target['x'] + target['width'] * 0.85, target['y'] + target['height'] * 0.4)
        if v.device == 'phone':
            long_press_drag(page, cards.nth(0), dst)
        else:
            mouse_drag(page, cards.nth(0), dst)
        order = page.evaluate("() => [...document.querySelectorAll('.pg-card .pg-sub')].map(x => x.textContent)")
        s.expect(order[2] in ('S. 1', 'p. 1'), f'{v}: page 1 should now be third: {order}')
        s.expect(page.locator('.pg-card.is-sel').count() == 0, f'{v}: a drag must not toggle the selection')
        # select (tap) page at position 1 (orig. page 2), rotate, duplicate
        tap(page, v, cards.nth(0))
        tap(page, v, btn(page, t['rotr']))
        tap(page, v, btn(page, t['dup']))
        s.expect(page.locator('.pg-card').count() == 6, f'{v}: duplicate adds a page')
        # blank page after the selection (the duplicate is selected now)
        tap(page, v, btn(page, t['blank']))
        s.expect(page.locator('.pg-card').count() == 7, f'{v}: blank page inserted')
        # delete the blank page, undo, redo, undo
        tap(page, v, btn(page, t['dele']))
        s.expect(page.locator('.pg-card').count() == 6, f'{v}: deleted')
        tap(page, v, btn(page, t['undo']))
        s.expect(page.locator('.pg-card').count() == 7, f'{v}: undo brings it back')
        tap(page, v, btn(page, t['redo']))
        tap(page, v, btn(page, t['undo']))
        s.expect(page.locator('.pg-card').count() == 7, f'{v}: undo again')
        tap(page, v, btn(page, t['zin']))
        shots(s, page, v, 'organize', 'configured', top='.pg-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            tx = page_texts(out)
            first = [x.split()[2] if len(x.split()) > 2 else '' for x in tx]
            # order: 2(rot) 2(rot, copy) blank 3 1 4 5
            s.expect(first == ['2', '2', '', '3', '1', '4', '5'], f'{v}: result order {first}')
            r = rotations(out)
            s.expect(r[:3] == [90, 90, 0] and r[3:] == [0, 0, 0, 0], f'{v}: rotations {r}')
            sz = s.page_sizes(out)
            s.expect(abs(sz[2][0] - 841.89) < 1 and abs(sz[2][1] - 595.28) < 1, f'{v}: blank page takes the (rotated) neighbour size {sz[2]}')
            ok, msg = s.qpdf_check(out); s.expect(ok, msg)
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'organize_result', top='.wt-result')
                dark_shot(s, page, 'organize')
        s.check_page(page)
        page.close()

    # keyboard: move with Ctrl+Arrow, delete with Delete, undo with Ctrl+Z
    page = s.open(s.context('desktop', 'en'), PATHS['en'])
    s.pick(page, 'text3.pdf'); s.wait_ready(page, 1); wait_grid(page, 3)
    page.locator('.pg-card .pg-hit').first.focus()
    page.keyboard.press('Control+ArrowRight')
    page.keyboard.press('Control+ArrowRight')
    order = page.evaluate("() => [...document.querySelectorAll('.pg-card .pg-sub')].map(x => x.textContent)")
    s.expect(order[2] == 'p. 1', f'keyboard move: {order}')
    page.keyboard.press('Delete')
    page.wait_for_timeout(150)
    s.expect(page.locator('.pg-card').count() == 2, 'Delete key removes the focused page')
    page.keyboard.press('Control+z')
    s.expect(page.locator('.pg-card').count() == 3, 'Ctrl+Z undoes')
    # insert another PDF after the selected first page
    page.locator('.pg-card .pg-hit').first.click()
    with page.expect_file_chooser() as fc:
        btn(page, L['en']['ins']).click()
    from wtlib import FIX
    fc.value.set_files(str(FIX / 'org' / 'org_c.pdf'))
    wait_grid(page, 5)
    page.wait_for_timeout(300)
    out = s.run_and_download(page)
    if out:
        tx = [' '.join(x.split()[:2]) for x in page_texts(out)]
        s.expect(tx == ['Text Seite', 'Drittens 1', 'Drittens 2', 'Text Seite', 'Text Seite'] or tx[1:3] == ['Drittens 1', 'Drittens 2'], f'inserted after selection: {tx}')
    page.locator('.wt-restart button').first.click()
    page.locator('.pg-btn[data-id="none"]').click()
    page.locator('.pg-btn[data-id="rev"]').click()
    out = s.run_and_download(page)
    if out:
        tx = page_texts(out)
        s.expect(tx[0].startswith('Text Seite 1') or 'Seite 1' in tx[0], f'reversed: {tx[:2]}')
    s.check_page(page)
    page.close()

    # 300+ pages: lazy thumbnails, drag with auto-scroll inside the grid
    page = s.open(s.context('phone', 'de'), PATHS['de'])
    s.pick(page, 'org/org_150.pdf', 'org/org_150.pdf', 'org/org_mixed.pdf')
    s.wait_ready(page, 3); wait_grid(page, 312)
    page.wait_for_timeout(1500)
    s.expect(page.locator('.pg-page.has-img').count() < 80, f'lazy thumbnails: {page.locator(".pg-page.has-img").count()}')
    s.expect(page.locator('.pg-card').nth(160).locator('.pg-sub').inner_text().startswith('B'), 'pages of the second file carry tag B')
    sc = page.locator('.pg-scroll').bounding_box()
    long_press_drag(page, page.locator('.pg-card .pg-hit').nth(0), (sc['x'] + sc['width'] / 2, sc['y'] + sc['height'] - 8), hold=520, steps=6)
    s.check_page(page)
    page.close()

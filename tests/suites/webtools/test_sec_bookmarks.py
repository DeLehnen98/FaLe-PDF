"""edit-bookmarks (+ merge-pdf keeps the files' own bookmarks): headings → nested bookmarks, rename (Unicode), one-per-page + undo, add for the shown page,
outdent, real /Outlines with correct pages + PageMode, existing outline loaded and removable; DE/EN × phone/desktop."""
import os
from wtlib import Suite, FIX
import pypdf

PATHS = {'de': '/werkzeuge/pdf-lesezeichen-bearbeiten/', 'en': '/en/tools/edit-pdf-bookmarks/'}

def make_fixtures():
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    heads = [('1 Einleitung', 24), ('1.1 Hintergrund', 16), ('2 Methoden', 24), ('2.1 Daten', 16)]
    p = str(FIX / 'bm_headings.pdf')
    c = canvas.Canvas(p, pagesize=A4)
    for title, size in heads:
        c.setFont('Helvetica-Bold', size); c.drawString(72, 760, title)
        c.setFont('Helvetica', 11)
        for k in range(22):
            c.drawString(72, 720 - k * 16, f'Dies ist ein ganz normaler Absatz mit Text in der Zeile {k + 1}, damit die Seite gefüllt ist.')
        c.showPage()
    c.save()
    w = pypdf.PdfWriter(clone_from=p)
    a = w.add_outline_item('Alt A', 0)
    w.add_outline_item('Alt B', 1, parent=a)
    with open(FIX / 'bm_outline.pdf', 'wb') as f:
        w.write(f)

def outline(path):
    r = pypdf.PdfReader(str(path))
    out = []
    def walk(items, level):
        for it in items:
            if isinstance(it, list): walk(it, level + 1)
            else: out.append((it.title, r.get_destination_page_number(it) + 1, level))
    walk(r.outline, 0)
    return out, r.trailer['/Root'].get('/PageMode')

def rows(page):
    return page.locator('.bm-row')

def row_by_title(page, title):
    n = rows(page).count()
    for i in range(n):
        if rows(page).nth(i).locator('.bm-title').input_value() == title:
            return rows(page).nth(i)
    return None

if not (FIX / 'bm_outline.pdf').exists():
    make_fixtures()

with Suite('sec-bookmarks') as s:
    for v in s.variants():
        de = v.lang == 'de'
        shots = v.device == 'phone' and de
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'bm_headings.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.bm-add canvas')
        s.expect(rows(page).count() == 0, f'{v}: no bookmarks at first')
        page.locator('[data-headings]').click()
        page.wait_for_function("() => /erkannt|found/.test(document.querySelector('.sec-status')?.textContent || '')", timeout=30000)
        titles = [rows(page).nth(i).locator('.bm-title').input_value() for i in range(rows(page).count())]
        levels = [rows(page).nth(i).get_attribute('data-level') for i in range(rows(page).count())]
        s.expect(titles == ['1 Einleitung', '1.1 Hintergrund', '2 Methoden', '2.1 Daten'] and levels == ['0', '1', '0', '1'], f'{v}: headings → nested list {titles} {levels}')
        if shots: s.shot(page, 'edit-bookmarks_phone_headings', top='.bm-list')
        # one per page + undo
        page.locator('[data-perpage]').click()
        s.expect(rows(page).count() == 4 and rows(page).nth(0).locator('.bm-title').input_value() == ('Seite 1' if de else 'Page 1'), f'{v}: one per page')
        page.locator('[data-undo]').click()
        s.expect(rows(page).nth(1).locator('.bm-title').input_value() == '1.1 Hintergrund', f'{v}: undo restores the list')
        # rename, add on page 3, outdent "2.1 Daten"
        rows(page).nth(0).locator('.bm-title').fill('Einführung & Überblick')
        page.locator('.bm-add .sec-nav-btn').nth(1).click(); page.locator('.bm-add .sec-nav-btn').nth(1).click()
        page.fill('#bm-new-title', 'Anhang Ä')
        page.locator('[data-add]').click()
        s.expect(rows(page).count() == 5 and rows(page).nth(3).locator('.bm-title').input_value() == 'Anhang Ä' and rows(page).nth(3).locator('.bm-pageno').input_value() == '3', f'{v}: added for the shown page')
        d = row_by_title(page, '2.1 Daten')
        s.expect(d is not None and d.get_attribute('data-level') == '1', f'{v}: Daten nested under Anhang')
        d.locator('.bm-out').click()
        s.expect(row_by_title(page, '2.1 Daten').get_attribute('data-level') == '0', f'{v}: outdent')
        if shots: s.shot(page, 'edit-bookmarks_phone_edited', top='.bm-list')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            ol, mode = outline(out)
            s.expect(ol == [('Einführung & Überblick', 1, 0), ('1.1 Hintergrund', 2, 1), ('2 Methoden', 3, 0), ('Anhang Ä', 3, 0), ('2.1 Daten', 4, 0)], f'{v}: written outline {ol}')
            s.expect(mode == '/UseOutlines', f'{v}: bookmarks panel opens ({mode})')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
            if shots: s.shot(page, 'edit-bookmarks_phone_result', top='.wt-result')
        page.close()

    # existing outline: loaded with levels, move + delete, remove all → no outline, panel option off
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'bm_outline.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.bm-row >> nth=1')
    s.expect([rows(page).nth(i).locator('.bm-title').input_value() for i in range(2)] == ['Alt A', 'Alt B'] and rows(page).nth(1).get_attribute('data-level') == '1', 'existing outline loaded with levels')
    rows(page).nth(1).locator('.bm-pageno').fill('1'); rows(page).nth(1).locator('.bm-pageno').dispatch_event('change')
    out = s.run_and_download(page)
    if out:
        ol, _ = outline(out)
        s.expect(ol == [('Alt A', 1, 0), ('Alt B', 1, 1)], f'page changed: {ol}')
        page.locator('.wt-restart button').first.click()
    page.close()
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'bm_outline.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.bm-row >> nth=1')
    page.locator('[data-clear]').click()
    s.expect(rows(page).count() == 0, 'remove all')
    page.locator('.wt-opt-toggle label.wt-switch').click()
    out = s.run_and_download(page)
    if out:
        ol, mode = outline(out)
        s.expect(ol == [] and mode in (None, '/UseNone') and 'entfernt' in page.locator('.wt-result').inner_text(), f'outline removed: {ol} {mode}')
    s.check_page(page)

    # merge-pdf: the files' own bookmarks survive, re-targeted, under the file names; pages left out drop theirs
    page = s.open(ctx, '/werkzeuge/pdf-zusammenfuegen/')
    s.pick(page, 'bm_outline.pdf', 'bm_headings.pdf')
    s.wait_ready(page, 2)
    out = s.run_and_download(page)
    if out:
        ol, _ = outline(out)
        s.expect(ol == [('bm_outline', 1, 0), ('Alt A', 1, 1), ('Alt B', 2, 2), ('bm_headings', 5, 0)], f'merge keeps bookmarks: {ol}')
        page.locator('.wt-restart button').first.click()
    page.close()
    page = s.open(ctx, '/werkzeuge/pdf-zusammenfuegen/')
    s.pick(page, 'bm_outline.pdf', 'bm_headings.pdf')
    s.wait_ready(page, 2)
    page.locator('select').filter(has=page.locator('option[value="keep"]')).select_option('keep')
    out = s.run_and_download(page)
    if out:
        ol, _ = outline(out)
        s.expect(ol == [('Alt A', 1, 0), ('Alt B', 2, 1)], f'merge "keep only existing": {ol}')
    s.check_page(page)

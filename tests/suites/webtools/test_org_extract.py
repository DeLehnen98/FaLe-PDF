"""extract-pages: tap to select, own order via text, one PDF vs one per page (ZIP)."""
from wtlib import Suite
from org_testlib import page_texts, wait_grid, wait_thumbs, tap, info, shots, dark_shot, all_outputs

PATHS = {'de': '/werkzeuge/pdf-seiten-extrahieren/', 'en': '/en/tools/extract-pdf-pages/'}

with Suite('extract-pages') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'extract', 'initial', top=None)
        s.pick(page, 'org/org_mixed.pdf')
        s.wait_ready(page, 1)
        wait_grid(page, 12)
        wait_thumbs(page, 2)
        cards = page.locator('.pg-hit')
        tap(page, v, cards.nth(2))
        tap(page, v, cards.nth(6))
        s.expect(page.locator('#wt-opt-pages').input_value() == '3, 7', f'{v}: field {page.locator("#wt-opt-pages").input_value()!r}')
        s.expect(info(page).startswith('2 '), f'{v}: info {info(page)!r}')
        shots(s, page, v, 'extract', 'configured', top='.pg-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            t = page_texts(out)
            s.expect(len(t) == 2 and t[0].startswith('Seite 3') and t[1].startswith('Seite 7'), f'{v}: one PDF {t}')
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'extract_result', top='.wt-result')
                dark_shot(s, page, 'extract')
        s.check_page(page)
        page.close()

    # own order + one file per page
    page = s.open(s.context('phone', 'en'), PATHS['en'])
    s.pick(page, 'org/org_mixed.pdf'); s.wait_ready(page, 1); wait_grid(page, 12)
    page.locator('#wt-opt-pages').fill('5, 1-2')
    page.wait_for_function("() => document.querySelectorAll('.pg-card.is-sel').length === 3")
    out = s.run_and_download(page)
    if out:
        t = page_texts(out)
        s.expect([x.split()[1] for x in t] == ['5', '1', '2'], f'custom order {t}')
    page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-output"][value="each"]').check()
    if s.run(page):
        outs = all_outputs(s, page)
        s.expect(len(outs) == 3, f'one per page: {len(outs)} files')
        s.expect(sorted(o.name for o in outs) == ['org_mixed – page 01.pdf', 'org_mixed – page 02.pdf', 'org_mixed – page 05.pdf'], f'names {[o.name for o in outs]}')
        s.expect(all(len(page_texts(o)) == 1 for o in outs), 'each file has one page')
    s.check_page(page)
    page.close()

    # form field keeps working when extracted alone
    page = s.open(s.context('desktop', 'de'), PATHS['de'])
    s.pick(page, 'form.pdf'); s.wait_ready(page, 1); wait_grid(page, 1)
    page.locator('.pg-hit').first.click()
    page.locator('input[name="wt-opt-output"][value="each"]').check()
    out = s.run_and_download(page)
    if out:
        from pypdf import PdfReader
        f = PdfReader(str(out)).get_fields() or {}
        s.expect('Name' in f, f'form field kept: {list(f)}')
    page.close()

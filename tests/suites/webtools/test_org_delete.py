"""delete-pages: tap marks, ranges sync, remaining count, pages really removed (bookmarks, content), password kept."""
import subprocess
from wtlib import Suite, OUT
from org_testlib import page_texts, wait_grid, wait_thumbs, tap, info, shots, dark_shot, error_text, dismiss_error

PATHS = {'de': '/werkzeuge/pdf-seiten-loeschen/', 'en': '/en/tools/delete-pdf-pages/'}

with Suite('delete-pages') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'delete', 'initial', top=None)
        s.pick(page, 'org/org_mixed.pdf')
        s.wait_ready(page, 1)
        wait_grid(page, 12)
        wait_thumbs(page, 3)
        cards = page.locator('.pg-hit')
        tap(page, v, cards.nth(1))
        tap(page, v, cards.nth(4))
        field = page.locator('#wt-opt-pages')
        s.expect(field.input_value() == '2, 5', f'{v}: ranges field should follow taps, got {field.input_value()!r}')
        s.expect(('10 von 12' if v.lang == 'de' else '10 of 12') in info(page), f'{v}: remaining count: {info(page)!r}')
        # typing updates the grid
        field.fill('2, 5-6')
        page.wait_for_function("() => document.querySelectorAll('.pg-card.is-sel').length === 3")
        s.expect(page.locator('.pg-card.is-sel').count() == 3, f'{v}: typed range should mark 3 pages')
        shots(s, page, v, 'delete', 'configured', top='.pg-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            texts = page_texts(out)
            s.expect(len(texts) == 9, f'{v}: 9 pages expected, got {len(texts)}')
            s.expect(texts[0].startswith('Seite 1') and texts[1].startswith('Seite 3') and texts[3].startswith('Seite 7'), f'{v}: page order {texts[:4]}')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
            # really gone: no content stream of the deleted pages left in the file
            qdf = OUT / f'del_qdf_{v.lang}_{v.device}.pdf'
            subprocess.run(['qpdf', '--qdf', '--object-streams=disable', str(out), str(qdf)], check=False)
            raw = qdf.read_bytes()
            s.expect(b'(Seite 5)' not in raw and b'(Seite 2)' not in raw and b'(Seite 1)' in raw, f'{v}: deleted page content must not stay in the file')
            from pypdf import PdfReader
            titles = [o.title for o in PdfReader(str(out)).outline]
            s.expect(titles == ['Kapitel Eins', 'Anhang: Tabellen/Daten'], f'{v}: bookmark of deleted page 5 should be gone: {titles}')
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'delete_result', top='.wt-result')
                dark_shot(s, page, 'delete')
        s.check_page(page)
        page.close()

    # all pages → friendly error; empty → error; quick buttons
    ctx = s.context('phone', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'text3.pdf'); s.wait_ready(page, 1); wait_grid(page, 3)
    s.primary(page).click()
    s.expect('First mark' in error_text(page), 'empty selection should explain')
    dismiss_error(page)
    page.locator('.pg-btn[aria-label="Mark odd pages"]').tap()
    s.expect(page.locator('#wt-opt-pages').input_value() == '1, 3', 'odd pages button')
    page.locator('.pg-btn[aria-label="Invert marks"]').tap()
    s.expect(page.locator('#wt-opt-pages').input_value() == '2', 'invert')
    page.locator('#wt-opt-pages').fill('1-3')
    s.primary(page).click()
    s.expect('at least one' in error_text(page), 'deleting all pages must be refused')
    page.close()

    # encrypted: password kept
    page = s.open(s.context('desktop', 'de'), PATHS['de'])
    s.pick(page, 'encrypted_aes256.pdf'); s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    wait_grid(page, 3)
    page.locator('.pg-hit').nth(0).click()
    out = s.run_and_download(page)
    if out:
        s.expect(s.pdf_info(out)['_rc'] != 0, 'result should need a password')
        s.expect(len(page_texts(out, 'geheim')) == 2, 'two pages left (with password)')
    s.check_page(page)
    page.close()

    # 150 pages: grid builds lazily, only few thumbnails rendered at first
    page = s.open(s.context('phone', 'de'), PATHS['de'])
    s.pick(page, 'org/org_150.pdf'); s.wait_ready(page, 1); wait_grid(page, 150); wait_thumbs(page, 3)
    page.wait_for_timeout(800)
    n = page.locator('.pg-page.has-img').count()
    s.expect(n < 60, f'thumbnails should load lazily, {n} rendered')
    page.locator('.pg-scroll').evaluate("el => el.scrollTop = el.scrollHeight")
    page.wait_for_function("() => document.querySelectorAll('.pg-card')[149].querySelector('.pg-page.has-img')", timeout=20000)
    s.check_page(page)
    page.close()

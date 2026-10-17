"""aud1 regression tests for the shared shell: unique output names, input hints instead of an error card,
phone back button, long file names, many outputs, "continue with" for images, share target with several files."""
import base64, re, subprocess, sys, zipfile
from wtlib import Suite, FIX, HERE, ORIGIN

if not (FIX / 'aud1/p20.pdf').exists():
    subprocess.run([sys.executable, str(HERE / 'aud1_make_fixtures.py'), 'small'], check=True, capture_output=True)
LONG = 'aud1/' + (FIX / 'aud1/longname.txt').read_text()
STATE = "() => document.getElementById('wt-app').dataset.state"

with Suite('aud1-shell') as s:
    # 1) same-named outputs (a.txt, a.md, a.csv → a.pdf ×3) get unique names – the ZIP keeps all three
    page = s.open(s.context('phone', 'de'), '/werkzeuge/text-in-pdf/')
    s.pick(page, 'conv_text.txt', 'conv_text.md', 'conv_text.csv')
    s.wait_ready(page, 3)
    if s.run(page):
        names = page.locator('.wt-output .wt-file-name').all_inner_texts()
        s.expect(names == ['conv_text.pdf', 'conv_text (2).pdf', 'conv_text (3).pdf'], f'unique output names: {names}')
        z = s.download_click(page, page.locator('.wt-result-actions button').first)
        zn = zipfile.ZipFile(z).namelist()
        s.expect(len(zn) == 3 and len(set(zn)) == 3, f'ZIP entries: {zn}')
    s.check_page(page)
    page.close()

    # 2) nothing selected → the files view stays, the bar says what to do (no error card, no "try again")
    page = s.open(s.context('phone', 'en'), '/en/tools/delete-pdf-pages/')
    s.pick(page, 'text5.pdf'); s.wait_ready(page, 1)
    page.wait_for_selector('.pg-hit')
    s.primary(page).click()
    page.wait_for_selector('.wt-bar-hint:not([hidden])')
    s.expect(page.evaluate(STATE) == 'files', 'stays in the files view')
    s.expect(page.locator('.wt-error:not([hidden])').count() == 0, 'no error card for an input hint')
    s.expect('First mark the pages' in page.locator('.wt-bar-hint').inner_text(), 'hint in the sticky bar')
    s.shot(page, 'aud1_input_hint')
    s.expect('First mark the pages' in page.locator('.wt-app [role=alert]').last.inner_text(), 'hint announced (role=alert)')
    page.locator('.pg-hit').nth(1).tap()
    page.wait_for_function("() => document.querySelector('.wt-bar-hint').hidden")
    out = s.run_and_download(page)
    s.expect(out and s.pdf_pages(out) == 4, 'after selecting a page the tool runs')
    s.check_page(page)
    page.close()

    # 3) phone back button: result → files (same page, options kept); re-run is instant (cached)
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/pdf-komprimieren/')
    s.pick(page, 'photos.pdf'); s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-level"][value="strong"]').check()
    url = page.url
    s.run(page)
    page.go_back()
    page.wait_for_function("() => document.getElementById('wt-app').dataset.state === 'files'")
    s.expect(page.url == url, f'still on the tool page after "back": {page.url}')
    s.expect(page.locator('.wt-file').count() == 1, 'the file is still there')
    s.expect(page.locator('input[name="wt-opt-level"][value="strong"]').is_checked(), 'option kept')
    s.run(page)
    # the result card's own "back to files" button consumes the history entry (no dead "back" press later)
    page.locator('.wt-restart button').first.click()
    page.wait_for_function("() => document.getElementById('wt-app').dataset.state === 'files'")
    page.wait_for_timeout(300)
    s.expect(page.evaluate("() => history.state && history.state.wtResult") in (None, False), 'history entry removed')
    # adding a file while the result is shown → files view, entry removed too
    s.run(page)
    s.pick(page, 'text3.pdf')
    page.wait_for_function("() => document.getElementById('wt-app').dataset.state === 'files'")
    page.wait_for_timeout(300)
    s.expect(page.evaluate("() => history.state && history.state.wtResult") in (None, False), 'history entry removed after adding files')
    s.expect(page.locator('.wt-file').count() == 2, 'file added after a result')
    s.check_page(page)
    page.close()

    # 4) very long name with umlauts + emoji: the suffix survives, the name stays ≤ 120 characters
    page = s.open(s.context('desktop', 'de'), '/werkzeuge/pdf-komprimieren/')
    s.pick(page, LONG); s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-level"][value="strong"]').check()
    if s.run(page):
        n = page.locator('.wt-output .wt-file-name').inner_text()
        if 'Unverändert' not in page.locator('.wt-output').inner_text():
            s.expect(n.endswith('… (komprimiert).pdf') and len(n) <= 120 and n.startswith('Überweisung März'), f'long output name: {n!r}')
    page.close()

    # 5) 20 page images: 10 rows shown, the rest behind "show all"; thumbnails only for visible rows
    page = s.open(s.context('phone', 'de'), '/werkzeuge/pdf-in-jpg/')
    s.pick(page, 'aud1/p20.pdf'); s.wait_ready(page, 1)
    if s.run(page, timeout=120000):
        s.expect(page.locator('.wt-output').count() == 20, '20 outputs')
        s.expect(page.locator('.wt-output:visible').count() == 10, 'first 10 visible')
        page.wait_for_timeout(800)
        s.expect(page.locator('.wt-output[hidden] .wt-thumb.has-img').count() == 0, 'no thumbnails for hidden rows')
        s.shot(page, 'aud1_many_outputs', top='.wt-out-more')
        page.locator('.wt-out-more').click()
        s.expect(page.locator('.wt-output:visible').count() == 20, 'all rows after "show all"')
        # images → "continue with: compress image" hands over all 20 files
        chip = page.locator('.wt-next-chip', has_text='Bild komprimieren')
        s.expect(chip.count() == 1, 'continue with "Bild komprimieren" offered for page images')
        with page.expect_navigation():
            chip.click()
        page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
        page.wait_for_function("() => document.querySelectorAll('.wt-file').length === 20", timeout=30000)
        s.check_page(page)
    page.close()

    # 6) share target with several files (2 PDFs + 1 photo): only tools taking all of them, merge loads all three
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/')
    page.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=30000)
    files = [[base64.b64encode((FIX / n).read_bytes()).decode(), n, t] for n, t in (('text3.pdf', 'application/pdf'), ('text5.pdf', 'application/pdf'), ('landscape.jpg', 'image/jpeg'))]
    r = page.evaluate("""async files => { const fd = new FormData();
      for (const [b64, name, type] of files) fd.append('files', new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type }));
      const res = await fetch('/werkzeuge/teilen/', { method: 'POST', body: fd }); return new URL(res.url).pathname + new URL(res.url).search; }""", files)
    page.goto(ORIGIN + r)
    page.wait_for_selector('[data-wt-shared]:not([hidden])')
    names = page.locator('[data-wt-shared-list] li .wt-card-name').all_inner_texts()
    s.expect('PDF zusammenfügen' in names, f'merge offered for 2 PDFs + photo: {names}')
    s.expect(not any(n in names for n in ('PDF komprimieren', 'Bild in PDF umwandeln', 'PDF teilen')), f'tools that cannot take all three are not offered: {names}')
    with page.expect_navigation():
        page.locator('[data-wt-shared-list] a', has_text='PDF zusammenfügen').click()
    page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
    s.wait_ready(page, 3)
    s.expect(page.locator('.wt-file .wt-file-name').all_inner_texts() == ['text3.pdf', 'text5.pdf', 'landscape.jpg'], 'shared files in order')
    s.check_page(page)

"""redact-pdf: terms + presets + manual box + exclusion; TRUE redaction verified by extracting text and scanning the
uncompressed file bytes; hidden data stripped; rotated page; 120-page doc keeps untouched pages as text."""
import subprocess
from wtlib import Suite, OUT

PATHS = {'de': '/werkzeuge/pdf-schwaerzen/', 'en': '/en/tools/redact-pdf/'}

def raw(path, pw=None):
    q = OUT / (path.stem + '_qdf.pdf')
    subprocess.run(['qpdf', '--qdf', '--object-streams=disable'] + ([f'--password={pw}'] if pw else []) + [str(path), str(q)], capture_output=True)
    return q.read_bytes()

def add_term(page, t):
    page.fill('#sec-red-term', t)
    page.press('#sec-red-term', 'Enter')

def wait_hits(page, n=None):
    page.wait_for_function("() => document.querySelectorAll('.sec-hit').length > 0 && !/Suche|Searching/.test(document.querySelector('.sec-status')?.textContent || '')")
    page.wait_for_timeout(200)

with Suite('sec-redact') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'redact-pdf_phone_initial')
        s.pick(page, 'sec_private.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.sec-page canvas')
        # blocked without marks
        s.primary(page).click(); page.wait_for_timeout(200)
        s.expect(page.locator('.sec-status[data-kind="error"]').is_visible(), f'{v}: no marks must be explained')
        add_term(page, 'Falke-7')
        wait_hits(page)
        n_term = page.locator('.sec-hit').count()
        s.expect(n_term >= 3, f'{v}: Falke-7 should be found on page 1, rotated page 2 and in the comment: {n_term}')
        for p in ('E-Mail-Adressen' if v.lang == 'de' else 'E-mail addresses', 'IBAN', 'Datumsangaben' if v.lang == 'de' else 'Dates'):
            page.locator('.sec-chip', has_text=p).first.click()
        wait_hits(page)
        page.wait_for_function("n => document.querySelectorAll('.sec-hit').length >= n", arg=n_term + 4)
        # exclude the date hit
        date_hit = page.locator('.sec-hit', has_text='12.03.1985')
        date_hit.locator('input').uncheck()
        # manual area on page 3
        page.locator('.sec-nav-btn').nth(1).click(); page.locator('.sec-nav-btn').nth(1).click()
        page.wait_for_function("() => /3/.test(document.querySelector('.sec-nav-label').textContent)")
        page.wait_for_timeout(500)
        page.locator('.sec-chip', has_text='Bereich ziehen' if v.lang == 'de' else 'Draw area').click()
        box = page.locator('.sec-page canvas').bounding_box()
        x0, y0 = box['x'] + box['width'] * 0.05, box['y'] + box['height'] * 0.04
        x1, y1 = box['x'] + box['width'] * 0.75, box['y'] + box['height'] * 0.12
        if v.device == 'phone':
            # touch drag via CDP
            cdp = page.context.new_cdp_session(page)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
            for i in range(1, 9):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * i / 8, 'y': y0 + (y1 - y0) * i / 8}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x1, y1, steps=8); page.mouse.up()
        page.wait_for_function("() => [...document.querySelectorAll('.sec-hit-meta')].some(e => /(Seite|Page) 3/.test(e.textContent))")
        if shots:
            s.shot(page, 'redact-pdf_phone_configured', top='.sec-page-wrap')
            s.shot(page, 'redact-pdf_phone_review', top='.sec-hits')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'redact-pdf_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'redact-pdf_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if not out: continue
        txt = s.pdf_text(out)
        for secret in ('Falke', 'erika.mustermann', 'max@firma', 'DE89', '3704 0044', 'Seite 3 ohne'):
            s.expect(secret not in txt, f'{v}: "{secret}" still extractable')
        b = raw(out)
        for secret in (b'Falke', b'Mustermann', b'Kontonummer', b'app.alert', b'erika', b'Druckertreiber'):
            s.expect(secret not in b, f'{v}: {secret!r} still in the file bytes')
        s.expect(s.pdf_pages(out) == 3, f'{v}: 3 pages')
        sizes = s.page_sizes(out)
        s.expect(abs(sizes[1][0] - 595.28) < 1 and abs(sizes[1][1] - 841.89) < 1, f'{v}: rotated landscape page 2 keeps its displayed (portrait) look: {sizes}')
        img = s.render(out, 1, 72)
        # e-mail line (y≈780-56 pt from top… text baseline 724) must be black
        dark = sum(1 for x in range(120, 260) if sum(img.getpixel((x, 842 - 727))) < 120)
        s.expect(dark > 120, f'{v}: e-mail area should be black ({dark})')
        light = sum(1 for x in range(200, 300) if sum(img.getpixel((x, 842 - 640 - 3))) > 600)
        s.expect(light > 50, f'{v}: excluded date line should stay visible ({light})')
        ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    # 120 pages: only the page with the hit becomes an image
    ctx = s.context('desktop', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'sec_long.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.sec-page canvas')
    page.locator('.sec-details summary').first.click()
    page.locator('label[for="sec-red-whole"]').click()
    add_term(page, 'Seite 77')
    page.wait_for_function("() => document.querySelectorAll('.sec-hit').length === 1", timeout=60000)
    out = s.run_and_download(page)
    if out:
        t = subprocess.run(['pdftotext', '-f', '76', '-l', '78', str(out), '-'], capture_output=True, text=True).stdout
        s.expect('Seite 76' in t and 'Seite 78' in t and 'Seite 77' not in t, f'only page 77 redacted: {t!r}')
        s.expect(s.pdf_pages(out) == 120, '120 pages')
    s.check_page(page)
    page.close()

    # protected input stays protected
    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'sec_form_enc.pdf')
    s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_selector('.sec-page canvas')
    add_term(page, 'Müller')
    wait_hits(page)
    out = s.run_and_download(page)
    if out:
        s.expect(s.pdf_info(out)['_rc'] != 0, 'output must stay encrypted')
        s.expect('Müller' not in s.pdf_text(out, 'geheim') and b'M\xfcller' not in raw(out, 'geheim') and b'Mller' not in raw(out, 'geheim'), 'field value redacted')
    s.check_page(page)

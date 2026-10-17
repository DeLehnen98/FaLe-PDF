"""sign-pdf: draw (touch + mouse), type initials on all pages, photo with background removal, date + check,
drag/resize/rotate via touch and keyboard, burned-in output at the right position (incl. rotated page),
remember on device (opt-in, deletable), protected input."""
import subprocess
from wtlib import Suite, FIX
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/pdf-unterschreiben/', 'en': '/en/tools/sign-pdf/'}
T = {'de': {'sig': 'Unterschrift', 'ini': 'Initialen', 'date': 'Datum', 'check': 'Haken', 'use': 'Übernehmen', 'type': 'Tippen', 'photo': 'Foto', 'all': 'Auf allen Seiten', 'remember': 'Auf diesem Gerät merken'},
     'en': {'sig': 'Signature', 'ini': 'Initials', 'date': 'Date', 'check': 'Check', 'use': 'Use', 'type': 'Type', 'photo': 'Photo', 'all': 'On all pages', 'remember': 'Remember on this device'}}

def touch_path(page, pts):
    cdp = page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': pts[0][0], 'y': pts[0][1]}]})
    for x, y in pts[1:]:
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

def mouse_path(page, pts):
    page.mouse.move(*pts[0]); page.mouse.down()
    for p in pts[1:]: page.mouse.move(*p)
    page.mouse.up()

def drag(page, v, pts):
    (touch_path if v.device == 'phone' else mouse_path)(page, pts)

def draw_signature(page, v):
    b = page.locator('.sec-pad canvas').bounding_box()
    import math
    pts = [(b['x'] + b['width'] * (0.15 + 0.7 * i / 40), b['y'] + b['height'] * (0.5 + 0.25 * math.sin(i / 3))) for i in range(41)]
    drag(page, v, pts)

def images_per_page(path):
    out = subprocess.run(['pdfimages', '-list', str(path)], capture_output=True, text=True).stdout.splitlines()[2:]
    pages = {}
    for l in out:
        f = l.split()
        if f[2] == 'image': pages[int(f[0])] = pages.get(int(f[0]), 0) + 1
    return pages

def dark_near(img, fx, fy, r=18):
    W, H = img.size
    cx, cy = int(fx * W), int(fy * H)
    return sum(1 for x in range(max(0, cx - r), min(W, cx + r)) for y in range(max(0, cy - r), min(H, cy + r)) if sum(img.getpixel((x, y))) < 450)

with Suite('sec-sign') as s:
    for v in s.variants():
        t = T[v.lang]
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: keep_ctx = v.ctx
        if shots: s.shot(page, 'sign-pdf_phone_initial')
        s.pick(page, 'text3.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.sec-page canvas')
        # blocked before anything is placed
        s.primary(page).click(); page.wait_for_timeout(200)
        s.expect(page.locator('.sec-status[data-kind="error"]').is_visible(), f'{v}: empty placement must be explained')
        # draw signature
        page.locator('.sec-chip', has_text=t['sig']).first.click()
        page.wait_for_selector('dialog.sec-dlg[open]')
        page.wait_for_timeout(150)
        if shots: s.shot(page, 'sign-pdf_phone_dialog')
        draw_signature(page, v)
        if shots: s.shot(page, 'sign-pdf_phone_drawn')
        page.locator('.sec-dlg label', has_text=t['remember']).click()
        page.locator('.sec-dlg button', has_text=t['use']).click()
        page.wait_for_selector('.sec-item img')
        s.expect(page.locator('dialog.sec-dlg').count() == 0, f'{v}: dialog closed')
        # move it: drag from item centre to 30 % / 60 % of the page
        page.locator('.sec-page').scroll_into_view_if_needed()
        page.evaluate("() => document.querySelector('.sec-page').scrollIntoView({block: 'center'})")
        page.wait_for_timeout(200)
        pb = page.locator('.sec-page canvas').bounding_box()
        ib = page.locator('.sec-item').first.bounding_box()
        start = (ib['x'] + ib['width'] / 2, ib['y'] + ib['height'] / 2)
        target = (pb['x'] + pb['width'] * 0.3, pb['y'] + pb['height'] * 0.6)
        drag(page, v, [(start[0] + (target[0] - start[0]) * k / 10, start[1] + (target[1] - start[1]) * k / 10) for k in range(11)])
        w0 = page.locator('.sec-item').first.bounding_box()['width']
        # resize with the corner handle (+30 %)
        hb = page.locator('.sec-item.is-sel .sec-h-size').bounding_box()
        hx, hy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        drag(page, v, [(hx + (hx - target[0]) * 0.3 * k / 6, hy + (hy - target[1]) * 0.3 * k / 6) for k in range(7)])
        w1 = page.locator('.sec-item').first.bounding_box()['width']
        s.expect(w1 > w0 * 1.15, f'{v}: resize handle should enlarge ({w0} → {w1})')
        # date + check (keyboard nudges on the check)
        page.locator('.sec-chip', has_text=t['date']).click()
        page.locator('.sec-chip', has_text=t['check']).click()
        page.wait_for_function("() => document.querySelectorAll('.sec-item').length === 3")
        page.keyboard.press('Shift+ArrowLeft'); page.keyboard.press('Shift+ArrowLeft'); page.keyboard.press('+'); page.keyboard.press('+')
        # initials typed, on all pages
        page.locator('.sec-chip', has_text=t['ini']).click()
        page.wait_for_selector('dialog.sec-dlg[open]')
        page.locator('.sec-tab', has_text=t['type']).click()
        page.fill('#sec-sig-text', 'E. M.')
        page.locator('.sec-dlg button', has_text=t['use']).click()
        page.wait_for_function("() => document.querySelectorAll('.sec-item').length === 4")
        page.locator('.sec-toolbar button', has_text=t['all']).click()
        if shots: s.shot(page, 'sign-pdf_phone_configured', top='.sec-toolbar')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'sign-pdf_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'sign-pdf_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            imgs = images_per_page(out)
            s.expect(imgs.get(1) == 2 and imgs.get(2) == 1 and imgs.get(3) == 1, f'{v}: signature + initials on page 1, initials on 2 and 3: {imgs}')
            txt = s.pdf_text(out)
            import datetime
            today = datetime.date.today()
            ds = today.strftime('%d.%m.%Y') if v.lang == 'de' else today.strftime('%d/%m/%Y')
            s.expect(ds in txt and 'Alpha Seite 1' in txt, f'{v}: date burned in as text ({ds})')
            img = s.render(out, 1, 60)
            s.expect(dark_near(img, 0.3, 0.6, 30) > 30, f'{v}: signature where it was dragged to')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        page.close()

    # remembered signature, photo, rotated page, protected
    page = s.open(keep_ctx, PATHS['de'])
    s.pick(page, 'sec_annots.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.sec-page canvas')
    page.wait_for_selector('.sec-saved-use', timeout=5000)
    s.expect(page.locator('.sec-saved-use').count() == 1, 'remembered signature offered (opt-in once)')
    # go to rotated page 2, add a check mark and the photo signature
    page.locator('.sec-nav-btn').nth(1).click()
    page.wait_for_function("() => /2 von/.test(document.querySelector('.sec-nav-label').textContent)")
    page.wait_for_timeout(400)
    page.locator('.sec-chip', has_text='Haken').click()
    page.locator('.sec-chip', has_text='Unterschrift').first.click()
    page.locator('.sec-tab', has_text='Foto').click()
    page.set_input_files('.sec-dlg input[type=file]:not([capture])', str(FIX / 'sec_sigphoto.jpg'))
    page.wait_for_selector('.sec-photo-prev canvas')
    s.shot(page, 'sign-pdf_phone_photo')
    alpha = page.evaluate("""() => { const c = document.querySelector('.sec-photo-prev canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let t = 0, o = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] < 10) t++; else if (d[i] > 200) o++; } return [t / (d.length / 4), o]; }""")
    s.expect(alpha[0] > 0.85 and alpha[1] > 500, f'photo: background removed, ink kept {alpha}')
    page.locator('.sec-dlg button', has_text='Übernehmen').click()
    page.wait_for_function("() => document.querySelectorAll('.sec-item').length === 2")
    # rotate the photo signature 90° with the toolbar
    page.locator('.sec-toolbar button[aria-label="Nach links drehen"]').click()
    out = s.run_and_download(page)
    if out:
        imgs = images_per_page(out)
        s.expect(imgs.get(2) == 1, f'photo signature on rotated page 2: {imgs}')
        img = s.render(out, 2, 60)
        W, H = img.size
        s.expect(W > H, 'page 2 displayed landscape')
        s.expect(dark_near(img, 0.62, 0.5, 14) > 10, 'check mark at its displayed position on the rotated page')
        s.expect(dark_near(img, 0.62, 0.82, 30) > 20, 'photo signature at its displayed position on the rotated page')
        ok, msg = s.qpdf_check(out); s.expect(ok, f'qpdf {msg}')
    # delete remembered signatures
    page.locator('.wt-restart button').first.click()
    page.locator('.sec-saved-del').first.click()
    page.wait_for_function("() => !document.querySelector('.sec-saved-use')")
    s.check_page(page)
    page.close()

    ctx = s.context('desktop', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'encrypted_aes256.pdf')
    s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_selector('.sec-page canvas')
    page.locator('.sec-chip', has_text='Check').click()
    out = s.run_and_download(page)
    if out:
        s.expect(s.pdf_info(out)['_rc'] != 0 and s.pdf_info(out, 'geheim')['_rc'] == 0, 'signed file stays protected')
    s.check_page(page)

    # typed text item with Polish, Greek, Cyrillic, Turkish, € → real text in an embedded Unicode subset
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'text3.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.sec-page canvas')
    page.locator('.sec-chip', has_text='Text').click()
    page.wait_for_selector('#sec-sign-text:visible')
    page.fill('#sec-sign-text', 'Łukasz Kowalski-Müller Ελληνικά')
    page.locator('.sec-chip', has_text='Text').click()
    page.wait_for_function("() => document.querySelectorAll('.sec-item').length === 2")
    page.fill('#sec-sign-text', 'Привет Türkçe İğ €')
    out = s.run_and_download(page)
    if out:
        check_unicode_pdf(s, out, UNI_WORDS, 'sign typed text')
        rt = page.locator('.wt-result').inner_text()
        s.expect('cannot show' not in rt and 'Western European' not in rt, f'no replacement note: {rt[:200]!r}')
    s.check_page(page)
    page.close()

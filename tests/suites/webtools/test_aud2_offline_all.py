"""aud2: every edit/security/image/everyday tool works offline after ONE visit – including the parts that are only
imported when the tool runs (lazy libs, signature dialog, fonts, ZIP). Own server on :8802, stopped after warm-up.
OCR tools are excluded here (their language data is cached on first use – test_new_ocr_offline.py)."""
import os
os.environ['WT_PORT'] = '8802'
from wtlib import Suite, FIX

def sign(page):
    page.wait_for_selector('.sec-page canvas')
    page.locator('.sec-chip', has_text='Unterschrift').first.click()
    page.wait_for_selector('dialog.sec-dlg[open]')
    page.locator('.sec-tab', has_text='Tippen').click()
    page.fill('#sec-sig-text', 'Erika M.')
    page.locator('.sec-dlg button', has_text='Übernehmen').click()
    page.wait_for_timeout(300)

def redact(page):
    page.wait_for_selector('.sec-page canvas')
    page.fill('#sec-red-term', 'Falke-7'); page.press('#sec-red-term', 'Enter')
    page.wait_for_function("() => document.querySelectorAll('.sec-hit').length > 0")

def edit(page):
    page.wait_for_selector('.ed-pv-cv', timeout=20000); page.wait_for_timeout(500)
    page.locator('.ed-tool[data-tool="text"]').click()
    page.locator('.ed-pv-page').scroll_into_view_if_needed()
    b = page.locator('.ed-pv-page').bounding_box()
    page.touchscreen.tap(b['x'] + b['width'] * 0.3, b['y'] + b['height'] * 0.3)
    page.wait_for_selector('.ed-props textarea'); page.locator('.ed-props textarea').fill('Offline Łódź')
    page.locator('.ed-props textarea').blur()

def overlay(page):
    page.wait_for_selector('.ed-pv-cv', timeout=20000)
    page.set_input_files('.ed-file >> nth=0 >> input[type=file]', str(FIX / 'edit_letterhead.pdf'))
    page.wait_for_function("() => document.getElementById('wt-opt-follow').value === 'page2'")

def invoice(page):
    page.wait_for_selector('.new-item')
    li = page.locator('.new-item').first
    li.locator('textarea').fill('Beratung'); li.locator('input[id^="new-inv-price-"]').fill('1.000')
    page.locator('input[id^="new-inv-sName-"]').fill('Muster GmbH')

def letter(page):
    page.wait_for_selector('.img-lt-sec')
    for k, v in {'customer': 'K-1', 'rName': 'Muster Mobilfunk GmbH', 'rStreet': 'Postfach 1', 'rCity': '12345 Musterstadt',
                 'sName': 'Łukasz Kowalski', 'sStreet': 'Weg 7', 'sCity': '66111 Saarbrücken', 'place': 'Saarbrücken'}.items():
        page.fill(f'#img-lt-{k}', v)

def qr(page):
    page.wait_for_selector('.img-qr'); page.fill('#img-qr-url', 'fale.network'); page.wait_for_selector('.img-qr-test.is-ok')

def sigmaker(page):
    page.locator('.new-tools button', has_text='Tippen').click()
    page.wait_for_selector('dialog.sec-dlg[open]'); page.fill('#sec-sig-text', 'Erika M.')
    page.locator('.sec-dlg button', has_text='Übernehmen').click(); page.wait_for_timeout(300)

def crop_img(page):
    page.locator('.new-chip[data-aspect="1:1"]').click()

TOOLS = [  # path, files, setup, zip?
    ('/werkzeuge/pdf-bearbeiten/', ['edit_rot.pdf'], edit, False),
    ('/werkzeuge/seitenzahlen-einfuegen/', ['edit_p6.pdf'], None, False),
    ('/werkzeuge/wasserzeichen-einfuegen/', ['edit_mixed.pdf'], None, False),
    ('/werkzeuge/kopf-und-fusszeile/', ['edit_p6.pdf'], lambda p: p.locator('#wt-opt-footerL, textarea, input.wt-input').first.fill('Łódź Fußzeile'), False),
    ('/werkzeuge/pdf-zuschneiden/', ['edit_margins.pdf'], None, False),
    ('/werkzeuge/seitengroesse-aendern/', ['edit_mixed.pdf'], None, False),
    ('/werkzeuge/mehrere-seiten-pro-blatt/', ['edit_p6.pdf'], None, False),
    ('/werkzeuge/broschuere-drucken/', ['edit_p10.pdf'], None, False),
    ('/werkzeuge/briefpapier-pdf/', ['edit_letter.pdf'], overlay, False),
    ('/werkzeuge/pdf-unterschreiben/', ['text3.pdf'], sign, False),
    ('/werkzeuge/pdf-formular-ausfuellen/', ['aud2/hard_form.pdf'], lambda p: p.get_by_label('Titel', exact=True).fill('Dr. Ελληνικά'), False),
    ('/werkzeuge/pdf-schwaerzen/', ['sec_private.pdf'], redact, False),
    ('/werkzeuge/pdf-mit-passwort-schuetzen/', ['text3.pdf'], lambda p: [e.fill('Sommer-2026!') for e in p.locator('input[type=password]:visible').all()], False),
    ('/werkzeuge/pdf-passwort-entfernen/', ['restricted.pdf'], None, False),
    ('/werkzeuge/pdf-glaetten/', ['sec_form.pdf'], None, False),
    ('/werkzeuge/pdf-metadaten/', ['sec_private.pdf'], None, False),
    ('/werkzeuge/pdf-vergleichen/', ['sec_v1.pdf', 'sec_v2.pdf'], None, False),
    ('/werkzeuge/bild-komprimieren/', ['img/portrait.jpg', 'img/logo.png'], None, True),
    ('/werkzeuge/bildgroesse-aendern/', ['img/portrait.jpg'], None, False),
    ('/werkzeuge/bild-umwandeln/', ['img/logo.png'], None, False),
    ('/werkzeuge/png-in-jpg/', ['img/logo.png'], None, False),
    ('/werkzeuge/jpg-in-png/', ['img/portrait.jpg'], None, False),
    ('/werkzeuge/webp-in-jpg/', ['photo.webp'], None, False),
    ('/werkzeuge/exif-entfernen/', ['img/gps_photo.jpg'], None, False),
    ('/werkzeuge/dokument-scannen/', ['img/doc_photo.jpg'], None, False),
    ('/werkzeuge/passfoto/', ['img/portrait.jpg'], None, False),
    ('/werkzeuge/qr-code-erstellen/', [], qr, False),
    ('/werkzeuge/kuendigung-schreiben/', [], letter, False),
    ('/werkzeuge/rechnung-schreiben/', [], invoice, False),
    ('/werkzeuge/unterschrift-erstellen/', [], sigmaker, False),
    ('/werkzeuge/bild-zuschneiden/', ['img/portrait.jpg'], crop_img, False),
    ('/werkzeuge/bild-drehen/', ['img/portrait.jpg'], lambda p: p.locator('button', has_text='Alle rechts').first.click(), False),
]
PDF_VIEWER = '/werkzeuge/pdf-oeffnen/'

with Suite('aud2-offline-all') as s:
    assert s.proc, 'needs its own server (port 8802 must be free)'
    ctx = s.context('phone', 'de')
    for path in [t[0] for t in TOOLS] + [PDF_VIEWER]:
        page = s.open(ctx, path)
        page.wait_for_function("() => document.documentElement.dataset.wtOffline === 'ready'", timeout=90000)
        page.close()
    s.proc.kill(); s.proc.wait(); s.proc = None
    ctx.set_offline(True)
    for path, files, setup, zipit in TOOLS:
        page = s.open(ctx, path)
        if files:
            s.pick(page, *files)
            s.wait_ready(page, len(files), timeout=60000)
        page.wait_for_timeout(500)
        try:
            if setup: setup(page)
        except Exception as e:
            s.fails.append(f'{path}: offline setup failed: {str(e)[:160]}')
            page.close(); continue
        page.wait_for_timeout(300)
        if s.run(page, timeout=120000):
            s.download(page, 0)
            if zipit:
                try:
                    p = s.download_click(page, page.locator('.wt-result-actions button').first)
                    s.expect(p.suffix == '.zip' and p.stat().st_size > 100, f'{path}: offline ZIP {p.name}')
                except Exception as e:
                    s.fails.append(f'{path}: ZIP download offline failed: {str(e)[:120]}')
        page.close()
    # the viewer renders offline
    page = s.open(ctx, PDF_VIEWER)
    s.pick(page, 'text5.pdf')
    page.wait_for_function("() => document.querySelectorAll('canvas').length > 0", timeout=30000)
    page.close()
    ctx.set_offline(False)

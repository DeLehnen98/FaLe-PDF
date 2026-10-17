"""cancellation-letter (no file intake): required fields gate the button, live text preview, contract types,
extraordinary cancellation, options, DIN 5008 PDF (address in the window area, text extractable), finger
signature embedded, copy text, opt-in "remember sender", special characters, DE/EN × phone/desktop."""
import subprocess
from wtlib import Suite
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/kuendigung-schreiben/', 'en': '/en/tools/cancellation-letter/'}

def bbox_text(path):
    return subprocess.run(['pdftotext', '-bbox', str(path), '-'], capture_output=True, text=True).stdout

def fill(page, d):
    for k, val in d.items():
        page.fill(f'#img-lt-{k}', val)

with Suite('cancellation-letter') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        page.wait_for_selector('.img-lt-sec')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled until required fields are filled')
        if shots: s.shot(page, 'img_letter_phone_initial')
        fill(page, {'customer': 'K-123456', 'phone': '0170 1234567', 'rName': 'Muster Mobilfunk GmbH', 'rAttn': 'Kundenservice Ελληνικά Привет Türkçe İğ €', 'rStreet': 'Postfach 10 20 30',
                    'rCity': '12345 Musterstadt', 'sName': 'Łukasz Kowalski-Müller', 'sStreet': 'Beispielweg 7', 'sCity': '66111 Saarbrücken', 'place': 'Saarbrücken'})
        page.locator('#img-lt-gdpr').check(force=True)
        page.wait_for_timeout(250)
        pv = page.locator('.img-lt-preview').inner_text()
        if v.lang == 'de':
            s.expect('hiermit kündige ich meinen Mobilfunkvertrag (Kundennummer: K-123456, Rufnummer: 0170 1234567) fristgerecht zum nächstmöglichen Zeitpunkt.' in pv, f'{v}: German body text: {pv[:400]}')
            s.expect('Art. 17 DSGVO' in pv and 'SEPA-Lastschriftmandat' in pv, f'{v}: GDPR + SEPA sentences')
        else:
            s.expect('I hereby cancel my mobile phone contract (Customer number: K-123456, Phone number: 0170 1234567) at the earliest possible date.' in pv, f'{v}: English body: {pv[:400]}')
            s.expect('DSGVO' not in pv and 'GDPR' in pv, f'{v}: English page without German law terms')
        s.expect(not s.primary(page).is_disabled(), f'{v}: enabled')
        # signature
        cv = page.locator('.img-sig-canvas'); cv.evaluate("e => e.scrollIntoView({block: 'center'})"); page.wait_for_timeout(150)
        b = cv.bounding_box()
        page.mouse.move(b['x'] + 20, b['y'] + b['height'] * 0.6); page.mouse.down()
        for i in range(12): page.mouse.move(b['x'] + 20 + i * 15, b['y'] + b['height'] * (0.6 - 0.25 * ((i % 3) - 1)))
        page.mouse.up()
        if shots: s.shot(page, 'img_letter_phone_configured', top='#img-lt-h5')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'img_letter_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'img_letter_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        o = s.download(page, 0)
        txt = s.pdf_text(o)
        s.expect('Muster Mobilfunk GmbH' in txt, f'{v}: recipient in PDF')
        # Polish, Greek, Cyrillic, Turkish, € stay real text (embedded Unicode subset), nothing simplified
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: letter')
        rt = page.locator('.wt-result').inner_text()
        s.expect('nicht darstellen' not in rt and 'cannot show' not in rt, f'{v}: no replacement note')
        w, h = s.page_sizes(o)[0]
        s.expect(abs(w - 595.28) < 1 and abs(h - 841.89) < 1, f'{v}: A4')
        # recipient name inside the window area (x 20–105 mm, y 62.7–90 mm from top)
        bb = bbox_text(o)
        import re
        m = re.search(r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>Muster</word>', bb)
        if s.expect(m, f'{v}: recipient word position found'):
            x, y = float(m.group(1)) / 72 * 25.4, float(m.group(2)) / 72 * 25.4
            s.expect(20 <= x <= 105 and 62 <= y <= 90, f'{v}: recipient in the window field: {x:.1f} mm, {y:.1f} mm')
        imgs = subprocess.run(['pdfimages', '-list', str(o)], capture_output=True, text=True).stdout.splitlines()[2:]
        s.expect(len([l for l in imgs if l.split()[2] == 'image']) == 1, f'{v}: signature embedded ({imgs})')
        s.check_page(page)

    # extraordinary + date + rent (German specifics) + remember sender
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('.img-lt-sec')
    page.select_option('#img-lt-type', 'fitness')
    fill(page, {'member': 'M-77', 'rName': 'FitX Beispiel', 'rStreet': 'Hauptstr. 1', 'rCity': '10115 Berlin', 'sName': 'Erika Muster', 'sStreet': 'Weg 2', 'sCity': '10117 Berlin'})
    page.locator('#img-lt-extra').check(force=True)
    page.select_option('#img-lt-reason', 'move')
    page.locator('input[name="img-lt-when"][value="date"]').check(force=True)
    page.fill('#img-lt-date', '2026-12-31')
    page.locator('#img-lt-remember').check(force=True)
    page.wait_for_timeout(250)
    pv = page.locator('.img-lt-preview').inner_text()
    s.expect('außerordentlich zum 31.12.2026, wegen meines Umzugs.' in pv and 'Hilfsweise kündige ich fristgerecht' in pv, f'extraordinary text: {pv[:600]}')
    s.expect(page.locator('.img-lt-help').count() == 1, 'deadline help present')
    page.locator('.img-lt-help summary').click()
    s.expect('keine Rechtsberatung' in page.locator('.img-lt-help').inner_text(), 'not legal advice note')
    # copy text
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    page.get_by_role('button', name='Text kopieren').click()
    page.wait_for_function("() => /kopiert/.test(document.querySelector('.img-lt-sec [role=status]')?.textContent || '') || [...document.querySelectorAll('.img-lt-sec [role=status]')].some(e => /kopiert/.test(e.textContent))")
    clip = page.evaluate("() => navigator.clipboard.readText()")
    s.expect('Kündigung meiner Mitgliedschaft' in clip, f'clipboard text: {clip[:120]}')
    # remember sender → reload restores
    page2 = s.open(ctx, PATHS['de'])
    page2.wait_for_selector('#img-lt-sName')
    s.expect(page2.input_value('#img-lt-sName') == 'Erika Muster', 'sender remembered (opt-in)')
    page2.locator('#img-lt-remember').uncheck(force=True)
    page3 = s.open(ctx, PATHS['de'])
    page3.wait_for_selector('#img-lt-sName')
    s.expect(page3.input_value('#img-lt-sName') == '', 'switching off deletes the stored sender')
    # rent: paper note + tenancy end
    page3.select_option('#img-lt-type', 'rent')
    fill(page3, {'object': 'Lindenstr. 5, 66111 Saarbrücken', 'rName': 'Hausverwaltung X', 'rStreet': 'Am Markt 1', 'rCity': '66111 Saarbrücken', 'sName': 'Max Mieter', 'receipt': '2026-03-02'})
    page3.wait_for_timeout(250)
    pv = page3.locator('.img-lt-preview').inner_text()
    s.expect('nach meiner Berechnung zum 31.05.2026' in pv, f'tenancy end (received 2 March → 31 May): {pv[:500]}')
    if s.run(page3):
        s.expect('eigenhändig unterschreiben' in page3.locator('.wt-result').inner_text(), 'paper signature note for rent')
    s.check_page(page3)

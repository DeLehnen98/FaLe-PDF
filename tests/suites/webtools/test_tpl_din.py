"""din-letter: DIN 5008 form B/A positions (address window, info block, subject, fold marks), reference line,
notices, multi-page with page numbers, enclosures, signature, Unicode, live preview, copy text, DE/EN × phone/desktop."""
from wtlib import Suite
from tpl_testlib import fill, wait_preview, preview_pages, sign, bbox_words, find_word, images, ink_ratio
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/brief-din-5008/', 'en': '/en/tools/letter-template/'}
LONG = '\n\n'.join(f'Absatz {i}: ' + 'Dies ist ein längerer Beispieltext, der den Seitenumbruch prüft. ' * 6 for i in range(1, 13))

with Suite('din-letter') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        page.wait_for_selector('#tpl-body')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled until required fields are filled')
        if shots: s.shot(page, 'tpl_din_phone_initial')
        fill(page, {'rName': 'Muster Versand GmbH', 'rAttn': 'Kundenservice Ελληνικά Привет Türkçe İğ €', 'rStreet': 'Hauptstraße 5', 'rCity': '10115 Berlin',
                    'sName': 'Łukasz Kowalski-Müller', 'sStreet': 'Beispielweg 7', 'sCity': '66111 Saarbrücken', 'place': 'Saarbrücken', 'letterDate': '2026-10-15',
                    'subject': 'Rückfrage zur Lieferung', 'yourRef': 'AB-17', 'body': 'erster Absatz.\n\nzweiter Absatz mit Zeile\nund Umbruch.', 'enclosures': 'Rechnungskopie\nFoto'})
        page.select_option('#tpl-notice', 'einschreiben')
        wait_preview(page)
        s.expect(preview_pages(page) == 1, f'{v}: one page preview')
        s.expect(not s.primary(page).is_disabled(), f'{v}: enabled')
        sign(page)
        if shots: s.shot(page, 'tpl_din_phone_configured', top='#tpl-h-text')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'tpl_din_phone_result', top='.wt-result')
        o = s.download(page, 0)
        txt = s.pdf_text(o)
        s.expect('Rückfrage zur Lieferung' in txt and ('Anlagen' in txt if v.lang == 'de' else 'Enclosures' in txt), f'{v}: subject + enclosures')
        s.expect(('Einschreiben' if v.lang == 'de' else 'Registered mail') in txt, f'{v}: notice')
        s.expect(('Ihr Zeichen: AB-17' if v.lang == 'de' else 'Your ref.: AB-17') in txt and ('15.10.2026' if v.lang == 'de' else '15 October 2026') in txt, f'{v}: info block')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: letter')
        w = bbox_words(o)
        m = find_word(w, 'Muster')
        s.expect(m and 20 <= m[1] <= 105 and 62.7 <= m[2] <= 90, f'{v}: recipient in the form B window: {m}')
        r = find_word(w, 'Rückfrage')
        s.expect(r and 95 <= r[2] <= 106 and abs(r[1] - 25) < 1, f'{v}: subject at ~ 103 mm, left 25 mm: {r}')
        z = find_word(w, 'AB-17')
        s.expect(z and 124 <= z[1] <= 160 and 45 <= z[2] <= 60, f'{v}: info block at x 125 mm from 50 mm: {z}')
        n = find_word(w, 'Einschreiben' if v.lang == 'de' else 'Registered')
        s.expect(n and 50 <= n[2] <= 63, f'{v}: notice in the Vermerkzone: {n}')
        s.expect(len([i for i in images(o) if i[2] == 'image']) == 1, f'{v}: signature embedded')
        s.expect(ink_ratio(o, 1, (3, 103, 9, 107)) > 0.02, f'{v}: fold mark at 105 mm')
        s.check_page(page)

    # form A + reference line + long letter (2+ pages, page numbers) + no marks
    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#tpl-body')
    page.locator('input[name="tpl-form"][value="A"]').check(force=True)
    page.locator('input[name="tpl-refStyle"][value="line"]').check(force=True)
    page.locator('#tpl-punch').uncheck(force=True)
    fill(page, {'rName': 'Amt für Beispiele', 'rStreet': 'Postfach 1', 'rCity': '66111 Saarbrücken', 'sName': 'Erika Muster', 'sStreet': 'Weg 2', 'sCity': '66113 Saarbrücken',
                'subject': 'Antrag', 'yourRef': 'Z-99', 'ourRef': 'EM-1', 'body': LONG, 'letterDate': '2026-10-15'})
    wait_preview(page)
    s.expect(preview_pages(page) >= 2, f'long letter previews several pages ({preview_pages(page)})')
    if s.run(page):
        o = s.download(page, 0)
        s.expect(s.pdf_pages(o) >= 2, 'long letter has 2+ pages')
        txt = s.pdf_text(o)
        s.expect('Seite 1 von' in txt and 'Seite 2 von' in txt, 'page numbers')
        w = bbox_words(o)
        m = find_word(w, 'Amt')
        s.expect(m and 39.7 <= m[2] <= 67.5, f'form A: recipient from 39.7 mm: {m}')
        z = find_word(w, 'Z-99')
        s.expect(z and 75 <= z[2] <= 84 and abs(z[1] - 25) < 1.5, f'reference line at ~ 80 mm: {z}')
        s.expect(ink_ratio(o, 1, (3, 85, 9, 89)) > 0.02 and ink_ratio(o, 1, (3, 147, 11, 150)) < 0.005, 'form A fold mark at 87 mm, no punch mark')
    # copy text
    ctx2 = s.context('desktop', 'en')
    ctx2.grant_permissions(['clipboard-read', 'clipboard-write'])
    page = s.open(ctx2, PATHS['en'])
    page.wait_for_selector('#tpl-body')
    fill(page, {'rName': 'Acme Ltd', 'sName': 'Jane Doe', 'subject': 'Hello', 'body': 'Some text.'})
    page.locator('.tpl-textbox summary').click()
    page.get_by_role('button', name='Copy text').click()
    page.wait_for_function("() => [...document.querySelectorAll('.tpl-copy-msg')].some(e => /copied/.test(e.textContent))")
    clip = page.evaluate("() => navigator.clipboard.readText()")
    s.expect('Dear Sir or Madam,' in clip and 'Some text.' in clip and 'Yours faithfully,' in clip, f'clipboard: {clip[:200]}')
    s.check_page(page)

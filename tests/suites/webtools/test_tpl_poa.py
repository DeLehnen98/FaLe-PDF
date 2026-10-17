"""power-of-attorney: presets (post, vehicle, bank note, child), validity, ID number only in PDF (not stored),
remember principal, signatures, Unicode, DE/EN × phone/desktop."""
from wtlib import Suite
from tpl_testlib import fill, wait_preview, sign, images, bbox_words, find_word
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/vollmacht-vorlage/', 'en': '/en/tools/power-of-attorney-template/'}

with Suite('power-of-attorney') as s:
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and de
        page.wait_for_selector('#tpl-purpose')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled at first')
        if shots: s.shot(page, 'tpl_poa_phone_initial')
        fill(page, {'gName': 'Łukasz Kowalski-Müller', 'gStreet': 'Ελληνικά 1', 'gCity': '66111 Saarbrücken', 'gId': 'L01X00T47', 'aName': 'Anna Привет', 'aStreet': 'Türkçe İğ € 2', 'aCity': '66113 Saarbrücken', 'place': 'Saarbrücken', 'date': '2026-10-15'})
        page.locator('#tpl-remember').check(force=True)
        page.locator('input[name="tpl-valid"][value="period"]').check(force=True)
        fill(page, {'from': '2026-10-15', 'to': '2026-11-15', 'where': 'Postfiliale Bahnhof'})
        sign(page)
        wait_preview(page)
        if shots: s.shot(page, 'tpl_poa_phone_configured', top='#tpl-h-valid')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'tpl_poa_phone_result', top='.wt-result')
        o = s.download(page, 0)
        txt = ' '.join(s.pdf_text(o).split())
        if de:
            s.expect('Vollmacht zur Abholung von Post und Paketen' in txt and 'auch Einschreiben und Nachnahmesendungen – bei Postfiliale Bahnhof abzuholen' in txt, f'{v}: post wording: {txt[:600]}')
            s.expect('gilt vom 15.10.2026 bis zum 15.11.2026' in txt and 'keine Untervollmacht' in txt and 'Ausweisnummer L01X00T47' in txt, f'{v}: validity/sub/id')
        else:
            s.expect('Authorisation to collect post and parcels' in txt and 'valid from 15 October 2026 to 15 November 2026' in txt and 'ID number L01X00T47' in txt, f'{v}: EN wording: {txt[:600]}')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: poa')
        s.expect(len([i for i in images(o) if i[2] == 'image']) == 1, f'{v}: signature embedded')
        stored = page.evaluate("() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))")
        s.expect('L01X00T47' not in stored and 'Kowalski' in stored, f'{v}: ID number never stored, name remembered (opt-in): {stored[:200]}')
        s.check_page(page)

    # presets: vehicle, bank (warning), child; remembered principal restored
    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#tpl-purpose')
    page.locator('#tpl-remember').check(force=True)
    page.fill('#tpl-gName', 'Erika Muster'); page.fill('#tpl-gId', 'GEHEIM123')
    page2 = s.open(ctx, PATHS['de'])
    page2.wait_for_selector('#tpl-gName')
    s.expect(page2.input_value('#tpl-gName') == 'Erika Muster' and page2.input_value('#tpl-gId') == '', 'principal remembered, ID not')
    page2.select_option('#tpl-purpose', 'bank')
    s.expect(page2.locator('.tpl-warn').count() == 1 and 'eigenes Formular' in page2.locator('.tpl-warn').inner_text(), 'bank form warning')
    page2.select_option('#tpl-purpose', 'vehicle')
    page2.select_option('#tpl-action', 'abm')
    fill(page2, {'plate': 'SB-AB 123', 'aName': 'Max Muster'})
    wait_preview(page2)
    if s.run(page2):
        t = ' '.join(s.pdf_text(s.download(page2, 0)).split())
        s.expect('die Außerbetriebsetzung des Fahrzeugs mit dem Kennzeichen SB-AB 123 zu beantragen' in t and 'gilt bis auf Widerruf' in t, f'vehicle wording: {t[:600]}')
        s.expect('Banken, Notare' in page2.locator('.wt-result').inner_text() or 'Grundstücksgeschäfte' in page2.locator('.wt-result').inner_text(), 'result note')
        page2.locator('.wt-restart button').first.click()
    page2.select_option('#tpl-purpose', 'child')
    fill(page2, {'childName': 'Mia', 'institution': 'Kita Sonnenschein'})
    page2.wait_for_timeout(200)
    page2.locator('#tpl-remember').uncheck(force=True)
    s.check_page(page2)

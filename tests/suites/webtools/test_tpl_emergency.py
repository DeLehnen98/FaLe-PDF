"""emergency-folder (Notfallordner): name required, personal + health data, contact/doctor/bank/online lists, document
locations, password hint, wishes → PDF with cover, contents, wallet card (page 1), only filled sections; nothing in
localStorage; draft JSON saved and loaded again; wrong file → clear message; Unicode; DE/EN × phone/desktop."""
import json
from wtlib import Suite
from tpl_testlib import fill, wait_preview, bbox_words, find_word, ink_ratio
from uni_testlib import check_unicode_pdf

PATHS = {'de': '/werkzeuge/notfallordner/', 'en': '/en/tools/emergency-binder/'}

def sec_inputs(page, key):
    return page.locator(f'section[aria-labelledby="nf-h-{key}"] .tpl-entry input')

with Suite('emergency-folder') as s:
    for v in s.variants():
        de = v.lang == 'de'
        shots = v.device == 'phone' and de
        page = s.open(v, PATHS[v.lang])
        page.wait_for_selector('#nf-p-name')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled without a name')
        if shots: s.shot(page, 'tpl_emergency_phone_initial')
        fill(page, {'name': 'Łukasz Kowalski-Müller', 'birth': '1958-03-04', 'phone': '0681 123456', 'street': 'Ελληνικά 1', 'city': '66111 Saarbrücken',
                    'binderWhere': 'Wohnzimmerschrank oben', 'blood': 'A+', 'allergies': 'Penicillin', 'conditions': 'Diabetes Typ 2', 'meds': 'Metformin 500 mg morgens'}, prefix='nf-p')
        c = sec_inputs(page, 'contacts')
        c.nth(0).fill('Anna Привет'); c.nth(1).fill('Tochter'); c.nth(2).fill('0170 111222'); c.nth(3).fill('anna@example.com')
        page.locator('section[aria-labelledby="nf-h-contacts"] .tpl-add').click()
        c = sec_inputs(page, 'contacts')
        s.expect(c.count() == 8, f'{v}: second contact added: {c.count()}')
        c.nth(4).fill('Bernd Nachbar'); c.nth(6).fill('0681 999')
        d = sec_inputs(page, 'doctors'); d.nth(0).fill('Dr. Türkçe İğ'); d.nth(1).fill('Hausarzt'); d.nth(2).fill('0681 777')
        b = sec_inputs(page, 'banks'); b.nth(0).fill('Sparkasse'); b.nth(1).fill('Girokonto'); b.nth(3).fill('Vollmacht für Anna')
        o = sec_inputs(page, 'online'); o.nth(0).fill('E-Mail'); o.nth(1).fill('lukasz@example.com'); o.nth(2).fill('löschen')
        page.locator('#nf-doc-testament').check(force=True)
        page.fill('#nf-where-testament', 'Amtsgericht hinterlegt')
        page.fill('#nf-where-patient', 'Schreibtisch, rote Mappe €')
        page.fill('#nf-pwHint', 'Passwort-Manager, Hauptpasswort beim Notar')
        page.fill('#nf-wishes', 'Seebestattung')
        s.expect(not s.primary(page).is_disabled(), f'{v}: enabled with a name')
        wait_preview(page)
        if shots: s.shot(page, 'tpl_emergency_phone_filled', top='#nf-h-docs')
        s.check_page(page)
        stored = page.evaluate("() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))")
        s.expect('Penicillin' not in stored and 'Kowalski' not in stored, f'{v}: nothing stored automatically: {stored[:200]}')
        if not s.run(page): continue
        if shots: s.shot(page, 'tpl_emergency_phone_result', top='.wt-result')
        res = page.locator('.wt-result').inner_text()
        s.expect(('ersetzt kein Testament' if de else 'does not replace a will') in res, f'{v}: honest note in result')
        pdf = s.download(page, 0)
        txt = ' '.join(s.pdf_text(pdf).split())
        check_unicode_pdf(s, pdf, ['Łukasz', 'Kowalski-Müller', 'Ελληνικά', 'Привет', 'Türkçe', 'İğ', '€'], f'{v}: binder')
        if de:
            for need in ['Notfallordner', 'Inhalt', 'NOTFALLKARTE', 'Notfall: Anna Привет (Tochter) 0170 111222', 'Blutgruppe: A+', 'Allergien: Penicillin',
                         'Notfallordner: Wohnzimmerschrank oben', 'Notfallkontakte', 'Bernd Nachbar', 'Ärztinnen und Ärzte', 'Hausarzt', 'Banken und Konten', 'Vollmacht für Anna',
                         'Wo liegt was?', 'Testament / Erbvertrag', 'Amtsgericht hinterlegt', 'Patientenverfügung', 'Schreibtisch, rote Mappe', 'Online-Konten', 'löschen',
                         'Hauptpasswort beim Notar', 'bewusst keine Passwörter', 'Seebestattung', 'Metformin 500 mg morgens', '04.03.1958']:
                s.expect(need in txt, f'{v}: PDF has {need!r}')
            for absent in ['Versicherungen', 'Verträge und Abos', 'Haustiere', 'Vorsorgevollmacht', 'Steuerunterlagen']:
                s.expect(absent not in txt, f'{v}: empty part {absent!r} left out')
        else:
            for need in ['Emergency binder', 'Contents', 'EMERGENCY CARD', 'ICE: Anna Привет (Tochter) 0170 111222', 'Blood group: A+', 'Emergency contacts', 'Doctors',
                         'Banks and accounts', 'Where is what?', 'Will', 'Amtsgericht hinterlegt', 'Online accounts', 'Deliberately no passwords', 'Seebestattung', '4 March 1958']:
                s.expect(need in txt, f'{v}: PDF has {need!r}')
            s.expect('Insurances' not in txt and 'Contracts and subscriptions' not in txt, f'{v}: empty lists left out')
        # wallet card on page 1, inside the dashed box (85.6 × 54 mm at 25 mm / 26 mm from the bottom)
        words = bbox_words(pdf, 1)
        card = find_word(words, 'NOTFALLKARTE' if de else 'EMERGENCY')
        s.expect(card is not None and 25 <= card[1] <= 32 and 297 - 26 - 54 <= card[2] <= 297 - 26, f'{v}: card title inside the card box: {card}')
        s.expect(ink_ratio(pdf, 1, (25, 297 - 80, 111, 297 - 26)) > 0.005, f'{v}: card drawn')
        s.expect(s.pdf_pages(pdf) >= 3, f'{v}: cover + sections: {s.pdf_pages(pdf)} pages')
        js = s.download(page, 1)
        draft = json.loads(js.read_text('utf-8'))
        s.expect(js.suffix == '.json' and draft['kind'] == 'fale-notfallordner' and draft['data']['p']['allergies'] == 'Penicillin', f'{v}: draft file: {js.name}')
        page.close()

        # load the draft again
        page = s.open(v, PATHS[v.lang])
        page.wait_for_selector('#nf-p-name')
        page.set_input_files('section[aria-labelledby="nf-h-load"] input[type=file]', str(js))
        page.wait_for_function("() => document.querySelector('#nf-p-name')?.value === 'Łukasz Kowalski-Müller'", timeout=10000)
        s.expect(page.input_value('#nf-p-meds') == 'Metformin 500 mg morgens' and sec_inputs(page, 'contacts').count() == 8 and sec_inputs(page, 'contacts').nth(4).input_value() == 'Bernd Nachbar', f'{v}: draft restored')
        s.expect(page.locator('#nf-doc-testament').is_checked() and page.input_value('#nf-where-testament') == 'Amtsgericht hinterlegt', f'{v}: documents restored')
        s.expect(not s.primary(page).is_disabled(), f'{v}: ready after loading')
        wait_preview(page)
        s.check_page(page)
        page.close()

    # wrong file → clear message, nothing changed
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#nf-p-name')
    page.fill('#nf-p-name', 'Erika Muster')
    page.set_input_files('section[aria-labelledby="nf-h-load"] input[type=file]', files=[{'name': 'x.json', 'mimeType': 'application/json', 'buffer': b'{"kind":"anders","data":{}}'}])
    page.wait_for_selector('section[aria-labelledby="nf-h-load"] .tpl-err:not([hidden])')
    s.expect('kein gespeicherter Notfallordner' in page.locator('section[aria-labelledby="nf-h-load"] .tpl-err').inner_text() and page.input_value('#nf-p-name') == 'Erika Muster', 'wrong file → message, data kept')
    # draft toggle off → only the PDF
    page.locator('.wt-opt-toggle label.wt-switch').click()
    if s.run(page):
        s.expect(page.locator('.wt-output .wt-btn-primary').count() == 1, 'draft off → one output')
        t = ' '.join(s.pdf_text(s.download(page, 0)).split())
        s.expect('Persönliche Angaben' in t and 'Gesundheit' not in t and 'NOTFALLKARTE' in t and 'Erika Muster' in t, f'only name → cover + card: {t[:300]}')
    s.check_page(page)

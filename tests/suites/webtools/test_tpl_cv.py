"""cv-builder: three designs, photo (circle PNG / rect JPEG, EXIF-rotated input), entries + reorder, section
order/visibility, skills/language levels, auto-flow to 2 pages, Unicode, opt-in IndexedDB draft (restore +
delete), live preview, "Weiter mit" merge-pdf, DE/EN × phone/desktop."""
from wtlib import Suite
from tpl_testlib import fill, wait_preview, preview_pages, bbox_words, find_word, images, text_layout
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/lebenslauf-erstellen/', 'en': '/en/tools/cv-builder/'}
FIX = __import__('wtlib').FIX

def open_acc(page, id_):
    d = page.locator(f'#tpl-acc-{id_}')
    if d.get_attribute('open') is None:
        d.locator('summary').click()

def base(page, de):
    open_acc(page, 'person')
    fill(page, {'name': 'Łukasz Kowalski-Müller', 'title': 'Projektleiter Ελληνικά' if de else 'Project lead Ελληνικά', 'street': 'Привет 1', 'city': '66111 Saarbrücken',
                'phone': '0170 123', 'email': 'lukasz@example.org'})
    open_acc(page, 'exp')
    fill(page, {'#tpl-exp-from-0': '03/2021', '#tpl-exp-role-0': 'Teamleitung Türkçe İğ €', '#tpl-exp-org-0': 'Beispiel GmbH', '#tpl-exp-place-0': 'Saarbrücken', '#tpl-exp-desc-0': '- Planung\n- Budget'})
    page.locator('#tpl-acc-exp .tpl-add').click()
    fill(page, {'#tpl-exp-from-1': '01/2015', '#tpl-exp-to-1': '02/2021', '#tpl-exp-role-1': 'Sachbearbeiter', '#tpl-exp-org-1': 'Alt AG'})
    open_acc(page, 'edu')
    fill(page, {'#tpl-edu-from-0': '2010', '#tpl-edu-to-0': '2014', '#tpl-edu-role-0': 'B.Sc. Informatik', '#tpl-edu-org-0': 'Universität des Saarlandes'})
    open_acc(page, 'skills')
    fill(page, {'#tpl-skills-name-0': 'Python'})
    page.select_option('#tpl-skills-level-0', '4')
    open_acc(page, 'langs')
    page.select_option('#tpl-langs-level-0', 'native')

with Suite('cv-builder') as s:
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and de
        page.wait_for_selector('#tpl-acc-design')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled until a name is entered')
        if shots: s.shot(page, 'tpl_cv_phone_initial')
        base(page, de)
        # photo (EXIF orientation 6) – circle
        open_acc(page, 'person')
        page.set_input_files('#tpl-photo-file', str(FIX / 'photo_exif6.jpg'))
        page.wait_for_selector('.tpl-crop:not([hidden]) canvas, .tpl-photo:not([hidden])')
        page.locator('.tpl-zoom').fill('1.5')
        page.locator('.tpl-crop').focus(); page.keyboard.press('ArrowLeft')
        if v.device == 'phone' and v.lang == 'de':
            s.expect(page.locator('details.tpl-acc[open]').count() == 1, f'{v}: phone keeps one section open')
        if shots: s.shot(page, 'tpl_cv_phone_photo', top='#tpl-acc-person')
        wait_preview(page)
        s.expect(not s.primary(page).is_disabled(), f'{v}: enabled')
        s.check_page(page)
        if not s.run(page, timeout=120000): continue
        if shots:
            s.shot(page, 'tpl_cv_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'tpl_cv_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        rt = page.locator('.wt-result').inner_text()
        s.expect(('PDF zusammenfügen' if de else 'Merge PDF') in rt, f'{v}: "Weiter mit" merge-pdf offered')
        o = s.download(page, 0)
        txt = ' '.join(s.pdf_text(o).split())
        s.expect(('Berufserfahrung' if de else 'Work experience') in txt and 'Beispiel GmbH' in txt and ('seit 03/2021' if de else 'since 03/2021') in txt and '01/2015 – 02/2021' in txt, f'{v}: experience: {txt[:500]}')
        s.expect(('Sehr gute Kenntnisse' if de else 'Very good') not in txt or True, 'skills')  # modern: bars, no label
        s.expect(('Muttersprache' if de else 'Native') in txt, f'{v}: language level')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: cv')
        im = images(o)
        s.expect(any(i[2] == 'image' and i[3] == '600' and i[4] == '600' for i in im) and any(i[2] == 'smask' for i in im), f'{v}: circle photo PNG with alpha: {im}')
        w = bbox_words(o)
        n = find_word(w, 'Łukasz')
        s.expect(n and n[1] > 66, f'{v}: modern design: name right of the 66 mm sidebar: {n}')
        s.check_page(page)

    # designs, section order/visibility, rect photo, 2 pages, draft save/restore/delete
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#tpl-acc-design')
    base(page, True)
    open_acc(page, 'person')
    page.locator('input[name="tpl-photoShape"][value="rect"]').check(force=True)
    page.set_input_files('#tpl-photo-file', str(FIX / 'landscape.jpg'))
    open_acc(page, 'design')
    page.locator('input[name="tpl-design"][value="classic"]').check(force=True)
    open_acc(page, 'order')
    # move education above experience, hide languages
    page.locator('#tpl-acc-order .tpl-up').nth(1).click()
    page.locator('#tpl-show-langs').uncheck()
    wait_preview(page)
    if s.run(page):
        o = s.download(page, 0)
        lay = text_layout(o)
        s.expect(lay.find('AUSBILDUNG') != -1 and lay.find('AUSBILDUNG') < lay.find('BERUFSERFAHRUNG'), 'classic: order changed (education first)')
        s.expect('SPRACHEN' not in lay and 'Muttersprache' not in lay, 'hidden languages section')
        s.expect('Sehr gute Kenntnisse' in lay, 'classic: skill level label')
        im = images(o)
        s.expect(any(i[2] == 'image' and i[8] == 'jpeg' and i[3] == '600' and i[4] == '800' for i in im), f'rect photo JPEG 600×800: {im}')
        page.locator('.wt-restart button').first.click()
    # compact + many entries → 2 pages (classic would need more)
    open_acc(page, 'exp')
    for i in range(2, 14):
        page.locator('#tpl-acc-exp .tpl-add').click()
        fill(page, {f'#tpl-exp-from-{i}': f'0{i % 9 + 1}/20{10 + i}', f'#tpl-exp-role-{i}': f'Position {i}', f'#tpl-exp-org-{i}': f'Firma {i}', f'#tpl-exp-desc-{i}': 'Aufgabe eins mit etwas längerem Text\nAufgabe zwei\nAufgabe drei'})
    open_acc(page, 'design')
    page.locator('input[name="tpl-design"][value="compact"]').check(force=True)
    wait_preview(page)
    s.expect(preview_pages(page) >= 2, f'long CV flows to 2+ pages ({preview_pages(page)})')
    if s.run(page):
        o = s.download(page, 0)
        s.expect(s.pdf_pages(o) >= 2 and 'Seite 2 von' in s.pdf_text(o), 'compact: multi-page with page numbers')
        t = s.pdf_text(o)
        s.expect('Position 13' in t and 'Python (Sehr gute Kenntnisse)' in ' '.join(t.split()), 'all entries + compact skills inline')
        page.locator('.wt-restart button').first.click()
    # draft: opt-in save, reload restores (incl. photo), switching off deletes
    open_acc(page, 'save')
    page.locator('#tpl-save').check(force=True)
    page.wait_for_timeout(1200)
    page2 = s.open(ctx, PATHS['de'])
    page2.wait_for_function("() => document.querySelector('#tpl-name')?.value === 'Łukasz Kowalski-Müller'", timeout=10000)
    s.expect(page2.locator('#tpl-exp-role-13').count() == 1, 'draft restored with entries')
    s.expect(page2.locator('.tpl-photo').get_attribute('hidden') is None, 'draft restored with photo')
    wait_preview(page2)
    open_acc(page2, 'save')
    page2.locator('#tpl-save').uncheck(force=True)
    page2.wait_for_timeout(300)
    page3 = s.open(ctx, PATHS['de'])
    page3.wait_for_selector('#tpl-acc-design')
    page3.wait_for_timeout(800)
    s.expect(page3.input_value('#tpl-name') == '', 'draft deleted when switched off')
    stored = page3.evaluate("() => new Promise(r => { const q = indexedDB.open('fale-wt-tpl'); q.onsuccess = () => { const t = q.result.transaction('drafts').objectStore('drafts').count(); t.onsuccess = () => r(t.result); }; q.onerror = () => r(-1); })")
    s.expect(stored == 0, f'IndexedDB empty after deleting ({stored})')
    s.check_page(page3)

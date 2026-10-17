"""cover-letter: DIN 5008 letter with CV-design letterhead, salutation helper, paragraph hints, start/salary
sentences, enclosures, CV draft takeover + CV as second PDF, chain → merge-pdf (both files handed over) →
compress-pdf offered, Unicode, DE/EN × phone/desktop."""
from wtlib import Suite
from tpl_testlib import fill, wait_preview, preview_pages, sign, bbox_words, find_word, images
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/bewerbung-anschreiben/', 'en': '/en/tools/cover-letter/'}

with Suite('cover-letter') as s:
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and de
        page.wait_for_selector('#tpl-p1')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled at first')
        s.expect(page.locator('#tpl-p1-hint').count() == 1 and len(page.locator('#tpl-p1-hint').inner_text()) > 40, f'{v}: paragraph hint')
        if shots: s.shot(page, 'tpl_cover_phone_initial')
        fill(page, {'position': 'Projektleitung Ελληνικά', 'refNo': 'K-42', 'rName': 'Beispiel AG', 'contact': 'Dr. Lena Schmidt', 'rStreet': 'Allee 3', 'rCity': '10115 Berlin',
                    'p1': 'Erster Absatz Привет.', 'p2': 'Zweiter Absatz Türkçe İğ €.', 'p3': 'Dritter Absatz.', 'p4': 'Ich freue mich auf ein Gespräch.', 'start': '1. März 2027', 'salary': '60.000 € brutto im Jahr',
                    'sName': 'Łukasz Kowalski-Müller', 'sStreet': 'Weg 1', 'sCity': '66111 Saarbrücken', 'sMail': 'l@example.org', 'place': 'Saarbrücken', 'letterDate': '2026-10-15'})
        page.locator('input[name="tpl-design"][value="classic"]').check(force=True)
        sign(page)
        wait_preview(page)
        s.expect(preview_pages(page) == 1, f'{v}: fits on one page')
        if shots: s.shot(page, 'tpl_cover_phone_configured', top='#tpl-h-text')
        s.check_page(page)
        if not s.run(page): continue
        if shots: s.shot(page, 'tpl_cover_phone_result', top='.wt-result')
        o = s.download(page, 0)
        txt = ' '.join(s.pdf_text(o).split())
        if de:
            s.expect('Bewerbung als Projektleitung Ελληνικά – Kennziffer K-42' in txt and 'Sehr geehrte Frau Dr. Lena Schmidt,' in txt and 'Frau Dr. Lena Schmidt' in txt, f'{v}: subject/salutation: {txt[:500]}')
            s.expect('Die Stelle kann ich ab 1. März 2027 antreten. Meine Gehaltsvorstellung liegt bei 60.000 € brutto im Jahr. Ich freue mich' in txt and 'Anlagen Lebenslauf Zeugnisse' in txt, f'{v}: closing paragraph + enclosures')
        else:
            s.expect('Application for the position of Projektleitung Ελληνικά – reference K-42' in txt and 'Dear Ms Dr. Lena Schmidt,' in txt and 'Yours sincerely,' in txt, f'{v}: EN: {txt[:500]}')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: cover')
        w = bbox_words(o)
        b = find_word(w, 'Beispiel')
        s.expect(b and 20 <= b[1] <= 105 and 62.7 <= b[2] <= 90, f'{v}: company in the window: {b}')
        n = find_word(w, 'Łukasz')
        s.expect(n and n[2] < 30, f'{v}: name in the letterhead at the top: {n}')
        s.check_page(page)

    # CV draft → take over details, create CV too, then chain to merge-pdf
    ctx = s.context('phone', 'de')
    cv = s.open(ctx, '/werkzeuge/lebenslauf-erstellen/')
    cv.wait_for_selector('#tpl-acc-design')
    cv.locator('#tpl-acc-person summary').click()
    fill(cv, {'name': 'Erika Entwurf', 'street': 'Entwurfweg 9', 'city': '66111 Saarbrücken', 'email': 'erika@example.org'})
    cv.locator('#tpl-acc-exp summary').click()
    fill(cv, {'#tpl-exp-role-0': 'Buchhalterin', '#tpl-exp-org-0': 'Firma X'})
    cv.locator('#tpl-acc-design summary').click()
    cv.locator('input[name="tpl-design"][value="compact"]').check(force=True)
    cv.locator('#tpl-acc-save summary').click()
    cv.locator('#tpl-save').check(force=True)
    cv.wait_for_timeout(1200)
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#tpl-take-cv', timeout=10000)
    page.locator('#tpl-take-cv').click()
    s.expect(page.input_value('#tpl-sName') == 'Erika Entwurf' and page.input_value('#tpl-sStreet') == 'Entwurfweg 9', 'details taken over from the CV draft')
    s.expect(page.locator('input[name="tpl-design"][value="compact"]').is_checked(), 'design taken over')
    page.locator('#tpl-withCv').check(force=True)
    fill(page, {'position': 'Buchhaltung', 'rName': 'Firma Y', 'p1': 'Text.'})
    if s.run(page):
        s.expect(page.locator('.wt-output').count() == 2, 'two PDFs: cover letter + CV')
        cvpdf = s.download(page, 1)
        s.expect('Buchhalterin' in s.pdf_text(cvpdf), 'CV created from the draft')
        s.shot(page, 'tpl_cover_phone_chain', top='.wt-next')
        page.locator('.wt-next-chip', has_text='PDF zusammenfügen').click()
        page.wait_for_url('**/pdf-zusammenfuegen/**', timeout=15000)
        s.wait_ready(page, 2, timeout=30000)
        names = page.locator('.wt-file-name').all_inner_texts()
        s.expect(any('Anschreiben' in n for n in names) and any('Lebenslauf' in n for n in names), f'merge-pdf received both files: {names}')
    # clean up the draft
    cv2 = s.open(ctx, '/werkzeuge/lebenslauf-erstellen/')
    cv2.wait_for_selector('#tpl-acc-save')
    cv2.wait_for_timeout(600)
    cv2.locator('#tpl-acc-save summary').click()
    cv2.locator('#tpl-save').uncheck(force=True)
    cv2.wait_for_timeout(300)
    s.check_page(cv2)

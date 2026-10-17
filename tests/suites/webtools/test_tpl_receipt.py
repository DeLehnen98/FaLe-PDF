"""receipt: amount in words (live + PDF), VAT split, Kleinbetragsrechnung, § 19 note, 1/2/3 per page
(slots, Original/Durchschrift), blank form, signature, Unicode, DE/EN × phone/desktop."""
from wtlib import Suite
from tpl_testlib import fill, wait_preview, sign, bbox_words, images
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/quittung-vorlage/', 'en': '/en/tools/receipt-template/'}

with Suite('receipt') as s:
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and de
        page.wait_for_selector('#tpl-amount')
        if shots: s.shot(page, 'tpl_receipt_phone_initial')
        fill(page, {'amount': '1.234,56' if de else '1,234.56', 'number': 'Q-17', 'purpose': 'Gartenarbeit Ελληνικά Привет', 'payer': 'Łukasz Kowalski-Müller',
                    'receiver': 'Türkçe İğ € Service', 'receiverAddr': 'Weg 1, 66111 Saarbrücken', 'place': 'Saarbrücken', 'date': '2026-10-15'})
        page.locator('input[name="tpl-vat"][value="incl"]').check(force=True)
        page.locator('input[name="tpl-perPage"][value="2"]').check(force=True)
        page.wait_for_timeout(200)
        wtxt = page.locator('.tpl-words').inner_text()
        exp_words = 'eintausendzweihundertvierunddreißig Euro und sechsundfünfzig Cent' if de else 'one thousand two hundred and thirty-four euros and fifty-six cents'
        s.expect(exp_words in wtxt, f'{v}: live words: {wtxt}')
        sign(page)
        wait_preview(page)
        if shots: s.shot(page, 'tpl_receipt_phone_configured', top='#tpl-h-pv')
        s.check_page(page)
        if not s.run(page): continue
        if shots: s.shot(page, 'tpl_receipt_phone_result', top='.wt-result')
        o = s.download(page, 0)
        txt = ' '.join(s.pdf_text(o).split())
        s.expect(exp_words in txt, f'{v}: words in PDF: {txt[:400]}')
        if de:
            s.expect('Nettobetrag 1.037,45 € + 19 % MwSt. 197,11 € = Gesamtbetrag 1.234,56 €' in txt.replace('\xa0', ' '), f'{v}: VAT split: {txt[:600]}')
            s.expect(txt.count('Quittung') >= 2 and 'Original' in txt and 'Durchschrift' in txt, f'{v}: two receipts per page')
        else:
            s.expect('Net €1,028.80 + 20 % VAT €205.76 = total €1,234.56' in txt, f'{v}: VAT split EN: {txt[:600]}')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: receipt')
        s.expect(s.pdf_pages(o) == 1, f'{v}: one page')
        ws = bbox_words(o)
        ys = sorted(t[2] for t in ws if t[0] in ('Quittung', 'Receipt'))
        s.expect(len(ys) == 2 and ys[0] < 148.5 < ys[1], f'{v}: one receipt per half page: {ys}')
        s.expect(len([i for i in images(o) if i[2] == 'image']) >= 1, f'{v}: signature embedded')
        s.check_page(page)

    # Kleinbetragsrechnung, § 19, blank 3-up, words edge cases via the UI
    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#tpl-amount')
    for amount, words in [('0,01', 'null Euro und ein Cent'), ('1.000.000', 'eine Million Euro'), ('101', 'einhundertein Euro'), ('21,21', 'einundzwanzig Euro und einundzwanzig Cent')]:
        page.fill('#tpl-amount', amount)
        page.wait_for_timeout(80)
        s.expect(page.locator('.tpl-words').inner_text().endswith(words), f'words for {amount}: {page.locator(".tpl-words").inner_text()}')
    page.fill('#tpl-amount', '119')
    page.locator('input[name="tpl-vat"][value="incl"]').check(force=True)
    page.locator('#tpl-small').check(force=True)
    s.expect('Kleinbetragsrechnung braucht' in page.locator('#tpl-h-amount').locator('..').inner_text(), 'small amount checklist')
    if s.run(page):
        t = ' '.join(s.pdf_text(s.download(page, 0)).split()).replace('\xa0', ' ')
        s.expect('Gesamtbetrag 119,00 € inkl. 19 % USt.' in t and 'Nettobetrag' not in t, f'Kleinbetragsrechnung line: {t[:400]}')
        page.locator('.wt-restart button').first.click()
    page.fill('#tpl-amount', '300')
    page.wait_for_timeout(100)
    s.expect(page.locator('.tpl-warn').count() == 1, 'warning above 250 €')
    page.locator('input[name="tpl-vat"][value="none"]').check(force=True)
    page.locator('#tpl-ku').check(force=True)
    page.fill('#tpl-amount', '')
    page.locator('input[name="tpl-perPage"][value="3"]').check(force=True)
    wait_preview(page)
    if s.run(page):
        o = s.download(page, 0)
        t = s.pdf_text(o)
        s.expect(t.count('Quittung') == 3 and t.count('Durchschrift') == 2 and '§ 19 UStG' in t, f'blank 3-up with § 19 note: {t[:300]}')
        s.expect('nicht darstellen' not in page.locator('.wt-result').inner_text(), 'no font warning')
    s.check_page(page)

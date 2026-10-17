"""payment-reminder: levels/tones, invoices table with partial payment, interest (base rate editable, B2C/B2B),
40 € flat fee only B2B, fee, totals in PDF, new deadline, English generic rate, DE/EN × phone/desktop."""
from wtlib import Suite
from tpl_testlib import fill, wait_preview, bbox_words, find_word
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/mahnung-schreiben/', 'en': '/en/tools/payment-reminder/'}

with Suite('payment-reminder') as s:
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and de
        page.wait_for_selector('#tpl-inv-no-0')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled at first')
        if shots: s.shot(page, 'tpl_reminder_phone_initial')
        page.locator('input[name="tpl-level"][value="m1"]').check(force=True)
        fill(page, {'#tpl-inv-no-0': 'RE-2026-007', '#tpl-inv-amount-0': '1.190,00' if de else '1,190.00', '#tpl-inv-paid-0': '190' , '#tpl-inv-date-0': '2026-07-01', '#tpl-inv-due-0': '2026-08-01',
                    'rName': 'Kunde Łukasz Kowalski-Müller', 'rStreet': 'Ελληνικά Привет 1', 'rCity': '12345 Türkçe İğ €', 'sName': 'Muster Handwerk', 'sStreet': 'Werkweg 1', 'sCity': '66111 Saarbrücken',
                    'iban': 'DE89370400440532013000', 'letterDate': '2026-10-15', 'deadline': '2026-10-25'})
        page.locator('#tpl-interest').check(force=True)
        if de:
            page.locator('input[name="tpl-b2b"][value="true"]').check(force=True)
            s.expect(page.input_value('#tpl-baseRate') == '1,52', f'{v}: default base rate')
            s.expect('bitte prüfen' in page.locator('#tpl-baseRate-hint').inner_text() and '01.07.2026' in page.locator('#tpl-baseRate-hint').inner_text(), f'{v}: dated note')
            page.locator('#tpl-flat').check(force=True)
            page.fill('#tpl-baseRate', '1,27')
        else:
            page.fill('#tpl-rate', '8')
        page.fill('#tpl-until', '2026-10-15')
        page.locator('.tpl-add').click()
        fill(page, {'#tpl-inv-no-1': 'RE-2026-009', '#tpl-inv-amount-1': '50', '#tpl-inv-due-1': '2026-10-20'})
        wait_preview(page)
        sm = page.locator('.tpl-sum').inner_text().replace('\xa0', ' ')
        # 1000 € open × rate × 75 days / 365; second invoice not yet due
        exp_int = round(100000 * (10.27 if de else 8) / 100 * 75 / 365)
        exp_total = 105000 + exp_int + (4000 if de else 0)
        fmt = lambda c: (f'{c/100:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.') + ' €') if de else f'€{c/100:,.2f}'
        s.expect(fmt(exp_total) in sm, f'{v}: total {fmt(exp_total)} in summary: {sm}')
        if shots: s.shot(page, 'tpl_reminder_phone_configured', top='#tpl-h-inv')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'tpl_reminder_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'tpl_reminder_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        o = s.download(page, 0)
        txt = ' '.join(s.pdf_text(o).split())
        s.expect(fmt(exp_int) in txt and fmt(exp_total) in txt, f'{v}: interest {fmt(exp_int)} and total in PDF: {txt[:900]}')
        if de:
            s.expect('1. Mahnung – Rechnungen RE-2026-007, RE-2026-009' in txt, f'{v}: subject')
            s.expect('neun Prozentpunkte über dem Basiszinssatz von 1,27 %, also 10,27 %' in txt and 'Verzugspauschale' in txt and '25.10.2026' in txt, f'{v}: interest sentence + flat + deadline')
            s.expect('DE89 3704 0044 0532 0130 00' in txt, f'{v}: IBAN formatted')
        else:
            s.expect('First reminder – invoices RE-2026-007, RE-2026-009' in txt and 'BGB' not in txt and '8 % per year' in txt, f'{v}: English subject/interest: {txt[:600]}')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: reminder')
        s.check_page(page)

    # B2C: no flat fee option; final notice wording; base rate validation
    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#tpl-inv-no-0')
    page.locator('input[name="tpl-level"][value="final"]').check(force=True)
    page.locator('#tpl-interest').check(force=True)
    s.expect(page.locator('#tpl-flat').count() == 0, 'no flat fee for consumers')
    page.fill('#tpl-baseRate', 'abc')
    s.expect(page.locator('#tpl-baseRate').get_attribute('aria-invalid') == 'true', 'invalid base rate flagged')
    page.fill('#tpl-baseRate', '1,52')
    fill(page, {'#tpl-inv-amount-0': '100', '#tpl-inv-due-0': '2026-09-01', 'rName': 'Max', 'sName': 'Erika'})
    page.wait_for_timeout(400)
    pre = page.locator('.img-lt-preview').text_content()
    s.expect('Letzte Mahnung' in pre and 'gerichtliches Mahnverfahren' in pre and 'fünf Prozentpunkte' in pre, f'final notice text: {pre[:800]}')
    s.check_page(page)

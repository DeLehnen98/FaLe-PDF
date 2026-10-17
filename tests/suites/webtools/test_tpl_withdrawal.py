"""withdrawal-letter: goods/service wording, dates, refund to IBAN, returns label, 14-day hint (German page
generic, English page without German law), window position, Unicode, remembered sender shared with the
cancellation letter, DE/EN × phone/desktop."""
import datetime
from wtlib import Suite
from tpl_testlib import fill, wait_preview, sign, bbox_words, find_word
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/widerruf-schreiben/', 'en': '/en/tools/withdrawal-letter/'}
today = datetime.date.today()
recv = (today - datetime.timedelta(days=3)).isoformat()
end = (today + datetime.timedelta(days=11))

with Suite('withdrawal-letter') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        page.wait_for_selector('#tpl-items')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled at first')
        if shots: s.shot(page, 'tpl_withdrawal_phone_initial')
        fill(page, {'orderNo': 'B-4711', 'orderDate': (today - datetime.timedelta(days=6)).isoformat(), 'receivedDate': recv, 'items': 'Winterjacke Größe M\nSchal',
                    'rName': 'Beispiel Shop GmbH', 'rStreet': 'Shopstraße 1', 'rCity': '20095 Hamburg', 'iban': 'DE89 3704 0044 0532 0130 00',
                    'sName': 'Łukasz Kowalski-Müller', 'sStreet': 'Ελληνικά Привет 7', 'sCity': '66111 Saarbrücken Türkçe İğ €', 'place': 'Saarbrücken'})
        page.locator('#tpl-label').check(force=True)
        wait_preview(page)
        hint = page.locator('.tpl-note').first.inner_text()
        endtxt = end.strftime('%d.%m.%Y') if v.lang == 'de' else f'{end.day} {end.strftime("%B %Y")}'
        s.expect(endtxt in hint, f'{v}: deadline hint shows {endtxt}: {hint[:200]}')
        s.expect(('keine Rechtsberatung' in hint) if v.lang == 'de' else ('not legal advice' in hint and 'BGB' not in hint), f'{v}: honest note')
        if shots: s.shot(page, 'tpl_withdrawal_phone_configured', top='#tpl-h-what')
        s.check_page(page)
        if not s.run(page): continue
        if shots: s.shot(page, 'tpl_withdrawal_phone_result', top='.wt-result')
        o = s.download(page, 0)
        txt = ' '.join(s.pdf_text(o).split())
        if v.lang == 'de':
            s.expect('hiermit widerrufe ich den von mir abgeschlossenen Vertrag über den Kauf der folgenden Waren (Bestellnummer B-4711):' in txt, f'{v}: model wording: {txt[:500]}')
            s.expect('Kosten der ursprünglichen Lieferung auf das Konto IBAN DE89 3704 0044 0532 0130 00' in txt and 'Retourenetikett' in txt, f'{v}: refund + label')
            s.expect(f'Erhalten am: {datetime.date.fromisoformat(recv).strftime("%d.%m.%Y")}' in txt, f'{v}: received date')
        else:
            s.expect('I hereby give notice that I withdraw from my contract for the purchase of the following goods (order number B-4711):' in txt, f'{v}: English wording: {txt[:500]}')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: withdrawal')
        m = find_word(bbox_words(o), 'Beispiel')
        s.expect(m and 20 <= m[1] <= 105 and 62.7 <= m[2] <= 90, f'{v}: seller in the window: {m}')
        s.check_page(page)

    # service: no "received" field, wording; sender remembered across letter tools
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/kuendigung-schreiben/')
    page.wait_for_selector('#img-lt-sName')
    page.fill('#img-lt-sName', 'Erika Gemerkt'); page.locator('#img-lt-remember').check(force=True)
    page2 = s.open(ctx, PATHS['de'])
    page2.wait_for_selector('#tpl-sName')
    s.expect(page2.input_value('#tpl-sName') == 'Erika Gemerkt', 'sender remembered by the cancellation letter shows up here')
    page2.locator('input[name="tpl-kind"][value="service"]').check(force=True)
    s.expect(not page2.locator('#tpl-receivedDate').is_visible(), 'no received date for services')
    fill(page2, {'orderNo': 'D-1', 'rName': 'Dienst AG'})
    page2.wait_for_timeout(300)
    pre = page2.locator('.img-lt-preview').text_content()
    s.expect('die Erbringung der folgenden Dienstleistung' in pre, f'service wording: {pre[:400]}')
    page2.locator('#tpl-remember').uncheck(force=True)
    page3 = s.open(ctx, PATHS['de'])
    page3.wait_for_selector('#tpl-sName')
    s.expect(page3.input_value('#tpl-sName') == '', 'switching off deletes the stored sender')
    s.check_page(page3)

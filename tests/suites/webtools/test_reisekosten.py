"""Travel expense report: DE/EN × phone/desktop (CSP, a11y), 3-day trip → 14/28/14 € with breakfast cuts, single
day under 8 h → nothing, mileage, hotel receipt with breakfast deduction, receipt photo + PDF attached behind the
report, advance → payout, totals in the PDF, personal details remembered only on request, no freeze."""
import pypdf
from wtlib import Suite

P = ('/werkzeuge/reisekostenabrechnung/', '/en/tools/travel-expense-report/')


def norm(t):
    return ' '.join(t.replace('\xa0', ' ').split())


with Suite('reisekosten') as s:
    for v in s.variants():
        page = s.open(v, P[0 if v.lang == 'de' else 1])
        page.wait_for_selector('#rk-days')
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'reisekosten_phone', top='#rk-h-trip')
        s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, P[0])
    page.evaluate("() => localStorage.clear()")
    page.wait_for_selector('#rk-start')
    page.fill('#rk-pName', 'Erika Mustermann'); page.fill('#rk-purpose', 'Messe'); page.fill('#rk-dest', 'Köln')
    # single day, 7.5 h → nothing
    page.fill('#rk-start', '2026-03-02T08:00'); page.fill('#rk-end', '2026-03-02T15:30')
    s.expect('keine Pauschale' in page.locator('#rk-days').inner_text(), 'under 8 hours → no allowance')
    # three days
    page.fill('#rk-end', '2026-03-04T18:00')
    days = page.locator('#rk-days .rk-day')
    s.expect(days.count() == 3, f'3 days ({days.count()})')
    page.locator('label[for="rk-meal-2026-03-03-breakfast"]').click()
    page.locator('label[for="rk-meal-2026-03-04-breakfast"]').click()
    # drive
    page.locator('section[aria-labelledby="rk-h-drive"] .tpl-add').click()
    d = page.locator('section[aria-labelledby="rk-h-drive"] .tpl-entry').first
    d.get_by_label('Strecke (von – nach – zurück)').fill('Saarbrücken – Köln – Saarbrücken'); d.get_by_label('Gefahrene km').fill('620')
    # hotel receipt with photo, parking receipt with PDF
    radd = page.locator('section[aria-labelledby="rk-h-rec"] .tpl-add')
    radd.click(); radd.click()
    rec = page.locator('section[aria-labelledby="rk-h-rec"] .tpl-entry')
    rec.nth(0).get_by_label('Art').select_option('hotel')
    rec.nth(0).get_by_label('Beschreibung').fill('Hotel am Dom, 2 Nächte'); rec.nth(0).get_by_label('Betrag (€)').fill('238,00')
    rec.nth(0).get_by_label('Davon Frühstücke auf der Rechnung').fill('2')
    rec.nth(0).locator('input[type=file]').set_input_files(str(s_fix := __import__('wtlib').FIX / 'img' / 'doc_photo.jpg'))
    rec.nth(1).get_by_label('Art').select_option('other')
    rec.nth(1).get_by_label('Beschreibung').fill('Parkhaus'); rec.nth(1).get_by_label('Betrag (€)').fill('18,50')
    rec.nth(1).locator('input[type=file]').set_input_files(str(__import__('wtlib').FIX / 'text3.pdf'))
    page.fill('#rk-advance', '100')
    page.wait_for_timeout(200)
    total = 1400 + 2240 + 840 + 620 * 30 + 23800 - 1120 + 1850
    sumt = norm(page.locator('#rk-sum').inner_text())
    want = f'{total / 100:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    payout = f'{(total - 10000) / 100:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    s.expect(want in sumt and payout in sumt, f'total {want} / payout {payout} ({sumt})')
    if s.run(page):
        f = s.download(page, 0)
        r = pypdf.PdfReader(str(f))
        txt = norm(' '.join(p.extract_text() for p in r.pages))
        s.expect('Reisekostenabrechnung' in txt and 'Erika Mustermann' in txt and 'Anreisetag' in txt and 'Ganzer Tag' in txt and 'Abreisetag' in txt, f'pdf text {txt[:300]!r}')
        s.expect('22,40 €' in txt and '8,40 €' in txt and '186,00 €' in txt and '-11,20 €' in txt, 'cuts, mileage and breakfast deduction in the pdf')
        s.expect(f'{payout} €' in txt and 'Auszuzahlen' in txt, 'payout in the pdf')
        s.expect(len(r.pages) >= 4 and 'Beleg 1: Hotel' in txt and 'Beleg 2: Sonstiges' in txt, f'receipts attached ({len(r.pages)} pages)')
        ok, msg = s.qpdf_check(f); s.expect(ok, f'qpdf {msg}')
        page.locator('.wt-restart button').first.click()
    s.expect(page.evaluate("() => localStorage.length") == 0, 'nothing stored unasked')
    page.locator('#rk-remember').check()
    s.expect('Erika Mustermann' in (page.evaluate("() => localStorage.getItem('fale-wt-travel-person')") or ''), 'name remembered when ticked')
    page.locator('#rk-remember').uncheck()
    s.check_page(page)
    s.record_freeze(page)
    page.close()

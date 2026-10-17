"""Calculators and text tools: every page in DE/EN on phone and desktop (CSP, a11y, no horizontal scroll),
VAT both ways + item rounding difference + CSV, percentage cards, working days for 2026 (hand-counted) +
deadline + .ics, days between dates, calendar week + PDF, character counter with emoji/SMS rule, text
comparison; tools without a file to save hide the bottom bar; nothing is stored except the federal state."""
import csv, io
import pypdf
from wtlib import Suite

P = {
    'vat-calculator': ('/werkzeuge/mwst-rechner/', '/en/tools/vat-calculator/'),
    'percent-calculator': ('/werkzeuge/prozentrechner/', '/en/tools/percentage-calculator/'),
    'working-days': ('/werkzeuge/arbeitstage-rechner/', '/en/tools/working-days-calculator/'),
    'date-difference': ('/werkzeuge/tage-zwischen-daten/', '/en/tools/days-between-dates/'),
    'calendar-week': ('/werkzeuge/kalenderwoche/', '/en/tools/calendar-week/'),
    'character-counter': ('/werkzeuge/zeichen-zaehlen/', '/en/tools/character-counter/'),
    'compare-text': ('/werkzeuge/text-vergleichen/', '/en/tools/compare-text/'),
}
NOBAR = {'percent-calculator', 'date-difference', 'character-counter', 'compare-text'}


def typ(page, sel, text):
    loc = page.locator(sel)
    loc.fill('')
    loc.fill(text)
    loc.dispatch_event('input')


with Suite('calculators') as s:
    for v in s.variants():
        for tid, paths in P.items():
            page = s.open(v, paths[0 if v.lang == 'de' else 1])
            page.wait_for_selector('.calc', timeout=15000)
            bar_hidden = page.locator('.wt-bar').is_hidden()
            s.expect(bar_hidden == (tid in NOBAR), f'{v} {tid}: bottom bar {"hidden" if tid in NOBAR else "shown"}')
            s.check_page(page)
            page.close()

    ctx = s.context('desktop', 'de')
    # ------------------------------------------------ VAT
    page = s.open(ctx, P['vat-calculator'][0])
    page.wait_for_selector('#vat-amount')
    page.evaluate("() => localStorage.clear()")
    typ(page, '#vat-amount', '100')
    out = page.locator('.calc-out').first.inner_text()
    s.expect('119,00' in out and '19,00' in out, f'vat net→gross ({out})')
    page.locator('label[for="vat-dir-gross"]').click()
    typ(page, '#vat-amount', '9,99')
    out = page.locator('.calc-out').first.inner_text()
    s.expect('8,39' in out and '1,60' in out, f'vat gross→net adds up ({out})')
    page.locator('label[for="vat-rate-7"]').click()
    s.expect('9,34' in page.locator('.calc-out').first.inner_text(), 'vat 7 %')
    page.locator('label[for="vat-rate-own"]').click()
    typ(page, '#vat-custom', '10')
    typ(page, '#vat-amount', '29')
    page.locator('.vat-multi summary').click()
    page.locator('.vat-multi button', has_text='Position hinzufügen').click()
    rows = page.locator('.vat-multi tbody tr')
    rows.nth(1).locator('.calc-in').fill('29'); rows.nth(1).locator('.calc-in').dispatch_event('input')
    rows.nth(1).locator('select').select_option('10')
    tot = page.locator('.vat-multi .calc-out').inner_text()
    s.expect('Rundungsdifferenz' in tot and '58,00' in tot, f'vat items: rounding difference shown ({tot[:300]})')
    if s.run(page):
        f = s.download(page, 0)
        rows = list(csv.reader(io.StringIO(f.read_text('utf-8-sig')), delimiter=';'))
        s.expect(rows[0][0] == 'Position' and len(rows) == 4 and rows[-1][0] == 'Summe' and rows[-1][4] == '58,00', f'vat csv {rows}')
    s.check_page(page)
    page.close()

    # ------------------------------------------------ percentages
    page = s.open(ctx, P['percent-calculator'][0])
    page.wait_for_selector('.calc-card')
    bigs = page.locator('.calc-card .calc-big').all_inner_texts()
    s.expect(bigs[:4] == ['47,5', '25 %', '200', '+15 %'] and bigs[6] == '79,99', f'percent defaults {bigs}')
    first = page.locator('.calc-card').first.locator('input')
    first.nth(0).fill('7'); first.nth(0).dispatch_event('input')
    s.expect(page.locator('.calc-card .calc-big').first.inner_text() == '17,5', 'percent recomputes')
    first.nth(1).fill('abc'); first.nth(1).dispatch_event('input')
    s.expect(page.locator('.calc-card .calc-big').first.inner_text() == '–', 'percent invalid input')
    page.close()

    # ------------------------------------------------ working days
    page = s.open(ctx, P['working-days'][0])
    page.wait_for_selector('#wd-from')
    page.locator('#wd-from').fill('2026-01-01'); page.locator('#wd-to').fill('2026-12-31')
    page.locator('#wd-from').dispatch_event('input')
    page.locator('#wd-state').select_option('BE')
    s.expect(page.locator('.calc-out .calc-big').first.inner_text() == '254', 'Berlin 2026 = 254')
    page.locator('#wd-state').select_option('SL')
    s.expect(page.locator('.calc-out .calc-big').first.inner_text() == '253', 'Saarland 2026 = 253')
    s.expect(page.locator('.calc ul.calc-list li').count() == 8, 'holiday list (8 on weekdays)')
    page.locator('#wd-dstart').fill('2026-04-02'); page.locator('#wd-dstart').dispatch_event('input')
    typ(page, '#wd-dn', '1')
    s.expect('7. April 2026' in page.locator('.calc-big-s').inner_text(), 'deadline skips Easter')
    if s.run(page):
        ics = s.download(page, 0).read_text('utf-8')
        s.expect(ics.count('BEGIN:VEVENT') == 8 and 'DTSTART;VALUE=DATE:20260403' in ics and 'Karfreitag' in ics, 'ics with holidays')
    stored = page.evaluate("() => Object.keys(localStorage)")
    s.expect(stored == ['fale-wt-state'], f'only the state is remembered {stored}')
    page.close()

    # ------------------------------------------------ days between dates
    page = s.open(ctx, P['date-difference'][0])
    page.wait_for_selector('#dd-a')
    page.locator('#dd-a').fill('2026-03-01'); page.locator('#dd-b').fill('2026-03-31'); page.locator('#dd-b').dispatch_event('input')
    s.expect(page.locator('.calc-out .calc-big').first.inner_text() == '30 Tage', 'days between')
    page.locator('label[for="dd-end"]').click()
    s.expect(page.locator('.calc-out .calc-big').first.inner_text() == '31 Tage', 'end day counted')
    page.locator('#dd-s').fill('2026-01-31'); page.locator('#dd-s').dispatch_event('input')
    typ(page, '#dd-n', '1')
    page.locator('label[for="dd-unit-m"]').click()
    t = page.locator('.calc-big-s').inner_text() + page.locator('.calc-big-s + .calc-sub').inner_text()
    s.expect('28. Februar 2026' in t and 'Monatsletzte' in t, f'month end ({t})')
    page.close()

    # ------------------------------------------------ calendar week
    page = s.open(ctx, P['calendar-week'][0])
    page.wait_for_selector('#kw-date')
    page.locator('#kw-date').fill('2027-01-01'); page.locator('#kw-date').dispatch_event('input')
    s.expect('53' in page.locator('section[aria-labelledby="kw-h2"] .calc-out').inner_text(), 'KW 53 of 2026')
    typ(page, '#kw-ylist', '2026')
    s.expect(page.locator('.calc-table tbody tr').count() == 53, '2026 has 53 weeks')
    if s.run(page):
        pdf = s.download(page, 0)
        r = pypdf.PdfReader(str(pdf))
        txt = r.pages[0].extract_text()
        s.expect(len(r.pages) == 1 and 'KW 53' in txt and '28.12.2026' in txt, f'calendar week PDF ({txt[-120:]})')
        ok, msg = s.qpdf_check(pdf); s.expect(ok, f'qpdf {msg}')
    page.close()

    # ------------------------------------------------ character counter
    page = s.open(ctx, P['character-counter'][0])
    page.wait_for_selector('#cc-text')
    page.evaluate("() => localStorage.clear()")   # the working-days page remembered a state on this origin
    page.locator('#cc-text').fill('Hallo Welt! 👋🏽 Wie geht’s?')
    page.wait_for_timeout(150)
    nums = page.locator('.calc-stat b').all_inner_texts()
    s.expect(nums[0] == '25' and nums[2] == '4' and nums[3] == '2', f'counts {nums}')
    s.expect('70 je SMS' in page.locator('.calc-out').inner_text(), 'unicode SMS rule')
    s.expect(page.evaluate("() => [localStorage.length, sessionStorage.length]") == [0, 0], 'nothing stored')
    page.locator('#cc-text').fill('x' * 300); page.wait_for_timeout(150)
    s.expect(page.locator('.calc-limit.is-over').count() == 4, 'limits over: title, description, SMS, post – caption and page fit')
    page.close()

    # ------------------------------------------------ compare text
    page = s.open(ctx, P['compare-text'][0])
    page.wait_for_selector('#ct-a')
    page.locator('#ct-a').fill('Die Miete beträgt 850 Euro und ist am 3. Werktag fällig.')
    page.locator('#ct-b').fill('Die Miete beträgt 900 Euro und ist am 1. Werktag fällig.')
    page.wait_for_timeout(300)
    s.expect(page.locator('.calc-diff del').all_inner_texts() == ['850', '3'] and page.locator('.calc-diff ins').all_inner_texts() == ['900', '1'], 'word diff marks')
    s.expect('− 2' in page.locator('.calc-summary').inner_text() and '+ 2' in page.locator('.calc-summary').inner_text(), 'counts')
    page.locator('label[for="ct-view-side"]').click()
    s.expect(page.locator('.calc-diff').count() == 2, 'side by side')
    s.check_page(page)
    s.record_freeze(page)
    page.close()

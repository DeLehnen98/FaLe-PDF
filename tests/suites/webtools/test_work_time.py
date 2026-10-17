"""Working hours calculator: DE/EN × phone/desktop (CSP, a11y, no horizontal scroll), times typed as 730 /
7,30, legal minimum break, night shift, vacation as target met, 11-hour rest warning, overtime, converter,
timesheet as PDF (text + qpdf) and CSV, nothing stored unless "remember" is ticked, no freeze."""
import csv, io
import pypdf
from wtlib import Suite

P = ('/werkzeuge/arbeitszeitrechner/', '/en/tools/working-hours-calculator/')


def typ(page, sel, text):
    loc = page.locator(sel)
    loc.fill(text)
    loc.dispatch_event('input')


with Suite('work-time') as s:
    for v in s.variants():
        page = s.open(v, P[0 if v.lang == 'de' else 1])
        page.wait_for_selector('.wtm-row')
        s.expect(page.locator('.wtm-row').count() == 5, f'{v}: a working week to start with')
        if v.lang == 'de':
            typ(page, '#wt-start-0', '22:00'); typ(page, '#wt-end-0', '6:30')
            s.shot(page, f'work_time_{v.device}', top='.wtm-list')
        s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, P[0])
    page.wait_for_selector('#wt-start-0')
    page.evaluate("() => localStorage.clear()")
    # Mon: 730 – 16,15, no break typed → 30 min legal break deducted
    typ(page, '#wt-start-0', '730'); typ(page, '#wt-end-0', '16,15')
    page.locator('#wt-end-0').blur()
    s.expect(page.locator('#wt-end-0').input_value() == '16:15', 'time normalised on leaving the field')
    row0 = page.locator('.wtm-row').nth(0)
    s.expect(row0.locator('.wtm-out b').inner_text() == '8:15' and 'Mindestpause' in row0.locator('.wtm-notes').inner_text(), f'legal break ({row0.inner_text()[:200]})')
    # Tue: night shift 22:00 – 6:00
    typ(page, '#wt-start-1', '22:00'); typ(page, '#wt-end-1', '6:00'); typ(page, '#wt-pause-1', '30')
    row1 = page.locator('.wtm-row').nth(1)
    s.expect(row1.locator('.wtm-out b').inner_text() == '7:30' and 'Mitternacht' in row1.inner_text(), 'night shift')
    # Wed starts 7:00 after a shift until 6:00 → rest warning
    typ(page, '#wt-start-2', '7:00'); typ(page, '#wt-end-2', '15:30'); typ(page, '#wt-pause-2', '30')
    s.expect('Ruhezeit' in page.locator('.wtm-row').nth(2).inner_text(), 'rest warning')
    # Thu vacation
    page.locator('#wt-kind-3').select_option('vacation')
    s.expect(page.locator('#wt-start-3').is_disabled(), 'times disabled for vacation')
    total = page.locator('#wt-total').inner_text()
    s.expect(total == '23:45', f'total worked {total}')               # 8:15 + 7:30 + 8:00
    bal = page.locator('#wt-balance').inner_text()
    s.expect(bal == '−0:15', f'balance against 4 × 8 h incl. vacation {bal}')   # 23:45 + 8:00 − 32:00
    # target 7:30 → overtime
    typ(page, '#wt-target', '7,5')
    s.expect(page.locator('#wt-balance').inner_text() == '+1:15', f'target 7:30 {page.locator("#wt-balance").inner_text()}')
    # converter
    typ(page, '#wt-conv-h', '7:45')
    s.expect(page.locator('#wt-conv-d').input_value() == '7,75', 'h:mm → decimal')
    typ(page, '#wt-conv-d', '1,2')
    s.expect(page.locator('#wt-conv-h').input_value() == '1:12', 'decimal → h:mm')
    typ(page, '#wt-name', 'Erika Mustermann')
    s.expect(page.evaluate("() => localStorage.getItem('fale-wt-worktime')") is None, 'nothing stored without the tick')
    if s.run(page):
        f = s.download(page, 0)
        s.expect(f.name.startswith('Stundenzettel Erika Mustermann'), f'file name {f.name}')
        txt = pypdf.PdfReader(str(f)).pages[0].extract_text()
        s.expect('Stundenzettel' in txt and 'Erika Mustermann' in txt and '23:45' in txt and 'Urlaub' in txt and 'Unterschrift' in txt, f'pdf text {txt[:300]!r}')
        ok, msg = s.qpdf_check(f); s.expect(ok, f'qpdf {msg}')
        s.render(f, 1, dpi=70)
        page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-format"][value="csv"]').check()
    if s.run(page):
        rows = list(csv.reader(io.StringIO(s.download(page, 0).read_text('utf-8-sig')), delimiter=';'))
        s.expect(rows[0][0] == 'Datum' and rows[1][6] == '8:15' and rows[1][7] == '8,25' and any(r and r[0] == 'Saldo' and r[6] == '1:15' for r in rows), f'csv {rows[:3]} … {rows[-2:]}')
        page.locator('.wt-restart button').first.click()
    page.locator('#wt-keep').check()
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('fale-wt-worktime'))")
    s.expect(stored and stored['rows'][0]['start'] and stored['set']['name'] == 'Erika Mustermann', 'remembered when ticked')
    page.reload(); page.wait_for_selector('#wt-start-0')
    s.expect(page.locator('#wt-end-0').input_value() == '16:15', 'entries back after reload')
    page.locator('#wt-keep').uncheck()
    s.expect(page.evaluate("() => localStorage.getItem('fale-wt-worktime')") is None, 'forgotten when unticked')
    # a month
    page.locator('.calc-actions button').nth(2).click()
    s.expect(page.locator('.wtm-row').count() >= 20, 'month rows')
    s.check_page(page)
    s.record_freeze(page)
    page.close()

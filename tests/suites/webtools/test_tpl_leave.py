"""leave-request: working days with Saarland holidays (Corpus Christi, Christmas), other state, 6-day week,
half days, several periods, remaining entitlement, approval box, EN default without holidays, DE/EN × phone/desktop."""
from wtlib import Suite
from tpl_testlib import fill, wait_preview, sign, images
from uni_testlib import UNI_WORDS, check_unicode_pdf

PATHS = {'de': '/werkzeuge/urlaubsantrag/', 'en': '/en/tools/leave-request/'}

with Suite('leave-request') as s:
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and de
        page.wait_for_selector('#tpl-from-0')
        s.expect(page.input_value('#tpl-state') == ('SL' if de else 'none'), f'{v}: default state')
        if shots: s.shot(page, 'tpl_leave_phone_initial')
        # 1–12 June 2026: 10 weekdays, Corpus Christi (4 June) in SL
        fill(page, {'#tpl-from-0': '2026-06-01', '#tpl-to-0': '2026-06-12', 'name': 'Łukasz Kowalski-Müller', 'dept': 'Ελληνικά Привет', 'stand': 'Türkçe İğ €', 'entitlement': '30', 'taken': '5', 'place': 'Saarbrücken'})
        page.wait_for_timeout(200)
        days = page.locator('.tpl-days').first.inner_text()
        s.expect(days.startswith('9 ' if de else '10 '), f'{v}: working days {days}')
        if de: s.expect('Fronleichnam' in page.locator('.tpl-hol').inner_text(), f'{v}: holiday listed')
        page.locator('.tpl-add').click()
        fill(page, {'#tpl-from-1': '2026-12-21', '#tpl-to-1': '2026-12-31'})
        page.locator('#tpl-halfDays').check(force=True)
        page.wait_for_timeout(200)
        exp = 9 + 7 if de else 10 + 7    # 21–31 Dec: 8 weekdays − 25 Dec (Fri) holiday − 2 × ½  (EN: no holidays → 9 − 1 = 8? see below)
        if not de: exp = 10 + 8          # no holidays: 9 weekdays incl. 25 Dec, two half days → 8
        tot = page.locator('.tpl-sum .tpl-total').inner_text()
        s.expect(tot.replace(',', '.').split()[-1] == str(exp), f'{v}: total {exp}: {tot}')
        rest = 30 - 5 - exp
        s.expect(str(rest) in page.locator('.tpl-sum').inner_text(), f'{v}: remaining {rest}')
        sign(page)
        wait_preview(page)
        if shots: s.shot(page, 'tpl_leave_phone_configured', top='#tpl-h-period')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'tpl_leave_phone_result', top='.wt-result')
        o = s.download(page, 0)
        txt = ' '.join(s.pdf_text(o).split())
        if de:
            s.expect('Urlaubsantrag Erholungsurlaub' in txt and '01.06.2026 12.06.2026 9' in txt and 'Summe 16' in txt, f'{v}: table: {txt[:700]}')
            s.expect('Resturlaub danach 9' in txt and 'Feiertage: Saarland' in txt and 'genehmigt' in txt and 'abgelehnt' in txt, f'{v}: account/basis/approval')
        else:
            s.expect('Leave request Annual leave' in txt and 'Total 18' in txt and 'no public holidays counted' in txt, f'{v}: EN: {txt[:600]}')
        check_unicode_pdf(s, o, UNI_WORDS, f'{v}: leave')
        s.expect(s.pdf_pages(o) == 1, f'{v}: one page')
        s.expect(len([i for i in images(o) if i[2] == 'image']) == 1, f'{v}: signature')
        s.check_page(page)

    # other states, 6-day week, invalid range
    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    page.wait_for_selector('#tpl-from-0')
    fill(page, {'#tpl-from-0': '2026-06-01', '#tpl-to-0': '2026-06-05', 'name': 'Max'})
    page.select_option('#tpl-state', 'NI')
    page.wait_for_timeout(150)
    s.expect(page.locator('.tpl-days').inner_text().startswith('5 '), 'NI: no Corpus Christi')
    page.select_option('#tpl-state', 'BY')
    page.wait_for_timeout(150)
    s.expect('Mariä Himmelfahrt' in page.locator('#tpl-h-period').locator('..').inner_text(), 'Bavaria note shown')
    fill(page, {'#tpl-from-0': '2026-11-16', '#tpl-to-0': '2026-11-21'})
    page.select_option('#tpl-state', 'SN'); page.select_option('#tpl-week', '6')
    page.wait_for_timeout(150)
    s.expect(page.locator('.tpl-days').inner_text().startswith('5 '), f'SN 6-day week with Buß- und Bettag: {page.locator(".tpl-days").inner_text()}')
    fill(page, {'#tpl-to-0': '2026-11-01'})
    page.wait_for_timeout(150)
    s.expect(s.primary(page).is_disabled(), 'invalid range disables the button')
    s.check_page(page)

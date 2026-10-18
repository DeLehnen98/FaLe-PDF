"""Operating cost statement: DE/EN × phone/desktop (CSP, a11y), house + cost items + three tenancies with a tenant
change, shares by area / person-days / per-tenant amounts checked against a hand calculation, overview with
due/credit, deadline, preview per tenant, one PDF (text per letter, qpdf) + CSV overview, ZIP per tenant,
nothing stored unless ticked, no freeze."""
import csv, io, math, zipfile
import pypdf
from wtlib import Suite

P = ('/werkzeuge/nebenkostenabrechnung/', '/en/tools/utility-cost-statement/')
rnd = lambda x: math.floor(x + 0.5)


def eur(c):
    s = f'{abs(c) / 100:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return ('-' if c < 0 else '') + s + '\xa0€'


with Suite('nebenkosten') as s:
    for v in s.variants():
        page = s.open(v, P[0 if v.lang == 'de' else 1])
        page.wait_for_selector('#nk-h-items')
        s.expect(s.primary(page).is_disabled(), f'{v}: nothing to create yet')
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'nebenkosten_phone', top='#nk-h-items')
        s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, P[0])
    page.evaluate("() => localStorage.clear()")
    page.wait_for_selector('#nk-pFrom')
    page.fill('#nk-pFrom', '2025-01-01'); page.fill('#nk-pTo', '2025-12-31')
    page.fill('#nk-hStreet', 'Lindenweg 4'); page.fill('#nk-hCity', '66111 Saarbrücken')
    page.fill('#nk-hArea', '300'); page.fill('#nk-hUnits', '4')
    items = page.locator('section[aria-labelledby="nk-h-items"] .tpl-entry')
    for i, amount in [(0, '600'), (1, '730'), (3, '365'), (4, '300')]:   # Grundsteuer (area), Wasser (persons), Müll (persons), Versicherung (area)
        items.nth(i).get_by_label('Gesamtkosten im Zeitraum (€)').fill(amount)
    add = page.locator('section[aria-labelledby="nk-h-tenants"] .tpl-add')
    add.click(); add.click()
    ten = page.locator('section[aria-labelledby="nk-h-tenants"] .tpl-entry')
    data = [('Erika Mustermann', 'EG', '100', '2', '1.200,00', '', '', '612,40'),
            ('Otto Alt', 'OG', '80', '1', '400', '', '2025-06-30', '210'),
            ('Nina Neu', 'OG', '80', '3', '450', '2025-07-01', '', '255,50')]
    for i, (name, unit, area, pers, pre, frm, to, heat) in enumerate(data):
        e = ten.nth(i)
        e.get_by_label('Name des Mieters').fill(name); e.get_by_label('Wohnung (z. B. EG links)').fill(unit)
        e.get_by_label('Wohnfläche m²').fill(area); e.get_by_label('Personen').fill(pers)
        e.get_by_label('Vorauszahlungen im Zeitraum (€)').fill(pre)
        if frm: e.get_by_label('Einzug (falls im Zeitraum)').fill(frm)
        if to: e.get_by_label('Auszug (falls im Zeitraum)').fill(to)
        e.get_by_label('Heizung (€)').fill(heat)
    page.fill('#nk-sName', 'Hans Vermieter'); page.fill('#nk-sStreet', 'Postweg 1'); page.fill('#nk-sCity', '66111 Saarbrücken')
    page.fill('#nk-iban', 'DE89 3704 0044 0532 0130 00')
    page.wait_for_timeout(300)
    # hand calculation (cents)
    pdays = 2 * 365 + 1 * 181 + 3 * 184
    exp = {
        'Erika Mustermann': rnd(60000 * 100 / 300) + rnd(73000 * 730 / pdays) + rnd(36500 * 730 / pdays) + rnd(30000 * 100 / 300) + 61240,
        'Otto Alt': rnd(60000 * 80 * 181 / (300 * 365)) + rnd(73000 * 181 / pdays) + rnd(36500 * 181 / pdays) + rnd(30000 * 80 * 181 / (300 * 365)) + 21000,
        'Nina Neu': rnd(60000 * 80 * 184 / (300 * 365)) + rnd(73000 * 552 / pdays) + rnd(36500 * 552 / pdays) + rnd(30000 * 80 * 184 / (300 * 365)) + 25550,
    }
    prepaid = {'Erika Mustermann': 120000, 'Otto Alt': 40000, 'Nina Neu': 45000}
    summ = page.locator('#nk-sum').inner_text()
    for n, c in exp.items():
        s.expect(eur(c) in summ, f'overview costs {n} {eur(c)} ({summ[:400]!r})')
    s.expect('31.12.2026' in summ and '556' in summ, 'deadline shown')
    s.expect(not s.primary(page).is_disabled(), 'ready')
    page.locator('#nk-next').click()
    s.expect(page.locator('#nk-pos').inner_text() == '2 / 3', 'stepper')
    if s.run(page):
        f = s.download(page, 0)
        r = pypdf.PdfReader(str(f))
        txt = ' '.join(' '.join(p.extract_text() for p in r.pages).split())   # table cells wrap
        s.expect('Betriebskostenabrechnung 01.01.2025 – 31.12.2025' in txt and 'Wohnfläche 80 m² von 300 m² · 181 von 365 Tagen' in txt and 'Laut Einzelabrechnung' in txt, f'pdf text {txt[:500]!r}')
        for n in exp:
            s.expect(n in txt and eur(exp[n]).replace('\xa0', ' ') in txt, f'{n} in pdf with {eur(exp[n])}')
        s.expect('DE89 3704 0044 0532 0130 00' in txt or 'Guthaben' in txt, 'payment line')
        ok, msg = s.qpdf_check(f); s.expect(ok, f'qpdf {msg}')
        rows = list(csv.reader(io.StringIO(s.download(page, 1).read_text('utf-8-sig')), delimiter=';'))
        got = {row[0]: row for row in rows[1:4]}
        for n, c in exp.items():
            want = f'{(c - prepaid[n]) / 100:.2f}'.replace('.', ',')
            s.expect(got[n][5] == want, f'csv balance {n} {got[n][5]} vs {want}')
        page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-out"][value="zip"]').check()
    if s.run(page):
        z = zipfile.ZipFile(io.BytesIO(s.download(page, 0).read_bytes()))
        s.expect(len(z.namelist()) == 3 and all(n.endswith('.pdf') and n.startswith('Betriebskostenabrechnung 2025') for n in z.namelist()), f'zip {z.namelist()}')
        page.locator('.wt-restart button').first.click()
    s.expect(page.evaluate("() => localStorage.getItem('fale-wt-nk')") is None, 'nothing stored without the tick')
    page.locator('#nk-keep').check()
    page.fill('#nk-hArea', '301'); page.fill('#nk-hArea', '300')
    s.expect('Erika Mustermann' in (page.evaluate("() => localStorage.getItem('fale-wt-nk')") or ''), 'remembered when ticked')
    page.reload(); page.wait_for_selector('#nk-pFrom')
    s.expect(page.locator('#nk-hArea').input_value() == '300' and page.locator('section[aria-labelledby="nk-h-tenants"] .tpl-entry').count() == 3, 'restored after reload')
    page.locator('#nk-keep').uncheck()
    s.expect(page.evaluate("() => localStorage.getItem('fale-wt-nk')") is None, 'forgotten when unticked')
    s.check_page(page)
    s.record_freeze(page)
    page.close()

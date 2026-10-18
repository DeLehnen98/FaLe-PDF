"""Mail merge: DE/EN × phone/desktop (CSP, a11y), Excel list with formatted amounts/dates and a postcode that lost
its zero, default address from the columns, {Briefanrede} per row, placeholders inserted at the cursor,
unknown placeholder + incomplete address warnings, preview stepper, one PDF (text per letter, duplex blanks,
qpdf) and ZIP with named PDFs, Windows-1252 CSV with quoted separators, nothing stored, no freeze."""
import io, zipfile
import pypdf
from wtlib import Suite

P = ('/werkzeuge/serienbrief/', '/en/tools/mail-merge/')


def fill(page, sel, text):
    page.fill(sel, text)


with Suite('mail-merge') as s:
    for v in s.variants():
        page = s.open(v, P[0 if v.lang == 'de' else 1])
        s.pick(page, 'merge/kunden.xlsx')
        page.wait_for_selector('#mm-chips .mm-chip', timeout=20000)
        s.expect('4' in page.locator('#mm-info').inner_text(), f'{v}: 4 recipients ({page.locator("#mm-info").inner_text()})')
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'mail_merge_phone', top='#mm-h-list')
        s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, P[0])
    page.evaluate("() => localStorage.clear()")
    s.pick(page, 'merge/kunden.xlsx')
    page.wait_for_selector('#mm-chips .mm-chip')
    s.expect('führende Null' in page.locator('#mm-zipnote').inner_text(), 'postcode zero restored note')
    s.expect('01067' in page.locator('.mm-table').inner_text() and '1.234,50 €' in page.locator('.mm-table').inner_text() and '15.11.2026' in page.locator('.mm-table').inner_text(), 'formatted cells shown as in Excel')
    addr = page.locator('#mm-address').input_value()
    s.expect(addr.startswith('{Firma}') and '{PLZ} {Ort}' in addr and '{Anrede Anschrift}' in addr, f'default address {addr!r}')
    fill(page, '#mm-sName', 'Verein Muster e. V.'); fill(page, '#mm-sStreet', 'Postfach 1'); fill(page, '#mm-sCity', '66111 Saarbrücken')
    fill(page, '#mm-subject', 'Beitrag {Fällig am}')
    # placeholder chips insert at the cursor of the focused field
    page.locator('#mm-body').fill('Bitte überweisen Sie  bis zum Fälligkeitstermin. {Kundennr}')
    page.locator('#mm-body').evaluate("t => { t.focus(); t.setSelectionRange(21, 21); }")
    page.locator('.mm-chip', has_text='{Betrag}').click()
    body = page.locator('#mm-body').input_value()
    s.expect(body.startswith('Bitte überweisen Sie {Betrag} bis'), f'chip inserted at cursor ({body!r})')
    page.wait_for_timeout(300)
    probs = page.locator('#mm-problems').inner_text()
    s.expect('{Kundennr}' in probs and 'Zeile 4' in probs, f'warnings ({probs})')
    page.locator('#mm-body').fill('Bitte überweisen Sie {Betrag} bis zum {Fällig am}.')
    page.locator('#mm-next').click()
    s.expect(page.locator('#mm-pos').inner_text() == '2 / 4', 'stepper')
    page.wait_for_timeout(600)
    if s.run(page):
        f = s.download(page, 0)
        r = pypdf.PdfReader(str(f))
        texts = [p.extract_text() for p in r.pages]
        allt = '\n'.join(texts)
        s.expect(len(r.pages) == 4, f'4 one-page letters ({len(r.pages)})')
        s.expect('Sehr geehrte Frau Dr. Mustermann,' in texts[0] and '01067 Dresden' in texts[0] and '1.234,50 €' in texts[0] and 'Beitrag 15.11.2026' in texts[0], f'letter 1 ({texts[0][:400]!r})')
        s.expect('Herrn Max Müller' in texts[1] and 'Sehr geehrter Herr Müller,' in texts[1] and 'Müller Bau GmbH' in texts[1], 'letter 2 (Herrn, company)')
        s.expect('Guten Tag Kim Lee,' in texts[2] and 'Sehr geehrte Frau Schulz,' in texts[3], 'letters 3 + 4 salutations')
        s.expect('{' not in allt, 'no placeholder left')
        ok, msg = s.qpdf_check(f); s.expect(ok, f'qpdf {msg}')
        page.locator('.wt-restart button').first.click()
    page.locator('#wt-opt-duplex').check(force=True)
    if s.run(page):
        r = pypdf.PdfReader(str(s.download(page, 0)))
        s.expect(len(r.pages) == 7, f'duplex blanks between letters ({len(r.pages)})')
        page.locator('.wt-restart button').first.click()
    page.locator('input[name="wt-opt-out"][value="zip"]').check()
    page.fill('#wt-opt-fileName', '{Nachname}, {Vorname}')
    if s.run(page):
        z = zipfile.ZipFile(io.BytesIO(s.download(page, 0).read_bytes()))
        names = sorted(z.namelist())
        s.expect(names == ['Lee, Kim.pdf', 'Mustermann, Erika.pdf', 'Müller, Max.pdf', 'Schulz.pdf'], f'zip names {names}')
        page.locator('.wt-restart button').first.click()
    stored = page.evaluate("() => Object.keys(localStorage)")
    s.expect(stored in ([], ['fale-wt-letter-sender']) and 'fale-wt-letter-sender' not in stored, f'nothing stored unasked {stored}')
    s.check_page(page)
    s.record_freeze(page)
    page.close()

    # Windows-1252 CSV with a quoted separator
    page = s.open(ctx, P[0])
    s.pick(page, 'merge/adressen_ansi.csv')
    page.wait_for_selector('#mm-chips .mm-chip')
    t = page.locator('.mm-table').inner_text()
    s.expect('Jörg' in t and 'Weiß' in t and 'Weg 1; Hinterhaus' in t and '01069' in t, f'csv decoded ({t[:200]!r})')
    s.check_page(page)
    page.close()

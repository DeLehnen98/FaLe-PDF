"""„E-Rechnung auf dem Handy“ – XRechnung/ZUGFeRD in der App (js/smart/einvoice.js + Briefkasten-Assistent).
Fixtures: tests/suites/webtools/fixtures/einv/ (made by webtools/einv_make_fixtures.mjs if missing).
- XRechnung (UBL) über „Datei öffnen“ → lesbare PDF in den Dateien (Original-XML unverändert angehängt) → Briefkasten
  öffnet sich mit den exakten Daten: Absender, Empfänger, Betrag, Zahlungsziel, IBAN/BIC, Verwendungszweck, Nummer;
  „E-Rechnung“-Kasten mit Profil und „alles stimmig“, 100 % sicher, kein KI-Knopf
- „Original-XML teilen“ liefert genau die Originaldatei; „Überweisung vorbereiten“ → GiroCode mit exakten Werten
- XRechnung (CII) mit Lastschrift: „Lastschrift am“, Hinweis „nichts überweisen“
- Rechnung mit falschen Summen + ungültiger IBAN: Warnungen sichtbar
- Gutschrift (UBL): „Gutschrift“, keine Zahlungsfrist
- ZUGFeRD-PDF: Daten aus der eingebetteten XML (nicht aus dem Text)
- keine E-Rechnung / ZUGFeRD 1: verständliche Meldung, nichts gespeichert
- Englisch: lesbare PDF auf Englisch; Handy 360 px ohne Überlauf; keine Konsolenfehler; nichts friert ein
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, json, base64, re, subprocess, time, traceback, io
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(SUITES, 'webtools', 'fixtures', 'einv')
OUT = os.path.join(SUITES, 'out_einvoice_app')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def attach(page, label):
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))


BLOB = """async (id) => { const db = await import('./js/db.js'); const b = await db.getFile(id); if (!b) return null;
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }); }"""
FILES = "async () => (await (await import('./js/db.js')).listFiles()).map(f => ({ id: f.id, name: f.name, source: f.source }))"
FIELDS = "Object.fromEntries([...document.querySelectorAll('.sm-fields [data-field]')].map(i => [i.dataset.field, i.value]))"


def open_file(page, path):
    page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(500)
    with page.expect_file_chooser() as fc:
        page.locator('#view-start .hero [data-action="open-file"]').click()
    fc.value.set_files(path)


def wait_letter(page, timeout=30000):
    page.wait_for_selector('.sm-letter', timeout=timeout)
    page.wait_for_timeout(900)


def run(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='de-DE', accept_downloads=True)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    attach(page, 'desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    state = {}

    def xrechnung():
        t0 = time.time()
        open_file(page, os.path.join(F, 'xrechnung_ubl.xml'))
        wait_letter(page)
        check('XML → Briefkasten opens by itself (< 8 s)', page.evaluate('location.hash').startswith('#/briefkasten/') and time.time() - t0 < 8, (page.evaluate('location.hash'), round(time.time() - t0, 1)))
        v = page.evaluate(FIELDS)
        exp = {'sender': 'Müller IT-Service GmbH', 'date': '2026-10-10', 'subject': 'Rechnung RE-2026-1042', 'amount': '1.525,29', 'due': '2099-10-24',
               'iban': 'DE89 3704 0044 0532 0130 00', 'bic': 'COBADEFFXXX', 'purpose': 'RE-2026-1042', 'rechnungsnummer': 'RE-2026-1042', 'senderAddress': 'Bahnhofstraße 12, 66111 Saarbrücken'}
        wrong = {k: v.get(k) for k, x in exp.items() if v.get(k) != x}
        check('exact data from the XML in the fields', not wrong, wrong)
        check('recipient = buyer', 'Kreisstadt Homburg' in v.get('recipient', ''), v.get('recipient'))
        head = page.locator('.sm-head').inner_text()
        check('E-Rechnung box: profile + "alles stimmig"', 'E-Rechnung' in head and 'XRechnung 3.0 (UBL)' in head and 'alles stimmig' in head, head[:400])
        check('100 % sicher, Zahlungsziel shown, no KI button', '100 % sicher' in head and 'Zahlungsziel: 24.10.2099' in head and not page.locator('[data-act="ki"]').is_visible())
        page.screenshot(path=os.path.join(OUT, 'xrechnung_letter.png'), full_page=True)
        files = page.evaluate(FILES)
        pdfs = [f for f in files if f['name'] == 'Rechnung RE-2026-1042 – Müller IT-Service GmbH.pdf']
        check('readable PDF saved in Dateien (source E-Rechnung)', len(pdfs) == 1 and pdfs[0]['source'] == 'E-Rechnung', files)
        if pdfs:
            state['ubl_id'] = pdfs[0]['id']
            path = os.path.join(OUT, 'xrechnung.pdf')
            open(path, 'wb').write(base64.b64decode(page.evaluate(BLOB, pdfs[0]['id'])))
            txt = subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout
            check('readable PDF: number, seller, buyer, items, total', all(x in txt for x in ['RE-2026-1042', 'Müller IT-Service GmbH', 'Kreisstadt Homburg', 'Wartung Server', '1.525,29']), txt[:300])
            import pypdf
            r = pypdf.PdfReader(path)
            att = r.attachments.get('xrechnung.xml')
            orig = open(os.path.join(F, 'xrechnung_ubl.xml'), 'rb').read()
            check('original XML attached unchanged (byte for byte)', att and att[0] == orig, (list(r.attachments.keys()), len(att[0]) if att else 0, len(orig)))
        # original XML share → download on desktop web
        with page.expect_download(timeout=15000) as dl:
            page.locator('[data-act="xml"]').click()
        x = dl.value
        p2 = os.path.join(OUT, x.suggested_filename)
        x.save_as(p2)
        check('„Original-XML teilen“ gives the original file', x.suggested_filename.endswith('.xml') and open(p2, 'rb').read() == open(os.path.join(F, 'xrechnung_ubl.xml'), 'rb').read(), x.suggested_filename)
        # GiroCode with the exact values
        page.locator('[data-act="zahlen"]').click()
        page.wait_for_selector('dialog[open] [data-qr]', timeout=8000)
        payload = ''
        for _ in range(30):
            payload = page.locator('dialog[open] [data-qr]').get_attribute('data-payload') or ''
            if payload: break
            page.wait_for_timeout(200)
        lines = payload.split('\n')
        check('GiroCode: IBAN, BIC, name, exact amount, reference', len(lines) > 10 and lines[4] == 'COBADEFFXXX' and lines[5] == 'Müller IT-Service GmbH' and lines[6] == 'DE89370400440532013000' and lines[7] == 'EUR1525.29' and 'RE-2026-1042' in payload, lines)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        t = time.time(); page.evaluate('new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))')
        check('page responsive after import (no freeze)', time.time() - t < 1.5)
    step('XRechnung UBL', xrechnung)

    def lastschrift():
        open_file(page, os.path.join(F, 'xrechnung_cii_lastschrift.xml'))
        wait_letter(page)
        head = page.locator('.sm-head').inner_text()
        check('CII direct debit: "Lastschrift am" + "nichts überweisen"', 'Lastschrift am: 15.10.2026' in head and 'nichts überweisen' in head, head[-300:])
        check('CII direct debit: profile XRechnung (CII)', 'XRechnung 3.0 (CII)' in head, head[:300])
    step('XRechnung CII Lastschrift', lastschrift)

    def kaputt():
        open_file(page, os.path.join(F, 'kaputt_summen.xml'))
        wait_letter(page)
        box = page.locator('[data-einv]')
        txt = box.inner_text()
        check('wrong sums + bad IBAN: warnings open and visible', 'has-warn' in (box.get_attribute('class') or '') and 'Hinweis' in txt and 'ungültige Prüfziffer' in txt, txt[:500])
        page.screenshot(path=os.path.join(OUT, 'kaputt.png'), full_page=True)
    step('wrong sums', kaputt)

    def gutschrift():
        open_file(page, os.path.join(F, 'gutschrift_ubl.xml'))
        wait_letter(page)
        v = page.evaluate(FIELDS)
        check('credit note: subject "Gutschrift …", no payment deadline', v.get('subject', '').startswith('Gutschrift') and not v.get('due'), v)
    step('Gutschrift', gutschrift)

    def zugferd_pdf():
        before = {f['id'] for f in page.evaluate(FILES)}
        open_file(page, os.path.join(F, 'zugferd.pdf'))
        page.wait_for_timeout(1500)
        new = [f for f in page.evaluate(FILES) if f['id'] not in before]
        check('ZUGFeRD PDF imported as normal PDF (viewer)', len(new) == 1 and page.evaluate('location.hash').startswith('#/ansicht/'), new)
        if new:
            page.evaluate(f"location.hash = '#/briefkasten/neu?doc={new[0]['id']}'")
            wait_letter(page)
            v = page.evaluate(FIELDS)
            head = page.locator('.sm-head').inner_text()
            check('ZUGFeRD PDF: data from the embedded XML', v.get('rechnungsnummer') == '2026-0815' and 'Grünwerk Gartenbau' in v.get('sender', '') and v.get('amount') == '362,95' and 'ZUGFeRD / Factur-X EN 16931' in head, (v, head[:300]))
    step('ZUGFeRD PDF', zugferd_pdf)

    def errors():
        before = len(page.evaluate(FILES))
        open_file(page, os.path.join(F, 'kein_einv.xml'))
        page.wait_for_timeout(1500)
        check('no e-invoice XML: clear message, nothing saved', page.locator('.toast-error', has_text='keine E-Rechnung').count() >= 1 and len(page.evaluate(FILES)) == before)
        open_file(page, os.path.join(F, 'zugferd1.xml'))
        page.wait_for_timeout(1500)
        check('ZUGFeRD 1: explains the old format', page.locator('.toast-error', has_text='ZUGFeRD-1').count() >= 1 and len(page.evaluate(FILES)) == before)
    step('errors', errors)

    def drop():
        # drag & drop / share target path (handleIncoming)
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(600)
        r = page.evaluate("""async (xml) => { const f = new File([xml], 'Rechnung.xml', { type: 'text/xml' });
          const dt = new DataTransfer(); dt.items.add(f);
          document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
          document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; }""",
                          open(os.path.join(F, 'xrechnung_ubl.xml'), encoding='utf-8').read())
        page.wait_for_timeout(2500)
        check('dropping an XRechnung opens the Briefkasten', page.evaluate('location.hash').startswith('#/briefkasten/') and page.locator('.sm-einv').count() == 1, page.evaluate('location.hash'))
    step('drop', drop)
    ctx.close()

    # English: readable PDF in English
    ctx = browser.new_context(viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True, locale='en-GB')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-lang', 'en'); } catch (e) {}")
    page = ctx.new_page()
    attach(page, 'phone-en')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)

    def phone_en():
        open_file(page, os.path.join(F, 'xrechnung_ubl.xml'))
        wait_letter(page)
        over = page.evaluate('document.documentElement.scrollWidth')
        check('phone: no horizontal scroll on the e-invoice letter', over <= 361, over)
        txt = page.locator('[data-einv]').inner_text()
        check('English UI: e-invoice box translated', 'E-Rechnung' not in txt.replace('XRechnung', '') or 'e-invoice' in txt.lower(), txt[:300])
        page.screenshot(path=os.path.join(OUT, 'phone_en.png'), full_page=True)
        files = page.evaluate(FILES)
        pdf = [f for f in files if f['name'].endswith('.pdf')]
        if pdf:
            path = os.path.join(OUT, 'xrechnung_en.pdf')
            open(path, 'wb').write(base64.b64decode(page.evaluate(BLOB, pdf[0]['id'])))
            t = subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout
            check('English: readable PDF in English (1,525.29)', '1,525.29' in t and 'Invoice' in t, t[:300])
    step('phone + English', phone_en)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    if not os.path.exists(os.path.join(F, 'xrechnung_ubl.xml')):
        subprocess.run(['node', os.path.join(SUITES, 'webtools', 'einv_make_fixtures.mjs')], check=True)
    with sync_playwright() as p:
        run(p)
    bad_console = [x for x in problems if 'favicon' not in x]
    check('no console errors', not bad_console, bad_console[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:400])
    sys.exit(1 if bad else 0)

"""„Formulardaten sammeln“ (js/tools/formdata.js).
- Werkzeug in der Liste; zwei ausgefüllte Formulare (formcheck/mitglied_*.pdf), eine PDF ohne Felder und ein in FaLe
  ausgefülltes, fixiertes Formular („Später in FaLe änderbar“) → Vorschau: 3 Zeilen, die PDF ohne Felder wird erklärt
- Speichern → Excel-Datei in „Dateien“: Kopfzeile Datei + Felder, Beträge als Zahlen (12,50 → 12.5; 1.200,00 → 1200),
  PLZ mit führender Null bleibt Text, Häkchen = „Ja“, Werte aus dem fixierten FaLe-Formular sind da
- Handy 360 px: kein waagerechtes Scrollen; keine Konsolenfehler
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, base64, io, re, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
FC = os.path.join(SUITES, 'formcheck')
TD = os.path.join(SUITES, '..', 'base', 'testdata')
OUT = os.path.join(SUITES, 'out_formdata')
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


IMPORT = """async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
  return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }"""
FILES = "async () => (await (await import('./js/db.js')).listFiles()).map(f => ({ id: f.id, name: f.name }))"
BLOB = """async (id) => { const db = await import('./js/db.js'); const b = await db.getFile(id); if (!b) return null;
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }); }"""
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()


def ctx_page(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-hint-memory', 'hidden'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    return ctx, page


def run(p):
    browser = p.chromium.launch()
    ctx, page = ctx_page(browser, 'desktop', viewport={'width': 1280, 'height': 900})
    st = {}

    def prepare():
        st['anna'] = page.evaluate(IMPORT, [b64(os.path.join(FC, 'mitglied_anna.pdf')), 'Mitglied Anna.pdf'])
        st['ben'] = page.evaluate(IMPORT, [b64(os.path.join(FC, 'mitglied_ben.pdf')), 'Mitglied Ben.pdf'])
        st['bericht'] = page.evaluate(IMPORT, [b64(os.path.join(TD, 'bericht.pdf')), 'Bericht.pdf'])
        # Clara fills the form in FaLe, fixed + „Später in FaLe änderbar“
        did = page.evaluate(IMPORT, [b64(os.path.join(FC, 'antrag.pdf')), 'Mitglied Clara.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={did}'")
        page.wait_for_selector('.form-panel input[data-fi]', timeout=20000); page.wait_for_timeout(600)
        page.locator('.form-panel input[data-fi]').first.fill('Clara Fix')
        page.locator('.form-panel input[type=checkbox][data-fi]').check()
        page.locator('.screen-foot [data-memory]').check()
        page.locator('[data-save]').click()
        page.wait_for_selector('dialog[open] .ff-list', timeout=5000)
        page.locator('dialog[open] button[value="save"]').click()  # IBAN (Pflichtfeld) left empty on purpose
        page.wait_for_selector('.result-card', timeout=30000)
        st['clara'] = next(f['id'] for f in page.evaluate(FILES) if f['name'] == 'Mitglied Clara (ausgefüllt).pdf')
        page.evaluate("location.hash = '#/werkzeuge'"); page.wait_for_timeout(600)
        check('tool listed under the tools', page.locator('a[href="#/werkzeug/formulardaten"], [data-tool="formulardaten"]').count() >= 1
              or 'Formulardaten sammeln' in page.locator('#view-werkzeuge, main').first.inner_text())
    step('prepare', prepare)

    def collect():
        page.evaluate(f"location.hash = '#/werkzeug/formulardaten?doc={st['anna']}'")
        page.wait_for_selector('.fd-table', timeout=20000)
        page.locator('[data-add]').click()
        page.wait_for_selector('dialog[open] .pick-item')
        for k in ('ben', 'bericht', 'clara'):
            page.locator(f'dialog[open] input[value="{st[k]}"]').check()
        page.locator('dialog[open] button[value="ok"]').click()
        page.wait_for_timeout(1500)
        rows = page.locator('.fd-table tbody tr')
        txt = page.locator('.fd-files').inner_text()
        check('preview: 3 rows (Anna, Ben, Clara), the PDF without fields is explained', rows.count() == 3 and 'Keine Formularfelder' in txt
              and 'Clara Fix' in page.locator('.fd-table').inner_text(), (rows.count(), txt[:300]))
        check('summary: 3 Formulare · 9 Spalten', '3 Formulare · 9 Spalten' in page.locator('[data-sum]').inner_text(), page.locator('[data-sum]').inner_text())
        page.screenshot(path=os.path.join(OUT, 'preview.png'))
        page.locator('.screen-foot [data-save]').click()
        page.wait_for_selector('dialog[open] .result-mini', timeout=30000)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        f = next((x for x in page.evaluate(FILES) if re.match(r'Formulardaten \d{4}-\d\d-\d\d\.xlsx$', x['name'])), None)
        check('Excel file saved in „Dateien“', f is not None)
        if not f:
            return
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(base64.b64decode(page.evaluate(BLOB, f['id']))))
        ws = wb.active
        data = [[c.value for c in r] for r in ws.iter_rows()]
        head = data[0]
        check('header: Datei + 9 fields', head[0] == 'Datei' and len([h for h in head if h]) == 10 and 'iban' in head and 'betrag' in head, head)
        col = {h: i for i, h in enumerate(head)}
        by = {r[0]: r for r in data[1:]}
        anna, ben, clara = by.get('Mitglied Anna.pdf'), by.get('Mitglied Ben.pdf'), by.get('Mitglied Clara (ausgefüllt).pdf')
        check('amounts are numbers: 12,50 → 12.5, 1.200,00 → 1200', anna and ben and anna[col['betrag']] == 12.5 and ben[col['betrag']] == 1200, (anna, ben))
        check('PLZ with a leading zero stays text', anna[col['plz']] == '06630', anna[col['plz']])
        check('ticked box → „Ja“, empty stays empty', anna[col['einwilligung']] == 'Ja' and not ben[col['einwilligung']])
        check('values from the fixed FaLe form are there', clara and clara[col['name']] == 'Clara Fix' and clara[col['einwilligung']] == 'Ja', clara)
        check('3 data rows, first row frozen', len(data) == 4 and ws.freeze_panes == 'A2', (len(data), ws.freeze_panes))
    step('collect + Excel', collect)
    ctx.close()

    ctx, page = ctx_page(browser, 'phone', viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True)

    def phone():
        did = page.evaluate(IMPORT, [b64(os.path.join(FC, 'mitglied_anna.pdf')), 'Anna.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/formulardaten?doc={did}'")
        page.wait_for_selector('.fd-table', timeout=20000); page.wait_for_timeout(500)
        over = page.evaluate('document.documentElement.scrollWidth')
        sv = page.locator('.screen-foot [data-save]').bounding_box()
        check('phone: no horizontal scroll (the table scrolls inside its box), save button reachable', over <= 361 and sv and sv['height'] >= 44 and sv['y'] + sv['height'] <= 760, (over, sv))
        page.screenshot(path=os.path.join(OUT, 'phone.png'))
    step('phone', phone)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:400])
    sys.exit(1 if bad else 0)

"""„Echtheits-Siegel“ (js/tools/seal.js + viewer banner).
- Werkzeug: Kennung (XXXX-XXXX) shown, „Versiegelt von“ → „Bericht (versiegelt).pdf“; file: /FaLeSeal, qpdf ok, text unchanged
- Ansicht: green „Unverändert seit <heute>“ · „Versiegelt von …“ · „(deine)“; a qpdf rewrite keeps it green
- changed page 2 (another program) → red „Seite 2 ist anders …“; page removed → „Beim Versiegeln 3 Seiten, jetzt 2“;
  seal edited (name changed) → „Das Siegel wurde verändert“; the tool shows the same status
- Handy 360 px: banner fits; no console errors
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, base64, re, subprocess, time, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SUITES, '..', 'base', 'testdata')
OUT = os.path.join(SUITES, 'out_seal')
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
# change a sealed file the way another program would (pdf-lib, keeps the catalog entry)
TAMPER = """async ([b64, how]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const L = await import('./js/pdflib.js'); const P = await L.loadPdfLib(); const d = await P.PDFDocument.load(bin);
  if (how === 'page2') d.getPages()[1].drawText('Betrag: 9.999 EUR', { x: 60, y: 60, size: 12 });
  if (how === 'remove') d.removePage(2);
  if (how === 'seal') { const s = d.catalog.lookup(P.PDFName.of('FaLeSeal')); const ref = s.get(P.PDFName.of('Data'));
    const raw = P.decodePDFRawStream(d.context.lookup(ref)).decode(); const j = JSON.parse(new TextDecoder().decode(raw)); j.by = 'Jemand anderes';
    d.context.assign(ref, d.context.flateStream(new TextEncoder().encode(JSON.stringify(j)), {})); }
  const out = await d.save({ useObjectStreams: false }); let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000)); return btoa(s); }"""
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()


def ctx_page(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    return ctx, page


def view(page, did):
    page.evaluate(f"location.hash = '#/ansicht/{did}'")
    page.wait_for_selector('.seal-banner', timeout=20000)
    page.wait_for_timeout(300)
    return page.locator('.seal-banner')


def run(p):
    browser = p.chromium.launch()
    ctx, page = ctx_page(browser, 'desktop', viewport={'width': 1280, 'height': 900})
    st = {}
    today = time.strftime('%d.%m.%Y')

    def seal():
        did = page.evaluate(IMPORT, [b64(os.path.join(TD, 'bericht.pdf')), 'Bericht.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/siegel?doc={did}'")
        page.wait_for_selector('[name=by]', timeout=20000)
        k = page.locator('.seal-kennung').inner_text()
        check('tool: own Kennung shown (XXXX-XXXX), no status for an unsealed file', re.fullmatch(r'[0-9A-F]{4}-[0-9A-F]{4}', k) and page.locator('.seal-status').count() == 0, k)
        st['k'] = k
        page.locator('[name=by]').fill('Max Muster')
        page.locator('[data-run]').click()
        page.wait_for_selector('.result-card', timeout=30000)
        f = next((x for x in page.evaluate(FILES) if x['name'] == 'Bericht (versiegelt).pdf'), None)
        check('saved „Bericht (versiegelt).pdf“', f is not None)
        st['id'] = f['id']
        path = os.path.join(OUT, 'sealed.pdf')
        open(path, 'wb').write(base64.b64decode(page.evaluate(BLOB, f['id'])))
        st['path'] = path
        raw = open(path, 'rb').read()
        t0 = subprocess.run(['pdftotext', os.path.join(TD, 'bericht.pdf'), '-'], capture_output=True, text=True).stdout
        t1 = subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout
        check('file: seal in the catalog, qpdf ok, text unchanged', b'/FaLeSeal' in raw and subprocess.run(['qpdf', '--check', path], capture_output=True).returncode == 0 and t0 == t1)
    step('seal', seal)

    def green():
        b = view(page, st['id'])
        tx = b.inner_text()
        check('viewer: green „Unverändert seit <heute>“ · Versiegelt von Max Muster · Kennung (deine)', 'seal-good' in b.get_attribute('class')
              and f'Unverändert seit {today}' in tx and 'Versiegelt von Max Muster' in tx and st['k'] in tx and '(deine)' in tx, tx)
        page.screenshot(path=os.path.join(OUT, 'green.png'))
        q = os.path.join(OUT, 'qpdf.pdf')
        subprocess.run(['qpdf', st['path'], q], capture_output=True)
        did = page.evaluate(IMPORT, [b64(q), 'Umgeschrieben.pdf'])
        check('rewritten by qpdf: still green', 'seal-good' in view(page, did).get_attribute('class'))
        b.locator('[data-seal-go]').count()
        view(page, st['id']).locator('[data-seal-go]').click()
        page.wait_for_selector('.seal-status', timeout=20000)
        check('„Details“ opens the tool with the green status', 'seal-good' in page.locator('.seal-status').get_attribute('class') and 'Neu versiegeln' in page.locator('.intro').inner_text())
    step('unchanged', green)

    def red():
        sealed = b64(st['path'])
        did = page.evaluate(IMPORT, [page.evaluate(TAMPER, [sealed, 'page2']), 'Geaendert.pdf'])
        b = view(page, did)
        check('page 2 changed elsewhere → red „Seite 2 ist anders …“', 'seal-bad' in b.get_attribute('class') and 'Nach dem Versiegeln geändert' in b.inner_text() and 'Seite 2 ist anders' in b.inner_text(), b.inner_text())
        page.screenshot(path=os.path.join(OUT, 'red.png'))
        page.evaluate(f"location.hash = '#/werkzeug/siegel?doc={did}'"); page.wait_for_selector('.seal-status', timeout=20000)
        check('tool shows the same red status', 'seal-bad' in page.locator('.seal-status').get_attribute('class') and 'Seite 2' in page.locator('.seal-status').inner_text())
        did = page.evaluate(IMPORT, [page.evaluate(TAMPER, [sealed, 'remove']), 'Seite weg.pdf'])
        b = view(page, did)
        check('page removed → „Beim Versiegeln 3 Seiten, jetzt 2“', 'seal-bad' in b.get_attribute('class') and re.search(r'Beim Versiegeln \d+ Seiten, jetzt \d+', b.inner_text()), b.inner_text())
        did = page.evaluate(IMPORT, [page.evaluate(TAMPER, [sealed, 'seal']), 'Siegel gefaelscht.pdf'])
        b = view(page, did)
        check('seal edited (other name) → „Das Siegel wurde verändert“', 'seal-bad' in b.get_attribute('class') and 'Das Siegel wurde verändert' in b.inner_text(), b.inner_text())
    step('changed', red)
    ctx.close()

    ctx, page = ctx_page(browser, 'phone', viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True)

    def phone():
        did = page.evaluate(IMPORT, [b64(st['path']), 'Handy.pdf'])
        b = view(page, did)
        bb = b.bounding_box()
        over = page.evaluate('document.documentElement.scrollWidth')
        check('phone: banner fits, no horizontal scroll', over <= 361 and bb['x'] >= 0 and bb['x'] + bb['width'] <= 361, (over, bb))
        check('other device: green, but without „(deine)“', 'seal-good' in b.get_attribute('class') and '(deine)' not in b.inner_text(), b.inner_text())
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

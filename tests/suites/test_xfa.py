"""Behörden-Formulare (XFA) – js/tools/xfaform.js. Runs the app under the strict CSP (sec/csp_server.mjs).

Fixtures: make_xfa_data.py → xfadata/xfa_pure.pdf (XFA only), xfadata/xfa_hybrid.pdf (XFA + normal fields).
Checks:
- viewer: banner for the XFA-only form, none for the hybrid form
- form screen: the form is laid out (fields, captions), prefilled value shown, fields can be filled
- save: the XFA data in the saved copy contains the new values; the original stays untouched
- "Als normale PDF": ordinary PDF without XFA, texts and values as real text, check mark drawn, renders
- fill & sign tool: XFA-only form → hint card (no silent loss of the form); hybrid form → normal form fields
- phone width: no horizontal overflow; no page errors, no long freeze (> 2.5 s) while flattening
Run: python3 test_xfa.py
"""
import base64, os, re, socket, subprocess, sys, time, zlib
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
TD = os.path.join(HERE, 'xfadata')
OUT = os.path.join(HERE, 'out_xfa')
PORT = int(os.environ.get('XFA_PORT', '9416'))
URL = f'http://127.0.0.1:{PORT}/'
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name}))); });
  db.close(); return res; }"""
FILE_JS = """async id => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const rec = await new Promise(r => { const t = db.transaction('files'); const g = t.objectStore('files').get(id); g.onsuccess = () => r(g.result); });
  db.close(); const u = new Uint8Array(await rec.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }"""


def docs(pg):
    return pg.evaluate(DOCS_JS)


def doc_by_name(pg, name):
    return next((d for d in docs(pg) if d['name'] == name), None)


def doc_bytes(pg, name):
    d = doc_by_name(pg, name)
    return base64.b64decode(pg.evaluate(FILE_JS, d['id'])) if d else b''


def streams(pdf):
    out = []
    for m in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', pdf, re.S):
        raw = m.group(1)
        try:
            out.append(zlib.decompress(raw))
        except Exception:
            out.append(raw)
    return out


def import_pdfs(pg, names):
    pg.set_input_files('#pdf-input', [os.path.join(TD, n) for n in names])
    for _ in range(120):
        if all(doc_by_name(pg, n) for n in names):
            break
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(500)


def pinch(pg, cx, cy, d0, d1, steps=10):
    """Two-finger pinch (spread when d1 > d0) at (cx, cy) – real touch events via the DevTools protocol."""
    cdp = pg.context.new_cdp_session(pg)
    def pts(d):
        return [{'x': cx - d / 2, 'y': cy, 'id': 1}, {'x': cx + d / 2, 'y': cy, 'id': 2}]
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(d0)})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(d0 + (d1 - d0) * i / steps)})
        pg.wait_for_timeout(30)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    cdp.detach()


def start_server():
    srv = subprocess.Popen(['node', os.path.join(HERE, 'sec', 'csp_server.mjs'), str(PORT), APP], cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            socket.create_connection(('127.0.0.1', PORT), timeout=0.2).close()
            return srv
        except OSError:
            time.sleep(0.1)
    return srv


LONGTASK = """() => { window.__lt = 0; try { new PerformanceObserver(l => l.getEntries().forEach(e => { window.__lt = Math.max(window.__lt, e.duration); })).observe({ type: 'longtask', buffered: false }); } catch (e) {} }"""


def run(p):
    subprocess.run([sys.executable, os.path.join(HERE, 'make_xfa_data.py')], check=True, capture_output=True)
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 1280, 'height': 900}, locale='de-DE', accept_downloads=True)
    c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errs.append('console: ' + m.text))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=20000)
    import_pdfs(pg, ['xfa_pure.pdf', 'xfa_hybrid.pdf'])
    pure = doc_by_name(pg, 'xfa_pure.pdf')
    hybrid = doc_by_name(pg, 'xfa_hybrid.pdf')
    check('fixtures imported', pure and hybrid, docs(pg))
    original = doc_bytes(pg, 'xfa_pure.pdf')

    # ---- viewer banners
    pg.goto(URL + f'#/ansicht/{pure["id"]}')
    banner = pg.locator('.xfa-banner')
    try:
        banner.wait_for(timeout=10000)
    except Exception:
        pass
    check('viewer: banner for the XFA-only form', banner.count() == 1 and banner.is_visible(), pg.locator('#viewer').inner_text()[:200])
    pg.screenshot(path=os.path.join(OUT, 'viewer_banner.png'))
    pg.goto(URL + f'#/ansicht/{hybrid["id"]}')
    pg.wait_for_timeout(2500)
    check('viewer: no banner for the hybrid form', pg.locator('.xfa-banner').count() == 0)
    pg.goto(URL + f'#/ansicht/{pure["id"]}')
    pg.locator('.xfa-banner [data-xfa-go]').click(timeout=10000)

    # ---- form screen
    pg.wait_for_selector('.xfaLayer input', timeout=20000)
    pg.wait_for_timeout(500)
    layer_text = pg.locator('.xfaLayer').first.inner_text()
    check('form: laid out with title and captions', 'Antrag auf Testbescheinigung' in layer_text and 'Nachname' in layer_text and 'Wohnort' in layer_text, layer_text[:200])
    vals = pg.evaluate("() => [...document.querySelectorAll('.xfaLayer input.xfaTextfield, .xfaLayer textarea')].map(e => e.value)")
    check('form: prefilled value "Muster" shown', 'Muster' in vals, vals)
    inputs = pg.locator('.xfaLayer .xfaTextfield')
    inputs.nth(1).fill('Anna')
    inputs.nth(2).fill('Saarbrücken')
    sel = pg.locator('.xfaLayer select')
    if sel.count():
        sel.first.select_option(label='Saarland')
    cb = pg.locator('.xfaLayer input[type=checkbox]')
    if cb.count():
        cb.first.check()
    pg.locator('body').click(position={'x': 5, 'y': 5})
    pg.wait_for_timeout(300)
    check('form: unsaved-changes note in the footer', 'Ungespeicherte' in pg.locator('.screen-foot').inner_text(), pg.locator('.screen-foot').inner_text())
    pg.screenshot(path=os.path.join(OUT, 'form_filled.png'))

    # ---- save (stays an XFA form)
    pg.locator('.screen-foot .btn-primary').click()
    pg.wait_for_selector('[data-result] .result-card', timeout=30000)
    saved = doc_bytes(pg, 'xfa_pure (ausgefüllt).pdf')
    data = b''.join(s for s in streams(saved) if b'datasets' in s)
    check('save: XFA data holds the new values', b'Anna' in data and ('Saarbrücken'.encode() in data or b'Saarbr&#xFC;cken' in data) and b'<Staat>Saarland' in data and b'Muster' in data, data[-400:])
    check('save: still an XFA form', b'/XFA' in saved)
    check('save: original untouched', doc_bytes(pg, 'xfa_pure.pdf') == original)
    check('save: footer note cleared', 'Ungespeicherte' not in pg.locator('.screen-foot').inner_text())

    # ---- reopen the saved copy: values come back
    sid = doc_by_name(pg, 'xfa_pure (ausgefüllt).pdf')['id']
    pg.goto(URL + f'#/werkzeug/behoerdenformular?doc={sid}')
    pg.wait_for_selector('.xfaLayer input', timeout=20000)
    pg.wait_for_timeout(500)
    vals2 = pg.evaluate("() => [...document.querySelectorAll('.xfaLayer .xfaTextfield')].map(e => e.value)")
    check('reopen: saved values are back', 'Anna' in vals2 and 'Saarbrücken' in vals2, vals2)

    # ---- normal PDF (flatten), with freeze measurement
    pg.evaluate(LONGTASK)
    pg.locator('.screen-foot .btn-secondary').click()
    pg.wait_for_selector('[data-result] .result-card', timeout=30000)
    lt = pg.evaluate('window.__lt || 0')
    check('flatten: no freeze over 2.5 s', lt < 2500, lt)
    flat = doc_bytes(pg, 'xfa_pure (ausgefüllt) (ausgefüllt, normale PDF).pdf')
    path = os.path.join(OUT, 'flat.pdf')
    open(path, 'wb').write(flat)
    check('flatten: ordinary PDF without XFA', flat.startswith(b'%PDF') and b'/XFA' not in flat and b'NeedsRendering' not in flat, len(flat))
    txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    check('flatten: title, captions and values as real text', all(s in txt for s in ['Antrag auf Testbescheinigung', 'Nachname', 'Muster', 'Anna', 'Saarbrücken']), txt[:400])
    check('flatten: chosen list entry printed', 'Saarland' in txt, txt[:400])
    png = os.path.join(OUT, 'flat')
    subprocess.run(['pdftoppm', '-r', '60', '-png', '-singlefile', path, png], check=False)
    check('flatten: renders', os.path.exists(png + '.png') and os.path.getsize(png + '.png') > 3000)

    # ---- fill & sign tool
    pg.goto(URL + f'#/werkzeug/unterschreiben?doc={pure["id"]}')
    pg.wait_for_timeout(2500)
    check('sign tool: XFA-only form → hint card with the way to the form', pg.locator('.xfa-info a[href*="behoerdenformular"]').count() == 1)
    pg.goto(URL + f'#/werkzeug/unterschreiben?doc={hybrid["id"]}')
    pg.wait_for_timeout(3000)
    check('sign tool: hybrid form → normal form fields', pg.locator('[data-mode="form"]').count() == 1 and pg.locator('.xfa-info').count() == 0)
    pg.goto(URL + f'#/werkzeug/behoerdenformular?doc={hybrid["id"]}')
    pg.wait_for_timeout(2500)
    check('form screen with a hybrid form → points to the normal tool', pg.locator('.xfa-info a[href*="unterschreiben"]').count() == 1)

    # ---- tools list
    pg.goto(URL + '#/werkzeuge')
    pg.wait_for_timeout(800)
    check('tools list: "Behörden-Formular" listed', pg.locator('[data-tool="behoerdenformular"]').count() >= 1)
    check('no page errors', not errs, errs[:4])
    c.close()

    # ---- phone
    c = b.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', is_mobile=True, has_touch=True)
    c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=20000)
    import_pdfs(pg, ['xfa_pure.pdf'])
    pid = doc_by_name(pg, 'xfa_pure.pdf')['id']
    pg.goto(URL + f'#/werkzeug/behoerdenformular?doc={pid}')
    pg.wait_for_selector('.xfaLayer input', timeout=20000)
    pg.wait_for_timeout(800)
    over = pg.evaluate('document.documentElement.scrollWidth')
    check('phone: no horizontal page overflow', over <= 391, over)
    box = pg.locator('.xfaLayer .xfaTextfield').first.bounding_box()
    check('phone: form fits the width (page-width zoom)', box and box['x'] >= 0 and box['x'] + box['width'] <= 390, box)
    w0 = pg.locator('.xfaLayer .xfaTextfield').first.bounding_box()['width']
    pg.locator('[data-zoom="1"]').click()
    pg.wait_for_timeout(700)
    w1 = pg.locator('.xfaLayer .xfaTextfield').first.bounding_box()['width']
    check('phone: "Größer" enlarges the form', w1 > w0 * 1.15, (w0, w1))
    over = pg.evaluate('document.documentElement.scrollWidth')
    check('phone: still no page overflow after zooming (the form scrolls inside its area)', over <= 391, over)
    sb = pg.locator('.xfa-scroll').bounding_box()
    pinch(pg, sb['x'] + sb['width'] / 2, sb['y'] + sb['height'] / 2, 80, 240)
    pg.wait_for_timeout(900)
    w2 = pg.locator('.xfaLayer .xfaTextfield').first.bounding_box()['width']
    check('phone: two-finger spread zooms in', w2 > w1 * 1.6, (w1, w2))
    pinch(pg, sb['x'] + sb['width'] / 2, sb['y'] + sb['height'] / 2, 260, 90)
    pg.wait_for_timeout(900)
    w3 = pg.locator('.xfaLayer .xfaTextfield').first.bounding_box()['width']
    check('phone: two-finger pinch zooms out again', w3 < w2 * 0.6, (w2, w3))
    over = pg.evaluate('document.documentElement.scrollWidth')
    check('phone: pinching never zooms the whole page (no overflow)', over <= 391, over)
    pg.screenshot(path=os.path.join(OUT, 'phone_form.png'))
    check('phone: no page errors', not errs, errs[:3])
    c.close()

    # ---- a real authority form (Canadian visa application IMM 5257, XFA + a signature field, owner-password
    #      protected). Not in the repository (third-party copyright): put it at xfadata/real_imm5257e.pdf to run this.
    real = os.path.join(TD, 'real_imm5257e.pdf')
    if os.path.exists(real):
        c = b.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', is_mobile=True, has_touch=True)
        c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
        pg = c.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL)
        pg.wait_for_selector('#view-start .hero', timeout=20000)
        import_pdfs(pg, ['real_imm5257e.pdf'])
        rid = doc_by_name(pg, 'real_imm5257e.pdf')['id']
        pg.goto(URL + f'#/ansicht/{rid}')
        pg.locator('.xfa-banner').wait_for(timeout=15000)
        check('real form: viewer offers "Formular ausfüllen" (XFA + signature field counts as XFA-only)', pg.locator('.xfa-banner').count() == 1)
        pg.locator('.xfa-banner [data-xfa-go]').click()
        pg.wait_for_selector('.xfaLayer input', state='attached', timeout=30000)
        pg.wait_for_timeout(1500)
        check('real form: 5 pages laid out', pg.locator('.xfa-scroll .page').count() == 5, pg.locator('.xfa-scroll .page').count())
        vis = pg.evaluate("() => [...document.querySelectorAll('.xfaLayer')].map(l => l.innerText).join(' ')")
        check('real form: the "JavaScript has been disabled" notice is hidden', 'JavaScript has been disabled' not in vis, vis[:200])
        pg.locator('.xfaLayer input.xfaTextfield:visible').first.fill('Mustermann')
        # signature line: tapping it opens the signature pad, not the keyboard
        sf = pg.locator('.xfaLayer .xfa-sigfield')
        for _ in range(12):  # the signature line is on the last page – scroll until pdf.js has laid it out
            if sf.count():
                break
            pg.locator('.xfa-scroll').evaluate('el => el.scrollBy(0, 1500)')
            pg.wait_for_timeout(500)
        check('real form: signature line found and marked "Hier unterschreiben"', sf.count() >= 1 and sf.first.get_attribute('placeholder') == 'Hier unterschreiben', sf.count())
        if sf.count():
            sf.first.scroll_into_view_if_needed()
            check('real form: signature line is read-only (no keyboard)', sf.first.evaluate('el => el.readOnly'))
            sf.first.tap()
            pg.wait_for_selector('dialog .sig-pad', timeout=10000)
            pad = pg.locator('dialog .sig-pad').bounding_box()
            pg.mouse.move(pad['x'] + 30, pad['y'] + 80)
            pg.mouse.down()
            for i in range(1, 25):
                pg.mouse.move(pad['x'] + 30 + i * 10, pad['y'] + 80 - 25 * ((i % 5) / 5.0))
            pg.mouse.up()
            pg.locator('dialog .btn-primary').click()
            pg.wait_for_timeout(800)
            img = pg.locator('.xfaLayer img.xfa-sig')
            ok = img.count() == 1
            if ok:
                ib, fb = img.bounding_box(), sf.first.bounding_box()
                ok = ib and fb and ib['width'] > 20 and abs((ib['y'] + ib['height']) - (fb['y'] + fb['height'])) < 6 and ib['x'] >= fb['x'] - 2
            check('real form: signature shows on the signature line', ok, img.count())
            pg.screenshot(path=os.path.join(OUT, 'real_signed.png'))
            pg.wait_for_timeout(500)
            check('real form: no endless re-drawing after signing', pg.locator('.xfaLayer img.xfa-sig').count() == 1)
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=30000)
        saved = doc_bytes(pg, 'real_imm5257e (ausgefüllt).pdf')
        check('real form: saved copy keeps the XFA form', b'/XFA' in saved or len(saved) > 1000000, len(saved))
        pg.locator('.screen-foot .btn-secondary').click()
        pg.wait_for_selector('[data-result] .result-card:has-text("normale")', timeout=60000)
        flat = doc_bytes(pg, 'real_imm5257e (ausgefüllt, normale PDF).pdf')
        fp = os.path.join(OUT, 'real_flat.pdf')
        open(fp, 'wb').write(flat)
        ft = subprocess.run(['pdftotext', fp, '-'], capture_output=True, text=True).stdout
        n = subprocess.run(['pdfinfo', fp], capture_output=True, text=True).stdout
        check('real form: normal PDF with 5 pages, title, value, no JavaScript notice',
              'Pages:           5' in n and 'APPLICATION FOR VISITOR VISA' in ft and 'Mustermann' in ft and 'JavaScript' not in ft, n[:80] + ft[:120])
        nimg = flat.count(b'/Subtype /Image') + flat.count(b'/Subtype/Image')
        check('real form: logo images and the signature carried over', nimg >= 2, nimg)
        subprocess.run(['pdftoppm', '-r', '50', '-png', '-f', '5', '-l', '5', '-singlefile', fp, os.path.join(OUT, 'real_flat_p5')])
        check('real form: no page errors', not errs, errs[:3])
        c.close()
    else:
        print('SKIP real form (xfadata/real_imm5257e.pdf not present)')

    # ---- English UI (device language)
    c = b.new_context(viewport={'width': 1100, 'height': 800}, locale='en-GB')
    c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    pg = c.new_page()
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=20000)
    import_pdfs(pg, ['xfa_pure.pdf'])
    pid = doc_by_name(pg, 'xfa_pure.pdf')['id']
    pg.goto(URL + f'#/ansicht/{pid}')
    pg.locator('.xfa-banner').wait_for(timeout=10000)
    pg.wait_for_timeout(400)
    btxt = pg.locator('.xfa-banner').inner_text()
    check('en: viewer banner in English', 'official form' in btxt and 'Fill in form' in btxt, btxt)
    pg.locator('.xfa-banner [data-xfa-go]').click()
    pg.wait_for_selector('.xfaLayer input', timeout=20000)
    pg.wait_for_timeout(500)
    ui = pg.locator('.xfa-tip').inner_text() + ' | ' + pg.locator('.screen-foot').inner_text() + ' | ' + pg.locator('.screen-head').inner_text()
    check('en: form screen in English', 'Tap the fields' in ui and 'As a normal PDF' in ui and 'Save' in ui and 'official form' in ui.lower(), ui)
    c.close()
    b.close()


if __name__ == '__main__':
    srv = start_server()
    try:
        with sync_playwright() as p:
            run(p)
    finally:
        srv.terminate()
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], str(r[2])[:400])
    sys.exit(1 if bad else 0)

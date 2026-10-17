"""End-to-end tests for the FaLe PDF pro tools (desktop 1366x860 + phone 390x844).
Run: python3 test_protools.py [all|desktop|phone]   (server: http://127.0.0.1:9100 serving /home/claude/FalePDF)
"""
import os, sys, json, zipfile, subprocess, traceback, shutil, socket, time, base64, re
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SP, 'testdata')
OUT = os.path.join(SP, 'out_protools')
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.startswith('t_'):
        os.remove(os.path.join(OUT, f))
URL = 'http://127.0.0.1:9100/'
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
STEPS = set(ONLY.split(':', 1)[1].split(',')) if ':' in ONLY else None
ONLY = ONLY.split(':', 1)[0]
APP = '/home/claude/FalePDF/tests/suites/design/before'

results, console_problems = [], []
CUR = {'page': None}


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    if STEPS and name not in STEPS and name not in ('setup', 'phone setup'):
        return
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        try:
            if CUR['page']:
                CUR['page'].screenshot(path=os.path.join(OUT, 'fail_' + re.sub(r'\W+', '_', name) + '.png'))
        except Exception:
            pass
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def ensure_server():
    s = socket.socket()
    try:
        s.connect(('127.0.0.1', 9100)); s.close(); return
    except OSError:
        pass
    subprocess.Popen(['python3', '-m', 'http.server', '9100', '--bind', '127.0.0.1'], cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)


def ensure_testdata():
    if not os.path.exists(os.path.join(TD, 'struktur.pdf')):
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak
        from reportlab.lib.styles import getSampleStyleSheet
        st = getSampleStyleSheet()
        doc = SimpleDocTemplate(os.path.join(TD, 'struktur.pdf'), pagesize=A4, title='Strukturtest')
        doc.build([Paragraph('Jahresbericht 2026', st['Title']), Paragraph('Einleitung', st['Heading1']),
                   Paragraph('Dies ist der erste Absatz mit <b>fettem Text</b> und <i>kursivem Text</i>. ' + 'Er enthält mehrere Sätze, damit er über mehrere Zeilen umbricht. ' * 3, st['BodyText']),
                   Paragraph('Ergebnisse', st['Heading2']), Paragraph('Ein Absatz mit dem geheimen Begriff Zitronenfalter.', st['BodyText']), PageBreak(),
                   Paragraph('Anhang', st['Heading1']), Paragraph('Kontakt: max.mustermann@example.de, IBAN DE89 3704 0044 0532 0130 00.', st['BodyText'])])
    for f in ['scan_truth.json', 'cam_doc.y4m', 'cam_card.y4m']:
        if not os.path.exists(os.path.join(TD, f)):
            subprocess.run(['python3', os.path.join(SP, 'make_scans.py')], cwd=SP, check=True)
            subprocess.run(['python3', os.path.join(SP, 'make_y4m.py')], cwd=SP, check=True)
            break


DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, pages: d.pages, encrypted: d.encrypted}))); });
  db.close(); return res; }"""


def docs(page):
    return page.evaluate(DOCS_JS)


def doc_id(page, name):
    for d in docs(page):
        if d['name'] == name:
            return d['id']
    return None


def attach_logging(page, label):
    def on_console(m):
        if m.type in ('error', 'warning'):
            console_problems.append(f'{label} [{m.type}] {m.text}')
            if os.environ.get('VERBOSE'):
                print('CONSOLE', label, m.type, m.text, m.location, flush=True)
    page.on('console', on_console)
    def on_err(e):
        console_problems.append(f'{label} [pageerror] {e}')
        if os.environ.get('VERBOSE'):
            print('PAGEERROR', label, e, getattr(e, 'stack', ''), flush=True)
    page.on('pageerror', on_err)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f'{name}.png'))


def goto(page, h, wait=None):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    if wait:
        page.wait_for_selector(wait, timeout=20000)
    page.wait_for_timeout(350)


def no_toast(page):
    try:
        page.wait_for_function("!document.querySelector('.toast')", timeout=9000)
    except Exception:
        pass


def download(page, name, sel='.result-card [data-r="dl"]'):
    with page.expect_download() as d:
        page.locator(sel).last.click()
    path = os.path.join(OUT, 't_' + name)
    d.value.save_as(path)
    return path


def import_pdfs(page, names, password=None):
    page.set_input_files('#pdf-input', [os.path.join(TD, n) for n in names])
    if password:
        page.wait_for_selector('dialog input[type=password]', timeout=10000)
        page.locator('dialog input[type=password]').fill(password)
        page.locator('dialog .btn-primary').click()
    for _ in range(120):
        have = {d['name'] for d in docs(page)}
        if all(n in have for n in names):
            break
        page.wait_for_timeout(250)
    else:
        raise AssertionError('import timed out: ' + ','.join(names))
    if len(names) == 1:  # a single import opens the viewer – let it finish
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=15000)
        page.wait_for_function("document.querySelector('[data-v=loading]') && document.querySelector('[data-v=loading]').hidden", timeout=20000)
    page.wait_for_timeout(300)


def pdftext(path, first=None, last=None, pw=None):
    cmd = ['pdftotext', '-layout']
    if first: cmd += ['-f', str(first)]
    if last: cmd += ['-l', str(last)]
    if pw: cmd += ['-upw', pw]
    return subprocess.run(cmd + [path, '-'], capture_output=True, text=True).stdout


def annot_subtypes(path):
    from pypdf import PdfReader
    r = PdfReader(path)
    out = []
    for pg in r.pages:
        for a in (pg.get('/Annots') or []):
            out.append(str(a.get_object().get('/Subtype')))
    return out


def text_box(page, docid, pnum, needle):
    """Viewport@1 box of a text on a page (computed with the app's own text geometry)."""
    return page.evaluate("""async ([id, n, needle]) => {
      const db = await import('./js/db.js'); const core = await import('./js/pdfcore.js'); const tg = await import('./js/tools/textgeom.js');
      const blob = await db.getFile(id);
      const { pdf } = await core.loadPdf(new Uint8Array(await blob.arrayBuffer()), { key: id });
      const pg = await pdf.getPage(n);
      const base = pg.getViewport({ scale: 1, rotation: pg.rotate });
      const pt = await tg.pageChars(pg, base);
      const hit = tg.findInPage(pt, needle)[0];
      const b = hit ? tg.boxesFor(pt.chars, hit.i, hit.j)[0] : null;
      pdf.destroy();
      return b;
    }""", [docid, pnum, needle])


def stage_point(page, pnum, x, y):
    pg = page.locator(f'.pt-page[data-page="{pnum}"]')
    pg.scroll_into_view_if_needed()
    page.wait_for_timeout(150)
    bb = pg.bounding_box()
    base_w = page.evaluate(f"(() => {{ const e = document.querySelector('.pt-page[data-page=\"{pnum}\"]'); return e.offsetWidth; }})()")
    return bb, bb['width'] / base_w


def at(page, pnum, x, y, page_w, scroll=True):
    """Screen point of PDF-viewport coordinate (x, y) on page pnum; scrolls the stage if needed."""
    pg = page.locator(f'.pt-page[data-page="{pnum}"]')
    for _ in range(3):
        bb = pg.bounding_box()
        s = bb['width'] / page_w
        px, py = bb['x'] + x * s, bb['y'] + y * s
        st = page.locator('.pt-stage').bounding_box()
        if not scroll or st['y'] + 50 < py < st['y'] + st['height'] - 60:
            return px, py
        page.locator('.pt-stage').evaluate('(e, d) => { e.scrollTop += d; }', py - (st['y'] + st['height'] / 2))
        page.wait_for_timeout(300)
    return px, py


def drag_pdf(page, pnum, a, b, page_w, steps=8):
    at(page, pnum, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, page_w)  # bring the area into view first
    pa, pb = at(page, pnum, *a, page_w, scroll=False), at(page, pnum, *b, page_w, scroll=False)
    drag(page, pa, pb, steps)


def drag(page, a, b, steps=8):
    page.mouse.move(*a); page.mouse.down(); page.mouse.move(*b, steps=steps); page.mouse.up()


def touch_drag(page, pts):
    cdp = page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': pts[0][0], 'y': pts[0][1]}]})
    for x, y in pts[1:]:
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    cdp.detach()


def nonblank_canvas(page, sel):
    return page.evaluate(f"""(() => {{ const c = document.querySelector({json.dumps(sel)}); if (!c) return 0;
      const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 40) if (d[i] < 200) n++; return n; }})()""")


# =====================================================================================
def desktop(p):
    browser = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                                      f'--use-file-for-fake-video-capture={TD}/cam_doc.y4m'])
    ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True, locale='de-DE', permissions=['camera'])
    page = ctx.new_page()
    CUR['page'] = page
    attach_logging(page, 'desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')

    def setup():
        import_pdfs(page, ['bericht.pdf', 'formular.pdf', 'struktur.pdf'])
        import_pdfs(page, ['geschuetzt.pdf'], password='geheim')
        check('docs imported', all(doc_id(page, n) for n in ['bericht.pdf', 'formular.pdf', 'struktur.pdf', 'geschuetzt.pdf']))
    step('setup', setup)
    ids = {d['name']: d['id'] for d in docs(page)}

    def registry():
        tools = page.evaluate("import('./js/tools/index.js').then(m => m.TOOLS.map(t => ({id: t.id, group: t.group, pro: !!t.pro, soon: !!t.soon})))")
        byid = {t['id']: t for t in tools}
        need = ['kommentieren', 'scannen', 'ausweis', 'passwort', 'passwort-entfernen', 'schwaerzen', 'bearbeiten', 'wasserzeichen', 'seitenzahlen', 'kopfzeile', 'extrahieren', 'pdf-word', 'pdf-powerpoint']
        check('registry has all new tools', all(n in byid for n in need), ','.join(n for n in need if n not in byid))
        check('every tool has a valid group', all(t['group'] in ('bearbeiten', 'konvertieren', 'organisieren', 'sicherheit', 'scannen', 'lesen') for t in tools))
        check('no "soon" placeholders left', not any(t['soon'] for t in tools))
        check('PDF zu Bild reachable under konvertieren', byid['exportieren']['group'] == 'konvertieren')
        check('pro flag on paid features', all(byid[n]['pro'] for n in ['kommentieren', 'passwort', 'schwaerzen', 'pdf-word']))
        goto(page, '#/werkzeuge', '#view-werkzeuge [data-tool="passwort"]')
        page.locator('#view-werkzeuge [data-tool="passwort"]').first.click()
        page.wait_for_timeout(600)
        check('password tile opens a tool screen', page.locator('#tool-screen').is_visible() and 'bald' not in page.locator('#toasts').inner_text().lower())
        shot(page, 'desktop_tools')
    step('registry', registry)

    # ---------------- password: set ----------------
    def pw_set():
        goto(page, f"#/werkzeug/passwort?doc={ids['bericht.pdf']}", '[name=pw1]')
        shot(page, 'desktop_passwort')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_timeout(300)
        check('empty password rejected', page.locator('[data-err]').is_visible())
        page.locator('[name=pw1]').fill('Sicher-2026!')
        page.locator('[name=pw2]').fill('anders')
        page.locator('.screen-foot .btn-primary').click()
        check('mismatch rejected', 'stimmen nicht' in page.locator('[data-err]').inner_text())
        page.locator('[name=pw2]').fill('Sicher-2026!')
        page.locator('details.pt-details summary').click()
        page.locator('[name=print]').uncheck()
        page.locator('[name=copy]').uncheck()
        page.locator('[name=owner]').fill('Chef-Passwort')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=30000)
        check('no password prompt when importing own result', page.locator('dialog[open]').count() == 0)
        path = download(page, 'protected.pdf')
        from pypdf import PdfReader
        r = PdfReader(path)
        check('output is encrypted', r.is_encrypted)
        check('wrong password rejected (pypdf)', PdfReader(path).decrypt('falsch') == 0)
        r2 = PdfReader(path)
        check('user password opens (pypdf)', r2.decrypt('Sicher-2026!') == 1 and 'Datenschutz' in (r2.pages[0].extract_text() or ''))
        check('owner password opens (pypdf)', PdfReader(path).decrypt('Chef-Passwort') == 2)
        enc = subprocess.run(['qpdf', '--show-encryption', '--password=Sicher-2026!', path], capture_output=True, text=True).stdout
        check('AES-256 R6 (qpdf)', 'R = 6' in enc and 'AESv3' in enc, enc.replace('\n', ' ')[:120])
        check('print/copy restricted', 'print high resolution: not allowed' in enc and 'extract for any purpose: not allowed' in enc)
        chk = subprocess.run(['qpdf', '--check', '--password=Sicher-2026!', path], capture_output=True, text=True)
        check('qpdf --check ok', chk.returncode == 0, chk.stdout[-120:])
        check('no text without password (pdftotext)', 'Datenschutz' not in pdftext(path) and 'Datenschutz' in pdftext(path, pw='Sicher-2026!'))
        d = [x for x in docs(page) if x['name'] == 'bericht (geschützt).pdf']
        check('library marks result as encrypted', d and d[0]['encrypted'])
        # open in viewer (session password known) → renders
        page.locator('[data-result] .result-card [data-r="open"]').click()
        page.wait_for_selector('#viewer .page canvas', timeout=20000)
        page.wait_for_function("document.querySelector('[data-v=loading]').hidden")
        page.wait_for_timeout(800)
        check('encrypted result renders in viewer', nonblank_canvas(page, '#viewer .page canvas') > 50)
    step('password set', pw_set)

    def pw_fresh_context():
        # a different browser profile: pdf.js must ask for the password
        c2 = browser.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE')
        pg = c2.new_page()
        attach_logging(pg, 'desktop-fresh')
        pg.goto(URL)
        pg.wait_for_selector('#view-start .hero')
        pg.set_input_files('#pdf-input', [os.path.join(OUT, 't_protected.pdf')])
        pg.wait_for_selector('dialog input[type=password]', timeout=10000)
        check('fresh profile asks for password', True)
        pg.locator('dialog input[type=password]').fill('falsch')
        pg.locator('dialog .btn-primary').click()
        pg.wait_for_selector('dialog .text-danger', timeout=10000)
        check('pdf.js: wrong password refused', 'Falsches Passwort' in pg.locator('dialog').inner_text())
        pg.locator('dialog input[type=password]').fill('Sicher-2026!')
        pg.locator('dialog .btn-primary').click()
        pg.wait_for_selector('#viewer .page canvas', timeout=20000)
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden")
        pg.wait_for_timeout(800)
        check('pdf.js: correct password renders content', nonblank_canvas(pg, '#viewer .page canvas') > 50)
        c2.close()
    step('password fresh context', pw_fresh_context)

    # ---------------- password: remove ----------------
    def pw_remove():
        goto(page, f"#/werkzeug/passwort-entfernen?doc={ids['geschuetzt.pdf']}", '[name=pw]')
        check('session password prefilled', page.locator('[name=pw]').input_value() == 'geheim')
        shot(page, 'desktop_passwort_entfernen')
        page.locator('[name=pw]').fill('falsch')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-err]:not([hidden])', timeout=15000)
        check('wrong password message', 'falsch' in page.locator('[data-err]').inner_text())
        page.locator('[name=pw]').fill('geheim')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=30000)
        path = download(page, 'unlocked.pdf')
        from pypdf import PdfReader
        r = PdfReader(path)
        check('unlocked output not encrypted', not r.is_encrypted)
        ref = pdftext(os.path.join(TD, 'geschuetzt.pdf'), pw='geheim')
        check('unlocked text identical', pdftext(path).strip() == ref.strip() and len(ref.strip()) > 20)
        check('qpdf check unlocked', subprocess.run(['qpdf', '--check', path], capture_output=True).returncode == 0)
        goto(page, f"#/werkzeug/passwort-entfernen?doc={ids['bericht.pdf']}", '.empty')
        check('unprotected doc: friendly message', 'Kein Passwortschutz' in page.locator('.empty').inner_text())
        # decryption of all standard handler variants (files generated with qpdf)
        made = []
        base = os.path.join(TD, 'bericht.pdf')
        variants = {'rc4_40': ['--allow-weak-crypto', '--encrypt', 'u', 'o', '40', '--'], 'rc4_128': ['--allow-weak-crypto', '--encrypt', 'u', 'o', '128', '--use-aes=n', '--'],
                    'aes_128': ['--allow-weak-crypto', '--encrypt', 'u', 'o', '128', '--use-aes=y', '--'], 'aes_256': ['--encrypt', 'u', 'o', '256', '--']}
        for k, args in variants.items():
            dst = os.path.join(OUT, f't_enc_{k}.pdf')
            subprocess.run(['qpdf', '--object-streams=generate'] + args + [base, dst], check=True)
            made.append((k, dst))
        page.set_input_files('#pdf-input', [m[1] for m in made])
        for _ in made:
            page.wait_for_selector('dialog input[type=password]', timeout=15000)
            page.locator('dialog input[type=password]').fill('u')
            page.locator('dialog .btn-primary').click()
            page.wait_for_timeout(500)
        for _ in range(120):
            if len([x for x in docs(page) if x['name'].startswith('t_enc_')]) == 4:
                break
            page.wait_for_timeout(250)
        allids = {d['name']: d['id'] for d in docs(page)}
        reftxt = pdftext(base).strip()
        for k, dst in made:
            goto(page, f"#/werkzeug/passwort-entfernen?doc={allids['t_enc_' + k + '.pdf']}", '[name=pw]')
            page.locator('[name=pw]').fill('o')  # owner password also removes restrictions
            page.locator('.screen-foot .btn-primary').click()
            page.wait_for_selector('[data-result] .result-card', timeout=30000)
            out = download(page, f'dec_{k}.pdf')
            check(f'decrypt {k} (object streams)', pdftext(out).strip() == reftxt)
    step('password remove', pw_remove)

    def encrypted_in_tools():
        goto(page, f"#/werkzeug/seiten?doc={ids['geschuetzt.pdf']}", '.pcard')
        page.locator('.pcard [data-r]').first.click()
        btn = page.locator('[data-save]')
        check('organize: save enabled for encrypted doc', btn.is_enabled())
        btn.click()
        page.wait_for_selector('.result-card', timeout=20000)
        path = download(page, 'enc_rotated.pdf')
        from pypdf import PdfReader
        r = PdfReader(path)
        check('organize: encrypted doc rotated & saved', not r.is_encrypted and r.pages[0].get('/Rotate') in (90, -270))
    step('encrypted doc in organize', encrypted_in_tools)

    # ---------------- annotate ----------------
    def annotate():
        goto(page, f"#/werkzeug/kommentieren?doc={ids['bericht.pdf']}", '.pt-page canvas')
        no_toast(page)
        W = 595.28
        box = text_box(page, ids['bericht.pdf'], 1, 'Testtext ueber Datenschutz')
        check('text geometry found', box is not None, str(box))
        page.locator('.pt-stage').evaluate('e => e.scrollTop = 0')
        y = (box['y0'] + box['y1']) / 2
        drag_pdf(page, 1, (box['x0'] + 1, y), (box['x1'] - 1, y), W)
        page.wait_for_timeout(200)
        b2 = text_box(page, ids['bericht.pdf'], 1, 'Rechnung')
        page.locator('.pt-tool[data-tool=underline]').click()
        page.mouse.click(*at(page, 1, (b2['x0'] + b2['x1']) / 2, (b2['y0'] + b2['y1']) / 2, W))
        b3 = text_box(page, ids['bericht.pdf'], 1, 'Vertrag')
        page.locator('.pt-tool[data-tool=strike]').click()
        drag_pdf(page, 1, (b3['x0'] + 1, (b3['y0'] + b3['y1']) / 2), (b3['x1'] - 1, (b3['y0'] + b3['y1']) / 2), W)
        page.locator('.pt-tool[data-tool=pen]').click()
        at(page, 1, 420, 210, W)
        page.mouse.move(*at(page, 1, 380, 200, W, scroll=False)); page.mouse.down()
        for i in range(20):
            page.mouse.move(*at(page, 1, 380 + i * 5, 200 + (i % 5) * 4, W, scroll=False))
        page.mouse.up()
        for t, a, bpt in [('rect', (80, 250), (200, 300)), ('ellipse', (220, 250), (330, 300)), ('arrow', (360, 250), (480, 300)), ('line', (60, 330), (150, 345))]:
            page.locator(f'.pt-tool[data-tool={t}]').click()
            drag_pdf(page, 1, a, bpt, W, 6)
        page.locator('.pt-tool[data-tool=text]').click()
        page.mouse.click(*at(page, 1, 60, 225, W)); page.wait_for_timeout(200)
        page.keyboard.type('Prüfvermerk: OK')
        page.mouse.click(*at(page, 1, 520, 330, W))
        page.locator('.pt-tool[data-tool=note]').click()
        page.mouse.click(*at(page, 1, 520, 90, W))
        page.locator('dialog textarea').fill('Bitte bis Freitag prüfen!')
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(300)
        info = page.locator('.screen-foot .foot-info').inner_text()
        check('10 annotations created', info.startswith('10 '), info)
        page.locator('[aria-label="Rückgängig"]').click()
        check('undo removes one', page.locator('.screen-foot .foot-info').inner_text().startswith('9 '))
        page.locator('[aria-label="Wiederholen"]').click()
        check('redo restores', page.locator('.screen-foot .foot-info').inner_text().startswith('10 '))
        # eraser: wipe across the pen stroke, then undo
        page.locator('.pt-tool[data-tool=eraser]').click()
        drag_pdf(page, 1, (400, 190), (400, 220), W, 6)
        check('eraser deletes stroke', page.locator('.screen-foot .foot-info').inner_text().startswith('9 '))
        page.locator('[aria-label="Rückgängig"]').click()
        # select + move the rectangle
        page.locator('.pt-tool[data-tool=select]').click()
        page.mouse.click(*at(page, 1, 80, 275, W))
        page.wait_for_timeout(150)
        check('select shows delete action', page.locator('.pt-props .btn-danger-ghost').count() == 1)
        drag_pdf(page, 1, (82, 255), (102, 405), W, 6)
        shot(page, 'desktop_kommentieren')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('.pt-result .result-card', timeout=30000)
        path = download(page, 'annotated.pdf')
        subs = annot_subtypes(path)
        want = ['/Highlight', '/Underline', '/StrikeOut', '/Ink', '/Square', '/Circle', '/Line', '/FreeText', '/Text']
        check('all annotation subtypes saved', all(w in subs for w in want) and subs.count('/Line') == 2, ','.join(subs))
        from pypdf import PdfReader
        r = PdfReader(path)
        aps = [a.get_object() for a in r.pages[0]['/Annots']]
        check('every annotation has an appearance stream', all('/AP' in a for a in aps))
        hl = [a for a in aps if a['/Subtype'] == '/Highlight'][0]
        check('highlight has QuadPoints + text', len(hl['/QuadPoints']) % 8 == 0 and 'Datenschutz' in str(hl.get('/Contents')))
        sq = [a for a in aps if a['/Subtype'] == '/Square'][0]
        check('moved rectangle saved at new position', float(sq['/Rect'][1]) < 842 - 380, str(sq['/Rect']))
        check('qpdf check annotated', subprocess.run(['qpdf', '--check', path], capture_output=True).returncode == 0)
        # pdf.js renders them (annotation layer of the viewer)
        res_id = doc_id(page, 'bericht (kommentiert).pdf')
        goto(page, f'#/ansicht/{res_id}', '#viewer .page canvas')
        page.wait_for_selector('#viewer .annotationLayer section', timeout=15000)
        check('pdf.js annotation layer shows annotations', page.locator('#viewer .annotationLayer section').count() >= 3)
        # existing annotations survive a second pass
        goto(page, f'#/werkzeug/kommentieren?doc={res_id}', '.pt-page canvas')
        no_toast(page)
        page.locator('.pt-tool[data-tool=rect]').click()
        drag_pdf(page, 1, (300, 330), (380, 360), W)
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('.pt-result .result-card', timeout=30000)
        path2 = download(page, 'annotated2.pdf')
        subs2 = annot_subtypes(path2)
        check('existing annotations kept on re-save', len(subs2) == len(subs) + 1, f'{len(subs)} → {len(subs2)}')
    step('annotate', annotate)

    # ---------------- watermark / page numbers / header-footer ----------------
    def stamps():
        goto(page, f"#/werkzeug/wasserzeichen?doc={ids['bericht.pdf']}", '.pt-prev-overlay')
        page.locator('[name=text]').fill('ENTWURF')
        page.wait_for_timeout(300)
        check('watermark preview drawn', nonblank_canvas(page, '.pt-prev-overlay') >= 0)
        shot(page, 'desktop_wasserzeichen')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=30000)
        path = download(page, 'watermark.pdf')
        from pypdf import PdfReader
        wm = sum('ENTWURF' in (pg.extract_text() or '') for pg in PdfReader(path).pages)
        check('watermark on all 6 pages', wm == 6, str(wm))
        # image watermark on pages 2-3
        goto(page, f"#/werkzeug/wasserzeichen?doc={ids['bericht.pdf']}", '.pt-prev-overlay')
        with page.expect_file_chooser() as fc:
            page.locator('[data-kind=image]').click()
        fc.value.set_files(os.path.join(TD, 'farbverlauf.png'))
        page.wait_for_timeout(600)
        page.locator('[name=range]').fill('2-3')
        page.locator('.pt-posgrid [data-pos=b-r]').click()
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=30000)
        path = download(page, 'watermark_img.pdf')
        imgs = subprocess.run(['pdfimages', '-list', path], capture_output=True, text=True).stdout.strip().splitlines()[2:]
        pages_with_img = sorted({int(l.split()[0]) for l in imgs})
        check('image watermark only on pages 2-3', pages_with_img == [2, 3], str(pages_with_img))

        goto(page, f"#/werkzeug/seitenzahlen?doc={ids['bericht.pdf']}", '.pt-prev-overlay')
        page.locator('[name=range]').fill('2-6')
        page.wait_for_timeout(200)
        shot(page, 'desktop_seitenzahlen')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=30000)
        path = download(page, 'numbers.pdf')
        p1, p2, p6 = pdftext(path, 1, 1), pdftext(path, 2, 2), pdftext(path, 6, 6)
        check('page numbers: cover page without number', 'Seite' not in p1.replace('auf Seite', ''), p1[-60:])
        check('page numbers: "Seite 1 von 5" on page 2', 'Seite 1 von 5' in p2)
        check('page numbers: "Seite 5 von 5" on page 6', 'Seite 5 von 5' in p6)

        goto(page, f"#/werkzeug/kopfzeile?doc={ids['bericht.pdf']}", '.pt-prev-overlay')
        page.locator('[name=hl]').fill('Vertraulich – {datei}')
        page.wait_for_timeout(200)
        shot(page, 'desktop_kopfzeile')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=30000)
        path = download(page, 'header.pdf')
        t3 = pdftext(path, 3, 3)
        today = time.strftime('%d.%m.%Y')
        check('header/footer placeholders filled', 'Vertraulich – bericht' in t3 and today in t3 and 'Seite 3 von 6' in t3, t3[:80].replace('\n', ' '))
    step('stamps', stamps)

    # ---------------- edit ----------------
    def edit():
        goto(page, f"#/werkzeug/bearbeiten?doc={ids['struktur.pdf']}", '.pt-page canvas')
        no_toast(page)
        W = 595.27
        page.mouse.click(*at(page, 1, 400, 40, W)); page.wait_for_timeout(250)
        page.keyboard.type('Freigegeben am Montag')
        page.mouse.click(*at(page, 1, 500, 20, W))
        page.locator('.pt-tool[data-tool=replace]').click()
        b = text_box(page, ids['struktur.pdf'], 1, 'Einleitung')
        page.mouse.click(*at(page, 1, (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2, W))
        page.wait_for_timeout(400)
        check('replace prefilled with existing text', page.evaluate("document.activeElement && document.activeElement.textContent") == 'Einleitung')
        page.keyboard.press('Control+A'); page.keyboard.type('Vorwort')
        page.mouse.click(*at(page, 1, 500, 20, W))
        # image
        page.locator('.pt-tool[data-tool=image]').click()
        # (choose dialog opens automatically)
        page.wait_for_timeout(200)
        shot(page, 'desktop_bearbeiten')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('.pt-result .result-card', timeout=30000)
        path = download(page, 'edited.pdf')
        t = pdftext(path, 1, 1)
        check('edit: new text added', 'Freigegeben am Montag' in t)
        check('edit: replacement text present', 'Vorwort' in t)
    step('edit', edit)

    def edit_image():
        goto(page, f"#/werkzeug/bearbeiten?doc={ids['struktur.pdf']}", '.pt-page canvas')
        no_toast(page)
        with page.expect_file_chooser() as fc:
            page.locator('.pt-tool[data-tool=image]').click()
        fc.value.set_files(os.path.join(TD, 'foto.jpg'))
        page.wait_for_timeout(500)
        page.mouse.click(*at(page, 1, 300, 300, 595.27))
        page.wait_for_selector('.pt-eimg')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('.pt-result .result-card', timeout=30000)
        path = download(page, 'edited_img.pdf')
        imgs = subprocess.run(['pdfimages', '-list', path], capture_output=True, text=True).stdout.strip().splitlines()[2:]
        check('edit: image placed', len(imgs) == 1)
    step('edit image', edit_image)

    # ---------------- redact ----------------
    def redact():
        goto(page, f"#/werkzeug/schwaerzen?doc={ids['bericht.pdf']}", '.pt-page canvas')
        no_toast(page)
        page.locator('.pt-tool[data-tool=search]').click()
        page.locator('dialog [name=q]').fill('Zitronenfalter')
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(1200)
        info = page.locator('.screen-foot .foot-info').inner_text()
        check('search marks hits', 'Markierung' in info, info)
        # plus a manual area on page 2
        page.locator('.pt-tool[data-tool=area]').click()
        b = text_box(page, ids['bericht.pdf'], 2, 'Kapitel 2')
        drag_pdf(page, 2, (b['x0'] - 3, b['y0'] - 3), (b['x1'] + 3, b['y1'] + 3), 595.28)
        shot(page, 'desktop_schwaerzen')
        pages_marked = page.locator('.screen-foot .foot-info').inner_text()
        page.locator('.screen-foot .btn-primary').click()
        page.locator('dialog .btn-danger').click()
        page.wait_for_selector('.pt-result .result-card', timeout=60000)
        path = download(page, 'redacted.pdf')
        full = pdftext(path)
        check('search hit redacted (text gone)', 'Zitronenfalter' not in full)
        check('area redaction applied (text gone)', 'Kapitel 2' not in full)
        check('unmarked pages keep their text', 'Kapitel 1: Datenschutz' in pdftext(path, 1, 1) and 'Zeile 5 auf Seite 3' in pdftext(path, 3, 3))
        qdf = os.path.join(OUT, 't_redacted_qdf.pdf')
        subprocess.run(['qpdf', '--qdf', '--object-streams=disable', path, qdf], check=True)
        raw = open(qdf, 'rb').read()
        check('redacted content not in raw file', b'Zitronenfalter' not in raw and b'Kapitel 2' not in raw)
        imgs = subprocess.run(['pdfimages', '-list', path], capture_output=True, text=True).stdout.strip().splitlines()[2:]
        img_pages = sorted({int(l.split()[0]) for l in imgs})
        check('only marked pages rasterised', len(img_pages) >= 2 and 1 not in img_pages and 3 not in img_pages, f'{img_pages} ({pages_marked})')
        from pypdf import PdfReader
        r = PdfReader(path)
        check('page count unchanged', len(r.pages) == 6)
        check('qpdf check redacted', subprocess.run(['qpdf', '--check', path], capture_output=True).returncode == 0)
    step('redact', redact)

    def redact_presets():
        goto(page, f"#/werkzeug/schwaerzen?doc={ids['struktur.pdf']}", '.pt-page canvas')
        no_toast(page)
        page.locator('.pt-tool[data-tool=search]').click()
        page.locator('dialog [name=p_email]').check()
        page.locator('dialog [name=p_iban]').check()
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(1200)
        page.locator('.screen-foot .btn-primary').click()
        page.locator('dialog .btn-danger').click()
        page.wait_for_selector('.pt-result .result-card', timeout=60000)
        path = download(page, 'redacted_presets.pdf')
        t = pdftext(path)
        check('presets: e-mail and IBAN removed', 'mustermann@' not in t and 'DE89' not in t and 'Jahresbericht' in t)
    step('redact presets', redact_presets)

    # ---------------- extract ----------------
    def extract():
        goto(page, f"#/werkzeug/extrahieren?doc={ids['bericht.pdf']}", '.pcard')
        page.locator('[data-range]').fill('2, 4-5')
        page.wait_for_timeout(200)
        check('range selects cards', page.locator('.pcard.selected').count() == 3)
        page.locator('.pcard[data-n="1"] .pcard-thumb').click()
        check('tap toggles selection + range text', page.locator('[data-range]').input_value() == '1-2, 4-5')
        shot(page, 'desktop_extrahieren')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=30000)
        path = download(page, 'extracted.pdf')
        from pypdf import PdfReader
        r = PdfReader(path)
        check('extract: 4 pages in order', len(r.pages) == 4 and 'Kapitel 4' in (r.pages[2].extract_text() or ''))
        page.locator('input[name=out][value=single]').check()
        page.locator('[data-q=even]').click()
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] [data-zip]', timeout=30000)
        z = download(page, 'extracted.zip', '[data-result] [data-zip]')
        names = zipfile.ZipFile(z).namelist()
        check('extract single: zip with 3 files', len(names) == 3, ','.join(names))
    step('extract', extract)

    # ---------------- convert ----------------
    def convert():
        import docx as pydocx, pptx as pypptx
        goto(page, f"#/werkzeug/pdf-word?doc={ids['struktur.pdf']}", 'input[name=mode]')
        shot(page, 'desktop_pdf_word')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = download(page, 'struktur.docx')
        check('docx is a valid zip', zipfile.is_zipfile(path))
        d = pydocx.Document(path)
        paras = [(p.style.name if p.style is not None else '', p.text) for p in d.paragraphs]
        heads = [t for s, t in paras if s.startswith('Heading')]
        check('docx headings detected', 'Einleitung' in heads and 'Ergebnisse' in heads and 'Anhang' in heads, str(heads))
        bold = [r.text for p in d.paragraphs for r in p.runs if r.bold]
        ital = [r.text for p in d.paragraphs for r in p.runs if r.italic]
        check('docx bold/italic runs', any('fettem Text' in b for b in bold) and any('kursivem Text' in i for i in ital))
        check('docx paragraphs joined (not one per line)', any(len(t) > 200 for _, t in paras))
        check('docx page break kept', any(p.paragraph_format.page_break_before for p in d.paragraphs))
        page.locator('input[name=mode][value=exact]').check()
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_function("document.querySelectorAll('[data-result] .result-card').length === 1 && !document.querySelector('.toast-progress')", timeout=60000)
        page.wait_for_timeout(500)
        path = download(page, 'struktur_exakt.docx')
        d2 = pydocx.Document(path)
        check('docx exact: one image per page', len(d2.inline_shapes) == 2 and len(d2.sections) == 2)
        goto(page, f"#/werkzeug/pdf-powerpoint?doc={ids['bericht.pdf']}", '[data-fmt]')
        page.locator('[data-fmt="16x9"]').click()
        shot(page, 'desktop_pdf_powerpoint')
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = download(page, 'bericht.pptx')
        pr = pypptx.Presentation(path)
        notes = pr.slides[0].notes_slide.notes_text_frame.text if pr.slides[0].has_notes_slide else ''
        check('pptx: 6 slides 16:9 with notes', len(pr.slides) == 6 and abs(pr.slide_width / pr.slide_height - 16 / 9) < 0.01 and 'Datenschutz' in notes)
        check('pptx: each slide has a picture', all(any(sh.shape_type == 13 for sh in s.shapes) for s in pr.slides))
    step('convert', convert)

    # ---------------- scanner (camera = synthetic document video) ----------------
    def scanner():
        goto(page, '#/werkzeug/scannen')
        page.wait_for_function("document.querySelector('.sc-view video') && document.querySelector('.sc-view video').videoWidth > 0", timeout=15000)
        page.wait_for_timeout(1500)
        check('live edge overlay drawn', nonblank_canvas(page, '.sc-live') >= 0)
        shot(page, 'desktop_scanner_camera')
        page.locator('[data-shoot]').click()
        page.wait_for_function("document.querySelector('[data-stack] img')", timeout=30000)
        page.locator('[data-done]').click()
        page.wait_for_selector('.sc-card img', timeout=20000)
        page.wait_for_function("Array.from(document.querySelectorAll('.sc-card img')).every(i => i.naturalWidth > 0)", timeout=20000)
        dims = page.evaluate("(() => { const i = document.querySelector('.sc-card img'); return [i.naturalWidth, i.naturalHeight]; })()")
        check('perspective-corrected page has A4 aspect', abs(dims[0] / dims[1] - 210 / 297) < 0.03, str(dims))
        check('detected (no warning badge)', page.locator('.sc-card .sc-warn').count() == 0)
        shot(page, 'desktop_scanner_review')
        page.locator('[data-size=fit]').click()
        page.locator('.screen-foot .btn-primary').click()
        page.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = download(page, 'scan_desktop.pdf')
        from pypdf import PdfReader
        r = PdfReader(path)
        w, h = float(r.pages[0].mediabox.width), float(r.pages[0].mediabox.height)
        check('scan pdf: 1 page, page aspect = scan', len(r.pages) == 1 and abs(w / h - 210 / 297) < 0.03, f'{w:.0f}x{h:.0f}')
    step('scanner', scanner)

    browser.close()


# =====================================================================================
def phone(p):
    browser = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                                      f'--use-file-for-fake-video-capture={TD}/cam_card.y4m'])
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                              accept_downloads=True, locale='de-DE', permissions=['camera'])
    page = ctx.new_page()
    CUR['page'] = page
    attach_logging(page, 'phone')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')
    import_pdfs(page, ['bericht.pdf', 'struktur.pdf'])
    import_pdfs(page, ['geschuetzt.pdf'], password='geheim')
    ids = {d['name']: d['id'] for d in docs(page)}

    def screens():
        for route, sel, name in [
            (f"#/werkzeug/passwort?doc={ids['bericht.pdf']}", '[name=pw1]', 'phone_passwort'),
            (f"#/werkzeug/passwort-entfernen?doc={ids['geschuetzt.pdf']}", '[name=pw]', 'phone_passwort_entfernen'),
            (f"#/werkzeug/wasserzeichen?doc={ids['bericht.pdf']}", '.pt-prev-overlay', 'phone_wasserzeichen'),
            (f"#/werkzeug/seitenzahlen?doc={ids['bericht.pdf']}", '.pt-prev-overlay', 'phone_seitenzahlen'),
            (f"#/werkzeug/kopfzeile?doc={ids['bericht.pdf']}", '.pt-prev-overlay', 'phone_kopfzeile'),
            (f"#/werkzeug/extrahieren?doc={ids['bericht.pdf']}", '.pcard canvas', 'phone_extrahieren'),
            (f"#/werkzeug/pdf-word?doc={ids['struktur.pdf']}", 'input[name=mode]', 'phone_pdf_word'),
            (f"#/werkzeug/pdf-powerpoint?doc={ids['bericht.pdf']}", '[data-fmt]', 'phone_pdf_powerpoint'),
            (f"#/werkzeug/bearbeiten?doc={ids['struktur.pdf']}", '.pt-page canvas', 'phone_bearbeiten'),
            (f"#/werkzeug/schwaerzen?doc={ids['bericht.pdf']}", '.pt-page canvas', 'phone_schwaerzen'),
        ]:
            goto(page, route, sel)
            page.wait_for_timeout(500)
            overflow = page.evaluate("document.querySelector('#tool-screen').scrollWidth > window.innerWidth + 1")
            check(f'{name}: no horizontal overflow', not overflow)
            shot(page, name)
    step('phone screens', screens)

    def dark_screens():
        page.evaluate("document.documentElement.dataset.theme = 'dark'")
        for route, sel, name in [
            (f"#/werkzeug/kommentieren?doc={ids['bericht.pdf']}", '.pt-page canvas', 'phone_kommentieren_dark'),
            (f"#/werkzeug/wasserzeichen?doc={ids['bericht.pdf']}", '.pt-prev-overlay', 'phone_wasserzeichen_dark'),
            (f"#/werkzeug/passwort?doc={ids['bericht.pdf']}", '[name=pw1]', 'phone_passwort_dark'),
        ]:
            goto(page, route, sel)
            page.wait_for_timeout(400)
            shot(page, name)
        page.evaluate("delete document.documentElement.dataset.theme")
        check('dark screenshots taken', True)
    step('phone dark', dark_screens)

    def annotate_touch():
        goto(page, f"#/werkzeug/kommentieren?doc={ids['bericht.pdf']}", '.pt-page canvas')
        no_toast(page)
        W = 595.28
        b = text_box(page, ids['bericht.pdf'], 1, 'Fahrrad')
        page.touchscreen.tap(*at(page, 1, (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2, W))
        page.wait_for_timeout(300)
        check('touch tap highlights a word', page.locator('.screen-foot .foot-info').inner_text().startswith('1 '))
        page.locator('.pt-tool[data-tool=pen]').tap()
        pts = [at(page, 1, 100 + i * 12, 420 + (i % 4) * 6, W) for i in range(15)]
        touch_drag(page, pts)
        page.wait_for_timeout(300)
        check('touch pen stroke', page.locator('.screen-foot .foot-info').inner_text().startswith('2 '))
        shot(page, 'phone_kommentieren')
        page.locator('.screen-foot .btn-primary').tap()
        page.wait_for_selector('.pt-result .result-card', timeout=30000)
        path = download(page, 'phone_annotated.pdf')
        subs = annot_subtypes(path)
        check('phone annotations saved', '/Highlight' in subs and '/Ink' in subs, ','.join(subs))
    step('phone annotate', annotate_touch)

    def id_scan():
        goto(page, '#/werkzeug/ausweis')
        page.wait_for_function("document.querySelector('.sc-view video') && document.querySelector('.sc-view video').videoWidth > 0", timeout=15000)
        page.wait_for_timeout(1200)
        shot(page, 'phone_ausweis_camera')
        check('ID guide frame shown', page.locator('.sc-guide').count() == 1)
        page.locator('[data-shoot]').tap()
        page.wait_for_function("document.querySelector('[data-label]') && document.querySelector('[data-label]').textContent === 'Rückseite'", timeout=30000)
        check('asks for back side', True)
        page.locator('[data-shoot]').tap()
        page.wait_for_selector('.sc-idslot img', timeout=30000)
        page.wait_for_function("Array.from(document.querySelectorAll('.sc-idslot img')).length === 2 && Array.from(document.querySelectorAll('.sc-idslot img')).every(i => i.naturalWidth > 0)", timeout=30000)
        dims = page.evaluate("Array.from(document.querySelectorAll('.sc-idslot img')).map(i => i.naturalWidth / i.naturalHeight)")
        check('card warped to ID-1 aspect', all(abs(d - 85.6 / 54) < 0.02 for d in dims), str(dims))
        shot(page, 'phone_ausweis_review')
        # adjust corners of the back side, then filter step
        page.locator('.sc-idslot [data-edit="1"]').first.tap()
        page.wait_for_selector('.sc-handle')
        page.wait_for_timeout(300)
        hb = page.locator('.sc-handle').nth(2).bounding_box()
        touch_drag(page, [(hb['x'] + 22, hb['y'] + 22), (hb['x'] + 30, hb['y'] + 28), (hb['x'] + 36, hb['y'] + 30)])
        shot(page, 'phone_ausweis_crop')
        page.locator('.screen-foot .btn-primary').tap()
        page.wait_for_selector('.sc-result', timeout=20000)
        page.locator('[data-f=enhance]').tap()
        page.wait_for_timeout(1200)
        shot(page, 'phone_ausweis_filter')
        page.locator('.screen-foot .btn-primary').tap()
        page.wait_for_selector('.sc-idslot img')
        page.locator('.screen-foot .btn-primary').tap()
        page.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = download(page, 'ausweis.pdf')
        from pypdf import PdfReader
        r = PdfReader(path)
        pg = r.pages[0]
        check('ID pdf: one A4 page', len(r.pages) == 1 and round(float(pg.mediabox.width)) == 595 and round(float(pg.mediabox.height)) == 842)
        content = pg.get_contents().get_data().decode('latin-1')
        cms = re.findall(r'([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm', content)
        sizes = [(float(a), float(b)) for a, b in cms if (float(a), float(b)) != (1.0, 1.0)]
        ok = len(sizes) == 2 and all(abs(w - 85.6 * 72 / 25.4) < 0.5 and abs(h - 54 * 72 / 25.4) < 0.5 for w, h in sizes)
        check('ID pdf: both sides at real size 85.6 x 54 mm', ok, str(sizes))
    step('phone ID scan', id_scan)

    def scan_file_fallback():
        # camera unavailable → file input with capture=environment
        c2 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True, locale='de-DE')
        c2.add_init_script("try { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); } catch (e) {}")
        pg = c2.new_page()
        attach_logging(pg, 'phone-nocam')
        pg.goto(URL + '#/werkzeug/scannen')
        pg.wait_for_selector('.sc-fallback', timeout=15000)
        shot(pg, 'phone_scanner_fallback')
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-photo]').tap()
        check('fallback uses capture=environment', pg.evaluate("!!document.querySelector('input[capture=environment]')"))
        fc.value.set_files(os.path.join(TD, 'scan_3_gray.jpg'))
        pg.wait_for_selector('.sc-card img', timeout=20000)
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-files]').tap()
        fc.value.set_files([os.path.join(TD, 'scan_2_dark.jpg'), os.path.join(TD, 'scan_1_wood.jpg')])
        pg.wait_for_function("document.querySelectorAll('.sc-card').length === 3", timeout=30000)
        pg.wait_for_function("Array.from(document.querySelectorAll('.sc-card img')).every(i => i.naturalWidth > 0)", timeout=30000)
        # reorder + delete + filter for all
        pg.locator('.sc-card').nth(0).locator('[data-r]').tap()
        pg.locator('.sc-card').nth(2).locator('[data-x]').tap()
        check('reorder/delete pages', pg.locator('.sc-card').count() == 2)
        pg.locator('[data-allf=gray]').tap()
        pg.wait_for_timeout(1500)
        shot(pg, 'phone_scanner_review')
        # page 1: edit → crop step screenshot with magnifier
        pg.locator('.sc-card [data-edit]').first.tap()
        pg.wait_for_selector('.sc-handle')
        pg.wait_for_timeout(300)
        hb = pg.locator('.sc-handle').first.bounding_box()
        cdp = pg.context.new_cdp_session(pg)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': hb['x'] + 22, 'y': hb['y'] + 22}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': hb['x'] + 30, 'y': hb['y'] + 30}]})
        pg.wait_for_timeout(200)
        check('magnifier visible while dragging', pg.locator('.sc-loupe:not([hidden])').count() == 1)
        shot(pg, 'phone_scanner_crop')
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        cdp.detach()
        pg.locator('.screen-foot .btn-primary').tap()
        pg.wait_for_selector('.sc-result', timeout=20000)
        pg.locator('[data-f=bw]').tap()
        pg.wait_for_timeout(1500)
        shot(pg, 'phone_scanner_filter')
        pg.locator('.screen-foot .btn-primary').tap()
        pg.wait_for_selector('.sc-card img')
        pg.locator('.screen-foot .btn-primary').tap()
        pg.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = download(pg, 'scan_phone.pdf')
        from pypdf import PdfReader
        r = PdfReader(path)
        sizes = [(round(float(x.mediabox.width)), round(float(x.mediabox.height))) for x in r.pages]
        check('scan pdf: 2 A4 pages', sizes == [(595, 842), (595, 842)], str(sizes))
        c2.close()
    step('phone scanner (file input)', scan_file_fallback)

    browser.close()


ensure_server()
ensure_testdata()
with sync_playwright() as p:
    if ONLY in ('all', 'desktop'):
        desktop(p)
    if ONLY in ('all', 'phone'):
        phone(p)

print('\n==== SUMMARY ====')
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
for f in fails:
    print('FAILED:', f[0], f[2])
print('\n==== CONSOLE errors/warnings ====')
for c in console_problems:
    print(c)
print(f'{len(console_problems)} console problems')
sys.exit(1 if fails else 0)

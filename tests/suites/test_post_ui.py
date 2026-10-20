"""„Brief per Post“ in der App (js/post/*) gegen den echten Server-Code (share_harness.mjs: /api/post mit Test-Druckerei
und Test-Bezahlung).
- Brief schreiben (Rückfrage) → „Per Post senden“ im Fertig-Dialog → Adresse vorausgefüllt, Fenster-Vorschau, Preise
  (Brief 1,99 €, Einschreiben Einwurf 4,99 €) → Weiter → Statusseite mit Testmodus-Hinweis
- die übergebene PDF: Adressblatt + Brief, Adresse im Fenster (DIN 5008 B: 25 mm links, 62–90 mm von oben), Absenderzeile
- Testzahlung → „In der Druckerei“ → verschickt + Sendungsnummer → Versandnachweis als PDF in den Dateien
- Kündigung Wohnung (Unterschrift mit Stift nötig): kein „Per Post senden“
- Ansicht → ⋮ → „Per Post senden“: Pflichtfelder, Ausland (nur Brief, 2,99 €), Abbrechen eines Auftrags, Druckerei-Fehler → Geld zurück
- Handy 360 px: Dialog und Statusseite passen; keine Konsolenfehler
Startet den Harness selbst (Port 8812)."""
import os, sys, base64, json, re, subprocess, time, traceback, urllib.request
from playwright.sync_api import sync_playwright

SUITES = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('POST_PORT', '8812'))
URL = f'http://127.0.0.1:{PORT}/'
OUT = os.path.join(SUITES, 'out_post_ui')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)


CUR = {}


def step(name, fn):
    try:
        fn()
    except Exception as e:
        try:
            CUR['page'].screenshot(path=os.path.join(OUT, 'fail_' + re.sub(r'\W+', '_', name) + '.png'))
        except Exception:
            pass
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def api(path):
    with urllib.request.urlopen(URL.rstrip('/') + path, timeout=10) as r:
        return json.loads(r.read().decode())


IMPORT = """async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
  return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }"""
FILES = "async () => (await (await import('./js/db.js')).listFiles()).map(f => f.name)"
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()


def wait_js(page, expr, timeout=15000):
    """Poll a JS expression (the app's CSP forbids the eval behind wait_for_function)."""
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if page.evaluate(f"() => !!({expr})"):
                return True
        except Exception:
            pass
        page.wait_for_timeout(200)
    raise TimeoutError('wait_js: ' + expr)


def goto(page, h, wait=900):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(wait)


def ctx_page(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {} window.open = () => null;")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and 'favicon' not in m.text else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    CUR['page'] = page
    return ctx, page


def words(path, page_no=1):
    """pdftotext -bbox words of one page → [(word, xMin, yMin)] in mm from left/top."""
    xml = subprocess.run(['pdftotext', '-bbox', '-f', str(page_no), '-l', str(page_no), path, '-'], capture_output=True, text=True).stdout
    return [(m.group(5), float(m.group(1)) / 72 * 25.4, float(m.group(2)) / 72 * 25.4) for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', xml)]


def run(p):
    browser = p.chromium.launch()
    ctx, page = ctx_page(browser, 'desktop', viewport={'width': 1280, 'height': 900})
    st = {}

    def letter():
        goto(page, '#/schreiben/rueckfrage', 1200)
        page.locator('.lt-form [name="thema"]').fill('Nebenkosten 2025')
        page.locator('.lt-form [name="r_name"]').fill('Hausverwaltung Muster GmbH')
        page.locator('.lt-form [name="r_strasse"]').fill('Am Markt 3')
        page.locator('.lt-form [name="r_ort"]').fill('66111 Saarbrücken')
        page.locator('.lt-form [name="s_name"]').fill('Erika Musterfrau')
        if page.locator('.lt-form [name="s_strasse"]').count():
            page.locator('.lt-form [name="s_strasse"]').fill('Lindenweg 7')
            page.locator('.lt-form [name="s_ort"]').fill('66740 Saarlouis')
        page.locator('[data-out="pdf"]').click()
        page.wait_for_selector('dialog[open] .result-mini', timeout=30000)
        check('letter ready: „Kein Drucker? FaLe verschickt den Brief für dich“', page.locator('dialog[open] .lt-post').count() == 1 and 'ab 1,99 €' in page.locator('dialog[open] .lt-post').inner_text().replace('\xa0', ' '))
        page.locator('dialog[open] button[value="post"]').click()
        page.wait_for_selector('dialog[open] .post-dlg', timeout=15000)
        page.wait_for_timeout(500)
        d = page.locator('dialog[open] .post-dlg')
        check('post dialog: test mode note, address taken from the letter', 'Testmodus' in d.inner_text()
              and d.locator('[name=name]').input_value() == 'Hausverwaltung Muster GmbH' and d.locator('[name=strasse]').input_value() == 'Am Markt 3'
              and d.locator('[name=plz]').input_value() == '66111' and d.locator('[name=ort]').input_value() == 'Saarbrücken')
        win = d.locator('.post-win').inner_text()
        check('window preview: return line + address lines', 'Erika Musterfrau' in win and 'Hausverwaltung Muster GmbH' in win and '66111 Saarbrücken' in win, win)
        check('Rückfrage: normal letter preselected at 1,99 €', d.locator('.post-way[aria-checked="true"]').get_attribute('data-way') == '' and '1,99' in d.locator('[data-sum]').inner_text())
        d.locator('.post-way[data-way="r1"]').click()
        check('Einschreiben Einwurf: 4,99 € on the button', '4,99' in page.locator('dialog[open] .dlg-actions .btn-primary').inner_text())
        page.screenshot(path=os.path.join(OUT, 'dialog.png'))
        page.locator('dialog[open] .dlg-actions .btn-primary').click()
        wait_js(page, "location.hash.startsWith('#/post/')", 30000)
        page.wait_for_selector('.post-detail .post-card', timeout=15000)
        st['id'] = page.evaluate("location.hash.split('/')[2].split('?')[0]")
        check('status screen: test note, waiting for payment, „Testzahlung bestätigen“', 'Testmodus' in page.locator('.post-detail').inner_text()
              and 'Wartet auf Bezahlung' in page.locator('.post-chip').inner_text() and page.locator('[data-mockpay]').count() == 1)
        page.screenshot(path=os.path.join(OUT, 'status_pending.png'))
    step('letter → per post', letter)

    def mailpdf():
        pdf = api(f"/__test/postpdf?id={st['id']}")['pdf']
        path = os.path.join(OUT, 'sent.pdf')
        open(path, 'wb').write(base64.b64decode(pdf))
        from pypdf import PdfReader
        r = PdfReader(path)
        check('handed-over PDF: address sheet + letter, A4', len(r.pages) == 2 and all(abs(float(pg.mediabox.width) - 595.28) < 1 and abs(float(pg.mediabox.height) - 841.89) < 1 for pg in r.pages), len(r.pages))
        w = words(path, 1)
        hv = [x for x in w if x[0] == 'Hausverwaltung']
        check('address in the window field (DIN 5008 B: x ≈ 25 mm, 62–90 mm from the top)', hv and 23 <= hv[0][1] <= 27 and 62 <= hv[0][2] <= 90, hv)
        ret = [x for x in w if x[0].startswith('Erika')]
        check('return line above the address (inside the window)', ret and 45 <= ret[0][2] < hv[0][2], ret)
        t2 = ' '.join(x[0] for x in words(path, 2))
        check('page 2 is the letter', 'Nebenkosten' in t2, t2[:200])
        check('server got no object streams (page count checked)', b'/ObjStm' not in open(path, 'rb').read())
    step('the mail PDF', mailpdf)

    def pay():
        page.locator('[data-mockpay]').click()
        wait_js(page, "document.querySelector('.post-chip') && /Druckerei/.test(document.querySelector('.post-chip').textContent)", 15000)
        jobs = api('/__test/post')['jobs']
        j = next(x for x in jobs if x['id'] == st['id'])
        check('paid → at the print service, PDF deleted on the server', j['status'] == 'submitted' and j['pdf'] is None and j['provider_id'], j)
        api('/__test/post?done=1')
        goto(page, '#/post', 800)
        check('list „Briefe per Post“ shows the letter', page.locator('.post-item').count() == 1 and 'In der Druckerei' in page.locator('.post-item').inner_text())
        goto(page, f"#/post/{st['id']}", 2500)
        wait_js(page, "document.querySelector('.post-chip') && /Verschickt/.test(document.querySelector('.post-chip').textContent)", 15000)
        txt = page.locator('.post-detail').inner_text()
        check('sent: three steps done, tracking number, „Sendung verfolgen“', page.locator('.post-step.done').count() == 3 and re.search(r'Sendungsnummer RT\d{6}123DE', txt) and page.locator('[data-track]').count() == 1, txt[:300])
        page.screenshot(path=os.path.join(OUT, 'status_sent.png'))
        page.locator('[data-proof]').click()
        wait_js(page, "location.hash.startsWith('#/ansicht/')", 15000)
        check('Versandnachweis saved as PDF in the files', any(n.endswith('Versandnachweis.pdf') for n in page.evaluate(FILES)))
    step('pay → sent → proof', pay)

    def strict():
        goto(page, '#/schreiben/kuendigung?art=miete', 1200)
        page.locator('.lt-form [name="r_name"]').fill('Hausverwaltung Beispiel')
        page.locator('.lt-form [name="s_name"]').fill('Erika Musterfrau')
        if page.locator('.lt-form [name="objekt"]').count():
            page.locator('.lt-form [name="objekt"]').fill('Lindenweg 7, 66740 Saarlouis')
        page.locator('[data-out="pdf"]').click()
        page.wait_for_selector('dialog[open] .result-mini', timeout=30000)
        check('Kündigung Wohnung (pen signature needed): no „Per Post senden“', page.locator('dialog[open] .lt-post').count() == 0)
        page.keyboard.press('Escape'); page.wait_for_timeout(400)
    step('strict letter', strict)

    def viewer():
        did = page.evaluate(IMPORT, [b64(os.path.join(SUITES, 'formcheck', 'antrag.pdf')), 'Antrag.pdf'])
        goto(page, f'#/ansicht/{did}', 2500)
        page.locator('[data-v="more"]').click()
        page.locator('.menu [role=menuitem]', has_text='Per Post senden').click()
        page.wait_for_selector('dialog[open] .post-dlg', timeout=15000)
        page.locator('dialog[open] .dlg-actions .btn-primary').click()
        page.wait_for_timeout(300)
        check('empty address: stays open with a clear message', page.locator('dialog[open] [data-err]').is_visible() and 'Bitte Name' in page.locator('dialog[open] [data-err]').inner_text())
        d = page.locator('dialog[open] .post-dlg')
        d.locator('[name=name]').fill('Mairie de Metz'); d.locator('[name=strasse]').fill('1 Place d\'Armes'); d.locator('[name=plz]').fill('57000'); d.locator('[name=ort]').fill('Metz')
        d.locator('[name=country]').fill('Frankreich'); page.wait_for_timeout(200)
        check('abroad: Einschreiben not possible, letter 2,99 €, country in capitals', d.locator('.post-way[data-way="r1"]').is_disabled() and d.locator('.post-way[data-way="r2"]').is_disabled()
              and '2,99' in d.locator('[data-sum]').inner_text() and 'FRANKREICH' in d.locator('.post-win').inner_text() and 'METZ' in d.locator('.post-win').inner_text())
        page.locator('dialog[open] .dlg-actions .btn-primary').click()
        wait_js(page, "location.hash.startsWith('#/post/')", 30000)
        page.wait_for_selector('[data-cancel]', timeout=15000)
        page.locator('[data-cancel]').click()
        page.locator('dialog[open] .btn-danger').click()
        wait_js(page, "document.querySelector('.post-chip') && /Abgebrochen/.test(document.querySelector('.post-chip').textContent)", 15000)
        check('cancel before paying: „Abgebrochen“, nothing charged', 'nichts abgebucht' in page.locator('.post-detail').inner_text())
        # print service fails after payment → refund
        api('/__test/post?fail=1')
        goto(page, f'#/ansicht/{did}', 2500)
        page.locator('[data-v="more"]').click()
        page.locator('.menu [role=menuitem]', has_text='Per Post senden').click()
        page.wait_for_selector('dialog[open] .post-dlg', timeout=15000)
        d = page.locator('dialog[open] .post-dlg')
        d.locator('[name=name]').fill('Stadt Beispiel'); d.locator('[name=strasse]').fill('Rathausplatz 1'); d.locator('[name=plz]').fill('66111'); d.locator('[name=ort]').fill('Saarbrücken')
        page.locator('dialog[open] .dlg-actions .btn-primary').click()
        page.wait_for_selector('[data-mockpay]', timeout=30000)
        page.locator('[data-mockpay]').click()
        wait_js(page, "document.querySelector('.post-chip') && /Geld zurück/.test(document.querySelector('.post-chip').textContent)", 15000)
        check('print service fails → „Geld zurück“ explained', 'automatisch zurückgebucht' in page.locator('.post-detail').inner_text())
        api('/__test/post?fail=0')
    step('viewer → per post, abroad, cancel, refund', viewer)

    def letters():
        did = page.evaluate(IMPORT, [b64(os.path.join(SUITES, 'formcheck', 'antrag.pdf')), 'Wniosek.pdf'])
        goto(page, '#/post', 600)
        page.evaluate("""async (id) => { const lib = await import('./js/library.js'); const b = await lib.getDocBytes(id); const m = await import('./js/post/send.js'); m.sendByPost({ docId: id, name: 'Wniosek.pdf', bytes: b }); }""", did)
        page.wait_for_selector('dialog[open] .post-dlg', timeout=15000)
        d = page.locator('dialog[open] .post-dlg')
        d.locator('[name=name]').fill('王小明'); d.locator('[name=strasse]').fill('Rathausplatz 1'); d.locator('[name=plz]').fill('66111'); d.locator('[name=ort]').fill('Saarbrücken')
        page.locator('dialog[open] .dlg-actions .btn-primary').click(); page.wait_for_timeout(300)
        check('Chinese letters in the address: stays open, asks for Latin letters', page.locator('dialog[open] [data-err]').is_visible() and 'lateinischen' in page.locator('dialog[open] [data-err]').inner_text())
        d.locator('[name=name]').fill('Łukasz Żółć'); d.locator('[name=strasse]').fill('ul. Świętokrzyska 5'); d.locator('[name=plz]').fill('00-360'); d.locator('[name=ort]').fill('Warszawa')
        d.locator('[name=country]').fill('Polen')
        page.locator('dialog[open] .dlg-actions .btn-primary').click()
        wait_js(page, "location.hash.startsWith('#/post/') && location.hash.split('/').length > 2", 30000)
        jid = page.evaluate("location.hash.split('/')[2].split('?')[0]")
        path = os.path.join(OUT, 'sent_pl.pdf')
        open(path, 'wb').write(base64.b64decode(api(f"/__test/postpdf?id={jid}")['pdf']))
        txt = ' '.join(x[0] for x in words(path, 1))
        check('Polish address printed exactly (Ł, Ż, ó, ś, ę – no „?“)', 'Łukasz' in txt and 'Żółć' in txt and 'Świętokrzyska' in txt and 'WARSZAWA' in txt and 'POLEN' in txt and '?' not in txt, txt)
    step('letters outside WinAnsi', letters)
    ctx.close()

    ctx, page = ctx_page(browser, 'phone', viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True)

    def phone():
        did = page.evaluate(IMPORT, [b64(os.path.join(SUITES, 'formcheck', 'antrag.pdf')), 'Handy.pdf'])
        page.evaluate("""async (id) => { const lib = await import('./js/library.js'); const b = await lib.getDocBytes(id); const m = await import('./js/post/send.js'); m.sendByPost({ docId: id, name: 'Handy.pdf', bytes: b }); }""", did)
        page.wait_for_selector('dialog[open] .post-dlg', timeout=15000); page.wait_for_timeout(600)
        over = page.evaluate('document.documentElement.scrollWidth')
        way = page.locator('dialog[open] .post-way').first.bounding_box()
        check('phone: dialog fits, ways big enough', over <= 361 and way['height'] >= 48 and way['x'] + way['width'] <= 361, (over, way))
        page.screenshot(path=os.path.join(OUT, 'phone_dialog.png'), full_page=False)
        d = page.locator('dialog[open] .post-dlg')
        d.locator('[name=name]').fill('Stadt Beispiel'); d.locator('[name=strasse]').fill('Rathausplatz 1'); d.locator('[name=plz]').fill('66111'); d.locator('[name=ort]').fill('Saarbrücken')
        page.locator('dialog[open] .dlg-actions .btn-primary').tap()
        page.wait_for_selector('.post-detail .post-card', timeout=30000); page.wait_for_timeout(500)
        over = page.evaluate('document.documentElement.scrollWidth')
        check('phone: status screen fits', over <= 361, over)
        page.screenshot(path=os.path.join(OUT, 'phone_status.png'))
    step('phone', phone)
    ctx.close()

    # not set up (production without credentials): a clear note, no dialog
    api('/__test/env?VERCEL_ENV=production')
    ctx, page = ctx_page(browser, 'prod', viewport={'width': 1280, 'height': 900})

    def notset():
        did = page.evaluate(IMPORT, [b64(os.path.join(SUITES, 'formcheck', 'antrag.pdf')), 'Prod.pdf'])
        page.evaluate("""async (id) => { const lib = await import('./js/library.js'); const b = await lib.getDocBytes(id); const m = await import('./js/post/send.js'); m.sendByPost({ docId: id, name: 'Prod.pdf', bytes: b }); }""", did)
        page.wait_for_timeout(1500)
        check('production without credentials: friendly note, no dialog', page.locator('dialog[open] .post-dlg').count() == 0 and page.locator('.toast', has_text='noch nicht eingerichtet').count() >= 1)
        goto(page, f'#/ansicht/{did}', 2500)
        page.locator('[data-v="more"]').click(); page.wait_for_timeout(300)
        check('not set up: viewer menu does not offer „Per Post senden“', page.locator('.menu [role=menuitem]', has_text='Drucken').count() == 1 and page.locator('.menu [role=menuitem]', has_text='Per Post senden').count() == 0)
        page.keyboard.press('Escape')
        goto(page, '#/schreiben', 1000)
        check('not set up: no „Briefe per Post“ card in the letters hub', not page.locator('.lt-postlink').is_visible())
        goto(page, '#/schreiben/rueckfrage', 1200)
        page.locator('.lt-form [name="thema"]').fill('Nebenkosten'); page.locator('.lt-form [name="r_name"]').fill('Hausverwaltung'); page.locator('.lt-form [name="s_name"]').fill('Erika Musterfrau')
        page.locator('[data-out="pdf"]').click()
        page.wait_for_selector('dialog[open] .result-mini', timeout=30000)
        check('not set up: finished letter offers no „Per Post senden“', page.locator('dialog[open] .lt-post').count() == 0)
    step('not set up', notset)
    api('/__test/env?VERCEL_ENV=')
    ctx.close()
    browser.close()


if __name__ == '__main__':
    proc = subprocess.Popen(['node', os.path.join(SUITES, 'share_harness.mjs'), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(URL, timeout=1); break
            except Exception:
                time.sleep(0.2)
        with sync_playwright() as p:
            run(p)
    finally:
        proc.terminate()
    check('no console errors', not problems, problems[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:400])
    sys.exit(1 if bad else 0)

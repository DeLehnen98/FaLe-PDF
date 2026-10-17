"""E2E tests for "Teilen & Übertragen" (js/share/*) against the local harness:
   node share_harness.mjs 8801   (static app + /api/share|sign|transfer + in-memory store + clock control)
Two (or three) browser contexts act as sender / recipient / signer / second device.
Screenshots → out_share/."""
import os, sys, json, base64, shutil, re, io, hashlib, time, urllib.request
import csp_compat  # noqa: F401 – CSP-safe wait_for_function
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, 'out_share')
DATA = os.path.join(SP, 'share_data')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
os.makedirs(DATA, exist_ok=True)
URL = os.environ.get('SHARE_URL', 'http://127.0.0.1:9415/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
results, console_problems = [], []
PAGES = []
MARKER = 'GEHEIMER-INHALT-4711'


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    if ONLY != 'all' and not any(o in name for o in ONLY.split(',')):
        return
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        for i, pg in enumerate(PAGES[-3:]):
            try:
                pg.screenshot(path=os.path.join(OUT, f'fail_{re.sub(r"\W+", "_", name)}_{i}.png'))
                print('   toasts:', pg.locator('#toasts').inner_text()[:300], '| url:', pg.url[:120])
            except Exception as e2:
                print('   (no debug)', e2)


IGNORED = ('favicon', 'status of 404', 'status of 410', 'status of 409', 'status of 403', 'status of 429', 'status of 503', 'ERR_INTERNET_DISCONNECTED', 'net::ERR_FAILED')


def attach(page, label):
    page.on('console', lambda m: console_problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and not any(i in m.text for i in IGNORED) else None)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))


def harness(path):
    with urllib.request.urlopen(URL.rstrip('/') + path) as r:
        return json.loads(r.read().decode())


def shot(page, name, full=False):
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


def goto(page, h, wait=700):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(wait)


def set_theme(page, t):
    page.evaluate(f"localStorage.setItem('fale-theme', '{t}'); document.documentElement.dataset.theme = '{t}'")


def make_pdf(path, pages=2, title='Vertrag'):
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    c = canvas.Canvas(path, pagesize=A4, pageCompression=0, invariant=1)
    for i in range(pages):
        c.setFont('Helvetica-Bold', 22); c.drawString(72, 760, f'{title} – Seite {i + 1}')
        c.setFont('Helvetica', 12)
        for k in range(18):
            c.drawString(72, 720 - k * 22, f'{MARKER} Zeile {k + 1}: Die Parteien vereinbaren Folgendes.')
        c.line(72, 150, 300, 150); c.drawString(72, 135, 'Unterschrift')
        c.showPage()
    c.save()


def import_file(page, path, name, mime):
    b64 = base64.b64encode(open(path, 'rb').read()).decode()
    return page.evaluate("""async ([b64, name, mime]) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const { importFiles } = await import('./js/library.js');
      const [d] = await importFiles([new File([u], name, { type: mime })], { source: 'Gerät', any: true });
      return d.id; }""", [b64, name, mime])


def doc_bytes(page, doc_id):
    b64 = page.evaluate("""async id => { const db = await import('./js/db.js'); const b = await db.getFile(id); const u = new Uint8Array(await b.arrayBuffer());
      let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }""", doc_id)
    return base64.b64decode(b64)


def find_doc(page, pattern):
    return page.evaluate("""async pat => { const db = await import('./js/db.js'); const l = await db.listFiles(); const d = l.find(x => new RegExp(pat).test(x.name)); return d ? { id: d.id, name: d.name, source: d.source } : null; }""", pattern)


def new_ctx(browser, phone=False, dark=False, offline=False):
    if phone:
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', is_mobile=True, has_touch=True, device_scale_factor=2, accept_downloads=True, color_scheme='dark' if dark else 'light')
    else:
        ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE', accept_downloads=True, color_scheme='dark' if dark else 'light')
    ctx.add_init_script("window.__FALE_ICE__ = []; try { localStorage.setItem('fale-onboarding-done', '1'); } catch {}")
    return ctx


def open_app(ctx, label, h='#/start'):
    page = ctx.new_page()
    attach(page, label)
    PAGES.append(page)
    page.goto(URL + h)
    page.wait_for_selector('html.ready', timeout=20000)
    page.wait_for_timeout(500)
    return page


def create_link(page, doc_id, expiry='1 Tag', limit='5×', password=None):
    goto(page, '#/teilen', 400)
    goto(page, f'#/teilen/link?doc={doc_id}', 900)
    page.wait_for_selector('.sh-create [data-go]')
    page.locator('.sh-create [data-exp]', has_text=expiry).click()
    page.locator('.sh-create [data-lim]', has_text=limit).click()
    if password:
        page.locator('[data-pwtoggle]').check()
        page.fill('[data-pw]', password)
    page.locator('.sh-create [data-go]').click()
    page.wait_for_selector('.sh-done .sh-link', timeout=20000)
    return page.locator('.sh-done .sh-link').input_value()


def server_log():
    return harness('/__test/log')['log']


def run():
    make_pdf(os.path.join(DATA, 'vertrag.pdf'))
    blob = os.urandom(600 * 1024) + MARKER.encode() + os.urandom(1000)   # 3 chunks of 256 KB
    open(os.path.join(DATA, 'daten.bin'), 'wb').write(blob)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        harness('/__test/reset')
        ctxA = new_ctx(browser)
        A = open_app(ctxA, 'A')
        ctxB = new_ctx(browser, phone=True)
        B = open_app(ctxB, 'B')
        state = {}

        # ------------------------------------------------------------ entry points
        def entries():
            A.wait_for_selector('#view-start [data-share-start] .sh-start-card', timeout=8000)
            check('entry: start card "Teilen & Übertragen"', A.locator('#view-start .sh-start-card').inner_text().count('Teilen') >= 1)
            shot(A, 'desktop_light_start')
            goto(A, '#/werkzeuge', 800)
            A.wait_for_selector('[data-share-section] .tool-card')
            check('entry: Werkzeuge section "Teilen & Unterschreiben"', A.locator('[data-share-section] .tool-card').count() == 4 and 'Teilen & Unterschreiben' in A.locator('[data-share-section] h2').inner_text())
            state['pdf'] = import_file(A, os.path.join(DATA, 'vertrag.pdf'), 'Vertrag Muster.pdf', 'application/pdf')
            state['bin'] = import_file(A, os.path.join(DATA, 'daten.bin'), 'Daten Export.txt', 'text/plain')
            goto(A, f'#/ansicht/{state["pdf"]}', 1500)
            A.locator('#viewer [data-v="more"], #viewer button[aria-label="Weitere Aktionen"]').first.click()
            A.wait_for_timeout(300)
            menu = A.locator('.menu').inner_text()
            check('entry: viewer ⋮ has "Sicher teilen" + "Unterschrift anfordern"', 'Sicher teilen' in menu and 'Unterschrift anfordern' in menu, menu[-200:])
            A.keyboard.press('Escape')
            goto(A, '#/dateien', 900)
            row = A.locator(f'#view-dateien article.doc[data-id="{state["pdf"]}"]')
            row.locator('.more-btn').click()
            A.wait_for_timeout(300)
            m2 = A.locator('.menu').inner_text()
            check('entry: Dateien ⋮ has share items', 'Sicher teilen (Link)' in m2 and 'Unterschrift anfordern' in m2)
            A.keyboard.press('Escape')
            row.locator('.doc-open').click(button='right')
            A.wait_for_timeout(300)
            check('entry: long-press/right-click opens file menu', A.locator('.menu-layer').count() == 1 and 'Sicher teilen' in A.locator('.menu').inner_text())
            A.keyboard.press('Escape')
            goto(A, '#/teilen', 900)
            A.wait_for_selector('.sh-hub')
            check('hub: four actions', A.locator('.sh-hub-grid .tool-card').count() == 4)
        step('entries', entries)

        # ------------------------------------------------------------ share link → recipient, identical bytes, nothing readable on the server
        def share_basic():
            link = create_link(A, state['bin'])
            state['link1'] = link
            check('share: link format #/s/<id>#k=<key>', re.search(r'#/s/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]{43}$', link) is not None, link)
            shot(A, 'desktop_light_share_done')
            B.goto(link)
            B.wait_for_selector('.sh-recv-name', timeout=15000)
            check('recipient: decrypted name shown', B.locator('.sh-recv-name').inner_text() == 'Daten Export.txt')
            shot(B, 'phone_light_recipient')
            with B.expect_download() as dl:
                B.locator('[data-dl]').click()
            path = dl.value.path()
            got = open(path, 'rb').read()
            check('recipient: downloaded bytes identical', got == blob and dl.value.suggested_filename == 'Daten Export.txt', f'{len(got)} vs {len(blob)}')
            B.locator('[data-open]').click()
            B.wait_for_timeout(1500)
            d = find_doc(B, '^Daten Export')
            check('recipient: "In FaLe öffnen" imports into library (Empfangen)', d is not None and d['source'] == 'Empfangen')
            if d:
                check('recipient: library copy identical', doc_bytes(B, d['id']) == blob)
            st = harness('/__test/state')
            obj = [o for o in st['objects'] if o['kind'] == 'file'][0]
            check('server: one download counted for download + open', obj['downloads'] == 1, obj)
            check('server: header without file name', 'Daten' not in obj['header'] and 'Export' not in obj['header'])
            key = link.split('#k=')[1]
            raw_chunks = b''.join(base64.b64decode(c['b64']) for c in st['chunks'])
            check('server: stored chunks are ciphertext (no marker, size = plain + tags)', MARKER.encode() not in raw_chunks and len(raw_chunks) == len(blob) + 16 * 3)
            log = server_log()
            blob_log = json.dumps(log)
            check('server: never received the key', key not in blob_log)
            check('server: never received plaintext/file name', MARKER not in blob_log and 'Daten Export' not in blob_log)
            check('server: no referer with key', all(key not in (x.get('referer') or '') for x in log))
        step('share_basic', share_basic)

        def share_errors():
            link = state['link1']
            C = open_app(new_ctx(browser), 'C', '#/start')
            bad = link[:-3] + ('AAA' if not link.endswith('AAA') else 'BBB')
            C.goto(bad); C.wait_for_timeout(300); C.reload()
            C.wait_for_selector('.sh-recv-error', timeout=10000)
            check('wrong key: graceful error', 'Schlüssel' in C.locator('.sh-recv-error').inner_text(), C.locator('.sh-recv-error').inner_text())
            C.goto(link.split('#k=')[0]); C.wait_for_timeout(300); C.reload()
            C.wait_for_selector('.sh-recv-error', timeout=10000)
            check('missing key: graceful error', 'Schlüssel fehlt' in C.locator('.sh-recv-error').inner_text())
            shot(C, 'desktop_light_recipient_nokey')
            C.goto(URL + '#/s/AAAAAAAAAAAAAAAAAAAAAA#k=' + 'A' * 43); C.wait_for_timeout(300); C.reload()
            C.wait_for_selector('.sh-recv-error', timeout=10000)
            check('unknown id: "nicht mehr verfügbar"', 'nicht mehr verfügbar' in C.locator('.sh-recv-error').inner_text())
            # download limit 1×
            l1 = create_link(A, state['pdf'], limit='1×')
            C.goto(l1); C.wait_for_timeout(300); C.reload()
            C.wait_for_selector('.sh-recv-name')
            with C.expect_download() as dl:
                C.locator('[data-dl]').click()
            check('limit 1×: first download ok', open(dl.value.path(), 'rb').read() == open(os.path.join(DATA, 'vertrag.pdf'), 'rb').read())
            D = open_app(new_ctx(browser, phone=True), 'D', '#/start')
            D.goto(l1); D.wait_for_timeout(300); D.reload()
            D.wait_for_selector('.sh-recv-error', timeout=10000)
            check('limit 1×: second recipient blocked', 'Download-Limit' in D.locator('.sh-recv-error').inner_text())
            shot(D, 'phone_light_recipient_limit')
            # expiry 1 h
            l2 = create_link(A, state['pdf'], expiry='1 Stunde', limit='Unbegrenzt')
            harness('/__test/advance?ms=3601000')
            D.goto(l2); D.wait_for_timeout(300); D.reload()
            D.wait_for_selector('.sh-recv-error', timeout=10000)
            check('expiry: link dead after 1 h', 'nicht mehr verfügbar' in D.locator('.sh-recv-error').inner_text())
            # revoke from the hub
            l3 = create_link(A, state['pdf'], expiry='7 Tage')
            id3 = re.search(r'#/s/([^#]+)', l3).group(1)
            goto(A, '#/teilen', 1200)
            row = A.locator(f'[data-share-id="{id3}"]')
            check('hub: link listed with status', row.count() == 1 and 'Aktiv' in row.inner_text(), row.inner_text() if row.count() else '')
            shot(A, 'desktop_light_hub')
            row.locator('[data-del]').click()
            A.locator('dialog[open] button[value="ok"]').click()
            A.wait_for_timeout(800)
            D.goto(l3); D.wait_for_timeout(300); D.reload()
            D.wait_for_selector('.sh-recv-error', timeout=10000)
            check('revoke: "Link löschen" kills the link', 'nicht mehr verfügbar' in D.locator('.sh-recv-error').inner_text())
            check('revoke: removed from hub', A.locator(f'[data-share-id="{id3}"]').count() == 0)
            # password-protected share
            l4 = create_link(A, state['bin'], password='Sommer2026!')
            check('password: link has no password in it', 'Sommer' not in l4)
            D.goto(l4); D.wait_for_timeout(300); D.reload()
            D.wait_for_selector('[data-pw]', timeout=10000)
            shot(D, 'phone_light_recipient_password')
            D.fill('[data-pw]', 'falsch-123'); D.locator('form.sh-recv-card button[type=submit]').click()
            D.wait_for_selector('text=Das Passwort ist falsch', timeout=15000)
            check('password: wrong password rejected', True)
            D.fill('[data-pw]', 'Sommer2026!'); D.locator('form.sh-recv-card button[type=submit]').click()
            D.wait_for_selector('.sh-recv-name', timeout=15000)
            with D.expect_download() as dl:
                D.locator('[data-dl]').click()
            check('password: right password → identical bytes', open(dl.value.path(), 'rb').read() == blob)
            log = json.dumps(server_log())
            check('password: never sent to the server', 'Sommer2026' not in log and 'falsch-123' not in log)
            C.context.close(); D.context.close()
        step('share_errors', share_errors)

        # ------------------------------------------------------------ signature request (sender ↔ signer)
        def sign_flow():
            harness('/__test/reset')
            goto(A, f'#/teilen/unterschrift?doc={state["pdf"]}', 1500)
            A.wait_for_selector('.sh-sr .sh-page canvas', timeout=15000)
            A.fill('[data-sname="0"]', 'Erika Muster')
            A.fill('[data-from]', 'Max Mustermann')
            A.fill('[data-msg]', 'Bitte bis Freitag unterschreiben.')
            page1 = A.locator('.sh-page[data-page="1"]')
            box = page1.bounding_box()
            A.locator('[data-ftype="sig"]').click()
            page1.click(position={'x': box['width'] * 0.3, 'y': box['height'] * 0.78})
            A.locator('[data-ftype="date"]').click()
            page1.click(position={'x': box['width'] * 0.7, 'y': box['height'] * 0.78})
            A.locator('[data-ftype="name"]').click()
            page1.click(position={'x': box['width'] * 0.3, 'y': box['height'] * 0.86})
            check('sender: 3 fields placed', A.locator('.sh-field').count() == 3)
            shot(A, 'desktop_light_signreq')
            A.locator('.sh-sr [data-create]').click()
            A.wait_for_selector('.sh-created .sh-link', timeout=20000)
            link = A.locator('.sh-created .sh-link').first.input_value()
            state['slink'] = link
            check('sender: signer link #/u/<token>#k=', re.search(r'#/u/[A-Za-z0-9_-]{32}#k=[A-Za-z0-9_-]{43}$', link) is not None, link)
            shot(A, 'desktop_light_signreq_created')
            log = json.dumps(server_log())
            check('sign: server never got names/message/key', 'Erika' not in log and 'Mustermann' not in log and 'Freitag' not in log and link.split('#k=')[1] not in log and MARKER not in log)
            A.locator('.sh-created a[href^="#/teilen/anfrage/"]').click()
            A.wait_for_selector('.sh-srow')
            A.wait_for_timeout(800)
            check('status: Offen', 'Offen' in A.locator('.sh-srow').inner_text())
            # signer (phone, any browser)
            B.goto(link); B.wait_for_timeout(300); B.reload()
            B.wait_for_selector('.sh-ffield-sig', timeout=20000)
            head = B.locator('.sh-sign-head').inner_text()
            check('signer: sees sender, message, own name', 'Max Mustermann' in head and 'Bitte bis Freitag' in head and 'Erika Muster' in head)
            check('signer: date + name prefilled', B.locator('.sh-ffield-text').count() == 2 and B.locator('.sh-ffield-text').nth(1).input_value() in ('Erika Muster',) or 'Erika Muster' in [B.locator('.sh-ffield-text').nth(i).input_value() for i in range(B.locator('.sh-ffield-text').count())])
            check('signer: submit disabled until done', B.locator('[data-submit]').is_disabled())
            shot(B, 'phone_light_signer')
            A.locator('[data-refresh]').click(); A.wait_for_timeout(900)
            check('status: Angesehen', 'Angesehen' in A.locator('.sh-srow').inner_text())
            B.locator('.sh-ffield-sig').scroll_into_view_if_needed()
            B.locator('.sh-ffield-sig').click()
            B.wait_for_selector('dialog[open] canvas.sig-pad', timeout=8000)
            B.wait_for_timeout(300)
            pad = B.locator('dialog[open] canvas.sig-pad').bounding_box()
            B.mouse.move(pad['x'] + 30, pad['y'] + pad['height'] * 0.6)
            B.mouse.down()
            for k in range(1, 20):
                B.mouse.move(pad['x'] + 30 + k * 12, pad['y'] + pad['height'] * (0.6 - 0.25 * ((k % 4) / 3)))
            B.mouse.up()
            B.locator('dialog[open] button[value="ok"]').click()
            B.wait_for_selector('.sh-ffield-sig.filled img', timeout=8000)
            B.locator('[data-agree]').check()
            check('signer: submit enabled after fields + consent', not B.locator('[data-submit]').is_disabled())
            shot(B, 'phone_light_signer_filled')
            B.locator('[data-submit]').click()
            B.wait_for_selector('text=Unterschrieben – danke!', timeout=30000)
            shot(B, 'phone_light_signer_done')
            with B.expect_download() as dl:
                B.locator('[data-copy]').click()
            signer_copy = open(dl.value.path(), 'rb').read()
            check('signer: copy download is a PDF', signer_copy[:5] == b'%PDF-')
            A.locator('[data-refresh]').click(); A.wait_for_timeout(1200)
            check('status: Unterschrieben', 'Unterschrieben' in A.locator('.sh-srow').inner_text())
            shot(A, 'desktop_light_status_signed')
            A.locator('.sh-final [data-save]').click()
            A.wait_for_timeout(2500)
            d = find_doc(A, r'\(unterschrieben\)\.pdf$')
            check('sender: signed PDF saved to library', d is not None)
            if d:
                signed = doc_bytes(A, d['id'])
                check('sender: same bytes as the signer copy', signed == signer_copy)
                from pypdf import PdfReader
                r = PdfReader(io.BytesIO(signed))
                check('audit: one page appended', len(r.pages) == 3, len(r.pages))
                txt = r.pages[-1].extract_text()
                orig_sha = hashlib.sha256(open(os.path.join(DATA, 'vertrag.pdf'), 'rb').read()).hexdigest()
                check('audit: title + EES/eIDAS note', 'Unterschriftsprotokoll' in txt and 'Einfache elektronische Signatur' in txt and 'eIDAS' in txt)
                check('audit: signer name + requester', 'Erika Muster' in txt and 'Max Mustermann' in txt)
                check('audit: SHA-256 of the original', orig_sha in txt.replace('\n', ''), txt[:600])
                check('audit: UTC timestamps', txt.count('UTC') >= 3)
                check('audit: no qualified-signature claim', 'Keine fortgeschrittene oder qualifizierte' in txt)
                p1 = r.pages[0].extract_text()
                check('signed page: name + date drawn', 'Erika Muster' in p1 and time.strftime('%Y') in p1)
                imgs = list(r.pages[0].images)
                check('signed page: signature image embedded', len(imgs) >= 1)
            st = harness('/__test/state')
            check('server state: signer status signed', [s['status'] for s in st['signers']] == ['signed'])
        step('sign_flow', sign_flow)

        def sign_other_device():
            # the status of a request on a second device: hand-over link (fragment only), asks before storing
            A.locator('[data-move]').click()
            A.wait_for_selector('.sh-move .sh-link')
            mlink = A.locator('.sh-move .sh-link').input_value()
            check('move: link #/teilen/mitnehmen#d=…', re.search(r'#/teilen/mitnehmen#d=[A-Za-z0-9_-]+$', mlink) is not None, mlink[:120])
            check('move: warning shown', 'nur an dich selbst' in A.locator('.sh-move').inner_text())
            shot(A, 'desktop_light_status_move')
            F = open_app(new_ctx(browser, phone=True), 'F', '#/start')
            F.goto(mlink); F.wait_for_timeout(300); F.reload()
            F.wait_for_selector('.sh-import-card', timeout=15000)
            check('move: asks first, nothing stored yet', F.evaluate("JSON.parse(localStorage.getItem('fale-shares-v1') || '[]').length") == 0)
            shot(F, 'phone_light_move_import')
            F.locator('[data-take]').click()
            F.wait_for_selector('.sh-srow', timeout=15000)
            F.wait_for_timeout(1200)
            rows = F.locator('.sh-status-list').inner_text()
            check('move: second device sees signer + status', 'Erika Muster' in rows and 'Unterschrieben' in rows, rows[:200])
            check('move: fragment with the key left the address bar', '#d=' not in F.url and '/teilen/anfrage/' in F.url, F.url)
            F.locator('.sh-final [data-save]').click()
            F.wait_for_timeout(2500)
            check('move: signed PDF loads on the second device', find_doc(F, r'\(unterschrieben\)\.pdf$') is not None)
            F.goto(mlink); F.wait_for_timeout(300); F.reload(); F.wait_for_timeout(1500)
            check('move: opening the link again goes straight to the status', '/teilen/anfrage/' in F.url and F.locator('.sh-import-card').count() == 0, F.url)
            F.goto(mlink[:-12]); F.wait_for_timeout(300); F.reload(); F.wait_for_timeout(1200)
            check('move: damaged link → clear message', 'Link unvollständig' in F.locator('.screen-inner').last.inner_text())
            F.context.close()
        step('sign_other_device', sign_other_device)

        def file_request():
            # requester (desktop) creates an upload link; uploader (phone, no account) sends encrypted files
            goto(A, '#/teilen/anfordern', 1200)
            A.wait_for_selector('.sh-rq-create [data-go]')
            A.fill('[data-title]', 'Steuer 2026')
            A.fill('[data-from]', 'Steuerbüro Muster')
            A.fill('[data-msg]', 'Bitte bis Freitag hochladen.')
            A.locator('.sh-rq-item input').first.fill('Lohnsteuerbescheinigung')
            A.locator('.sh-rq-create [data-add]').click()
            A.locator('.sh-rq-item input').nth(1).fill('Kontoauszug')
            A.locator('.sh-rq-create [data-exp]', has_text='30 Tage').click()
            A.locator('.sh-rq-create [data-max]', has_text='10').click()
            import datetime
            due = (datetime.date.today() + datetime.timedelta(days=60)).isoformat()
            A.fill('.sh-rq-create input[data-due]', due)
            A.locator('.sh-rq-create [data-go]').click()
            A.wait_for_timeout(500)
            check('request: deadline after expiry refused', A.locator('.sh-done').count() == 0 and 'Frist' in A.locator('#toasts').inner_text())
            due = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()
            due_de = '.'.join(reversed(due.split('-')))
            A.fill('.sh-rq-create input[data-due]', due)
            shot(A, 'desktop_light_request_create')
            A.locator('.sh-rq-create [data-go]').click()
            A.wait_for_selector('.sh-done .sh-link', timeout=20000)
            link = A.locator('.sh-done .sh-link').input_value()
            check('request: upload link #/r/<token>#k=<key>', re.search(r'#/r/[A-Za-z0-9_-]{32}#k=[A-Za-z0-9_-]{43}$', link) is not None, link)
            check('request: key hint shown', 'nur auf diesem Gerät' in A.locator('.sh-done').inner_text())
            shot(A, 'desktop_light_request_created')
            log = json.dumps(server_log())
            check('request: server never got title/name/items/key', all(x not in log for x in ['Steuer 2026', 'Muster', 'Lohnsteuer', 'Kontoauszug', 'Freitag', link.split('#k=')[1]]))
            st = harness('/__test/state')
            check('request: stored with 10 files max', len(st['fileReqs']) == 1 and st['fileReqs'][0]['maxFiles'] == 10)
            # uploader
            B.goto(link); B.wait_for_timeout(300); B.reload()
            B.wait_for_selector('.sh-rq-head', timeout=20000)
            head = B.locator('.sh-rq-head').inner_text()
            check('uploader: sees requester, title, message, checklist', all(x in head for x in ['Steuerbüro Muster', 'Steuer 2026', 'Bitte bis Freitag', 'Lohnsteuerbescheinigung', 'Kontoauszug']), head[:300])
            check('uploader: sees the deadline', f'Bitte bis {due_de} hochladen' in head, head[:300])
            shot(B, 'phone_light_upload')
            B.fill('[data-name]', 'Erika Beispiel')
            with B.expect_file_chooser() as fc:
                B.locator('[data-pick]').click()
            fc.value.set_files([os.path.join(DATA, 'vertrag.pdf'), os.path.join(DATA, 'daten.bin')])
            B.wait_for_selector('.sh-rq-prow >> nth=1')
            B.locator('.sh-rq-prow select').nth(0).select_option('Lohnsteuerbescheinigung')
            B.locator('.sh-rq-prow select').nth(1).select_option('__other')
            B.fill('[data-note]', 'Kontoauszug folgt.')
            check('uploader: send button counts files', '2 Dateien' in B.locator('[data-send]').inner_text())
            shot(B, 'phone_light_upload_picked')
            B.locator('[data-send]').click()
            B.wait_for_selector('.sh-rq-sent li >> nth=1', timeout=30000)
            check('uploader: 2 files confirmed', B.locator('.sh-rq-sentlist li').count() == 2 and 'Du hast 2 Dateien hochgeladen' in B.locator('.sh-rq-sent').inner_text())
            check('uploader: checklist item marked', B.locator('.sh-rq-head li.done').count() == 1)
            shot(B, 'phone_light_upload_done')
            log = json.dumps(server_log())
            check('upload: server never saw content, names or note', MARKER not in log and 'Erika' not in log and 'vertrag' not in log and 'Kontoauszug folgt' not in log)
            st = harness('/__test/state')
            rq = [o for o in st['objects'] if o['kind'] == 'req-file']
            check('upload: 2 complete encrypted objects', len(rq) == 2 and all(o['complete'] for o in rq) and all('"e":' in o['header'] for o in rq))
            # the link key cannot open uploads (encrypted to the requester's public key)
            can_open = B.evaluate("""async ([hdr, link]) => { const C = await import('./js/share/crypto.js'); const L = C.keyFromFragment(link);
              try { await C.openObject(L, hdr); return true; } catch { return false; } }""", [rq[0]['header'], link])
            check('upload: link key alone cannot decrypt an upload', can_open is False)
            # third file → retract
            with B.expect_file_chooser() as fc:
                B.locator('[data-pick]').click()
            fc.value.set_files(os.path.join(DATA, 'daten.bin'))
            B.locator('[data-send]').click()
            B.wait_for_selector('.sh-rq-sentlist li >> nth=2', timeout=30000)
            B.locator('.sh-rq-sentlist li').nth(2).locator('button').click()
            B.locator('dialog[open] button[value="ok"]').click()
            B.wait_for_function("document.querySelectorAll('.sh-rq-sentlist li').length === 2", timeout=10000)
            check('uploader: retract own upload', len([o for o in harness('/__test/state')['objects'] if o['kind'] == 'req-file']) == 2)
            # requester inbox
            A.locator('.sh-done a[href^="#/teilen/unterlagen/"]').click()
            A.wait_for_selector('.sh-rq-file >> nth=1', timeout=20000)
            A.wait_for_timeout(500)
            files = A.locator('[data-rqfiles]').inner_text()
            check('inbox: decrypted names, sender, item, note', all(x in files for x in ['vertrag.pdf', 'daten.bin', 'von Erika Beispiel', 'Lohnsteuerbescheinigung', 'Kontoauszug folgt.']), files[:400])
            chk = A.locator('.sh-rq-check').inner_text()
            check('inbox: checklist (received / missing)', A.locator('.sh-rq-checklist li.done').count() == 1 and 'fehlt noch' in chk, chk)
            shot(A, 'desktop_light_request_inbox')
            check('inbox: deadline shown', f'Frist: {due_de}' in A.locator('.sh-status-head').inner_text())
            # nudge: message lists what is still missing, sent with the user's own share sheet
            A.evaluate("window.__shared = null; navigator.share = async d => { window.__shared = d; }; navigator.canShare = () => true;")
            A.locator('[data-nudge]').click()
            A.wait_for_function('window.__shared !== null', timeout=5000)
            shared = A.evaluate('window.__shared')
            check('nudge: missing items + deadline + link', 'Kontoauszug' in shared['text'] and 'Lohnsteuer' not in shared['text'] and due_de in shared['text'] and '#/r/' in shared['url'], shared)
            row = A.locator('.sh-rq-file', has_text='vertrag.pdf')
            with A.expect_download() as dl:
                row.locator('[data-save]').click()
            check('inbox: downloaded bytes identical', open(dl.value.path(), 'rb').read() == open(os.path.join(DATA, 'vertrag.pdf'), 'rb').read() and dl.value.suggested_filename == 'vertrag.pdf')
            row.locator('[data-import]').click()
            A.wait_for_timeout(1500)
            d = find_doc(A, r'^vertrag\.pdf$')
            check('inbox: saved to library', d is not None and doc_bytes(A, d['id']) == open(os.path.join(DATA, 'vertrag.pdf'), 'rb').read())
            with A.expect_download() as dl:
                A.locator('[data-zip]').click()
            import zipfile
            z = zipfile.ZipFile(dl.value.path())
            names = z.namelist()
            check('inbox: ZIP with folders per item', 'Lohnsteuerbescheinigung/vertrag.pdf' in names and 'daten.bin' in names and z.read('daten.bin') == open(os.path.join(DATA, 'daten.bin'), 'rb').read(), names)
            # reuse as template → new request prefilled
            A.locator('[data-reuse]').click()
            A.wait_for_selector('.sh-rq-create [data-title]')
            A.wait_for_timeout(500)
            check('reuse: title, sender and items prefilled', A.input_value('[data-title]') == 'Steuer 2026' and A.input_value('[data-from]') == 'Steuerbüro Muster'
                  and [A.locator('.sh-rq-item input').nth(i).input_value() for i in range(A.locator('.sh-rq-item input').count())] == ['Lohnsteuerbescheinigung', 'Kontoauszug'])
            A.go_back(); A.wait_for_selector('.sh-rq-file', timeout=15000)
            # pause uploads
            A.locator('.sh-rq-toggle input').uncheck()
            A.wait_for_timeout(900)
            check('pause: server closed', harness('/__test/state')['fileReqs'][0]['closed'] is True)
            B.reload(); B.wait_for_selector('.sh-rq-closed', timeout=15000)
            check('pause: uploader sees a clear note, no form', 'nicht möglich' in B.locator('.sh-rq-closed').inner_text() and B.locator('[data-pick]').count() == 0)
            shot(B, 'phone_light_upload_paused')
            A.locator('.sh-rq-toggle input').check()
            A.wait_for_timeout(900)
            check('pause: reopened', harness('/__test/state')['fileReqs'][0]['closed'] is False)
            # delete one file
            A.locator('.sh-rq-file', has_text='daten.bin').locator('[data-rm]').click()
            A.locator('dialog[open] button[value="ok"]').click()
            A.wait_for_function("document.querySelectorAll('.sh-rq-file').length === 1", timeout=10000)
            check('inbox: file deleted on the server', len([o for o in harness('/__test/state')['objects'] if o['kind'] == 'req-file']) == 1)
            # hub row
            goto(A, '#/teilen', 1500)
            A.wait_for_selector('[data-filereq-id]')
            check('hub: request listed with file count', '1 Datei' in A.locator('[data-filereq-id]').inner_text() and 'Steuer 2026' in A.locator('[data-filereq-id]').inner_text())
            shot(A, 'desktop_light_hub_requests')
            # delete request → link dead
            A.locator('[data-filereq-id]').click()
            A.wait_for_selector('.sh-rq-status [data-del]')
            A.locator('.sh-rq-status [data-del]').click()
            A.locator('dialog[open] button[value="ok"]').click()
            A.wait_for_timeout(1000)
            check('delete: request + files gone', not harness('/__test/state')['fileReqs'] and not [o for o in harness('/__test/state')['objects'] if o['kind'] == 'req-file'])
            B.reload(); B.wait_for_timeout(1500)
            check('delete: upload link shows a clear message', 'nicht mehr gültig' in B.locator('.sh-recv-main').inner_text())
            B.goto(link[:-10]); B.wait_for_timeout(300); B.reload(); B.wait_for_timeout(1200)
            check('uploader: damaged link → clear message', 'Schlüssel fehlt' in B.locator('.sh-recv-main').inner_text() or 'beschädigt' in B.locator('.sh-recv-main').inner_text() or 'nicht mehr gültig' in B.locator('.sh-recv-main').inner_text())
        step('file_request', file_request)

        def file_request_xss():
            # attacker-controlled texts on both sides (request texts → uploader, file meta → requester) render as text
            X = '<img src=x onerror="window.__pwn=1">'
            goto(A, '#/teilen/anfordern', 1200)
            A.wait_for_selector('.sh-rq-create [data-go]')
            A.fill('[data-title]', 'T' + X); A.fill('[data-from]', 'F' + X); A.fill('[data-msg]', 'M' + X)
            A.locator('.sh-rq-item input').first.fill('I' + X)
            A.locator('.sh-rq-create [data-go]').click()
            A.wait_for_selector('.sh-done .sh-link', timeout=20000)
            link = A.locator('.sh-done .sh-link').input_value()
            B.goto(link); B.wait_for_timeout(300); B.reload()
            B.wait_for_selector('.sh-rq-head', timeout=20000)
            check('xss: uploader shows request texts literally', 'T' + X in B.locator('.sh-rq-head').inner_text() and B.locator('.sh-rq-head img').count() == 0)
            B.fill('[data-name]', 'N' + X)
            with B.expect_file_chooser() as fc:
                B.locator('[data-pick]').click()
            fc.value.set_files(files=[{'name': 'D' + X.replace('/', '_') + '.pdf', 'mimeType': 'application/pdf', 'buffer': open(os.path.join(DATA, 'vertrag.pdf'), 'rb').read()}])
            B.locator('.sh-rq-prow select').select_option(index=1)
            B.fill('[data-note]', 'O' + X)
            B.locator('[data-send]').click()
            B.wait_for_selector('.sh-rq-sent li', timeout=30000)
            A.locator('.sh-done a[href^="#/teilen/unterlagen/"]').click()
            A.wait_for_selector('.sh-rq-file', timeout=20000)
            A.wait_for_timeout(500)
            txt = A.locator('.sh-rq-status').inner_text()
            check('xss: inbox shows file meta literally', 'N' + X in txt and 'O' + X in txt and A.locator('.sh-rq-status img').count() == 0, txt[:300])
            check('xss: no script ran', A.evaluate('window.__pwn') is None and B.evaluate('window.__pwn') is None)
            with A.expect_download() as dl:
                A.locator('.sh-rq-file [data-save]').click()
            check('xss: file name sanitised for saving', '<' not in dl.value.suggested_filename and dl.value.suggested_filename.endswith('.pdf'), dl.value.suggested_filename)
        step('file_request_xss', file_request_xss)

        def sign_multi():
            # two signers, sequential: person 2 must wait
            goto(A, f'#/teilen/unterschrift?doc={state["pdf"]}', 1500)
            A.wait_for_selector('.sh-sr .sh-page canvas', timeout=15000)
            A.fill('[data-sname="0"]', 'Person Eins')
            A.locator('[data-addsigner]').click()
            A.fill('[data-sname="1"]', 'Person Zwei')
            page1 = A.locator('.sh-page[data-page="1"]'); box = page1.bounding_box()
            A.locator('.sh-signer').nth(0).locator('.sh-signer-pick').click()
            A.locator('[data-ftype="sig"]').click(); page1.click(position={'x': box['width'] * 0.3, 'y': box['height'] * 0.7})
            A.locator('.sh-signer').nth(1).locator('.sh-signer-pick').click()
            A.locator('[data-ftype="sig"]').click(); page1.click(position={'x': box['width'] * 0.7, 'y': box['height'] * 0.7})
            shot(A, 'desktop_light_signreq_two')
            A.locator('.sh-sr [data-create]').click()
            A.wait_for_selector('.sh-created .sh-link', timeout=20000)
            links = [A.locator('.sh-created .sh-link').nth(i).input_value() for i in range(2)]
            check('multi: two signer links', len(set(links)) == 2)
            E = open_app(new_ctx(browser, phone=True), 'E', '#/start')
            E.goto(links[1]); E.wait_for_timeout(300); E.reload()
            E.wait_for_selector('.sh-recv-error', timeout=10000)
            check('multi: person 2 waits for person 1', 'Noch nicht an der Reihe' in E.locator('.sh-recv-error').inner_text())
            E.context.close()
        step('sign_multi', sign_multi)

        # ------------------------------------------------------------ transfer: WebRTC P2P via QR link
        def transfer_p2p():
            harness('/__test/reset')
            goto(A, '#/verbinden', 1000)
            A.wait_for_selector('[data-host]')
            shot(A, 'desktop_light_transfer_choice')
            A.locator('[data-host]').click()
            A.wait_for_selector('.sh-tr-host [data-qr] svg', timeout=10000)
            qr_url = A.locator('.sh-tr-host [data-qr]').get_attribute('data-url')
            code = A.locator('.sh-tr-code-big').inner_text().replace(' ', '')
            check('transfer: QR + 6-digit code shown', re.match(r'^\d{6}$', code) is not None and '#/verbinden?r=' in qr_url and '&s=' in qr_url)
            shot(A, 'desktop_light_transfer_host')
            secret = qr_url.split('&s=')[1]
            B.goto(qr_url)
            B.wait_for_selector('.sh-tr-session', timeout=25000)
            check('transfer: pairing secret removed from the address bar', '&s=' not in B.url)
            A.wait_for_selector('.sh-tr-session', timeout=25000)
            mA = A.locator('[data-mode]').inner_text(); mB = B.locator('[data-mode]').inner_text()
            check('transfer: direct P2P on both sides', 'Peer-to-Peer' in mA and 'Peer-to-Peer' in mB, f'{mA} | {mB}')
            sA = A.locator('[data-sas]').inner_text(); sB = B.locator('[data-sas]').inner_text()
            check('transfer: same Prüfnummer on both devices', re.match(r'^\d{3} \d{3}$', sA) is not None and sA == sB, f'{sA} vs {sB}')
            shot(B, 'phone_light_transfer_connected')
            with A.expect_file_chooser() as fc:
                A.locator('[data-dev]').click()
            fc.value.set_files([os.path.join(DATA, 'daten.bin'), os.path.join(DATA, 'vertrag.pdf')])
            B.wait_for_function("document.querySelectorAll('.sh-tr-row.done .sh-tr-dir.in').length >= 2", timeout=30000)
            d1 = find_doc(B, r'^daten\.bin$'); d2 = find_doc(B, r'^vertrag.*\.pdf$')
            check('transfer: files land in library (Empfangen)', d2 is not None and d2['source'] == 'Empfangen')
            if d2:
                check('transfer: PDF bytes identical', doc_bytes(B, d2['id']) == open(os.path.join(DATA, 'vertrag.pdf'), 'rb').read())
            check('transfer: unknown file type not imported', d1 is None)
            with B.expect_download() as dl:
                B.locator('[data-save-file]').first.click()
            check('transfer: unknown type can be saved on the device (identical bytes)', open(dl.value.path(), 'rb').read() == blob)
            A.wait_for_function("document.querySelectorAll('.sh-tr-row.done .sh-tr-dir.out').length >= 1", timeout=20000)
            shot(A, 'desktop_light_transfer_done')
            shot(B, 'phone_light_transfer_done')
            # back channel B → A
            with B.expect_file_chooser() as fc:
                B.locator('[data-dev]').click()
            txt_path = os.path.join(DATA, 'notiz.txt'); open(txt_path, 'w').write('Hallo vom Handy ' + MARKER)
            fc.value.set_files(txt_path)
            A.wait_for_function("document.querySelectorAll('.sh-tr-row.done .sh-tr-dir.in').length >= 1", timeout=20000)
            d3 = find_doc(A, r'^notiz\.txt$')
            check('transfer: phone → PC works too', d3 is not None and doc_bytes(A, d3['id']) == open(txt_path, 'rb').read())
            log = json.dumps(server_log())
            check('transfer: P2P file data never touches the server', MARKER not in log and harness('/__test/state')['objects'] == [])
            check('transfer: pairing secret never sent', secret not in log)
            check('transfer: signalling encrypted (no SDP in clear)', 'a=fingerprint' not in log and 'v=0' not in log)
            B.locator('[data-close]').click()
            A.wait_for_selector('[data-host]', timeout=15000)
            check('transfer: disconnect reaches the other device', True)
        step('transfer_p2p', transfer_p2p)

        # ------------------------------------------------------------ transfer: relay fallback (forced), 6-digit code
        def transfer_relay():
            harness('/__test/reset')
            ctxR1 = new_ctx(browser); ctxR1.add_init_script('window.__FALE_FORCE_RELAY__ = true;')
            ctxR2 = new_ctx(browser, phone=True, dark=True); ctxR2.add_init_script('window.__FALE_FORCE_RELAY__ = true;')
            R1 = open_app(ctxR1, 'R1', '#/verbinden'); R2 = open_app(ctxR2, 'R2', '#/verbinden')
            R1.wait_for_selector('[data-host]'); R1.locator('[data-host]').click()
            R1.wait_for_selector('.sh-tr-code-big', timeout=10000)
            code = R1.locator('.sh-tr-code-big').inner_text().replace(' ', '')
            R2.wait_for_selector('[data-code]')
            shot(R2, 'phone_dark_transfer_choice')
            R2.fill('[data-code]', code)
            R2.locator('[data-codeform] button[type=submit]').click()
            R2.wait_for_selector('.sh-tr-session', timeout=20000)
            R1.wait_for_selector('.sh-tr-session', timeout=20000)
            check('relay: both in relay mode', 'Relais' in R1.locator('[data-mode]').inner_text() and 'Relais' in R2.locator('[data-mode]').inner_text())
            with R1.expect_file_chooser() as fc:
                R1.locator('[data-dev]').click()
            fc.value.set_files(os.path.join(DATA, 'vertrag.pdf'))
            R2.wait_for_function("document.querySelectorAll('.sh-tr-row.done .sh-tr-dir.in').length >= 1", timeout=30000)
            d = find_doc(R2, r'^vertrag.*\.pdf$')
            check('relay: file received + identical', d is not None and doc_bytes(R2, d['id']) == open(os.path.join(DATA, 'vertrag.pdf'), 'rb').read())
            shot(R2, 'phone_dark_transfer_relay_done')
            R1.wait_for_timeout(2500)
            st = harness('/__test/state')
            check('relay: ciphertext deleted after receipt', [o for o in st['objects'] if o['kind'] == 'relay'] == [], st['objects'])
            log = json.dumps(server_log())
            check('relay: server never saw plaintext', MARKER not in log)
            ups = [x for x in server_log() if 'a=create' in x['url'] and 'share' in x['url']]
            check('relay: uploaded as kind relay with 1 h', any('"relay"' in x['body'] for x in ups))
            ctxR1.close(); ctxR2.close()
        step('transfer_relay', transfer_relay)

        # ------------------------------------------------------------ offline + screenshots in dark
        def offline_and_shots():
            ctxO = new_ctx(browser, phone=True)
            O = open_app(ctxO, 'O', '#/teilen')
            O.wait_for_selector('.sh-hub')
            # offline use needs the precached app (service worker active), as in test_full.py
            O.wait_for_function("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active && r.active.state === 'activated'))", timeout=90000)
            ctxO.set_offline(True)
            O.evaluate("window.dispatchEvent(new Event('offline'))")
            O.wait_for_timeout(400)
            check('offline: banner shown on hub', O.locator('.sh-offline').is_visible())
            shot(O, 'phone_light_hub_offline')
            goto(O, '#/teilen/link', 900)
            check('offline: banner on create', O.locator('.sh-offline').is_visible())
            goto(O, '#/verbinden', 900)
            check('offline: transfer buttons disabled', O.locator('[data-host]').is_disabled())
            ctxO.close()
            # dark mode screenshots (phone + desktop)
            ctxD = new_ctx(browser, dark=True)
            Dk = open_app(ctxD, 'Dk', '#/start')
            set_theme(Dk, 'dark')
            Dk.wait_for_timeout(400)
            shot(Dk, 'desktop_dark_start')
            goto(Dk, '#/teilen', 900); shot(Dk, 'desktop_dark_hub')
            pid = import_file(Dk, os.path.join(DATA, 'vertrag.pdf'), 'Vertrag dunkel.pdf', 'application/pdf')
            link = create_link(Dk, pid, password='Geheim123')
            shot(Dk, 'desktop_dark_share_done')
            goto(Dk, f'#/teilen/unterschrift?doc={pid}', 1500)
            Dk.wait_for_selector('.sh-page canvas', timeout=15000)
            shot(Dk, 'desktop_dark_signreq')
            goto(Dk, '#/verbinden', 900); Dk.locator('[data-host]').click(); Dk.wait_for_selector('.sh-tr-host svg')
            shot(Dk, 'desktop_dark_transfer_host')
            ctxP = new_ctx(browser, phone=True, dark=True)
            P = open_app(ctxP, 'P', '#/start')
            set_theme(P, 'dark'); P.wait_for_timeout(300)
            shot(P, 'phone_dark_start')
            goto(P, '#/werkzeuge', 900)
            P.locator('[data-share-section]').scroll_into_view_if_needed(); shot(P, 'phone_dark_tools_section')
            goto(P, '#/teilen', 900); shot(P, 'phone_dark_hub')
            P.goto(link); P.wait_for_timeout(300); P.reload(); P.wait_for_selector('[data-pw]', timeout=10000)
            set_theme(P, 'dark'); shot(P, 'phone_dark_recipient_password')
            P.fill('[data-pw]', 'Geheim123'); P.locator('form.sh-recv-card button[type=submit]').click(); P.wait_for_selector('.sh-recv-name', timeout=15000)
            shot(P, 'phone_dark_recipient')
            ppid = import_file(P, os.path.join(DATA, 'vertrag.pdf'), 'Vertrag Handy.pdf', 'application/pdf')
            goto(P, f'#/teilen/unterschrift?doc={ppid}', 1500)
            P.wait_for_selector('.sh-page canvas', timeout=15000)
            shot(P, 'phone_dark_signreq')
            goto(P, '#/verbinden', 900); P.locator('[data-host]').click(); P.wait_for_selector('.sh-tr-host svg')
            shot(P, 'phone_dark_transfer_host')
            # phone light screenshots of start + share form
            ctxL = new_ctx(browser, phone=True)
            Lp = open_app(ctxL, 'L', '#/start')
            Lp.locator('[data-share-start]').scroll_into_view_if_needed(); shot(Lp, 'phone_light_start_card')
            lid = import_file(Lp, os.path.join(DATA, 'vertrag.pdf'), 'Vertrag.pdf', 'application/pdf')
            goto(Lp, f'#/teilen/link?doc={lid}', 900); Lp.wait_for_selector('.sh-create [data-go]'); shot(Lp, 'phone_light_share_form')
            goto(Lp, f'#/teilen/unterschrift?doc={lid}', 1500); Lp.wait_for_selector('.sh-page canvas', timeout=15000); shot(Lp, 'phone_light_signreq')
            ctxD.close(); ctxP.close(); ctxL.close()
        step('offline_shots', offline_and_shots)

        def english():
            ctxE = new_ctx(browser)
            En = open_app(ctxE, 'En', '#/start')
            En.evaluate("localStorage.setItem('fale-lang', 'en')")
            En.reload(); En.wait_for_selector('html.ready'); En.wait_for_timeout(800)
            goto(En, '#/teilen', 1000)
            t = En.locator('.sh-hub').inner_text()
            check('i18n: hub in English', 'Share securely' in t or 'end-to-end' in t.lower(), t[:200])
            shot(En, 'desktop_light_hub_en')
            ctxE.close()
        step('english', english)

        browser.close()


if __name__ == '__main__':
    run()
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)} passed, {len(bad)} failed')
    if console_problems:
        print('Console problems:')
        for c in console_problems[:40]:
            print('  ', c[:300])
    sys.exit(1 if bad else 0)

"""„Formular mit Gedächtnis“ (PDF+ Stufe 1, js/tools/formmemory.js + js/tools/sign.js).
- Formular (formular.pdf: Textfeld, Kästchen, Auswahl) ausfüllen + freier Text + Häkchen + Unterschrift → Speichern (Felder fixiert)
- Ergebnis in anderen Programmen: keine ausfüllbaren Felder mehr (pypdf), Werte + Text sichtbar (pdftotext), qpdf --check ok,
  keine Anhänge in der Anhang-Liste
- In FaLe wieder öffnen: Feld wieder ausfüllbar mit dem alten Wert, Text/Häkchen/Unterschrift wieder als bewegliche Einträge,
  nichts doppelt gezeichnet; Text ändern → Speichern → neuer Wert sichtbar, alter weg, Name ohne doppeltes „(ausgefüllt)“
- Datei außerhalb von FaLe verändert (Seite geändert) → kein Zurückbauen, freundlicher Hinweis
- PDF ohne Felder (nur Text + Unterschrift) funktioniert genauso; nicht fixiertes Formular bleibt ausfüllbar
- nur auf Wunsch: Häkchen „Später in FaLe änderbar“ an der Speichern-Leiste ist aus → Datei ohne Gedächtnis, kein Banner,
  kein Zurückbauen; angehakt → animierte Hinweis-Karte; „Immer so speichern“ und Einstellung „Ausgefüllte PDFs später änderbar“
  schalten es dauerhaft ein (dann Häkchen vorab gesetzt + Hinweis); „Nicht mehr anzeigen“ wirkt
- keine alten Einträge versteckt in der Datei (nach Ändern / nach Abschalten des Gedächtnisses)
- Handy 360 px: Speichern-Leiste passt, kein waagerechtes Scrollen
- keine Konsolenfehler, nichts friert ein
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, base64, re, subprocess, time, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SUITES, '..', 'base', 'testdata')
OUT = os.path.join(SUITES, 'out_formmemory')
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
BLOB = """async (id) => { const db = await import('./js/db.js'); const b = await db.getFile(id); if (!b) return null;
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }); }"""
FILES = "async () => (await (await import('./js/db.js')).listFiles()).map(f => ({ id: f.id, name: f.name, t: f.createdAt || 0 }))"


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


def open_sign(page, did):
    page.evaluate("location.hash = '#/werkzeuge'"); page.wait_for_timeout(300)
    page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={did}'")
    page.wait_for_selector('.sign-page canvas', timeout=20000)
    page.wait_for_timeout(900)


def page_box(page):
    return page.locator('.sign-page').first.bounding_box()


def draw_signature(page, x, y):
    page.locator('[data-mode="sign"]').click()
    page.wait_for_selector('dialog .sig-pad', timeout=8000)
    pad = page.locator('dialog .sig-pad').bounding_box()
    page.mouse.move(pad['x'] + 30, pad['y'] + 110); page.mouse.down()
    for i in range(1, 30):
        page.mouse.move(pad['x'] + 30 + i * 10, pad['y'] + 110 - 30 * ((i % 6) / 6.0))
    page.mouse.up()
    page.locator('dialog .btn-primary').click()
    page.wait_for_timeout(400)
    page.mouse.click(x, y)
    page.wait_for_selector('.s-item.s-image', timeout=5000)


ANIMS = "() => [...document.querySelectorAll('.sh-card.sh-memory .sh-type, .sh-card.sh-memory .sh-lock, .sh-card.sh-memory .sh-pen')].reduce((n, e) => n + e.getAnimations().filter(a => a.playState === 'running').length, 0)"


def raw_text(path):
    """All bytes of the file uncompressed (qpdf --qdf), to find hidden leftovers."""
    q = path + '.qdf'
    subprocess.run(['qpdf', '--qdf', '--object-streams=disable', path, q], capture_output=True)
    return open(q, 'rb').read().decode('latin-1')


def tick_memory(page):
    page.locator('.screen-foot [data-memory]').check()
    page.wait_for_timeout(300)


def save_and_get(page, name_re):
    page.locator('[data-save]').click()
    page.wait_for_selector('.result-card', timeout=30000)
    page.wait_for_timeout(600)
    files = [f for f in page.evaluate(FILES) if re.search(name_re, f['name'])]
    if not files:
        return None, None
    f = max(files, key=lambda x: x['t'])
    path = os.path.join(OUT, f"{f['id']}_" + re.sub(r'[^\w.-]+', '_', f['name']))
    open(path, 'wb').write(base64.b64decode(page.evaluate(BLOB, f['id'])))
    return f, path


def run(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='de-DE', accept_downloads=True)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-hint-redact', 'hidden'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'[pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    st = {}

    def first_fill():
        did = page.evaluate(IMPORT, [b64(os.path.join(TD, 'formular.pdf')), 'Anmeldung.pdf'])
        open_sign(page, did)
        page.locator('.form-panel input[data-fi]').first.fill('Erika Musterfrau')
        page.locator('.form-panel input[type=checkbox][data-fi]').first.check()
        box = page_box(page)
        page.locator('[data-mode="text"]').click()
        page.mouse.click(box['x'] + box['width'] * 0.15, box['y'] + 560)
        page.keyboard.type('Notiz: bitte bis Freitag')
        page.mouse.click(box['x'] + 5, box['y'] + 5)
        page.locator('[data-mode="mark"]').click()
        page.mouse.click(box['x'] + box['width'] * 0.7, box['y'] + 600)
        page.mouse.click(box['x'] + 5, box['y'] + 5)
        draw_signature(page, box['x'] + box['width'] * 0.78, box['y'] + 440)
        page.mouse.click(box['x'] + 5, box['y'] + 5)
        mem = page.locator('.screen-foot [data-memory]')
        check('option „Später in FaLe änderbar“ at the save bar, off by default, no hint yet', mem.count() == 1 and not mem.is_checked() and page.locator('.sh-card').count() == 0)
        tick_memory(page)
        card = page.locator('.sh-card.sh-memory')
        check('ticked: hint card with explanation and „Immer so speichern“', card.count() == 1 and 'Später in FaLe änderbar' in card.inner_text() and 'In FaLe kannst du Einträge' in card.inner_text() and card.locator('[data-sh-auto]').count() == 1)
        page.wait_for_timeout(1600)
        check('hint card: animation running (field, lock, pen)', page.evaluate(ANIMS) >= 3, page.evaluate(ANIMS))
        page.screenshot(path=os.path.join(OUT, 'memory_hint.png'))
        mem.uncheck(); page.wait_for_timeout(400)
        check('unticked: hint card goes away', page.locator('.sh-card').count() == 0)
        tick_memory(page)
        page.locator('.sh-card [data-sh-ok]').click(); page.wait_for_timeout(400)
        check('„Verstanden“ closes the card, option stays on', page.locator('.sh-card').count() == 0 and mem.is_checked())
        f, path = save_and_get(page, r'^Anmeldung \(unterschrieben\)\.pdf$')
        check('save toast says the entries stay changeable', page.locator('.toast', has_text='später in FaLe wieder ändern').count() >= 1)
        check('saved „Anmeldung (unterschrieben).pdf“', f is not None)
        if not f:
            return
        st['id'], st['path'] = f['id'], path
        import pypdf
        r = pypdf.PdfReader(path)
        check('other programs: no fillable fields left', not r.get_fields(), r.get_fields())
        check('other programs: nothing in the attachment list', not r.attachments, list(r.attachments.keys()))
        txt = subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout
        check('other programs: value + note visible on the page', 'Erika Musterfrau' in txt and 'Notiz: bitte bis Freitag' in txt, txt[:300])
        check('qpdf --check ok', subprocess.run(['qpdf', '--check', path], capture_output=True).returncode == 0)
        imgs = subprocess.run(['pdfimages', '-list', path], capture_output=True, text=True).stdout.strip().split('\n')[2:]
        check('signature drawn on the page', len(imgs) >= 1, imgs)
    step('fill + sign + save', first_fill)

    def reopen():
        if 'id' not in st:
            return
        t = time.time()
        open_sign(page, st['id'])
        check('re-open: fast (< 6 s)', time.time() - t < 6, round(time.time() - t, 1))
        v = page.locator('.form-panel input[data-fi]').first.input_value()
        check('re-open: field editable again with its value', v == 'Erika Musterfrau', v)
        check('re-open: checkbox still ticked', page.locator('.form-panel input[type=checkbox][data-fi]').first.is_checked())
        n = page.evaluate("() => ({ t: document.querySelectorAll('.s-item.s-textbox').length, m: document.querySelectorAll('.s-item.s-mark').length, i: document.querySelectorAll('.s-item.s-image').length })")
        check('re-open: note, check mark and signature are movable entries again', n == {'t': 1, 'm': 1, 'i': 1}, n)
        check('re-open: note text kept', 'Notiz: bitte bis Freitag' in page.locator('.s-item.s-textbox').inner_text())
        check('re-open: toast says the entries are editable', page.locator('.toast', has_text='wieder bearbeitbar').count() >= 1)
        check('re-open: option stays ticked (no extra card, the toast explains)', page.locator('.screen-foot [data-memory]').is_checked() and page.locator('.sh-card').count() == 0)
        # nothing drawn twice: the page canvas must not show the old note (it is only an overlay item now)
        page.screenshot(path=os.path.join(OUT, 'reopen.png'))
        page.locator('.form-panel input[data-fi]').first.fill('Erika Muster-Neu')
        tb = page.locator('.s-item.s-textbox .s-text')
        tb.click(); page.keyboard.press('Control+A'); page.keyboard.type('Notiz: erledigt')
        box = page_box(page)
        page.mouse.click(box['x'] + 5, box['y'] + 5)
        f, path = save_and_get(page, r'^Anmeldung \(unterschrieben\)\.pdf$')
        names = [x['name'] for x in page.evaluate(FILES)]
        check('second save: same name, no doubled suffix', not any('(unterschrieben) (' in n for n in names) and f is not None, names)
        if f:
            txt = subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout
            check('second save: new values visible, old ones gone', 'Erika Muster-Neu' in txt and 'Notiz: erledigt' in txt and 'Erika Musterfrau' not in txt and 'bis Freitag' not in txt, txt[:300])
            imgs = [l for l in subprocess.run(['pdfimages', '-list', path], capture_output=True, text=True).stdout.strip().split('\n')[2:] if len(l.split()) > 2 and l.split()[2] == 'image']
            check('second save: signature drawn once', len(imgs) == 1, imgs)
            raw = raw_text(path)
            check('second save: old entries not hidden anywhere in the file', 'Musterfrau' not in raw and 'bis Freitag' not in raw and '/FaLePlus' in raw)
            st['id2'], st['path2'] = f['id'], path
    step('re-open + change', reopen)

    def viewer_banner():
        if 'id2' not in st:
            return
        page.evaluate(f"location.hash = '#/ansicht/{st['id2']}'")
        page.wait_for_selector('.plus-banner', timeout=20000)
        check('viewer: hint „Mit FaLe ausgefüllt“ with a button', 'Einträge ändern' in page.locator('.plus-banner').inner_text())
        page.locator('.plus-banner [data-plus-go]').click()
        page.wait_for_selector('.sign-page canvas', timeout=20000); page.wait_for_timeout(900)
        check('viewer button opens the entries for editing', page.locator('.s-item.s-image').count() == 1)
    step('viewer banner', viewer_banner)

    def tampered():
        if 'path' not in st:
            return
        # another program changes the page (here: qpdf rewrites, then a raw edit of the content would differ) →
        # simulate with pdf-lib: draw one more line on page 1 without touching the memory
        data = page.evaluate("""async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const L = await import('./js/pdflib.js'); const PDFLib = await L.loadPdfLib(); const d = await PDFLib.PDFDocument.load(bin);
          d.getPages()[0].drawText('Fremd geändert', { x: 50, y: 50, size: 10 }); const out = await d.save();
          let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000)); return btoa(s); }""", b64(st['path']))
        did = page.evaluate(IMPORT, [data, 'Fremd.pdf'])
        open_sign(page, did)
        check('changed elsewhere: no restore, friendly note', page.locator('.toast', has_text='anderen Programm verändert').count() >= 1 and page.locator('.s-item').count() == 0)
        # a plain qpdf rewrite (renumbered objects) keeps the memory working
        q = os.path.join(OUT, 'qpdf_rewrite.pdf')
        subprocess.run(['qpdf', '--object-streams=generate', '--linearize', st['path'], q], capture_output=True)
        did = page.evaluate(IMPORT, [b64(q), 'Umgeschrieben.pdf'])
        open_sign(page, did)
        check('rewritten by qpdf (renumbered): entries still come back', page.locator('.s-item.s-image').count() == 1 and page.locator('.form-panel input[data-fi]').first.input_value() == 'Erika Musterfrau')
    step('changed elsewhere', tampered)

    def plain_and_open_form():
        did = page.evaluate(IMPORT, [b64(os.path.join(TD, 'bericht.pdf')), 'Bericht.pdf'])
        open_sign(page, did)
        box = page_box(page)
        page.locator('[data-mode="text"]').click()
        page.mouse.click(box['x'] + box['width'] * 0.2, box['y'] + box['height'] * 0.2)
        page.keyboard.type('Gelesen am Montag')
        page.mouse.click(box['x'] + 5, box['y'] + 5)
        tick_memory(page)
        f, path = save_and_get(page, r'^Bericht \(ausgefüllt\)\.pdf$')
        check('PDF without fields: saved', f is not None)
        if f:
            open_sign(page, f['id'])
            check('PDF without fields: text entry comes back', page.locator('.s-item.s-textbox').count() == 1 and 'Gelesen am Montag' in page.locator('.s-item.s-textbox').inner_text())
        # form kept fillable (box unticked)
        did = page.evaluate(IMPORT, [b64(os.path.join(TD, 'formular.pdf')), 'Offen.pdf'])
        open_sign(page, did)
        page.locator('.form-panel input[data-fi]').first.fill('Max Offen')
        page.locator('.form-panel [data-flatten]').uncheck()
        tick_memory(page)
        f, path = save_and_get(page, r'^Offen \(ausgefüllt\)\.pdf$')
        if f:
            import pypdf
            flds = pypdf.PdfReader(path).get_fields() or {}
            check('not fixed: still a fillable form elsewhere with the value', flds.get('name', {}).get('/V') == 'Max Offen', {k: v.get('/V') for k, v in flds.items()})
            open_sign(page, f['id'])
            check('not fixed: re-open keeps the value and the setting', page.locator('.form-panel input[data-fi]').first.input_value() == 'Max Offen' and not page.locator('.form-panel [data-flatten]').is_checked())
    step('plain PDF + unfixed form', plain_and_open_form)

    def without_memory():
        # not ticked: a normal fixed PDF – nothing remembered, no banner, nothing restored
        did = page.evaluate(IMPORT, [b64(os.path.join(TD, 'formular.pdf')), 'Ohne.pdf'])
        open_sign(page, did)
        page.locator('.form-panel input[data-fi]').first.fill('Nina Normal')
        f, path = save_and_get(page, r'^Ohne \(ausgefüllt\)\.pdf$')
        if not f:
            return check('without memory: saved', False)
        import pypdf
        raw = raw_text(path)
        check('without memory: fixed as before, no memory in the file', not pypdf.PdfReader(path).get_fields() and '/FaLePlus' not in raw and 'Nina Normal' in subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout)
        check('without memory: plain toast', page.locator('.toast', has_text='Dokument gespeichert').count() >= 1)
        page.evaluate(f"location.hash = '#/ansicht/{f['id']}'"); page.wait_for_selector('.pdf-page, .page canvas, canvas', timeout=20000); page.wait_for_timeout(1200)
        check('without memory: no „Mit FaLe ausgefüllt“ banner', page.locator('.plus-banner').count() == 0)
        open_sign(page, f['id'])
        check('without memory: nothing restored, option off', page.locator('.s-item').count() == 0 and not page.locator('.screen-foot [data-memory]').is_checked())
        # a remembered file saved again WITHOUT the option: memory and old entries leave the file completely
        if 'id2' in st:
            open_sign(page, st['id2'])
            page.locator('.screen-foot [data-memory]').uncheck()
            page.locator('.form-panel input[data-fi]').first.fill('Erika Final')
            f2, p2 = save_and_get(page, r'^Anmeldung \(unterschrieben\)\.pdf$')
            raw = raw_text(p2) if f2 else ''
            check('option switched off: memory and old entries removed from the file', f2 and '/FaLePlus' not in raw and 'Muster-Neu' not in raw and 'Erika Final' in subprocess.run(['pdftotext', p2, '-'], capture_output=True, text=True).stdout)
    step('without memory', without_memory)
    ctx.close()

    # „Immer so speichern“ + setting + „Nicht mehr anzeigen“ (fresh browser profile)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='de-DE')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'[pageerror] {e}'))
    page.goto(URL); page.wait_for_selector('#view-start .hero', timeout=30000)

    def always():
        did = page.evaluate(IMPORT, [b64(os.path.join(TD, 'formular.pdf')), 'Immer.pdf'])
        open_sign(page, did)
        tick_memory(page)
        page.locator('.sh-card [data-sh-auto]').click(); page.wait_for_timeout(500)
        check('„Immer so speichern“: switched on for good, card closes, toast', page.evaluate("localStorage.getItem('fale-form-memory')") == 'auto' and page.locator('.sh-card').count() == 0 and page.locator('.toast', has_text='immer in FaLe änderbar').count() >= 1)
        open_sign(page, did)
        card = page.locator('.sh-card.sh-memory')
        check('auto: option ticked from the start, card says it is on in the settings (no extra button)', page.locator('.screen-foot [data-memory]').is_checked() and card.count() == 1 and 'Einstellungen' in card.inner_text() and card.locator('[data-sh-auto]').count() == 0)
        page.evaluate("location.hash = '#/einstellungen'"); page.wait_for_selector('[data-memory-toggle]', timeout=10000)
        tg = page.locator('[data-memory-toggle]')
        check('settings: switch „Ausgefüllte PDFs später änderbar“ is on', tg.is_checked() and 'später änderbar' in page.locator('.settings-row', has=tg).inner_text())
        page.locator('.settings-row', has=tg).locator('.switch').click(); page.wait_for_timeout(300)
        check('settings: switching off → only on request again', page.evaluate("localStorage.getItem('fale-form-memory')") is None and not tg.is_checked())
        open_sign(page, did)
        check('after switching off: option not ticked, no card', not page.locator('.screen-foot [data-memory]').is_checked() and page.locator('.sh-card').count() == 0)
        page.evaluate("location.hash = '#/einstellungen'"); page.wait_for_selector('[data-memory-toggle]', timeout=10000)
        page.locator('.settings-row', has=page.locator('[data-memory-toggle]')).locator('.switch').click(); page.wait_for_timeout(300)
        check('settings: switching on works too', page.evaluate("localStorage.getItem('fale-form-memory')") == 'auto')
        open_sign(page, did)
        page.locator('.sh-card [data-sh-never]').click(); page.wait_for_timeout(400)
        open_sign(page, did)
        check('„Nicht mehr anzeigen“: option still on, card gone for good', page.locator('.screen-foot [data-memory]').is_checked() and page.locator('.sh-card').count() == 0 and page.evaluate("localStorage.getItem('fale-hint-memory')") == 'hidden')
    step('always / settings / never', always)
    ctx.close()

    ctx = browser.new_context(viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True, locale='de-DE')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('pageerror', lambda e: problems.append(f'[pageerror phone] {e}'))
    page.goto(URL); page.wait_for_selector('#view-start .hero', timeout=30000)

    def phone():
        did = page.evaluate(IMPORT, [b64(os.path.join(TD, 'formular.pdf')), 'Handy.pdf'])
        open_sign(page, did)
        page.locator('.screen-foot [data-memory]').tap(); page.wait_for_timeout(500)
        mem = page.locator('.screen-foot .sign-mem').bounding_box()
        sv = page.locator('.screen-foot [data-save]').bounding_box()
        card = page.locator('.sh-card').bounding_box()
        over = page.evaluate('document.documentElement.scrollWidth')
        foot = page.locator('.screen-foot').bounding_box()
        check('phone: option + save button side by side in one compact row, big enough, no horizontal scroll', over <= 361 and mem['height'] >= 40 and sv['height'] >= 40 and abs((mem['y'] + mem['height'] / 2) - (sv['y'] + sv['height'] / 2)) < 6 and mem['x'] + mem['width'] <= sv['x'] and sv['x'] + sv['width'] <= 361 and foot['height'] <= 80, (over, mem, sv, foot))
        check('phone: hint card fits and leaves room for the page', card and card['height'] <= 760 * 0.4 and page.locator('.sign-page').first.bounding_box()['y'] < 640, card)
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

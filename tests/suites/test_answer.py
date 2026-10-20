"""„Antwortbrief mit einem Tipp“ – Briefkasten-Assistent → Antwort schreiben → fertiger Brief + Versand-Hinweis.
- requestedDocs(): erkennt die angeforderten Unterlagen (Aufzählung nach „folgende Unterlagen“) – und nichts bei normalen Briefen
- Hub: neue Gruppe „Auf Post antworten“ (Fristverlängerung, Unterlagen, Rückfrage, Antwort auf Mahnung)
- Behördenbrief (als PDF erzeugt) → Briefkasten → „Antwort schreiben“: Unterlagen nachreichen (Liste vorausgefüllt),
  Um mehr Zeit bitten (alte Frist vorausgefüllt), Rückfrage stellen; kein „Widerruf“ bei Bescheiden
- jeder neue Brief: Vorschau, PDF mit den richtigen Sätzen, Dialog „So verschickst du den Brief“, Erinnerung
- Widerspruch: Unterschriftszeile, strenger Hinweis (Post/Fax, keine E-Mail), „Drucken“ als Hauptknopf
- Einspruch: ELSTER-Hinweis; Kündigung Miete: Original per Post; Widerruf: keine Form nötig
- gespeicherte Unterschrift: Häkchen nur bei Briefen ohne Papierpflicht, Bild in Vorschau und PDF
- „Drucken“ öffnet die Ansicht und startet den Druck (window.print), der Link bleibt sauber (kein Doppel-Druck)
- Handy 360 px: kein waagerechtes Scrollen, Dialog passt; keine Konsolenfehler; nichts friert ein (Antwortzeit < 1,5 s)
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, json, base64, re, subprocess, time, traceback, datetime
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_answer')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


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


def goto(page, h, wait=700):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(wait)


def responsive(page, label):
    t = time.time()
    page.evaluate("new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))")
    dt = time.time() - t
    check(f'{label}: page stays responsive (no freeze)', dt < 1.5, f'{dt:.2f}s')


BLOB = """async (id) => { const db = await import('./js/db.js'); const b = await db.getFile(id); if (!b) return null;
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }); }"""
NEWEST = """async (re) => { const db = await import('./js/db.js'); const fs = (await db.listFiles()).filter(f => new RegExp(re).test(f.name)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); return fs[0] ? { id: fs[0].id, name: fs[0].name } : null; }"""


def save_doc(page, doc_id, name):
    path = os.path.join(OUT, name)
    with open(path, 'wb') as f:
        f.write(base64.b64decode(page.evaluate(BLOB, doc_id)))
    return path


def pdftext(path):
    return re.sub(r'\s+', ' ', subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout)


def pdfimages(path):
    out = subprocess.run(['pdfimages', '-list', path], capture_output=True, text=True).stdout
    return max(0, len(out.strip().split('\n')) - 2)


def make_pdf(page, html, name):
    """Build a letter PDF inside the app (docmodel → docpdf) and import it into the library → doc id."""
    return page.evaluate("""async ([html, name]) => {
      const { htmlToModel } = await import('./js/office/docmodel.js'); const { modelToPdf } = await import('./js/office/docpdf.js');
      const bytes = await modelToPdf(htmlToModel(html, { baseSize: 11 }), { title: name });
      const lib = await import('./js/library.js'); const meta = await lib.importPdf(bytes, { name, source: 'Test', silent: true }); return meta.id; }""", [html, name])


def create(page, kind='pdf'):
    page.locator(f'[data-out="{kind}"]').click()
    page.wait_for_selector('dialog[open] .result-mini', timeout=30000)
    page.wait_for_timeout(300)


def close_dialog(page, value=None):
    if value:
        page.locator(f'dialog[open] button[value="{value}"]').click()
    else:
        page.keyboard.press('Escape')
    page.wait_for_timeout(400)


JOBCENTER = """<p>Jobcenter Musterstadt · Hauptstraße 1 · 66111 Saarbrücken</p>
<p>Erika Musterfrau<br>Lindenweg 7<br>66111 Saarbrücken</p>
<p>Aktenzeichen: BG-70412-2026</p><p>Datum: 06.10.2026</p>
<p><strong>Aufforderung zur Mitwirkung</strong></p>
<p>Sehr geehrte Frau Musterfrau,</p>
<p>zur Bearbeitung Ihres Weiterbewilligungsantrags benötigen wir noch Unterlagen von Ihnen. Bitte reichen Sie folgende Unterlagen bis zum 30.10.2026 ein:</p>
<p>– Kontoauszüge der letzten drei Monate</p>
<p>– Lohnabrechnung September 2026</p>
<p>– aktuelle Nebenkostenabrechnung</p>
<p>Kommen Sie Ihrer Mitwirkungspflicht nicht nach, können die Leistungen ganz oder teilweise versagt werden (§ 66 SGB I).</p>
<p>Mit freundlichen Grüßen<br>Ihr Jobcenter Musterstadt</p>"""


def run(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='de-DE', accept_downloads=True)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {} window.__printed = 0; window.print = () => { window.__printed++; };")
    page = ctx.new_page()
    attach(page, 'desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    page.evaluate("""async () => { const P = await import('./js/extras/profile.js'); await P.setProfile({ vorname: 'Erika', nachname: 'Musterfrau', strasse: 'Lindenweg', hausnummer: '7', plz: '66111', ort: 'Saarbrücken', telefon: '0681 123456' }); }""")

    def unit():
        r = page.evaluate("""async (txt) => { const m = await import('./js/smart/inbox.js'); return {
          a: m.requestedDocs(txt),
          b: m.requestedDocs('Bitte senden Sie uns noch folgende Nachweise:\\n1. Mietvertrag\\n2. Meldebescheinigung\\n\\nVielen Dank'),
          c: m.requestedDocs('Ihre Rechnung Nr. 4711\\n- Position 1 Strom\\n- Position 2 Grundpreis'),
          d: m.requestedDocs('') }; }""", 'Bitte reichen Sie folgende Unterlagen bis zum 30.10.2026 ein:\n– Kontoauszüge der letzten drei Monate\n– Lohnabrechnung September 2026\n\nMit freundlichen Grüßen')
        check('requestedDocs: dash list after "folgende Unterlagen"', r['a'] == ['Kontoauszüge der letzten drei Monate', 'Lohnabrechnung September 2026'], r['a'])
        check('requestedDocs: numbered list after "folgende Nachweise"', r['b'] == ['Mietvertrag', 'Meldebescheinigung'], r['b'])
        check('requestedDocs: nothing for an ordinary invoice list / empty text', r['c'] == [] and r['d'] == [], r)
    step('unit', unit)

    def hub():
        goto(page, '#/schreiben', 900)
        page.wait_for_selector('.lt-hub')
        txt = page.locator('.lt-hub').inner_text()
        check('hub: group "Auf Post antworten"', 'Auf Post antworten' in txt)
        check('hub: 3 new letters + Antwort auf Mahnung', all(page.locator(f'[data-letter="{i}"]').count() == 1 for i in ['fristverlaengerung', 'unterlagen', 'rueckfrage', 'mahnung-antwort']))
        page.screenshot(path=os.path.join(OUT, 'hub.png'), full_page=True)
    step('hub', hub)

    state = {}

    def inbox():
        did = make_pdf(page, JOBCENTER, 'Jobcenter Mitwirkung.pdf')
        goto(page, f'#/briefkasten/neu?doc={did}', 400)
        page.wait_for_selector('.sm-letter', timeout=40000)
        page.wait_for_timeout(600)
        state['letter_hash'] = page.evaluate('location.hash')
        page.locator('[data-act="antwort"]').click()
        page.wait_for_selector('.menu-item', timeout=5000)
        items = [x.strip() for x in page.locator('.menu-item').all_inner_texts()]
        check('menu: Unterlagen nachreichen + Um mehr Zeit bitten + Rückfrage stellen', all(any(k in i for i in items) for k in ['Unterlagen nachreichen', 'Um mehr Zeit bitten', 'Rückfrage stellen']), items)
        check('menu: no "Widerruf" for an authority letter', not any('Widerruf' in i for i in items), items)
        page.screenshot(path=os.path.join(OUT, 'answer_menu.png'))
        page.locator('.menu-item', has_text='Unterlagen nachreichen').click()
        page.wait_for_selector('.lt-gen', timeout=10000)
        page.wait_for_timeout(500)
        v = page.evaluate("document.querySelector('.lt-gen')._letterApi.values")
        check('Unterlagen: recipient + Aktenzeichen prefilled', 'Jobcenter' in v['r_name'] and v['az'] == 'BG-70412-2026', [v['r_name'], v['az']])
        check('Unterlagen: requested documents prefilled as list', v['liste'].split('\n') == ['Kontoauszüge der letzten drei Monate', 'Lohnabrechnung September 2026', 'aktuelle Nebenkostenabrechnung'], v['liste'])
        prev = page.locator('.lt-paper').inner_text()
        check('Unterlagen preview: subject, list, Anlagen count', 'Nachreichen von Unterlagen – BG-70412-2026' in prev and '– Lohnabrechnung September 2026' in prev and 'Anlagen: 3' in prev, prev[:400])
        responsive(page, 'Unterlagen generator')
        create(page)
        dlg = page.locator('dialog[open]').inner_text()
        check('Unterlagen dialog: send guide (copies, name + file number)', 'So verschickst du den Brief' in dlg and 'Kopien schicken' in dlg and 'Aktenzeichen' in dlg, dlg)
        check('Unterlagen dialog: Drucken + Öffnen offered', page.locator('dialog[open] button[value="print"]').count() == 1 and page.locator('dialog[open] button[value="open"]').count() == 1)
        page.screenshot(path=os.path.join(OUT, 'unterlagen_dialog.png'))
        close_dialog(page)
        d = page.evaluate(NEWEST, r'^Unterlagen nachgereicht .*\.pdf$')
        txt = pdftext(save_doc(page, d['id'], 'unterlagen.pdf')) if d else ''
        check('Unterlagen PDF: sentences + list', 'sende ich Ihnen die folgenden Unterlagen' in txt and 'Kontoauszüge der letzten drei Monate' in txt and 'Erika Musterfrau' in txt, txt[:300])
        # Fristverlängerung from the same letter
        page.evaluate(f"location.hash = {json.dumps(state['letter_hash'])}")
        page.wait_for_selector('.sm-letter', timeout=20000)
        page.wait_for_timeout(500)
        page.locator('[data-act="antwort"]').click()
        page.locator('.menu-item', has_text='Um mehr Zeit bitten').click()
        page.wait_for_selector('.lt-gen', timeout=10000)
        page.wait_for_timeout(500)
        v = page.evaluate("document.querySelector('.lt-gen')._letterApi.values")
        check('Fristverlängerung: old deadline + topic prefilled', v['frist_alt'] == '2026-10-30' and v['sache'] == 'Unterlagen einreichen' and v['az'] == 'BG-70412-2026', [v['frist_alt'], v['sache'], v['az']])
        txt = page.locator('.lt-form').inner_text()
        check('Fristverlängerung: note that statutory deadlines cannot be extended', 'lassen sich nicht verlängern' in txt)
        page.locator('.lt-form [name="grund"]').select_option('krank')
        page.wait_for_timeout(400)
        prev = page.locator('.lt-paper').inner_text()
        check('Fristverlängerung preview: old + new deadline + reason', 'bis zum 30.10.2026 gesetzt' in prev and 'zu verlängern' in prev and 'erkrankt' in prev, prev[:500])
        create(page)
        dlg = page.locator('dialog[open]').inner_text()
        check('Fristverlängerung dialog: guide + reminder for the new deadline', 'vor Ablauf der alten Frist' in dlg and page.locator('dialog[open] .lt-remind input').is_checked(), dlg)
        close_dialog(page, 'open')
        page.wait_for_timeout(1200)
        rems = page.evaluate("async () => (await (await import('./js/extras/reminders.js')).listAll()).map(r => r.title)")
        check('Fristverlängerung: reminder stored', any('Frist (verlängert)' in r for r in rems), rems)
        # Rückfrage
        page.evaluate(f"location.hash = {json.dumps(state['letter_hash'])}")
        page.wait_for_selector('.sm-letter', timeout=20000)
        page.wait_for_timeout(400)
        page.locator('[data-act="antwort"]').click()
        page.locator('.menu-item', has_text='Rückfrage stellen').click()
        page.wait_for_selector('.lt-gen', timeout=10000)
        page.wait_for_timeout(500)
        page.locator('.lt-form [name="rueckruf"]').check()
        page.wait_for_timeout(400)
        prev = page.locator('.lt-paper').inner_text()
        check('Rückfrage preview: topic + question + phone from profile', 'habe ich eine Frage' in prev and 'Mitwirkung' in prev and '0681 123456' in prev, prev[:500])
        create(page)
        check('Rückfrage dialog: deadlines keep running', 'Fristen laufen trotz deiner Frage weiter' in page.locator('dialog[open]').inner_text())
        close_dialog(page)
    step('inbox → answers', inbox)

    def strict():
        goto(page, '#/schreiben/widerspruch', 900)
        page.locator('.lt-form [name="bescheidart"]').fill('Bescheid über Wohngeld')
        page.locator('.lt-form [name="r_name"]').fill('Stadt Musterstadt, Wohngeldstelle')
        page.wait_for_timeout(400)
        check('Widerspruch preview: line for handwritten signature', '……………………' in page.locator('.lt-paper').inner_text())
        create(page)
        dlg = page.locator('dialog[open]').inner_text()
        check('Widerspruch guide: print, sign, post/fax, no e-mail', 'mit der Hand unterschreiben' in dlg and 'Einschreiben' in dlg and 'Fax' in dlg and 'E-Mail reicht nicht' in dlg, dlg)
        check('Widerspruch guide: highlighted as strict', page.locator('dialog[open] .lt-send.strict').count() == 1)
        check('Widerspruch: "Drucken" is the main button', page.locator('dialog[open] button.btn-primary[value="print"]').count() == 1)
        page.screenshot(path=os.path.join(OUT, 'widerspruch_dialog.png'))
        close_dialog(page, 'print')
        for _ in range(60):
            if page.evaluate('window.__printed') > 0: break
            page.wait_for_timeout(500)
        check('Drucken: viewer opens + print starts', page.evaluate('window.__printed') == 1 and page.evaluate("location.hash").startswith('#/ansicht/'))
        check('Drucken: link cleaned (no second print on reload)', 'drucken' not in page.evaluate('location.hash'), page.evaluate('location.hash'))
        responsive(page, 'viewer after print')
        page.evaluate("location.hash = '#/schreiben'"); page.wait_for_timeout(700)
        # Einspruch → ELSTER
        goto(page, '#/schreiben/widerspruch', 900)
        page.locator('.lt-form [data-f="typ"] [data-v="einspruch"]').click()
        page.locator('.lt-form [name="bescheidart"]').fill('Einkommensteuerbescheid 2025')
        page.locator('.lt-form [name="r_name"]').fill('Finanzamt Saarbrücken')
        create(page)
        dlg = page.locator('dialog[open]').inner_text()
        check('Einspruch guide: ELSTER, post or fax', 'ELSTER' in dlg and 'Fax' in dlg and page.locator('dialog[open] .lt-send.strict').count() == 0, dlg)
        close_dialog(page)
        # Kündigung Miete → original by post; Widerruf → no form needed
        goto(page, '#/schreiben/kuendigung?art=miete', 900)
        page.locator('.lt-form [name="r_name"]').fill('Hausverwaltung Beispiel')
        create(page)
        dlg = page.locator('dialog[open]').inner_text()
        check('Kündigung Miete guide: original by registered mail, e-mail not enough', 'Original per Einschreiben' in dlg and 'reichen nicht' in dlg, dlg)
        close_dialog(page)
        goto(page, '#/schreiben/widerruf', 900)
        page.locator('.lt-form [name="gegenstand"]').fill('Kaffeemaschine')
        page.locator('.lt-form [name="r_name"]').fill('Beispiel Versand GmbH')
        create(page)
        dlg = page.locator('dialog[open]').inner_text()
        check('Widerruf guide: no special form, keep proof', 'Eine besondere Form ist nicht nötig' in dlg and 'Nachweis' in dlg, dlg)
        close_dialog(page)
    step('strict + guides', strict)

    def signature():
        page.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 100; const g = c.getContext('2d');
          g.strokeStyle = '#14162E'; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 70); g.bezierCurveTo(80, 0, 120, 120, 290, 30); g.stroke();
          const blob = await new Promise(r => c.toBlob(r, 'image/png')); const S = await import('./js/tools/sigstore.js'); await S.addAsset({ blob, kind: 'signature', name: 'Test', w: 300, h: 100 }); }""")
        goto(page, '#/schreiben/rueckfrage', 1000)
        box = page.locator('.lt-sigembed')
        check('signature: option shown for a letter without paper rule', box.count() == 1 and box.is_visible())
        page.locator('.lt-form [name="thema"]').fill('Nebenkosten')
        page.locator('.lt-form [name="r_name"]').fill('Hausverwaltung Muster GmbH')
        page.locator('.lt-form [name="__sig"]').check()
        page.wait_for_timeout(500)
        check('signature: image in preview above the name', page.locator('.lt-paper img[alt="Unterschrift"]').count() == 1)
        create(page)
        close_dialog(page)
        d = page.evaluate(NEWEST, r'^Rückfrage .*\.pdf$')
        path = save_doc(page, d['id'], 'rueckfrage_sig.pdf') if d else None
        check('signature: embedded in the PDF', path and pdfimages(path) >= 1, path)
        goto(page, '#/schreiben/widerspruch', 1000)
        check('signature: not offered where a handwritten signature is required (Widerspruch)', page.locator('.lt-sigembed').count() == 0 or not page.locator('.lt-sigembed').is_visible())
        goto(page, '#/schreiben/kuendigung?art=miete', 1000)
        check('signature: not offered for Kündigung Miete', page.locator('.lt-sigembed').count() == 0 or not page.locator('.lt-sigembed').is_visible())
        goto(page, '#/schreiben/kuendigung?art=fitness', 1000)
        check('signature: offered for Kündigung Fitnessstudio', page.locator('.lt-sigembed').is_visible())
    step('signature', signature)
    ctx.close()

    # ---- phone 360 px (simple mode)
    ctx = browser.new_context(viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True, locale='de-DE')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-simple', '1'); } catch (e) {} window.print = () => {};")
    page = ctx.new_page()
    attach(page, 'phone')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)

    def phone():
        for lid in ['fristverlaengerung', 'unterlagen', 'rueckfrage']:
            goto(page, f'#/schreiben/{lid}', 1000)
            over = page.evaluate('document.documentElement.scrollWidth')
            check(f'phone {lid}: no horizontal scroll', over <= 361, over)
            responsive(page, f'phone {lid}')
        page.locator('.lt-form [name="thema"]').fill('Nebenkosten')
        page.locator('.lt-form [name="r_name"]').fill('Hausverwaltung')
        page.locator('.lt-form [name="s_name"]').fill('Erika Musterfrau')
        create(page)
        bb = page.locator('dialog[open]').bounding_box()
        btns = page.locator('dialog[open] .dlg-actions button')
        fits = all((b := btns.nth(i).bounding_box()) and b['x'] >= 0 and b['x'] + b['width'] <= 361 for i in range(btns.count()))
        check('phone dialog: fits the screen, all buttons visible', bb and bb['width'] <= 360 and fits, bb)
        page.screenshot(path=os.path.join(OUT, 'phone_dialog.png'))
        close_dialog(page)
    step('phone', phone)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    bad_console = [x for x in problems if 'favicon' not in x]
    check('no console errors', not bad_console, bad_console[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)

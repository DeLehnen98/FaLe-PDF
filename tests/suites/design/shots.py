"""Screenshot tour. Usage: python3 shots.py <port> <outdir> [phone|desktop|all] [light|dark|all] [filter-substr,...]"""
import os, sys, json, time
from playwright.sync_api import sync_playwright

D = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(D, 'tests', 'testdata')
OD = os.path.join(D, 'tests', 'officedata')
PORT = sys.argv[1]
OUT = sys.argv[2]
DEV = sys.argv[3] if len(sys.argv) > 3 else 'all'
THEMES = sys.argv[4] if len(sys.argv) > 4 else 'all'
FILT = [x for x in (sys.argv[5].split(',') if len(sys.argv) > 5 else []) if x]
URL = f'http://127.0.0.1:{PORT}/'
os.makedirs(OUT, exist_ok=True)

DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name}))); });
  db.close(); return res; }"""

SCREENS = [
    ('01-start', '#/start', None),
    ('02-dateien', '#/dateien', None),
    ('03-werkzeuge', '#/werkzeuge', None),
    ('04-suche', '#/suche?q=Bericht', None),
    ('05-ich', '#/einstellungen', None),
    ('06-viewer', '#/ansicht/{bericht}', None),
    ('07-newmenu', '#/start', 'newmenu'),
    ('08-onboarding', '#/start', 'onboarding'),
    ('09-dialog', '#/dateien', 'dialog'),
    ('10-toast', '#/start', 'toast'),
    ('11-scrolled', '#/start', 'scroll'),
    ('20-t-unterschreiben', '#/werkzeug/unterschreiben?doc={formular}', None),
    ('21-t-kommentieren', '#/werkzeug/kommentieren?doc={bericht}', None),
    ('22-t-seiten', '#/werkzeug/seiten?doc={bericht}', None),
    ('23-t-zusammenfuegen', '#/werkzeug/zusammenfuegen', None),
    ('24-t-bilder', '#/werkzeug/bilder', None),
    ('25-t-komprimieren', '#/werkzeug/komprimieren?doc={unkomprimiert}', None),
    ('26-t-exportieren', '#/werkzeug/exportieren?doc={bericht}', None),
    ('27-t-passwort', '#/werkzeug/passwort?doc={bericht}', None),
    ('28-t-schwaerzen', '#/werkzeug/schwaerzen?doc={struktur}', None),
    ('29-t-bearbeiten', '#/werkzeug/bearbeiten?doc={struktur}', None),
    ('30-t-wasserzeichen', '#/werkzeug/wasserzeichen?doc={bericht}', None),
    ('31-t-seitenzahlen', '#/werkzeug/seitenzahlen?doc={bericht}', None),
    ('32-t-pdf-word', '#/werkzeug/pdf-word?doc={struktur}', None),
    ('33-t-vergleichen', '#/werkzeug/vergleichen', None),
    ('34-t-zuschneiden', '#/werkzeug/zuschneiden?doc={bericht}', None),
    ('35-t-stapel', '#/werkzeug/stapel', None),
    ('36-t-qr-erstellen', '#/werkzeug/qr-erstellen', None),
    ('37-t-text-erkennen', '#/werkzeug/text-erkennen', None),
    ('38-t-chooser', '#/werkzeug/extrahieren', None),
    ('39-t-passfoto', '#/werkzeug/passfoto', None),
    ('40-t-formular', '#/werkzeug/formular-erstellen?doc={bericht}', None),
    ('50-o-dokument', '#/neu/dokument', None),
    ('51-o-tabelle', '#/neu/tabelle', None),
    ('52-o-praesentation', '#/neu/praesentation', None),
    ('53-o-vorlagen', '#/vorlagen', None),
    ('60-ki', '#/ki', None),
    ('61-ki-plus', '#/ki/plus', None),
    ('62-ki-chat', '#/ki/chat', None),
    ('63-teilen', '#/teilen', None),
    ('64-verbinden', '#/verbinden', None),
    ('65-teilen-link', '#/teilen/link', None),
    ('70-konto', '#/konto', None),
    ('71-profil', '#/profil', None),
    ('72-fristen', '#/fristen', None),
    ('73-tresor', '#/tresor', None),
    ('74-schreiben', '#/schreiben', None),
    ('75-papierkorb', '#/papierkorb', None),
    ('76-kuendigung', '#/schreiben/kuendigung?art=handy', None),
]


def ids_of(page):
    out = {}
    for d in page.evaluate(DOCS_JS):
        if d['name'].endswith('.pdf'):
            out[d['name'][:-4]] = d['id']
    return out


def seed(page):
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=20000)
    page.wait_for_timeout(600)
    pdfs = [os.path.join(TD, n) for n in ['bericht.pdf', 'formular.pdf', 'struktur.pdf', 'unkomprimiert.pdf', 'bild.pdf']]
    page.set_input_files('#pdf-input', pdfs)
    for _ in range(120):
        if len(page.evaluate(DOCS_JS)) >= 5:
            break
        page.wait_for_timeout(250)
    page.wait_for_timeout(800)
    try:
        with page.expect_file_chooser(timeout=5000) as fc:
            page.locator('#view-start .hero [data-action="open-file"]').first.click()
        fc.value.set_files([os.path.join(OD, n) for n in ['bericht.docx', 'umsatz.xlsx', 'praesentation.pptx']])
        for _ in range(80):
            if len(page.evaluate(DOCS_JS)) >= 8:
                break
            page.wait_for_timeout(250)
    except Exception as e:
        print('office import failed', e)
    page.wait_for_timeout(1500)
    page.evaluate("location.hash = '#/start'")
    page.wait_for_timeout(800)


def run(p, phone, dark):
    tag = ('phone' if phone else 'desk') + ('-dark' if dark else '-light')
    b = p.chromium.launch()
    if phone:
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='de-DE', color_scheme='dark' if dark else 'light')
    else:
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='de-DE', color_scheme='dark' if dark else 'light')
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    seed(page)
    ids = ids_of(page)
    for name, h, action in SCREENS:
        if FILT and not any(f in name for f in FILT):
            continue
        try:
            hh = h.format(**ids)
        except KeyError:
            continue
        try:
            page.evaluate("() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.menu-layer, .onboard').forEach(m => m.remove()); }")
            page.evaluate("h => { if (location.hash === h) location.hash = '#/start'; }", hh)
            page.wait_for_timeout(200)
            page.evaluate("h => { location.hash = h; }", hh)
            page.wait_for_timeout(1400)
            if action == 'newmenu':
                sel = '.fab' if phone else '.side-open'
                page.locator(sel).first.click()
                page.wait_for_timeout(500)
            elif action == 'onboarding':
                page.evaluate("() => { import('./js/extras/onboarding.js').then(m => m.showOnboarding()); }")
                page.wait_for_timeout(700)
            elif action == 'dialog':
                page.evaluate("() => { import('./js/ui.js').then(m => m.confirmDialog('Ordner löschen?', '„Rechnungen“ wird entfernt. Die Dateien darin bleiben erhalten.', { okLabel: 'Ordner löschen', danger: true })); }")
                page.wait_for_timeout(600)
            elif action == 'toast':
                page.evaluate("() => { import('./js/ui.js').then(m => { m.toast('PDF gespeichert', 'success'); m.toast('Datei konnte nicht gelesen werden.', 'error'); }); }")
                page.wait_for_timeout(500)
            elif action == 'scroll':
                page.evaluate("document.querySelector('#main').scrollTop = 700")
                page.wait_for_timeout(500)
            page.screenshot(path=os.path.join(OUT, f'{name}_{tag}.png'))
        except Exception as e:
            print('FAIL', name, tag, str(e)[:200])
    if errs:
        print(tag, 'pageerrors:', errs[:5])
    b.close()


with sync_playwright() as p:
    for phone in ([True, False] if DEV == 'all' else [DEV == 'phone']):
        for dark in ([False, True] if THEMES == 'all' else [THEMES == 'dark']):
            t = time.time()
            run(p, phone, dark)
            print('done', phone, dark, round(time.time() - t, 1), 's')

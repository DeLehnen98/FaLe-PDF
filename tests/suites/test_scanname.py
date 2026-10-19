"""Scanner: automatic file names from the content (js/tools/smartname.js) – on the device, no cloud.

- name field empty with the hint "Automatisch aus dem Inhalt …"; with text recognition off the hint is "Scan <date>"
- German electricity invoice → "Energieabrechnung Stadtwerke Saarbrücken Okt 2026", reminder → "Mahnung Telekom Deutschland Sept 2026"
- an English note with a big title → "Swimming Class Registration <month year>"
- a photo without text → "Scan <date>"; a name the user typed is always kept
- result card: "Name automatisch aus dem Inhalt · Ändern" – renaming works
- English UI: "Energy bill Stadtwerke Saarbrücken Oct 2026"
- phone size, 4× slower CPU: no main-thread block over 1.5 s, nothing hangs
Run: python3 test_scanname.py   (server: python3 -m http.server 8798 --bind 127.0.0.1 in the repo; URL via SCAN_URL)
"""
import os, re, sys, random, subprocess
from datetime import date
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('SCAN_URL', 'http://127.0.0.1:8798/')
TD = os.path.join(HERE, 'scannamedata')
OUT = os.path.join(HERE, 'out_scanname')
os.makedirs(TD, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


def page(name, lines):
    """A4 'photo' at ~150 dpi: lines = [(text, size, bold, x, y)]"""
    im = Image.new('RGB', (1240, 1754), (250, 250, 247))
    d = ImageDraw.Draw(im)
    for text, size, bold, x, y in lines:
        d.text((x, y), text, fill=(25, 25, 30), font=ImageFont.truetype(BOLD if bold else FONT, size))
    im = im.filter(ImageFilter.GaussianBlur(0.4))
    im.save(os.path.join(TD, name), quality=90)


def fixtures():
    body = 24
    page('rechnung.jpg', [
        ('Stadtwerke Saarbrücken GmbH', 38, True, 110, 110),
        ('Hohenzollernstraße 104-106 · 66117 Saarbrücken', 20, False, 110, 165),
        ('Stadtwerke Saarbrücken GmbH · Postfach 10 · 66001 Saarbrücken', 15, False, 110, 300),
        ('Herrn', body, False, 110, 330), ('Max Mustermann', body, False, 110, 362),
        ('Am Weiher 3', body, False, 110, 394), ('66123 Saarbrücken', body, False, 110, 426),
        ('Saarbrücken, 15.10.2026', body, False, 800, 520),
        ('Rechnung', 34, True, 110, 600),
        ('Rechnungsnummer: 2026-48812', body, False, 110, 670),
        ('Kundennummer: 700 123 456', body, False, 110, 702),
        ('Sehr geehrter Herr Mustermann,', body, False, 110, 780),
        ('für den Abrechnungszeitraum September 2026 berechnen wir Ihnen:', body, False, 110, 830),
        ('Strom Grundpreis                      12,40 EUR', body, False, 110, 890),
        ('Strom Arbeitspreis                    72,10 EUR', body, False, 110, 922),
        ('Rechnungsbetrag                       84,50 EUR', body, True, 110, 970),
        ('Zahlbar bis 30.10.2026 auf das unten genannte Konto.', body, False, 110, 1030),
        ('Mit freundlichen Grüßen', body, False, 110, 1120), ('Ihre Stadtwerke Saarbrücken', body, False, 110, 1152),
    ])
    page('mahnung.jpg', [
        ('Telekom Deutschland GmbH', 38, True, 110, 110),
        ('Landgrabenweg 151 · 53227 Bonn', 20, False, 110, 165),
        ('Frau', body, False, 110, 330), ('Erika Musterfrau', body, False, 110, 362),
        ('Bahnhofstraße 9', body, False, 110, 394), ('66111 Saarbrücken', body, False, 110, 426),
        ('Bonn, 22.09.2026', body, False, 850, 520),
        ('Zahlungserinnerung / 1. Mahnung', 32, True, 110, 600),
        ('Kundennummer: 4455 6677', body, False, 110, 670),
        ('Sehr geehrte Frau Musterfrau,', body, False, 110, 750),
        ('leider konnten wir bisher keinen Zahlungseingang für unsere Rechnung', body, False, 110, 800),
        ('vom 01.09.2026 feststellen. Der offene Betrag beträgt 39,95 EUR.', body, False, 110, 832),
        ('Bitte überweisen Sie den Betrag bis zum 06.10.2026.', body, False, 110, 864),
        ('Mahngebühr: 2,50 EUR', body, False, 110, 920),
        ('Mit freundlichen Grüßen', body, False, 110, 1000), ('Ihre Telekom', body, False, 110, 1032),
    ])
    page('englisch.jpg', [
        ('SWIMMING CLASS REGISTRATION', 44, True, 110, 160),
        ('Please fill in this form and hand it in at the front desk.', 22, False, 110, 260),
        ('Name of the child: ____________________________', 22, False, 110, 340),
        ('Age: ________   Group: beginners / advanced', 22, False, 110, 390),
        ('Parent or guardian: ____________________________', 22, False, 110, 440),
        ('Phone: ____________________________', 22, False, 110, 490),
        ('Classes start on Monday at 4 pm in the small pool.', 22, False, 110, 570),
        ('Bring a towel, a swimming cap and something to drink.', 22, False, 110, 610),
    ])
    rnd = random.Random(5)
    im = Image.effect_noise((620, 877), 30).convert('RGB').resize((1240, 1754))
    d = ImageDraw.Draw(im)
    for _ in range(18):  # a photo of a drawing – shapes, no text
        x, y = rnd.randint(50, 1100), rnd.randint(50, 1600)
        d.ellipse([x, y, x + rnd.randint(40, 200), y + rnd.randint(40, 200)], outline=(30, 30, 90), width=6)
    im.save(os.path.join(TD, 'bild.jpg'), quality=85)


DOCS = """async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const res = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, created: d.created || d.added || 0}))); });
  db.close(); return res; }"""
INIT = """try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-simple-hint', 'hidden'); } catch (e) {}
window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}"""


def scan(pg, files, name=None, ocr=True):
    """Scanner → pick images → (name) → save; returns (doc name in the result card, seconds)"""
    pg.goto(URL + '#/werkzeuge')
    pg.wait_for_timeout(300)
    pg.goto(URL + '#/werkzeug/scannen')
    pg.wait_for_selector('[data-gallery]', timeout=20000)
    pg.wait_for_timeout(600)
    with pg.expect_file_chooser() as fc:
        pg.locator('[data-gallery]').first.click()
    fc.value.set_files([os.path.join(TD, f) for f in files])
    pg.wait_for_selector('[data-ocr]', timeout=30000)
    box = pg.locator('[data-ocr]')
    if box.is_checked() != ocr:
        box.set_checked(ocr)
    ph = pg.locator('[data-name]').get_attribute('placeholder')
    if name:
        pg.fill('[data-name]', name)
    pg.evaluate('window.__lt = []')
    pg.locator('.screen-foot .btn-primary').click()
    pg.wait_for_selector('[data-result] .result-card', timeout=180000)
    worst = max(pg.evaluate('window.__lt') or [0])
    return pg.locator('[data-result] .doc-name').inner_text().strip(), ph, worst


def run(p):
    fixtures()
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='de-DE')
    c.add_init_script(INIT)
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=30000)
    cdp = c.new_cdp_session(pg)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    today = date.today().strftime('%d-%m-%Y')

    n, ph, worst = scan(pg, ['rechnung.jpg'])
    check('name field: empty, hint "Automatisch aus dem Inhalt …"', ph and ph == 'Automatisch aus dem Inhalt', ph)
    check('electricity invoice → "Energieabrechnung Stadtwerke Saarbrücken Okt 2026"', n == 'Energieabrechnung Stadtwerke Saarbrücken Okt 2026.pdf', n)
    check('invoice: no freeze over 1.5 s (4× slower CPU)', worst <= 1500, worst)
    hint = pg.locator('.sc-autoname')
    check('result: "Name automatisch aus dem Inhalt" with "Ändern"', hint.count() == 1 and 'Name automatisch aus dem Inhalt' in hint.inner_text() and pg.locator('[data-rename]').is_visible())
    pg.wait_for_timeout(1200)
    rb = pg.locator('[data-result] .result-card').bounding_box()
    check('phone: the result is scrolled into view (no searching for it)', rb and rb['y'] >= 0 and rb['y'] + 60 <= 844 - 90, rb)
    pg.screenshot(path=os.path.join(OUT, 'result_phone.png'))
    pg.locator('[data-rename]').click()
    pg.wait_for_selector('dialog[open] input', timeout=5000)
    pg.fill('dialog[open] input', 'Strom Oktober')
    pg.locator('dialog[open] .btn-primary').click()
    pg.wait_for_timeout(500)
    names = [d['name'] for d in pg.evaluate(DOCS)]
    check('"Ändern" renames the file (card and library)', pg.locator('[data-result] .doc-name').inner_text().strip() == 'Strom Oktober.pdf' and 'Strom Oktober.pdf' in names, names)

    n, _, _ = scan(pg, ['mahnung.jpg'])
    check('reminder → "Mahnung Telekom Deutschland Sept 2026"', n == 'Mahnung Telekom Deutschland Sept 2026.pdf', n)

    n, _, _ = scan(pg, ['englisch.jpg'])
    month = date.today().strftime('%m')
    mon = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sept', 'Okt', 'Nov', 'Dez'][int(month) - 1]
    check('English note → its title + month', n.startswith('Swimming Class Registration ') and str(date.today().year) in n, (n, mon))

    n, _, _ = scan(pg, ['bild.jpg'])
    check('photo without text → "Scan <date>"', n == f'Scan {today}.pdf', n)
    check('photo: no "automatisch" hint', pg.locator('.sc-autoname').count() == 0)

    n, _, _ = scan(pg, ['rechnung.jpg'], name='Meine Rechnung')
    check('a typed name is kept', n == 'Meine Rechnung.pdf', n)

    n, ph, _ = scan(pg, ['rechnung.jpg'], ocr=False)
    check('text recognition off → hint and name "Scan <date>"', ph == f'Scan {today}' and n == f'Scan {today}.pdf', (ph, n))
    pg.locator('[data-ocr]').set_checked(True)
    check('phone: no page overflow', pg.evaluate('document.documentElement.scrollWidth') <= 391)

    # names for the 50 letters of the Briefkasten test corpus (smart/gen_corpus.py) – text only, no OCR
    corpus = os.path.join(HERE, 'smart', 'corpus')
    if not os.path.exists(os.path.join(corpus, 'r01.pdf')):
        subprocess.run([sys.executable, os.path.join(HERE, 'smart', 'gen_corpus.py')], cwd=os.path.join(HERE, 'smart'), capture_output=True)
    if os.path.exists(os.path.join(corpus, 'r01.pdf')):
        keys = sorted(k[:-4] for k in os.listdir(corpus) if k.endswith('.pdf'))
        texts = {k: subprocess.run(['pdftotext', '-layout', os.path.join(corpus, k + '.pdf'), '-'], capture_output=True, text=True).stdout for k in keys}
        got = pg.evaluate("""async T => { const M = await import('/js/tools/smartname.js'); const o = {}; for (const [k, t] of Object.entries(T)) o[k] = await M.suggestScanName({ text: t, lines: [] }); return o; }""", texts)
        want = {
            'r01': 'Energieabrechnung Stadtwerke Saarbrücken Okt 2026', 'r10': 'Nebenkostenabrechnung Hausverwaltung Nordlicht Sept 2026',
            'r12': 'Rechnung Rheinische Akademie Juli 2026', 'm02': 'Inkasso Westdeutsche Forderungsmanagement Okt 2026',
            'b01': 'Steuerbescheid Finanzamt Saarbrücken Okt 2026', 'v01': 'Kündigungsbestätigung FitPark Saar Okt 2026',
            'k01': 'Kontoauszug Sparkasse Saarbrücken Okt 2026', 'a03': 'Krankenkasse Isar BKK Sept 2026',
            's02': 'Einladung zum Elternabend Okt 2026', 'c04': 'Rosen-Apotheke Okt 2026', 'c05': 'Tankstelle Am Ring Okt 2026',
            'c01': 'Kassenbon Frischmarkt Müller Okt 2026',
        }
        bad = {k: got.get(k) for k, v in want.items() if got.get(k) != v}
        check('corpus: typical letters get the expected names', not bad, bad)
        empty = [k for k in keys if not got.get(k)]
        check(f'corpus: every one of the {len(keys)} letters gets a name', not empty, empty)
        long_ = {k: v for k, v in got.items() if v and len(v) > 80}
        check('corpus: names stay short (≤ 80 characters)', not long_, long_)
    check('no page errors', not errs, errs[:3])
    c.close()

    # English UI
    c = b.new_context(viewport={'width': 1200, 'height': 900}, locale='en-GB')
    c.add_init_script(INIT)
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=30000)
    n, ph, _ = scan(pg, ['rechnung.jpg'])
    check('en: hint in English', ph and ph.startswith('Automatic, from the content'), ph)
    check('en: "Energy bill Stadtwerke Saarbrücken Oct 2026"', n == 'Energy bill Stadtwerke Saarbrücken Oct 2026.pdf', n)
    check('en: result hint in English', 'Name made from the content' in pg.locator('.sc-autoname').inner_text(), pg.locator('.sc-autoname').inner_text())
    pg.screenshot(path=os.path.join(OUT, 'result_en.png'))
    check('en: no page errors', not errs, errs[:3])
    c.close()
    b.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], str(r[2])[:400])
    sys.exit(1 if bad else 0)

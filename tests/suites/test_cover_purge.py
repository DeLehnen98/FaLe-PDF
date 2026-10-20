"""„Abdecken“ und „Ersetzen“ in PDF bearbeiten löschen den Inhalt darunter wirklich (js/tools/purge.js).
Fixtures: tests/suites/purge/gen.py (ReportLab Standardschrift, eingebettete TrueType + Formular-XObjekt, Bild,
LibreOffice mit Unterschriften-Schrift und Kerning) + im Browser erzeugt: pdf-lib mit eingebetteter Schrift (Type0
Identity-H) und eine durchsuchbare Scan-PDF (unsichtbarer Text).
Für jede Datei: geheimes Wort abdecken → speichern →
- das Wort ist nicht mehr kopierbar (pdftotext) und nicht in den entpackten Rohdaten (qpdf --qdf)
- der übrige Text derselben Zeile bleibt erhalten und an derselben Stelle (Abweichung < 0,6 pt)
- Seite bleibt Vektor/Text (nur bei Bild unter der Fläche wird die Seite zum Bild)
- qpdf --check fehlerfrei
UI: in „PDF bearbeiten“ Fläche aufziehen + Text ersetzen → Speichern → alter Text weg, neuer Text da, keine Konsolenfehler.
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, json, base64, re, subprocess, traceback, tempfile
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(SUITES, 'purge')
OUT = os.path.join(SUITES, 'out_cover_purge')
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


PURGE = """async ([b64, words, color]) => {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const { loadPdf } = await import('./js/pdfcore.js'); const { pdf } = await loadPdf(bin.slice());
  const T = await import('./js/tools/textgeom.js');
  const page = await pdf.getPage(1); const base = page.getViewport({ scale: 1 });
  const pt = await T.pageChars(page, base);
  const rects = [];
  for (const w of words) for (const hit of T.findInPage(pt, w, { caseSensitive: true })) for (const b of T.boxesFor(pt.chars, hit.i, hit.j)) {
    const a = base.convertToPdfPoint(b.x0 - 0.5, b.y0 - 0.5), c = base.convertToPdfPoint(b.x1 + 0.5, b.y1 + 0.5);
    rects.push({ x0: Math.min(a[0], c[0]), y0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), y1: Math.max(a[1], c[1]) });
  }
  const L = await import('./js/pdflib.js'); const PDFLib = await L.loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(bin);
  const P = await import('./js/tools/purge.js');
  const r = await P.purgePage(PDFLib, doc, doc.getPages()[0], rects);
  for (const q of rects) doc.getPages()[0].drawRectangle({ x: q.x0, y: q.y0, width: q.x1 - q.x0, height: q.y1 - q.y0, color: PDFLib.rgb(1, 1, 1) });
  await doc.flush(); (await import('./js/tools/redact.js')).collectGarbage(PDFLib, doc.context);
  const out = await doc.save();
  let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return { b64: btoa(s), rects: rects.length, removed: r.removed, raster: r.raster }; }"""

MAKE_TYPE0 = """async () => {
  const L = await import('./js/pdflib.js'); const PDFLib = await L.loadPdfLib();
  const doc = await PDFLib.PDFDocument.create(); const p = doc.addPage([595, 842]);
  const U = await import('./js/office/unifont.js'); const f = await U.uniFont(doc, { PDFLib });
  p.drawText('Zażółć gęślą: TYPNULLGEHEIM und der Rest der Zeile', { x: 60, y: 700, size: 13, font: f });
  const out = await doc.save(); let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000)); return btoa(s); }"""

MAKE_SCAN = """async () => {
  // a "scan": picture of text + invisible OCR text (render mode 3), like FaLe's searchable PDFs
  const L = await import('./js/pdflib.js'); const PDFLib = await L.loadPdfLib();
  const doc = await PDFLib.PDFDocument.create(); const p = doc.addPage([595, 842]);
  const c = document.createElement('canvas'); c.width = 1190; c.height = 200; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1190, 200); g.fillStyle = '#000'; g.font = '40px sans-serif'; g.fillText('IBAN: SCANGEHEIM12', 100, 110);
  const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
  p.drawImage(img, { x: 0, y: 700, width: 595, height: 100 });
  const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  p.pushOperators(PDFLib.pushGraphicsState(), PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible));
  p.drawText('IBAN: SCANGEHEIM12', { x: 50, y: 745, size: 20, font: f });
  p.pushOperators(PDFLib.popGraphicsState());
  const out = await doc.save(); let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000)); return btoa(s); }"""


def words_bbox(path):
    bb = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '1', path, '-'], capture_output=True, text=True).stdout
    return [(m.group(5), round(float(m.group(1)), 1), round(float(m.group(2)), 1)) for m in re.finditer(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)</word>', bb)]


def raw_has(path, needle):
    q = path + '.qdf'
    subprocess.run(['qpdf', '--qdf', '--object-streams=disable', '--decode-level=all', path, q], capture_output=True)
    data = open(q, 'rb').read() if os.path.exists(q) else open(path, 'rb').read()
    return needle.encode('latin1') in data


def case(page, name, src_b64, secrets, keep, expect_raster=False):
    r = page.evaluate(PURGE, [src_b64, secrets, None])
    src = os.path.join(OUT, f'{name}_src.pdf'); open(src, 'wb').write(base64.b64decode(src_b64))
    out = os.path.join(OUT, f'{name}_out.pdf'); open(out, 'wb').write(base64.b64decode(r['b64']))
    txt = subprocess.run(['pdftotext', out, '-'], capture_output=True, text=True).stdout
    check(f'{name}: covered area found', r['rects'] >= len(secrets), r)
    if expect_raster:
        check(f'{name}: page with a picture under the cover → rebuild as image requested', r['raster'], r)
        return
    check(f'{name}: secret text no longer in the text ({r["removed"]} glyphs removed)', not any(s in txt for s in secrets) and r['removed'] > 0 and not r['raster'], (txt[:200], r))
    check(f'{name}: secret not in the raw file', not any(raw_has(out, s) for s in secrets))
    before = {w: (x, y) for w, x, y in words_bbox(src)}
    after = {w: (x, y) for w, x, y in words_bbox(out)}
    moved = {w: (before.get(w), after.get(w)) for w in keep if w not in after or w not in before or abs(after[w][0] - before[w][0]) > 0.6 or abs(after[w][1] - before[w][1]) > 0.6}
    check(f'{name}: rest of the line kept at the same place', not moved, moved)
    check(f'{name}: qpdf --check', subprocess.run(['qpdf', '--check', out], capture_output=True).returncode == 0)


def run(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='de-DE')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'[pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    b = lambda f: base64.b64encode(open(os.path.join(D, f), 'rb').read()).decode()

    step('ReportLab standard font', lambda: case(page, 'rl_std', b('rl_std.pdf'), ['GEHEIM4711', 'STRENGGEHEIM'], ['Kontonummer:', 'bitte', 'weitergeben,', 'bleibt', 'Zweite', 'Fett:', 'steht', 'hier']))
    step('ReportLab TrueType + form XObject', lambda: case(page, 'rl_ttf', b('rl_ttf.pdf'), ['GEHEIM4711', 'FORMGEHEIM'], ['und', 'weiter', 'Text', 'Formular:', 'bleibt', 'nicht']))
    step('ReportLab picture', lambda: case(page, 'rl_img', b('rl_img.pdf'), ['BILDGEHEIM'], [], expect_raster=False))
    step('LibreOffice (subset font, kerning)', lambda: case(page, 'lo', b('lo.pdf'), ['LOGEHEIM99'], ['Kundennummer', 'ist', 'vertraulich.', 'Sehr', 'AVAVAV', 'WAVE']))
    step('pdf-lib Type0 Identity-H', lambda: case(page, 'type0', page.evaluate(MAKE_TYPE0), ['TYPNULLGEHEIM'], ['und', 'der', 'Rest', 'Zeile']))
    step('scan with invisible OCR text', lambda: case(page, 'scan', page.evaluate(MAKE_SCAN), ['SCANGEHEIM12'], [], expect_raster=True))

    def ui():
        # PDF bearbeiten: cover a word + replace another → save
        data = b('rl_std.pdf')
        did = page.evaluate("""async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
          return (await lib.importPdf(bin, { name: 'Konto.pdf', source: 'Test', silent: true })).id; }""", data)
        page.evaluate(f"location.hash = '#/werkzeug/bearbeiten?doc={did}'")
        page.wait_for_selector('.pt-page canvas', timeout=20000)
        page.wait_for_timeout(1200)
        hint = page.locator('[data-mode="cover"], .pt-tool', has_text='Abdecken').first
        hint.click()
        page.wait_for_timeout(300)
        # word positions from pdf.js in screen coordinates
        box = page.evaluate("""async () => { const el = document.querySelector('.pt-page'); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }""")
        sc = box['w'] / 595.28
        # GEHEIM4711 on line 1 (x≈150…235 pt, baseline y = 742 from bottom → top ≈ 90 pt)
        x0, x1 = box['x'] + 150 * sc, box['x'] + 238 * sc
        y0, y1 = box['y'] + 88 * sc, box['y'] + 104 * sc
        check('UI: hint says the content under the area is deleted', 'gelöscht' in page.locator('#tool-screen').inner_text())
        page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=4); page.mouse.move(x1, y1, steps=4); page.mouse.up()
        page.wait_for_timeout(400)
        page.locator('#tool-screen .screen-foot .btn-primary', has_text='Speichern').click()
        page.wait_for_selector('.result-card', timeout=30000)
        page.wait_for_timeout(500)
        f = page.evaluate("async () => (await (await import('./js/db.js')).listFiles()).filter(x => x.name === 'Konto (bearbeitet).pdf').map(x => x.id)")
        check('UI: saved „Konto (bearbeitet).pdf“', len(f) == 1, f)
        if f:
            b64 = page.evaluate("""async (id) => { const db = await import('./js/db.js'); const bl = await db.getFile(id); return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(bl); }); }""", f[0])
            path = os.path.join(OUT, 'ui_out.pdf'); open(path, 'wb').write(base64.b64decode(b64))
            txt = subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout
            check('UI: covered word gone, rest of the line still text', 'GEHEIM4711' not in txt and 'Kontonummer:' in txt and 'weitergeben' in txt and not raw_has(path, 'GEHEIM4711'), txt[:200])
    step('UI', ui)
    browser.close()


if __name__ == '__main__':
    if not os.path.exists(os.path.join(D, 'lo.pdf')):
        subprocess.run([sys.executable, os.path.join(D, 'gen.py')], check=True)
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:400])
    sys.exit(1 if bad else 0)

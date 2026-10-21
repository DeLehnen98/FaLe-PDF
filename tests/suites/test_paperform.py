"""„Papierformular automatisch ausfüllbar“ – Ausfüllen & unterschreiben → „Felder finden“.
Test forms: tests/suites/paperform/gen_forms.py (flat born-digital form, the same form as crooked noisy scan, a letter),
gen_photo.py (a Vollmacht photographed with a phone: perspective, tilt, uneven warm light, dark table).
- detection (in the app, offline): every expected field found with the right type, name and place – flat form 14/14,
  scan (OCR on the device) ≥ 13/14, at most one extra field; the letter gets no fields; empty page and a huge page are fine
- pure helpers: crooked scans are straightened (skew found), OCR mistakes in labels corrected („Or“ → „Ort“)
- flow: PDF without fields → offer card → „Felder finden“ (progress in the card, page stays responsive) → new file
  „… (ausfüllbar).pdf“ opens with the field list, profile values filled in (Name = family name next to „Vorname“,
  „Ort, Datum“ = place + today), the original stays unchanged; „Speichern“ writes the values onto the right spots
- cancel during the search: nothing is created; letter: friendly „nothing found“ note, the card goes away, no new file
- phone 360 px: card fits, big buttons; no console errors
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, json, base64, re, subprocess, time, traceback, datetime
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'paperform')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_paperform')
os.makedirs(OUT, exist_ok=True)
TRUTH = json.load(open(os.path.join(D, 'truth.json'), encoding='utf-8'))['fields']
TODAY = datetime.date.today().strftime('%d.%m.%Y')
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


def attach(page, label):
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


DETECT = """async ([data, opts]) => { const bin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const { loadPdf } = await import('./js/pdfcore.js'); const { pdf } = await loadPdf(bin);
  const P = await import('./js/tools/paperform.js'); const t0 = performance.now();
  const r = await P.detectPaperFields(pdf, opts || {});
  return { ms: performance.now() - t0, ocrUsed: r.ocrUsed, fields: r.fields.map(f => ({ name: f.name, type: f.type, x: f.x, y: f.y, w: f.w, h: f.h, page: f.page })) }; }"""
IMPORT = """async ([data, name]) => { const bin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const lib = await import('./js/library.js'); const meta = await lib.importPdf(bin, { name, source: 'Test', silent: true }); return meta.id; }"""
BLOB = """async (id) => { const db = await import('./js/db.js'); const b = await db.getFile(id); if (!b) return null;
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }); }"""
FILES = "async () => (await (await import('./js/db.js')).listFiles()).map(f => ({ id: f.id, name: f.name }))"
norm = lambda s: re.sub(r'[^a-z0-9äöüß]+', ' ', (s or '').lower()).strip()


def score(fields):
    """→ (matched names, missing truth names, extra detected fields)"""
    used, matched, missing = set(), [], []
    for t in TRUTH:
        x0, y0, x1, y1 = t['box']
        hit = None
        for i, f in enumerate(fields):
            if i in used:
                continue
            cx, cy = f['x'] + f['w'] / 2, f['y'] + f['h'] / 2
            ttype = {'date': ('date', 'text')}.get(t['type'], (t['type'],))
            if x0 - 5 <= cx <= x1 + 5 and y0 - 5 <= cy <= y1 + 5 and f['type'] in ttype and norm(f['name']) == norm(t['name']):
                hit = i
                break
        if hit is None:
            missing.append(t['name'])
        else:
            used.add(hit); matched.append(t['name'])
    extra = [f for i, f in enumerate(fields) if i not in used]
    return matched, missing, extra


def run(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='de-DE', accept_downloads=True)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    attach(page, 'desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    page.evaluate("""async () => { const P = await import('./js/extras/profile.js'); await P.setProfile({ vorname: 'Erika', nachname: 'Musterfrau', strasse: 'Lindenweg', hausnummer: '7', plz: '66111', ort: 'Saarbrücken', telefon: '0681 123456', geburtsdatum: '1990-05-17' }); }""")

    def pure():
        r = page.evaluate("""async () => { const S = await import('./js/tools/paperscan.js');
          // synthetic page: two boxes and a line, drawn 1.2° crooked
          const c = document.createElement('canvas'); c.width = 1000; c.height = 700; const g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, 1000, 700); g.translate(500, 350); g.rotate(1.2 * Math.PI / 180); g.translate(-500, -350);
          g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(100, 100, 800, 80); g.strokeRect(100, 300, 24, 24); g.beginPath(); g.moveTo(100, 550); g.lineTo(700, 550); g.stroke();
          const d = g.getImageData(0, 0, 1000, 700).data; const m = S.inkMask(d, 1000, 700);
          const blank = S.inkMask(new Uint8ClampedArray(400 * 300 * 4).fill(255), 400, 300);
          return { skew: S.estimateSkew(m, 1000, 700), blankSkew: S.estimateSkew(blank, 400, 300), blankShapes: S.findShapes(blank, 400, 300, 2),
                   fix: ['Or', 'Vomame', 'Unterschnft', 'Hallo', 'PLZ'].map(S.fixLabel), od: ['Or, Datum', 'Qrt Datum', 'Das Datum', 'Ihr Datum'].map(S.fixLabel) }; }""")
        check('skew of a crooked page found (1.2° ± 0.25)', abs(abs(r['skew']) - 1.2) <= 0.25, r['skew'])
        check('blank page: no skew, no shapes', r['blankSkew'] == 0 and not any(r['blankShapes'][k] for k in ('lines', 'cells', 'checks')), r)
        check('OCR label correction', r['fix'] == ['Ort', 'Vorname', 'Unterschrift', 'Hallo', 'PLZ'], r['fix'])
        check('„Ort, Datum“ misread is fixed, „Das Datum“ stays', r['od'] == ['Ort, Datum', 'Ort, Datum', 'Das Datum', 'Ihr Datum'], r['od'])
        # a photo: level text lines, but the edge of the sheet, a dark table and a fold run at 6° – the text decides
        r2 = page.evaluate("""async () => { const S = await import('./js/tools/paperscan.js');
          const c = document.createElement('canvas'); c.width = 1100; c.height = 1500; const g = c.getContext('2d');
          g.fillStyle = '#cdbfb6'; g.fillRect(0, 0, 1100, 1500);
          g.fillStyle = '#2a2420'; g.beginPath(); g.moveTo(0, 0); g.lineTo(1100, 0); g.lineTo(1100, 40); g.lineTo(0, 155); g.closePath(); g.fill();
          g.fillStyle = '#e3c22a'; g.beginPath(); g.moveTo(980, 0); g.lineTo(1100, 0); g.lineTo(1100, 1500); g.lineTo(1050, 1500); g.closePath(); g.fill();
          g.fillStyle = 'rgba(60,40,50,0.35)'; g.beginPath(); g.moveTo(0, 820); g.lineTo(1100, 705); g.lineTo(1100, 1500); g.lineTo(0, 1500); g.closePath(); g.fill();
          g.fillStyle = '#1b1715'; g.font = '26px Helvetica, Arial, sans-serif';
          for (let i = 0; i < 14; i++) g.fillText('Hiermit bevollmächtige ich meinen Sohn, mich gegenüber der Versicherung zu vertreten', 90, 260 + i * 42);
          const d = g.getImageData(0, 0, 1100, 1500).data;
          return S.estimateSkew(S.inkMask(d, 1100, 1500), 1100, 1500, { maxDeg: 8, step: 0.2 }); }""")
        check('photo: skew from the text lines, not from the sheet edge / table / fold at 6° (|skew| < 0.4)', abs(r2) < 0.4, r2)
    step('pure helpers', pure)

    def detection():
        r = page.evaluate(DETECT, [b64(os.path.join(D, 'flat_form.pdf')), {}])
        m, miss, extra = score(r['fields'])
        check(f'flat form: all 14 fields found with type, name and place ({len(m)}/14)', not miss, miss)
        check('flat form: no extra fields', not extra, extra)
        check('flat form: fast (< 3 s), no OCR needed', r['ms'] < 3000 and not r['ocrUsed'], r['ms'])
        r = page.evaluate(DETECT, [b64(os.path.join(D, 'scan_form.pdf')), {}])
        m, miss, extra = score(r['fields'])
        check(f'scan: ≥ 13 of 14 fields incl. labels read by OCR ({len(m)}/14)', len(m) >= 13 and r['ocrUsed'], (miss, r['ocrUsed']))
        check('scan: at most one extra field', len(extra) <= 1, extra)
        check('scan: done in < 25 s', r['ms'] < 25000, r['ms'])
        # a phone photo: perspective, ~2.5° tilt, lamp spot and shadow, warm light, blur, dark table at the edge
        if not os.path.exists(os.path.join(D, 'photo_form.pdf')):
            subprocess.run([sys.executable, os.path.join(D, 'gen_photo.py')], check=True)
        pt = json.load(open(os.path.join(D, 'photo_truth.json'), encoding='utf-8'))['lines']
        r = page.evaluate(DETECT, [b64(os.path.join(D, 'photo_form.pdf')), {}])
        got = {norm(f['name']).split(' ')[0]: f for f in r['fields']}
        ok = []
        for t in pt:
            f = got.get(norm(t['name']).split(' ')[0])
            x0, y0, x1, y1 = t['line']
            if f and abs(f['x'] - x0) < 15 and abs((f['y'] + f['h']) - min(y0, y1)) < 8 and abs(f['x'] + f['w'] - x1) < 15:
                ok.append(t['name'])
        check(f'photo: the four write-on lines found with their labels ({len(ok)}/4)', len(ok) == 4, [(f['name'], round(f['x']), round(f['y'] + f['h'])) for f in r['fields']])
        check('photo: no fields from rows of bold text or letters', len(r['fields']) == 4, [f['name'] for f in r['fields']])
        check('photo: signature line is a signature field, date line a text field', any(f['type'] == 'sign' for f in r['fields']) and any(f['name'] == 'Ort, Datum' for f in r['fields']))
        r = page.evaluate(DETECT, [b64(os.path.join(D, 'letter.pdf')), {}])
        check('letter: no fields', len(r['fields']) == 0, r['fields'])
        r = page.evaluate("""async () => { const PDFLib = await (await import('./js/pdflib.js')).loadPdfLib(); const d = await PDFLib.PDFDocument.create();
          d.addPage([595, 842]); d.addPage([2384, 3370]); const bytes = await d.save();
          const { loadPdf } = await import('./js/pdfcore.js'); const { pdf } = await loadPdf(bytes);
          const t0 = performance.now(); const r = await (await import('./js/tools/paperform.js')).detectPaperFields(pdf, {}); return { n: r.fields.length, ms: performance.now() - t0 }; }""")
        check('empty page + huge A0 page: no fields, no hang (< 5 s)', r['n'] == 0 and r['ms'] < 5000, r)
    step('detection', detection)

    def flow():
        did = page.evaluate(IMPORT, [b64(os.path.join(D, 'scan_form.pdf')), 'Antrag Parkausweis.pdf'])
        orig = page.evaluate(BLOB, did)
        page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={did}'")
        page.wait_for_selector('.pf-offer', timeout=20000)
        txt = page.locator('.pf-offer').inner_text()
        check('offer card on a PDF without fields', 'Papierformular' in txt and 'Felder finden' in txt and 'deine Daten gleich ein' in txt, txt)
        page.screenshot(path=os.path.join(OUT, 'offer.png'))
        page.locator('.pf-offer [data-pf]').click()
        # page stays responsive while the form is analysed
        worst, busy_seen = 0, False
        t_end = time.time() + 60
        while time.time() < t_end and '#/werkzeug/unterschreiben?doc=' + did in page.evaluate('location.hash'):
            t = time.time()
            page.evaluate('new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))')
            worst = max(worst, time.time() - t)
            busy_seen = busy_seen or page.locator('.pf-offer.busy').count() > 0
            page.wait_for_timeout(150)
        check('progress shown in the card while searching', busy_seen)
        check('no freeze while searching (longest UI pause < 1.5 s)', worst < 1.5, f'{worst:.2f}s')
        page.wait_for_selector('.form-panel [data-fi]', timeout=30000)
        page.wait_for_timeout(800)
        files = page.evaluate(FILES)
        new = [f for f in files if f['name'] == 'Antrag Parkausweis (ausfüllbar).pdf']
        check('new file „… (ausfüllbar).pdf“ opened', len(new) == 1 and new[0]['id'] in page.evaluate('location.hash'), [f['name'] for f in files])
        check('link cleaned after opening (no second auto-fill on reload)', 'gefunden' not in page.evaluate('location.hash'), page.evaluate('location.hash'))
        check('original file unchanged', page.evaluate(BLOB, did) == orig)
        vals = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.form-panel label.field')].map(l => [l.querySelector('.field-label').textContent.trim(), (l.querySelector('input,select') || {}).value]))""")
        exp = {'Name': 'Musterfrau', 'Vorname': 'Erika', 'PLZ': '66111', 'Ort': 'Saarbrücken', 'Telefon': '0681 123456', 'Geburtsdatum': '17.05.1990',
               'Straße, Hausnummer': 'Lindenweg 7', 'Ort, Datum': f'Saarbrücken, {TODAY}'}
        wrong = {k: vals.get(k) for k, v in exp.items() if vals.get(k) != v}
        check('profile values filled in (Name = family name, Ort, Datum = place + today)', not wrong, (wrong, vals))
        check('Kennzeichen + Bemerkungen left empty', vals.get('Amtliches Kennzeichen') == '' and vals.get('Bemerkungen') == '', vals)
        check('3 checkboxes + signature field in the list', page.locator('.form-panel input[type=checkbox][data-fi]').count() == 3 and page.locator('.form-panel [data-sigfield]').count() == 1)
        check('toast tells how many were found/filled', page.locator('.toast', has_text='Felder gefunden').count() >= 1)
        page.screenshot(path=os.path.join(OUT, 'filled.png'))
        page.locator('.form-panel label.field', has_text='Amtliches Kennzeichen').locator('input').fill('SB-FL 123')
        page.locator('.form-panel label.check', has_text='Firmenwagen').locator('input').check()
        page.wait_for_timeout(300)
        page.locator('[data-save]').click()
        page.wait_for_selector('.result-card', timeout=30000)
        page.wait_for_timeout(500)
        out = [f for f in page.evaluate(FILES) if f['name'] == 'Antrag Parkausweis (ausfüllbar) (ausgefüllt).pdf']
        check('saved as „… (ausgefüllt).pdf“', len(out) == 1, [f['name'] for f in page.evaluate(FILES)])
        if out:
            path = os.path.join(OUT, 'ausgefuellt.pdf')
            open(path, 'wb').write(base64.b64decode(page.evaluate(BLOB, out[0]['id'])))
            bb = subprocess.run(['pdftotext', '-bbox', path, '-'], capture_output=True, text=True).stdout
            words = {m.group(5): (float(m.group(1)), float(m.group(2))) for m in re.finditer(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)</word>', bb)}
            box = {t['name']: t['box'] for t in TRUTH}
            inside = lambda w, n: w in words and box[n][0] - 4 <= words[w][0] <= box[n][2] and box[n][1] - 8 <= words[w][1] <= box[n][3]
            check('PDF: Musterfrau in the Name box, Erika in Vorname, 66111 in PLZ', inside('Musterfrau', 'Name') and inside('Erika', 'Vorname') and inside('66111', 'PLZ'), {k: words.get(k) for k in ['Musterfrau', 'Erika', 'SB-FL']})
            check('PDF: Kennzeichen on its line, place + date in „Ort, Datum“', inside('SB-FL', 'Amtliches Kennzeichen') and inside(TODAY, 'Ort, Datum'), {k: words.get(k) for k in ['SB-FL', TODAY]})
            import pypdf
            check('PDF: fields fixed (flattened) by default', not pypdf.PdfReader(path).get_fields())
    step('flow scan → fillable → filled', flow)

    def cancel_and_letter():
        did = page.evaluate(IMPORT, [b64(os.path.join(D, 'scan_form.pdf')), 'Abbruch.pdf'])
        before = len(page.evaluate(FILES))
        page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={did}'")
        page.wait_for_selector('.pf-offer', timeout=20000)
        page.locator('.pf-offer [data-pf]').click()
        page.wait_for_selector('.pf-offer.busy', timeout=5000)
        page.wait_for_timeout(600)
        page.locator('.pf-offer [data-pf]').click()  # „Abbrechen“
        for _ in range(60):
            if page.locator('.pf-offer.busy').count() == 0:
                break
            page.wait_for_timeout(250)
        page.wait_for_timeout(800)
        check('cancel: card back to idle, no new file, still on the same document', page.locator('.pf-offer.busy').count() == 0 and len(page.evaluate(FILES)) == before and did in page.evaluate('location.hash'))
        lid = page.evaluate(IMPORT, [b64(os.path.join(D, 'letter.pdf')), 'Brief.pdf'])
        before = len(page.evaluate(FILES))
        page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={lid}'")
        page.wait_for_selector('.pf-offer', timeout=20000)
        page.locator('.pf-offer [data-pf]').click()
        ok = False
        for _ in range(80):
            if page.locator('#toasts .toast', has_text='Keine Linien').count():
                ok = True; break
            page.wait_for_timeout(250)
        check('letter: friendly „nothing found“ note, no new file', ok and len(page.evaluate(FILES)) == before)
        check('letter: the offer card goes away (no clutter above the page)', page.locator('.pf-offer').count() == 0)
    step('cancel + letter', cancel_and_letter)
    ctx.close()

    ctx = browser.new_context(viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True, locale='de-DE')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-simple', '1'); } catch (e) {}")
    page = ctx.new_page()
    attach(page, 'phone')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)

    def phone():
        did = page.evaluate(IMPORT, [b64(os.path.join(D, 'flat_form.pdf')), 'Formular.pdf'])
        page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={did}'")
        page.wait_for_selector('.pf-offer', timeout=20000)
        page.wait_for_timeout(600)
        over = page.evaluate('document.documentElement.scrollWidth')
        bb = page.locator('.pf-offer').bounding_box()
        btn = page.locator('.pf-offer [data-pf]').bounding_box()
        check('phone: card fits, no horizontal scroll', over <= 361 and bb['x'] >= 0 and bb['x'] + bb['width'] <= 361, (over, bb))
        check('phone: big „Felder finden“ button (≥ 44 px)', btn['height'] >= 44, btn)
        page.screenshot(path=os.path.join(OUT, 'phone_offer.png'))
        page.locator('.pf-offer [data-pf]').click()
        page.wait_for_selector('.form-panel [data-fi]', timeout=30000)
        page.wait_for_timeout(800)
        check('phone: field list opens with the found fields', page.locator('.form-panel.open').count() == 1 and page.locator('.form-panel [data-fi]').count() >= 10)
        page.screenshot(path=os.path.join(OUT, 'phone_fields.png'))
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
        print('  FAIL', r[0], r[2][:400])
    sys.exit(1 if bad else 0)

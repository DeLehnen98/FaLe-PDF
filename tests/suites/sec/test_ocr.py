"""E2E tests for the offline OCR features of FaLe PDF.
Builds dist (vercel-build), serves a COPY from this scratchpad on 127.0.0.1:8797.
Run: python3 test_ocr.py [all|build|engine|tools|integr|offline|shots][:step1,step2] [--nobuild]
"""
import os, sys, json, re, io, shutil, subprocess, socket, time, zipfile, difflib, traceback, base64
from PIL import Image, ImageFont
import csp_compat  # noqa: F401 – CSP-safe wait_for_function
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SP, 'ocrdata')
OUT = os.path.join(SP, 'out_ocr')
DIST = os.path.join(SP, 'dist_ocr')
APP = '/home/claude/FalePDF'
PORT = 9407
URL = f'http://127.0.0.1:{PORT}/app/'  # the app lives under /app/ (the start page is at /)
os.makedirs(OUT, exist_ok=True)
TRUTH = json.load(open(os.path.join(TD, 'truth.json')))
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
ONLY = ARGS[0] if ARGS else 'all'
STEPS = set(ONLY.split(':', 1)[1].split(',')) if ':' in ONLY else None
ONLY = ONLY.split(':', 1)[0]
results, console, external = [], [], []
CUR = {'page': None}
for f in os.listdir(OUT):
    if f.startswith('t_') or f.startswith('fail_'):
        os.remove(os.path.join(OUT, f))


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    if STEPS and name not in STEPS:
        return
    t = time.time()
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
    print(f'   ({name}: {time.time() - t:.1f}s)', flush=True)


# ------------------------------------------------------------------ build + server
def build():
    env = dict(os.environ, FALE_NODE_MODULES='/opt/npm-tools/node_modules')
    r = subprocess.run(['node', 'scripts/vercel-build.mjs'], cwd=APP, env=env, capture_output=True, text=True)
    print(r.stdout.strip(), r.stderr.strip()[:500])
    assert r.returncode == 0, 'build failed'
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    shutil.copytree(os.path.join(APP, 'dist'), DIST)


def stop_server():
    out = subprocess.run(['pgrep', '-f', f'csp_server.mjs {PORT} '], capture_output=True, text=True).stdout.split()
    for pid in out:
        try:
            os.kill(int(pid), 15)
        except Exception:
            pass
    time.sleep(0.4)


def start_server():
    stop_server()
    subprocess.Popen(['node', os.path.join(SP, 'csp_server.mjs'), str(PORT), DIST], cwd=DIST, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        s = socket.socket()
        try:
            s.connect(('127.0.0.1', PORT)); s.close(); return
        except OSError:
            time.sleep(0.2)


# ------------------------------------------------------------------ browser helpers
INIT = "try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}"


def new_ctx(browser, phone=False, dark=False, sw=False):
    kw = dict(accept_downloads=True, locale='de-DE', color_scheme='dark' if dark else 'light', service_workers='allow' if sw else 'block')
    if phone:
        kw.update(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        kw.update(viewport={'width': 1366, 'height': 860})
    ctx = browser.new_context(**kw)
    ctx.add_init_script(INIT)

    def route(r):
        u = r.request.url
        if u.startswith(f'http://127.0.0.1:{PORT}') or u.startswith('data:') or u.startswith('blob:'):
            return r.continue_()
        external.append(u)
        return r.abort()
    ctx.route('**/*', route)
    return ctx


def attach(pg, label):
    pg.on('console', lambda m: console.append(f'{label} [{m.type}] {m.text[:300]}') if m.type in ('error',) else None)
    pg.on('pageerror', lambda e: console.append(f'{label} [pageerror] {e}'))
    pg.on('request', lambda r: external.append(r.url) if not (r.url.startswith(f'http://127.0.0.1:{PORT}') or r.url.startswith('data:') or r.url.startswith('blob:')) else None)


def goto(pg, h, wait=None, timeout=20000):
    pg.evaluate(f"location.hash = {json.dumps(h)}")
    if wait:
        pg.wait_for_selector(wait, timeout=timeout)
    pg.wait_for_timeout(250)


DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, pages: d.pages, kind: d.kind}))); });
  db.close(); return res; }"""
FILE_JS = """async id => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const rec = await new Promise(r => { const t = db.transaction('files'); const g = t.objectStore('files').get(id); g.onsuccess = () => r(g.result); });
  db.close(); const u = new Uint8Array(await rec.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }"""


def docs(pg):
    return pg.evaluate(DOCS_JS)


def doc_by_name(pg, name):
    for d in docs(pg):
        if d['name'] == name:
            return d
    return None


def save_doc(pg, name, out):
    d = doc_by_name(pg, name)
    assert d, 'doc missing: ' + name
    b = base64.b64decode(pg.evaluate(FILE_JS, d['id']))
    path = os.path.join(OUT, 't_' + out)
    open(path, 'wb').write(b)
    return path


def import_pdfs(pg, names):
    pg.set_input_files('#pdf-input', [os.path.join(TD, n) for n in names])
    for _ in range(160):
        have = {d['name'] for d in docs(pg)}
        if all(n in have for n in names):
            break
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(600)


def dl(pg, locator, name, timeout=60000):
    with pg.expect_download(timeout=timeout) as d:
        locator.click()
    path = os.path.join(OUT, 't_' + name)
    d.value.save_as(path)
    return path


def pdftext(path, first=None, last=None):
    cmd = ['pdftotext', '-layout']
    if first:
        cmd += ['-f', str(first), '-l', str(last or first)]
    return subprocess.run(cmd + [path, '-'], capture_output=True, text=True).stdout


def pdf_word_boxes(path, page=1):
    html = subprocess.run(['pdftotext', '-bbox', '-f', str(page), '-l', str(page), path, '-'], capture_output=True, text=True).stdout
    m = re.search(r'<page width="([\d.]+)" height="([\d.]+)"', html)
    W, H = float(m.group(1)), float(m.group(2))
    words = [(w, float(a), float(b), float(c), float(d)) for a, b, c, d, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', html)]
    return W, H, words


def norm_words(t):
    return re.findall(r"[\wäöüÄÖÜß€%@.,:&+\-']+", t.replace('’', "'"))


def word_acc(truth, got):
    a = [w.strip('.,:') for w in norm_words(truth)]
    b = [w.strip('.,:') for w in norm_words(got)]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    same = sum(bl.size for bl in sm.get_matching_blocks())
    return same / max(1, len(a))


def ocr_eval(pg, name, extra='{}'):
    data = base64.b64encode(open(os.path.join(TD, name), 'rb').read()).decode()
    return pg.evaluate("""async ([d, n, extra]) => { const m = await import('./js/ocr/engine.js');
      const bin = Uint8Array.from(atob(d), c => c.charCodeAt(0)); const blob = new Blob([bin], {type: n.endsWith('png') ? 'image/png' : 'image/jpeg'});
      const t = performance.now(); const r = await m.recognize(blob, JSON.parse(extra));
      return { text: r.text, conf: r.conf, angle: r.angle, w: r.width, h: r.height, words: r.words.length, ms: performance.now() - t,
        lines: r.lines.map(l => ({ text: l.text, bbox: l.bbox, size: l.size })) }; }""", [data, name, extra])


def tool(pg, tid, wait='.screen-body', q=''):
    if pg.evaluate('location.hash') == f'#/werkzeug/{tid}{q}':
        goto(pg, '#/werkzeuge', '.tool-grid')
    goto(pg, f'#/werkzeug/{tid}{q}', wait)
    pg.wait_for_timeout(400)


def choose_files(pg, locator, files):
    with pg.expect_file_chooser() as fc:
        locator.click()
    fc.value.set_files([os.path.join(TD, f) for f in files])


def wait_panel_gone(pg, timeout=120000):
    pg.wait_for_timeout(300)
    pg.wait_for_function("!document.querySelector('.ocr-panel')", timeout=timeout)


def accept_ocr_notice(pg):
    # first use: consent dialog "Laden & starten"
    try:
        pg.wait_for_selector('dialog[open]', timeout=2500)
        btn = pg.locator('dialog[open] button', has_text='Laden & starten')
        if btn.count():
            btn.click()
    except Exception:
        pass


def word_box_truth(page_lines, word, line_idx, paste=(90, 200), margin=40, gap=1.55, img=(2480, 3508)):
    """Expected box (fractions of the page) of `word` in line `line_idx` of a generated scan page."""
    y = margin
    for i, (t, s, f) in enumerate(page_lines):
        if i == line_idx:
            font = ImageFont.truetype(f, s)
            k = t.index(word)
            x0 = margin + font.getlength(t[:k])
            x1 = x0 + font.getlength(word)
            bb = font.getbbox(t)
            return ((paste[0] + x0) / img[0], (paste[1] + y + bb[1]) / img[1], (paste[0] + x1) / img[0], (paste[1] + y + bb[3]) / img[1])
        y += int(s * gap)


F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FS = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
DE = [('Rechnung für März 2026', 56, FB), ('Sehr geehrte Frau Müller,', 40, F), ('vielen Dank für Ihre Bestellung. Die Lieferung erfolgt', 40, F),
      ('übermorgen durch unseren Spediteur. Bitte prüfen Sie', 40, F), ('die Größe der Pakete und bestätigen Sie den Empfang.', 40, F),
      ('Grüße aus Saarbrücken, Ihr Kundenservice', 34, FS), ('Straße: Hauptstraße 12, 66111 Saarbrücken', 30, F), ('Öffnungszeiten: Montag bis Freitag, 9 bis 18 Uhr', 30, F)]


# ======================================================================================= build checks
def build_checks():
    sw = open(os.path.join(DIST, 'sw.js')).read()
    m = re.search(r'const ASSETS = (\[[\s\S]*?\]);', sw)
    assets = json.loads(m.group(1))
    check('build: OCR files not in install precache', not any('tesseract' in a for a in assets), f'{len(assets)} assets')
    check('build: OCR files shipped in dist', os.path.exists(os.path.join(DIST, 'vendor/tesseract/lang/deu.traineddata.gz')) and os.path.exists(os.path.join(DIST, 'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js')))
    check('build: sw has OCR runtime cache', "OCR_CACHE = 'falepdf-ocr-v6'" in sw and "k !== OCR_CACHE" in sw)
    a = open(os.path.join(APP, 'js/ocr/assets.js')).read()
    check('build: cache names match', "OCR_CACHE = 'falepdf-ocr-v6'" in a)
    js = open(os.path.join(APP, 'js/ocr/engine.js')).read() + a
    check('build: no CDN in OCR code', 'jsdelivr' not in js and 'unpkg' not in js and 'https://' not in js)


# ======================================================================================= engine
def engine_tests(p):
    browser = p.chromium.launch()
    ctx = new_ctx(browser)
    pg = ctx.new_page()
    CUR['page'] = pg
    attach(pg, 'engine')
    pg.goto(URL)
    pg.wait_for_timeout(800)

    def accuracy():
        for name, key, minacc in [('clean_de.png', 'clean_de', 0.95), ('clean_en.png', 'clean_en', 0.95), ('photo_scan.jpg', 'photo_scan', 0.9), ('small.png', 'small', 0.9)]:
            r = ocr_eval(pg, name)
            acc = word_acc(TRUTH[key], r['text'])
            check(f'engine: word accuracy {name} ≥ {int(minacc * 100)} %', acc >= minacc, f'{acc:.3f}, conf {r["conf"]:.0f}, {r["ms"]:.0f} ms, angle {r["angle"]}')
            if name == 'photo_scan.jpg':
                check('engine: deskew estimate on rotated photo', -3.2 < r['angle'] < -2.0, f'angle {r["angle"]}')
                # boxes are mapped back to the (rotated) source: first line slopes upwards
                l0 = r['lines'][0]['bbox']
                check('engine: boxes in source coordinates', 200 < l0['x0'] < 300 and 250 < l0['y0'] < 360 and r['w'] == 2090, json.dumps(l0))
        # language only English
        r = ocr_eval(pg, 'clean_en.png', '{"lang":"eng","psm":"block"}')
        check('engine: lang eng + psm block', word_acc(TRUTH['clean_en'], r['text']) >= 0.95)
        r = ocr_eval(pg, 'card_de.jpg', '{"psm":"sparse"}')
        check('engine: psm sparse works', 'Schäfer' in r['text'] or 'Schafer' in r['text'], r['text'][:80])

    def api_shapes():
        res = pg.evaluate("""async () => { const m = await import('./js/ocr/engine.js');
          const c = document.createElement('canvas'); c.width = 900; c.height = 200; const g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 200); g.fillStyle = '#000'; g.font = '48px sans-serif'; g.fillText('Hallo Welt 2026', 40, 120);
          const a = await m.recognize(c);
          const id = g.getImageData(0, 0, 900, 200); const b = await m.recognize(id);
          const bmp = await createImageBitmap(c); const d = await m.recognize(bmp);
          const w = a.words[0];
          return { a: a.text, b: b.text, d: d.text, keys: Object.keys(a), w: w && Object.keys(w), bbox: w && w.bbox, lines: a.lines.length && Object.keys(a.lines[0]) }; }""")
        check('engine: canvas / ImageData / ImageBitmap inputs', all('Hallo Welt' in res[k] for k in 'abd'), json.dumps({k: res[k] for k in 'abd'}, ensure_ascii=False))
        check('engine: result shape', {'text', 'lines', 'words', 'width', 'height'} <= set(res['keys']) and {'text', 'bbox', 'conf'} <= set(res['w']) and {'text', 'bbox', 'conf'} <= set(res['lines']), json.dumps(res['bbox']))

    def pdf_pages():
        data = base64.b64encode(open(os.path.join(TD, 'mixed.pdf'), 'rb').read()).decode()
        r = pg.evaluate("""async d => { const m = await import('./js/ocr/engine.js'); const bin = Uint8Array.from(atob(d), c => c.charCodeAt(0));
          const ev = []; const res = await m.ocrPdfPages(bin, { skipText: true, onProgress: p => ev.push(p.phase) });
          return res.map(x => ({ page: x.page, skipped: x.skipped, text: x.text.slice(0, 80), words: x.words.length, w: x.width, scale: x.scale })).concat([{ ev: [...new Set(ev)] }]); }""", data)
        check('engine: ocrPdfPages skips text pages, OCRs image pages', r[0]['skipped'] and not r[1]['skipped'] and 'Quarterly' in r[1]['text'], json.dumps(r, ensure_ascii=False)[:300])
        check('engine: ocrPdfPages progress phases', 'recognize' in r[2]['ev'] or 'done' in r[2]['ev'], str(r[2]))

    def cancel_and_pool():
        r = pg.evaluate("""async () => { const m = await import('./js/ocr/engine.js');
          const c = document.createElement('canvas'); c.width = 2400; c.height = 3000; const g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000'; g.font = '30px serif';
          for (let i = 0; i < 70; i++) g.fillText('Zeile ' + i + ' mit etwas Text zum Erkennen und Abbrechen', 60, 60 + i * 40);
          const ac = new AbortController(); const p = m.recognize(c, { signal: ac.signal }); setTimeout(() => ac.abort(), 300);
          let aborted = false; try { await p; } catch (e) { aborted = e.name === 'AbortError'; }
          const again = await m.recognize(document.createElement('canvas').getContext ? (() => { const k = document.createElement('canvas'); k.width = 600; k.height = 120; const q = k.getContext('2d'); q.fillStyle = '#fff'; q.fillRect(0,0,600,120); q.fillStyle = '#000'; q.font = '40px sans-serif'; q.fillText('Weiter geht es', 20, 80); return k; })() : null);
          const par = await Promise.all([1, 2, 3].map(i => { const k = document.createElement('canvas'); k.width = 600; k.height = 120; const q = k.getContext('2d'); q.fillStyle = '#fff'; q.fillRect(0,0,600,120); q.fillStyle = '#000'; q.font = '40px sans-serif'; q.fillText('Parallel Nummer ' + i, 20, 80); return m.recognize(k); }));
          return { aborted, again: again.text, par: par.map(x => x.text.trim()), max: m.maxWorkers() }; }""")
        check('engine: cancel via AbortSignal', r['aborted'])
        check('engine: works again after cancel', 'Weiter geht es' in r['again'], r['again'])
        check('engine: parallel jobs (worker reuse)', all(f'Nummer {i}' in t for i, t in zip([1, 2, 3], r['par'])), f"{r['par']} max={r['max']}")

    def bizcard_parse():
        for n in ['card_de.jpg', 'card_en.jpg']:
            r = ocr_eval(pg, n)
            parsed = pg.evaluate("async lines => (await import('./js/ocr/bizcard-parse.js')).parseCard(lines)", [{'text': l['text'], 'size': l['size']} for l in r['lines']])
            t = TRUTH[n.split('.')[0]]
            got = dict(parsed)
            got['adresse'] = f"{parsed['strasse']}, {parsed['plz']} {parsed['ort']}" if n == 'card_de.jpg' else f"{parsed['strasse']}, {parsed['ort']} {parsed['plz']}"
            ok = [k for k in t if got.get(k, '').replace(' ', '').lower() == t[k].replace(' ', '').lower()]
            check(f'bizcard parse {n}: ≥ 7 of 8 fields exact', len(ok) >= 7, f'ok={ok} got={json.dumps({k: got.get(k) for k in t}, ensure_ascii=False)}')

    step('engine accuracy', accuracy)
    step('engine api', api_shapes)
    step('engine pdf pages', pdf_pages)
    step('engine cancel', cancel_and_pool)
    step('bizcard parse', bizcard_parse)
    browser.close()


# ======================================================================================= tools
def tools_tests(p):
    browser = p.chromium.launch()
    ctx = new_ctx(browser)
    pg = ctx.new_page()
    CUR['page'] = pg
    attach(pg, 'tools')
    pg.goto(URL)
    pg.wait_for_timeout(800)

    def listed():
        goto(pg, '#/werkzeuge', '.tool-grid')
        txt = pg.inner_text('#view-werkzeuge') if pg.locator('#view-werkzeuge').count() else pg.inner_text('body')
        for t in ['Text erkennen (OCR)', 'Durchsuchbares PDF', 'Bild zu Word', 'Bild zu Excel', 'Visitenkarte scannen']:
            check(f'tools list: {t}', t in txt)

    def text_tool():
        tool(pg, 'text-erkennen', '[data-pick]')
        choose_files(pg, pg.locator('[data-pick]'), ['clean_de.png', 'clean_en.png'])
        pg.wait_for_selector('.ocr-item >> nth=1')
        pg.locator('.screen-foot [data-go]').click()
        accept_ocr_notice(pg)
        pg.wait_for_selector('.ocr-panel', timeout=10000)
        pg.wait_for_selector('[data-text]', timeout=120000)
        texts = pg.eval_on_selector_all('[data-text]', 'els => els.map(e => e.value)')
        check('text tool: two results', len(texts) == 2)
        check('text tool: accuracy DE ≥ 95 %', word_acc(TRUTH['clean_de'], texts[0]) >= 0.95, f'{word_acc(TRUTH["clean_de"], texts[0]):.3f}')
        check('text tool: accuracy EN ≥ 95 %', word_acc(TRUTH['clean_en'], texts[1]) >= 0.95)
        # edit the text, then export
        pg.locator('[data-text]').first.fill(texts[0] + '\n\nZusatzzeile vom Nutzer')
        pg.locator('[data-save]').click()
        pg.locator('[role=menu] >> text=Textdatei').click()
        pg.wait_for_selector('[data-result] .result-card')
        p_txt = dl(pg, pg.locator('[data-result] [data-r="dl"]'), 'ocr.txt')
        t = open(p_txt, encoding='utf-8').read()
        check('text tool: .txt export incl. edits + umlauts', 'Zusatzzeile vom Nutzer' in t and 'Größe' in t and 'Quarterly' in t)
        pg.locator('[data-save]').click()
        pg.locator('[role=menu] >> text=Word – Absätze').click()
        pg.wait_for_function("document.querySelector('[data-result] .doc-name') && document.querySelector('[data-result] .doc-name').textContent.endsWith('.docx')", timeout=20000)
        p_docx = dl(pg, pg.locator('[data-result] [data-r="dl"]'), 'ocr.docx')
        import docx
        d = docx.Document(p_docx)
        paras = [x.text for x in d.paragraphs]
        joined = '\n'.join(paras)
        check('text tool: .docx valid with paragraphs', 'vielen Dank für Ihre Bestellung. Die Lieferung erfolgt übermorgen' in joined and len(paras) >= 6, f'{len(paras)} paras')
        pg.locator('[data-save]').click()
        pg.locator('[role=menu] >> text=Word – Zeilen').click()
        pg.wait_for_timeout(1500)
        p_docx2 = dl(pg, pg.locator('[data-result] [data-r="dl"]'), 'ocr_lines.docx')
        x = zipfile.ZipFile(p_docx2).read('word/document.xml').decode()
        check('text tool: .docx line mode keeps line breaks', x.count('<w:br/>') >= 3)
        # searchable PDF from the images
        pg.locator('[data-save]').click()
        pg.locator('[role=menu] >> text=Durchsuchbares PDF').click()
        pg.wait_for_selector('[data-result] .result-card [data-r="open"]', timeout=60000)
        path = save_doc(pg, 'clean_de (durchsuchbar).pdf', 'img_search.pdf')
        t = pdftext(path)
        check('text tool: searchable PDF from images', 'Spediteur' in t and 'Quarterly' in t, t[:120].replace('\n', ' | '))
        shot(pg, 'text_result_desktop')
        # copy
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        pg.locator('.screen-foot [data-copy]').click()
        pg.wait_for_timeout(300)
        clip = pg.evaluate('navigator.clipboard.readText()')
        check('text tool: copy to clipboard', 'Zusatzzeile' in clip and 'Quarterly' in clip)

    def text_tool_pdf():
        import_pdfs(pg, ['mixed.pdf'])
        d = doc_by_name(pg, 'mixed.pdf')
        tool(pg, 'text-erkennen', '[data-pick]', f'?doc={d["id"]}')
        pg.locator('.screen-foot [data-go]').click()
        accept_ocr_notice(pg)
        pg.wait_for_selector('[data-text]', timeout=120000)
        texts = pg.eval_on_selector_all('[data-text]', 'els => els.map(e => e.value)')
        heads = pg.eval_on_selector_all('.ocr-page-head', 'els => els.map(e => e.textContent)')
        check('text tool (PDF): text page taken from PDF, image page OCR', 'echte Textseite' in texts[0] and 'Quarterly' in texts[1] and 'aus der PDF' in heads[0], str(heads))

    def searchable_tool():
        import_pdfs(pg, ['scan3.pdf'])
        d = doc_by_name(pg, 'scan3.pdf')
        tool(pg, 'durchsuchbar', '[data-status]', f'?doc={d["id"]}')
        pg.wait_for_function("!document.querySelector('[data-status] .spinner')", timeout=20000)
        check('searchable tool: status shows pages without text', 'Alle 3 Seiten ohne Text' in pg.inner_text('[data-status]'))
        shot(pg, 'searchable_tool_desktop')
        pg.locator('.screen-foot [data-go]').click()
        accept_ocr_notice(pg)
        pg.wait_for_selector('.ocr-panel', timeout=10000)
        pg.wait_for_timeout(1200)
        info = pg.inner_text('.ocr-panel')
        check('searchable tool: progress shows page x of y', re.search(r'\d von 3', info) is not None, info.replace('\n', ' | '))
        shot(pg, 'progress_panel_desktop')
        pg.wait_for_selector('[data-result] .result-card', timeout=180000)
        path = save_doc(pg, 'scan3 (durchsuchbar).pdf', 'scan3_search.pdf')
        t = pdftext(path)
        acc = word_acc('\n'.join(TRUTH['scan_pages']), t)
        check('searchable: pdftotext word accuracy ≥ 95 %', acc >= 0.95, f'{acc:.3f}')
        # positions: word boxes vs. the generated image
        W, H, words = pdf_word_boxes(path, 1)
        errs = []
        for word, li in [('Spediteur.', 3), ('Rechnung', 0), ('Saarbrücken,', 5), ('Hauptstraße', 6), ('Montag', 7)]:
            exp = word_box_truth(DE, word.rstrip('.,'), li)
            cands = [w for w in words if w[0].rstrip('.,') == word.rstrip('.,')]
            if not cands:
                errs.append(f'{word} missing'); continue
            best = min(cands, key=lambda w: abs(w[2] / H - exp[1]))
            dx0 = abs(best[1] / W - exp[0]); dx1 = abs(best[3] / W - exp[2]); dy = abs((best[2] + best[4]) / 2 / H - (exp[1] + exp[3]) / 2)
            if max(dx0, dx1) > 0.012 or dy > 0.01:
                errs.append(f'{word}: dx0={dx0:.4f} dx1={dx1:.4f} dy={dy:.4f}')
        check('searchable: pdftotext word positions match the image', not errs, '; '.join(errs))
        # original page image untouched (same image XObject bytes), text render mode 3
        from pypdf import PdfReader
        a, b = PdfReader(os.path.join(TD, 'scan3.pdf')), PdfReader(path)
        same = all(list(a.pages[i]['/Resources']['/XObject'].values())[0].get_object().get_data() == list(b.pages[i]['/Resources']['/XObject'].values())[0].get_object().get_data() for i in range(3))
        check('searchable: original page images untouched', same)
        cs = b.pages[0].get_contents().get_data().decode('latin-1')
        check('searchable: invisible text (3 Tr)', '3 Tr' in cs and 'Tz' in cs)
        return path

    def searchable_mixed_special():
        for name in ['mixed.pdf', 'special.pdf']:
            if not doc_by_name(pg, name):
                import_pdfs(pg, [name])
            d = doc_by_name(pg, name)
            tool(pg, 'durchsuchbar', '[data-status]', f'?doc={d["id"]}&start=1')
            accept_ocr_notice(pg)
            pg.wait_for_selector('[data-result] .result-card', timeout=180000)
            path = save_doc(pg, name.replace('.pdf', ' (durchsuchbar).pdf'), 's_' + name)
            if name == 'mixed.pdf':
                p1a, p1b = pdftext(os.path.join(TD, name), 1), pdftext(path, 1)
                check('searchable (mixed): text page unchanged, image page recognised', p1a == p1b and 'Quarterly' in pdftext(path, 2), pdftext(path, 2)[:60])
                check('searchable (mixed): note says 1 page', '1 Seite erkannt' in pg.inner_text('[data-result]'))
            else:
                t = pdftext(path)
                check('searchable (special chars): no crash, Latin text kept', 'Sonderzeichen' in t and 'Zitat' in t and 'Kyrillisch' in t, t.strip()[:160].replace('\n', ' | '))

    def pdfjs_find(path):
        # open the searchable PDF in the viewer and search: highlight must sit on the word in the image
        d = doc_by_name(pg, 'scan3 (durchsuchbar).pdf')
        goto(pg, f'#/ansicht/{d["id"]}')
        pg.wait_for_function("document.querySelector('[data-v=loading]') && document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.evaluate("document.querySelector('[data-v=find]').click()")
        pg.fill('[data-v=findinput]', 'Spediteur')
        pg.wait_for_selector('.textLayer .highlight', timeout=15000)
        pg.wait_for_timeout(600)
        r = pg.evaluate("""() => { const hl = document.querySelector('.textLayer .highlight'); const pageEl = hl.closest('.page');
          const a = hl.getBoundingClientRect(), p = pageEl.querySelector('canvas').getBoundingClientRect();
          return { x0: (a.left - p.left) / p.width, y0: (a.top - p.top) / p.height, x1: (a.right - p.left) / p.width, y1: (a.bottom - p.top) / p.height, page: pageEl.dataset.pageNumber }; }""")
        exp = word_box_truth(DE, 'Spediteur', 3)
        dx0, dx1 = abs(r['x0'] - exp[0]), abs(r['x1'] - exp[2])
        dyc = abs((r['y0'] + r['y1']) / 2 - (exp[1] + exp[3]) / 2)
        hgt = (r['y1'] - r['y0']) / (exp[3] - exp[1])
        check('viewer: pdf.js find highlight lines up with the scanned word', r['page'] == '1' and dx0 < 0.012 and dx1 < 0.02 and dyc < 0.012 and 0.6 < hgt < 2.0,
              f'dx0={dx0:.4f} dx1={dx1:.4f} dyc={dyc:.4f} h×{hgt:.2f}')
        shot(pg, 'viewer_find_on_scan')
        cnt = pg.inner_text('[data-v=findcount]')
        check('viewer: find count on scanned doc', '1' in cnt, cnt)

    def banner():
        d = doc_by_name(pg, 'scan3.pdf')
        goto(pg, f'#/ansicht/{d["id"]}')
        pg.wait_for_selector('.ocr-banner', timeout=15000)
        check('viewer banner: shown for image-only PDF', 'Dieser Scan enthält keinen Text' in pg.inner_text('.ocr-banner'))
        shot(pg, 'viewer_banner_desktop')
        import_pdfs(pg, ['textonly.pdf'])
        d2 = doc_by_name(pg, 'textonly.pdf')
        goto(pg, f'#/ansicht/{d2["id"]}')
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.wait_for_timeout(1500)
        check('viewer banner: not shown for text PDF', pg.locator('.ocr-banner').count() == 0)
        d3 = doc_by_name(pg, 'scan3 (durchsuchbar).pdf')
        if d3:
            goto(pg, f'#/ansicht/{d3["id"]}')
            pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
            pg.wait_for_timeout(1500)
            check('viewer banner: not shown after OCR', pg.locator('.ocr-banner').count() == 0)
        # menu entry + banner click → tool with auto start
        goto(pg, f'#/ansicht/{d["id"]}')
        pg.wait_for_selector('.ocr-banner', timeout=15000)
        pg.evaluate("document.querySelector('[data-v=more]').click()")
        check('viewer menu: "Text erkennen (OCR)"', pg.locator('[role=menu] >> text=Text erkennen (OCR)').count() == 1)
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(200)
        pg.locator('.ocr-banner [data-ocr-go]').click()
        pg.wait_for_selector('.ocr-panel', timeout=15000)
        check('viewer banner: click starts searchable conversion', 'durchsuchbar' in pg.evaluate('location.hash'))
        pg.locator('.ocr-panel [data-cancel]').click()
        pg.wait_for_selector('.toast >> text=abgebrochen', timeout=20000)
        check('cancel: toast after Abbrechen', True)
        wait_panel_gone(pg)
        # dismiss banner persists
        goto(pg, f'#/ansicht/{d["id"]}')
        pg.wait_for_selector('.ocr-banner', timeout=15000)
        pg.locator('.ocr-banner [data-ocr-x]').click()
        goto(pg, '#/dateien')
        goto(pg, f'#/ansicht/{d["id"]}')
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.wait_for_timeout(1500)
        check('viewer banner: dismissed stays hidden', pg.locator('.ocr-banner').count() == 0)
        pg.evaluate(f"localStorage.removeItem('fale-ocr-banner-off:{d['id']}')")

    def word_tool():
        tool(pg, 'bild-word', '[data-pick]')
        choose_files(pg, pg.locator('[data-pick]'), ['clean_en.png'])
        pg.locator('.screen-foot [data-go]').click()
        accept_ocr_notice(pg)
        pg.wait_for_function("document.querySelector('[data-result] .doc-name') && document.querySelector('[data-result] .doc-name').textContent.endsWith('.docx')", timeout=120000)
        p_docx = dl(pg, pg.locator('[data-result] [data-r="dl"]'), 'bild.docx')
        import docx
        t = '\n'.join(x.text for x in docx.Document(p_docx).paragraphs)
        check('Bild zu Word: valid .docx with text', word_acc(TRUTH['clean_en'], t) >= 0.95 and 'Quarterly Report Summary' in t, t[:100])

    def excel_tool():
        tool(pg, 'bild-excel', '[data-pick]')
        choose_files(pg, pg.locator('[data-pick]'), ['table.png'])
        pg.locator('.screen-foot [data-go]').click()
        accept_ocr_notice(pg)
        pg.wait_for_function("document.querySelector('[data-result] .doc-name') && document.querySelector('[data-result] .doc-name').textContent.endsWith('.xlsx')", timeout=120000)
        shot(pg, 'excel_result_desktop')
        p_x = dl(pg, pg.locator('[data-result] [data-r="dl"]'), 'tabelle.xlsx')
        import openpyxl
        ws = openpyxl.load_workbook(p_x).active
        rows = [[c for c in r if c is not None] for r in ws.iter_rows(values_only=True)]
        rows = [r for r in rows if r]
        truth = TRUTH['table']
        def num(s):
            try:
                return float(s.replace(',', '.'))
            except ValueError:
                return s
        exp = [[num(c) if i else c for i, c in enumerate(r)] if ri else r for ri, r in enumerate(truth)]
        ok = len(rows) == len(exp) and all(len(a) == 4 and all((abs(x - y) < 1e-6 if isinstance(y, float) else str(x) == y) for x, y in zip(a, b)) for a, b in zip(rows, exp))
        check('Bild zu Excel: valid .xlsx, 5×4 table with numbers', ok, json.dumps(rows, ensure_ascii=False))

    def card_tool():
        for n in ['card_de.jpg', 'card_en.jpg']:
            tool(pg, 'visitenkarte', '[data-pick]')
            choose_files(pg, pg.locator('[data-pick]'), [n])
            accept_ocr_notice(pg)
            pg.wait_for_selector('[data-f="name"]', timeout=120000)
            vals = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-f]')].map(e => [e.dataset.f, e.value]))")
            t = TRUTH[n.split('.')[0]]
            ok = [k for k in ['name', 'firma', 'position', 'telefon', 'mobil', 'email', 'web'] if vals.get(k, '').replace(' ', '').lower() == t[k].replace(' ', '').lower()]
            check(f'Visitenkarte {n}: form fields', len(ok) >= 6 and vals['ort'] in t['adresse'] and vals['strasse'] in t['adresse'], f'ok={ok} {json.dumps(vals, ensure_ascii=False)[:300]}')
            if n == 'card_de.jpg':
                shot(pg, 'bizcard_form_desktop')
                pg.fill('[data-f="position"]', 'Geschäftsführerin; Vertrieb')
            path = dl(pg, pg.locator('.screen-foot [data-vcf]'), n.replace('.jpg', '.vcf'))
            raw = open(path, 'rb').read()
            v = raw.decode('utf-8')
            lines = v.split('\r\n')
            okv = lines[0] == 'BEGIN:VCARD' and lines[1] == 'VERSION:3.0' and 'END:VCARD' in lines and all(len(l.encode()) <= 75 for l in lines)
            fields = {l.split(':', 1)[0]: l.split(':', 1)[1] for l in lines if ':' in l}
            okv = okv and fields.get('FN') == vals['name'] and any(k.startswith('EMAIL') for k in fields) and any('CELL' in k for k in fields)
            if n == 'card_de.jpg':
                okv = okv and fields.get('TITLE') == 'Geschäftsführerin\\; Vertrieb' and fields.get('N', '').startswith('Schäfer;Anna;')
            check(f'Visitenkarte {n}: valid vCard 3.0', okv, v[:300].replace('\r\n', ' | '))

    def settings():
        goto(pg, '#/einstellungen', '[data-ocr-row]', timeout=15000)
        pg.wait_for_function("!/geprüft/.test(document.querySelector('[data-ocr-status]').textContent)", timeout=10000)
        st = pg.inner_text('[data-ocr-status]')
        lic = pg.inner_text('.license-list')
        check('settings: OCR row with status + size', 'MB' in st and ('Nicht geladen' in st or 'Geladen' in st or 'Teilweise' in st), st)
        check('settings: licences tesseract.js, -core, tessdata_fast', 'tesseract.js 6.0.1' in lic and 'tesseract.js-core 6.1.2' in lic and 'tessdata_fast' in lic and lic.count('Apache-2.0') >= 4)
        pg.locator('[data-ocr-row]').scroll_into_view_if_needed()
        shot(pg, 'settings_ocr_desktop')

    def scanner():
        tool(pg, 'scannen', '.sc-fallback, .sc-cap', '')
        pg.wait_for_timeout(1500)
        btn = pg.locator('[data-gallery]').first
        choose_files(pg, btn, ['scanpage_1.png'])
        pg.wait_for_selector('[data-ocr]', timeout=20000)
        check('scanner: OCR option shown and on by default', pg.locator('[data-ocr]').is_checked() and 'Text erkennen – PDF durchsuchbar machen' in pg.inner_text('.sc-settings'))
        pg.locator('[data-ocr]').scroll_into_view_if_needed()
        shot(pg, 'scanner_ocr_option_desktop')
        pg.fill('[data-name]', 'OCR Scan Test')
        note = pg.inner_text('.sc-ocr')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_timeout(700)
        check('scanner: no extra dialog when saving (size note shown inline)', pg.locator('dialog[open]').count() == 0 and ('einmalig' in note or 'Texterkennung' in note), note)
        pg.wait_for_selector('[data-result] .result-card', timeout=120000)
        check('scanner: result note "durchsuchbar"', 'durchsuchbar' in pg.inner_text('[data-result]'))
        path = save_doc(pg, 'OCR Scan Test.pdf', 'scan_ocr.pdf')
        t = pdftext(path)
        check('scanner: saved PDF is searchable', word_acc(TRUTH['scan_pages'][0], t) >= 0.9, t[:120].replace('\n', ' | '))
        W, H, words = pdf_word_boxes(path, 1)
        sp = [w for w in words if w[0].startswith('Spediteur')]
        check('scanner: text layer within the page', sp and 0 < sp[0][1] < W and 0 < sp[0][2] < H, str(sp[:1]))
        # remembered setting
        tool(pg, 'scannen', '.sc-fallback, .sc-cap', '')
        pg.wait_for_timeout(1200)
        choose_files(pg, pg.locator('[data-gallery]').first, ['scanpage_3.png'])
        pg.wait_for_selector('[data-ocr]')
        pg.locator('[data-ocr]').uncheck()
        tool(pg, 'scannen', '.sc-fallback, .sc-cap', '')
        pg.wait_for_timeout(1200)
        choose_files(pg, pg.locator('[data-gallery]').first, ['scanpage_3.png'])
        pg.wait_for_selector('[data-ocr]')
        check('scanner: OCR option remembered', not pg.locator('[data-ocr]').is_checked())
        pg.locator('[data-ocr]').check()

    step('tools listed', listed)
    step('text tool', text_tool)
    step('text tool pdf', text_tool_pdf)
    res = {}
    step('searchable tool', lambda: res.setdefault('p', searchable_tool()))
    step('searchable mixed/special', searchable_mixed_special)
    step('viewer find', lambda: pdfjs_find(res.get('p')))
    step('viewer banner', banner)
    step('word tool', word_tool)
    step('excel tool', excel_tool)
    step('card tool', card_tool)
    step('settings', settings)
    step('scanner', scanner)
    browser.close()


def shot(pg, name):
    pg.screenshot(path=os.path.join(OUT, f'{name}.png'))


# ======================================================================================= integrations
def integr_tests(p):
    browser = p.chromium.launch()
    ctx = new_ctx(browser)
    pg = ctx.new_page()
    CUR['page'] = pg
    attach(pg, 'integr')
    pg.goto(URL)
    pg.wait_for_timeout(800)
    pg.evaluate("localStorage.setItem('fale-ocr-consent', '1')")
    import_pdfs(pg, ['scan3.pdf', 'cmp_alt.pdf', 'cmp_neu.pdf'])
    ids = {d['name']: d['id'] for d in docs(pg)}

    def reflow():
        goto(pg, f"#/ansicht/{ids['scan3.pdf']}")
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.evaluate("document.querySelector('[data-v=reflow]').click()")
        pg.wait_for_selector('[data-rf-ocr]', timeout=30000)
        check('Lesemodus: OCR offer on scan', 'Text per OCR erkennen' in pg.inner_text('.rf-noscan'))
        shot(pg, 'reader_noscan_desktop')
        pg.locator('[data-rf-ocr]').click()
        pg.wait_for_selector('.rf-doc p', timeout=180000)
        pg.wait_for_function("!document.querySelector('.ocr-panel')", timeout=60000)
        pg.wait_for_function("document.querySelector('.rf-doc') && /Spediteur/.test(document.querySelector('.rf-doc').innerText)", timeout=60000)
        txt = pg.inner_text('.rf-doc')
        check('Lesemodus: reflowed OCR text', 'Spediteur' in txt and 'Quarterly' in txt and 'Abschlussbericht' in txt, txt[:150].replace('\n', ' | '))
        pg.locator('[data-rf-save]').click()
        pg.wait_for_timeout(1500)
        check('Lesemodus: save searchable copy', any(d['name'] == 'scan3 (durchsuchbar).pdf' for d in docs(pg)))
        shot(pg, 'reader_ocr_desktop')
        pg.evaluate("document.querySelector('[data-rf=close]') && document.querySelector('[data-rf=close]').click()")

    def compare():
        goto(pg, f"#/werkzeug/vergleichen?doc={ids['cmp_alt.pdf']}", '[data-slot=b]')
        pg.locator('[data-slot=b] button').click()
        pg.wait_for_selector('dialog[open]')
        pg.locator('dialog[open] label, dialog[open] button', has_text='cmp_neu.pdf').first.click()
        btns = pg.locator('dialog[open] .dlg-actions button')
        btns.nth(btns.count() - 1).click()
        pg.wait_for_timeout(500)
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-cmp-ocr]', timeout=30000)
        shot(pg, 'compare_offer_desktop')
        pg.locator('[data-cmp-ocr]').click()
        pg.wait_for_selector('.ocr-panel', timeout=10000)
        pg.wait_for_function("!document.querySelector('.ocr-panel') && document.querySelector('.cmp-summary')", timeout=180000)
        pg.wait_for_timeout(500)
        s = pg.inner_text('.cmp-summary')
        body = pg.inner_text('[data-out]')
        check('Vergleichen: OCR compare finds 100 → 120', re.search(r'\b1\b\s*Änderungen', s) is not None and '120' in body and '100' in body, s.replace('\n', ' | ')[:200])

    def redact():
        goto(pg, f"#/werkzeug/schwaerzen?doc={ids['scan3.pdf']}", '.pt-toolbar')
        pg.wait_for_timeout(800)
        pg.locator('[data-tool=search]').click()
        pg.fill('dialog[open] [name=q]', 'Saarbrücken, Spediteur')
        pg.locator('dialog[open] button', has_text='Treffer markieren').click()
        pg.wait_for_selector('dialog[open] >> text=Seiten ohne Text', timeout=20000)
        shot(pg, 'redact_ocr_offer_desktop')
        pg.locator('dialog[open] button', has_text='Text per OCR erkennen').click()
        pg.wait_for_function("document.querySelectorAll('.pt-redmark').length > 0", timeout=180000)
        n = pg.evaluate("document.querySelectorAll('.pt-redmark').length")
        foot = pg.inner_text('.screen-foot')
        check('Schwärzen: search terms found via OCR (2× Saarbrücken + Spediteur)', n == 3 and 'Markierung' in foot, f'{n} marks · {foot}')
        # mark position: first "Spediteur" mark on page 1 near expected box
        r = pg.evaluate("""() => { const p = document.querySelector('.pt-page[data-page="1"]'); const pr = p.getBoundingClientRect();
          return [...p.querySelectorAll('.pt-redmark')].map(m => { const b = m.getBoundingClientRect(); return [(b.left - pr.left) / pr.width, (b.top - pr.top) / pr.height, (b.right - pr.left) / pr.width, (b.bottom - pr.top) / pr.height]; }); }""")
        exp = word_box_truth(DE, 'Spediteur', 3)
        hit = any(abs(m[0] - exp[0]) < 0.015 and abs((m[1] + m[3]) / 2 - (exp[1] + exp[3]) / 2) < 0.012 for m in r)
        check('Schwärzen: OCR mark covers the word', hit, json.dumps(r[:4]))
        pg.locator('.screen-foot .btn-primary').click()
        pg.locator('dialog[open] button', has_text='Endgültig schwärzen').click()
        pg.wait_for_selector('.pt-result .result-card', timeout=60000)
        path = save_doc(pg, 'scan3 (geschwärzt).pdf', 'redacted.pdf')
        check('Schwärzen: result saved (pages rasterised)', os.path.getsize(path) > 1000)

    def toword():
        goto(pg, f"#/werkzeug/pdf-word?doc={ids['scan3.pdf']}", '[data-range]')
        pg.wait_for_selector('[data-ocr]', timeout=20000)
        check('PDF zu Word: OCR option for scans', pg.locator('[data-ocr]').is_checked())
        shot(pg, 'toword_ocr_desktop')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=180000)
        p_docx = dl(pg, pg.locator('[data-result] [data-r="dl"]'), 'scan_word.docx')
        import docx
        t = '\n'.join(x.text for x in docx.Document(p_docx).paragraphs)
        check('PDF zu Word: OCR text in .docx', 'Spediteur' in t and 'Quarterly' in t and 'Abschlussbericht' in t, t[:120])

    def stats():
        n = pg.evaluate("() => { try { const d = JSON.parse(localStorage.getItem('fale-stats') || '{}'); return d.total ? d.total.ocr_pages || 0 : -1; } catch (e) { return -2; } }")
        keys = pg.evaluate("Object.keys(localStorage).filter(k => /stat/i.test(k))")
        check('stats: ocr_pages tracked', n > 0 or keys, f'{n} {keys}')

    step('reflow ocr', reflow)
    step('compare ocr', compare)
    step('redact ocr', redact)
    step('toword ocr', toword)
    step('stats', stats)
    browser.close()


# ======================================================================================= offline via SW
def offline_tests(p):
    browser = p.chromium.launch()
    ctx = new_ctx(browser, sw=True)
    pg = ctx.new_page()
    CUR['page'] = pg
    attach(pg, 'offline')

    def run():
        pg.goto(URL)
        pg.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)", timeout=30000)
        pg.wait_for_timeout(1500)
        pg.reload()
        pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=30000)
        st0 = pg.evaluate("async () => (await import('./js/ocr/assets.js')).offlineStatus()")
        check('offline: OCR data not cached before first use', st0['mode'] == 'missing', st0['mode'])
        keys0 = pg.evaluate("caches.keys()")
        n_pre = pg.evaluate("async () => { let n = 0; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) if (r.url.includes('tesseract')) n++; } return n; }")
        check('offline: nothing of tesseract precached at install', n_pre == 0, f'{keys0}')
        r1 = ocr_eval(pg, 'clean_de.png')
        check('offline: warm-up OCR online', word_acc(TRUTH['clean_de'], r1['text']) >= 0.95)
        pg.wait_for_timeout(800)
        st1 = pg.evaluate("async () => (await import('./js/ocr/assets.js')).offlineStatus()")
        check('offline: OCR files cached by SW on first use', st1['mode'] == 'cached', f"{st1['mode']} {st1['bytes']}")
        ctx.set_offline(True)
        pg.reload()
        pg.wait_for_timeout(1500)
        r2 = ocr_eval(pg, 'clean_en.png')
        check('offline: second OCR works offline (SW cache)', word_acc(TRUTH['clean_en'], r2['text']) >= 0.95, f"{r2['ms']:.0f} ms")
        # settings shows "Geladen"
        goto(pg, '#/einstellungen', '[data-ocr-row]', timeout=15000)
        pg.wait_for_function("/Geladen/.test(document.querySelector('[data-ocr-status]').textContent)", timeout=10000)
        check('offline: settings show "Geladen" + size', re.search(r'Geladen · [\d,]+ MB', pg.inner_text('[data-ocr-status]')) is not None, pg.inner_text('[data-ocr-status]'))
        ctx.set_offline(False)

    def fresh_offline():
        # a new profile that never loaded OCR: offline → clear German explanation, no hang
        c2 = new_ctx(browser, sw=True)
        p2 = c2.new_page()
        attach(p2, 'fresh')
        p2.goto(URL)
        p2.wait_for_function("navigator.serviceWorker.ready.then(() => true)", timeout=30000)
        p2.wait_for_timeout(1200)
        p2.reload()
        p2.wait_for_function("!!navigator.serviceWorker.controller", timeout=30000)
        c2.set_offline(True)
        msg = p2.evaluate("async () => { const m = await import('./js/ocr/engine.js'); const c = document.createElement('canvas'); c.width = 100; c.height = 50; try { await m.recognize(c); return 'ok'; } catch (e) { return e.userMessage || String(e); } }")
        check('offline (never loaded): German explanation', 'Internetverbindung' in msg and 'MB' in msg, msg)
        goto(p2, '#/werkzeug/text-erkennen', '[data-pick]')
        choose_files(p2, p2.locator('[data-pick]'), ['clean_de.png'])
        p2.locator('.screen-foot [data-go]').click()
        p2.wait_for_selector('dialog[open]', timeout=5000)
        dtext = p2.inner_text('dialog[open]')
        check('offline (never loaded): dialog before first use', 'noch nicht offline verfügbar' in dtext and 'einmalig' in dtext, dtext[:120])
        p2.screenshot(path=os.path.join(OUT, 'offline_first_use_dialog_desktop.png'))
        c2.set_offline(False)
        # online but first use → consent dialog with size
        p2.locator('dialog[open] button', has_text='OK').click()
        p2.wait_for_timeout(300)
        p2.locator('.screen-foot [data-go]').click()
        p2.wait_for_selector('dialog[open] >> text=Laden & starten', timeout=5000)
        check('first use: download notice', re.search(r'einmalig ca\. [\d,]+ MB Sprachdaten', p2.inner_text('dialog[open]')) is not None, p2.inner_text('dialog[open]')[:150])
        p2.screenshot(path=os.path.join(OUT, 'first_use_notice_desktop.png'))
        p2.locator('dialog[open] button', has_text='Abbrechen').click()
        # settings download button
        goto(p2, '#/einstellungen', '[data-ocr-row]', timeout=15000)
        p2.wait_for_function("/Nicht geladen/.test(document.querySelector('[data-ocr-status]').textContent)", timeout=10000)
        p2.locator('[data-ocr-load]').click()
        p2.wait_for_function("/Geladen ·/.test(document.querySelector('[data-ocr-status]').textContent)", timeout=60000)
        check('settings: "OCR-Daten für offline laden" downloads', True, p2.inner_text('[data-ocr-status]'))
        c2.set_offline(True)
        p2.reload()
        p2.wait_for_timeout(1200)
        r = ocr_eval(p2, 'clean_de.png')
        check('settings download → OCR works offline', word_acc(TRUTH['clean_de'], r['text']) >= 0.95)
        c2.close()

    step('sw offline', run)
    step('fresh offline', fresh_offline)
    browser.close()


# ======================================================================================= screenshots
def shots(p):
    browser = p.chromium.launch()
    for phone in (True, False):
        for dark in (False, True):
            tag = ('phone' if phone else 'desktop') + ('_dark' if dark else '_light')
            ctx = new_ctx(browser, phone=phone, dark=dark)
            pg = ctx.new_page()
            CUR['page'] = pg
            attach(pg, 'shots-' + tag)
            pg.goto(URL)
            pg.evaluate("d => { localStorage.setItem('fale-theme', d ? 'dark' : 'light'); localStorage.setItem('fale-ocr-consent', '1'); }", dark)
            pg.reload()
            pg.wait_for_timeout(800)
            # source screen
            tool(pg, 'text-erkennen', '[data-pick]')
            choose_files(pg, pg.locator('[data-pick]'), ['photo_scan.jpg'])
            pg.wait_for_selector('.ocr-item')
            shot(pg, f'ocr_source_{tag}')
            pg.locator('.screen-foot [data-go]').click()
            pg.wait_for_selector('.ocr-panel.show', timeout=10000)
            pg.wait_for_timeout(500)
            shot(pg, f'ocr_progress_{tag}')
            pg.wait_for_selector('[data-text]', timeout=120000)
            pg.wait_for_timeout(400)
            shot(pg, f'ocr_result_{tag}')
            # business card
            tool(pg, 'visitenkarte', '[data-pick]')
            shot(pg, f'bizcard_start_{tag}')
            choose_files(pg, pg.locator('[data-pick]'), ['card_de.jpg'])
            pg.wait_for_selector('[data-f="name"]', timeout=120000)
            pg.wait_for_timeout(300)
            shot(pg, f'bizcard_form_{tag}')
            # searchable + banner
            import_pdfs(pg, ['scan3.pdf'])
            d = doc_by_name(pg, 'scan3.pdf')
            goto(pg, f'#/ansicht/{d["id"]}')
            pg.wait_for_selector('.ocr-banner', timeout=15000)
            pg.wait_for_timeout(600)
            shot(pg, f'viewer_banner_{tag}')
            tool(pg, 'durchsuchbar', '[data-status]', f'?doc={d["id"]}')
            pg.wait_for_function("!document.querySelector('[data-status] .spinner')", timeout=20000)
            shot(pg, f'searchable_{tag}')
            tool(pg, 'bild-excel', '[data-pick]')
            choose_files(pg, pg.locator('[data-pick]'), ['table.png'])
            pg.locator('.screen-foot [data-go]').click()
            pg.wait_for_selector('.ocr-tbl', timeout=120000)
            pg.wait_for_timeout(500)
            shot(pg, f'excel_{tag}')
            goto(pg, '#/einstellungen', '[data-ocr-row]', timeout=15000)
            pg.wait_for_timeout(600)
            pg.locator('[data-ocr-row]').scroll_into_view_if_needed()
            shot(pg, f'settings_{tag}')
            tool(pg, 'scannen', '.sc-fallback, .sc-cap')
            pg.wait_for_timeout(1200)
            choose_files(pg, pg.locator('[data-gallery]').first, ['scanpage_1.png'])
            pg.wait_for_selector('[data-ocr]', timeout=20000)
            pg.locator('[data-ocr]').scroll_into_view_if_needed()
            shot(pg, f'scanner_option_{tag}')
            goto(pg, f'#/ansicht/{d["id"]}')
            pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
            pg.evaluate("document.querySelector('[data-v=reflow]').click()")
            pg.wait_for_selector('[data-rf-ocr]', timeout=30000)
            shot(pg, f'reader_noscan_{tag}')
            ctx.close()
    browser.close()


# ======================================================================================= main
if __name__ == '__main__':
    if '--nobuild' not in sys.argv or not os.path.exists(DIST):
        build()
    start_server()
    try:
        with sync_playwright() as p:
            if ONLY in ('all', 'build'):
                build_checks()
            if ONLY in ('all', 'engine'):
                engine_tests(p)
            if ONLY in ('all', 'tools'):
                tools_tests(p)
            if ONLY in ('all', 'integr'):
                integr_tests(p)
            if ONLY in ('all', 'offline'):
                offline_tests(p)
            if ONLY in ('all', 'shots'):
                shots(p)
    finally:
        stop_server()
    ext = sorted(set(external))
    check('privacy: no request left 127.0.0.1', not ext, str(ext[:5]))
    errs = [c for c in console if 'favicon' not in c and 'net::ERR_INTERNET_DISCONNECTED' not in c and 'Failed to load resource' not in c]
    check('no console errors', not errs, ' || '.join(errs[:6]))
    passed = sum(1 for r in results if r[1])
    print(f'\n{passed}/{len(results)} passed')
    for r in results:
        if not r[1]:
            print('  FAIL', r[0], r[2])

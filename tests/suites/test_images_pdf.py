"""Bilder → PDF with big phone photos (js/tools/images.js + imgprep-worker.js) – must not freeze the app.
- a 12 MP photo is decoded, scaled (≤ 3000 px) and encoded in a worker: no main-thread stall > 400 ms (CPU ×4)
- the list shows small previews (≤ 480 px), not the full photos
- EXIF rotation is applied (a sideways-stored portrait photo becomes a portrait page)
- a small PNG stays a lossless PNG; transparent areas become white
- without OffscreenCanvas (older browsers) the main-thread path still works
- „Fotos von Papier gerade ausrichten“ still works (fed by the worker's smaller JPEG)
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import io, os, sys, time, traceback
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out_images_pdf')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []
INIT = "try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); localStorage.setItem('fale-img-straight', '0'); } catch (e) {}"
WATCH = """window.__drift = []; (function () { let last = performance.now(); setInterval(() => { const n = performance.now(); window.__drift.push([Math.round(n), Math.round(n - last - 100)]); last = n; }, 100); })();"""


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


def make_files():
    big = os.path.join(OUT, 'handyfoto.jpg')
    if not os.path.exists(big):
        a = (np.random.default_rng(1).random((3024, 4032, 3)) * 60 + 150).astype('uint8')
        im = Image.fromarray(a).filter(ImageFilter.GaussianBlur(1.2))
        d = ImageDraw.Draw(im)
        for y in range(300, 2800, 90):
            d.text((400, y), 'Sehr geehrte Damen und Herren, Testzeile %d' % y, fill=(20, 20, 20))
        im.save(big, quality=92)
    # stored 800×600 (landscape pixels) with EXIF orientation 6 → shown as a 600×800 portrait
    rot = os.path.join(OUT, 'hochkant.jpg')
    im = Image.new('RGB', (800, 600), (230, 230, 230))
    ImageDraw.Draw(im).rectangle([0, 0, 200, 600], fill=(200, 20, 20))
    ex = Image.Exif(); ex[0x0112] = 6
    im.save(rot, quality=90, exif=ex.tobytes())
    png = os.path.join(OUT, 'grafik.png')
    p = Image.new('RGBA', (640, 480), (0, 0, 0, 0))
    ImageDraw.Draw(p).ellipse([100, 100, 540, 380], fill=(30, 90, 200, 255))
    p.save(png)
    return big, rot, png


PAGES_JS = """async () => {
  const db = await import('./js/db.js'); const files = await db.listFiles();
  const d = files.filter(f => /^Bilder /.test(f.name)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const bytes = new Uint8Array(await (await db.getFile(d.id)).arrayBuffer());
  const { loadPdfLib } = await import('./js/pdflib.js'); const { PDFDocument, PDFName, PDFRawStream } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes);
  const imgs = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && String(obj.dict.get(PDFName.of('Subtype'))) === '/Image')
      imgs.push({ w: obj.dict.get(PDFName.of('Width')).asNumber(), h: obj.dict.get(PDFName.of('Height')).asNumber(), f: String(obj.dict.get(PDFName.of('Filter')) || '') });
  }
  return { pages: doc.getPages().map(p => p.getSize()), imgs, size: bytes.length, id: d.id };
}"""


def new_page(browser, label, extra='', throttle=0):
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, locale='de-DE', device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_init_script(INIT + WATCH + extra)
    pg = ctx.new_page()
    pg.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    if throttle:
        ctx.new_cdp_session(pg).send('Emulation.setCPUThrottlingRate', {'rate': throttle})
    pg.goto(URL + '#/werkzeug/bilder')
    pg.wait_for_selector('[data-pick]', timeout=60000)
    pg.wait_for_timeout(2500)
    return ctx, pg


def make_pdf(pg, files, straight=False):
    if straight:
        pg.locator('[data-straight]').check()
    with pg.expect_file_chooser() as fc:
        pg.locator('[data-pick]').click()
    fc.value.set_files(files)
    pg.wait_for_function(f"() => document.querySelectorAll('.img-card img[src]').length >= {len(files)}", timeout=60000)
    m0 = pg.evaluate('performance.now()')
    t0 = time.time()
    pg.locator('[data-make]').click()
    pg.wait_for_selector('[data-result] .result-card', timeout=180000)
    return time.time() - t0, m0


def run(p):
    big, rot, png = make_files()
    browser = p.chromium.launch()

    def big_photo():
        ctx, pg = new_page(browser, 'phone', throttle=4)
        dt, m0 = make_pdf(pg, [big])
        pg.wait_for_timeout(4000)
        stalls = [x for x in pg.evaluate('window.__drift') if x[0] > m0 and x[1] > 400]
        check('12 MP photo → PDF without freezing the app (no stall > 400 ms, CPU ×4)', not stalls, stalls)
        check('…and done in reasonable time', dt < 30, round(dt, 1))
        used = pg.evaluate("performance.getEntriesByType('resource').some(e => e.name.includes('imgprep-worker.js'))")
        check('the photo was processed in the worker', used)
        prev = pg.evaluate("[...document.querySelectorAll('.img-card img')].map(i => Math.max(i.naturalWidth, i.naturalHeight))")
        check('the list shows a small preview, not the 12 MP photo', prev and max(prev) <= 480, prev)
        info = pg.evaluate(PAGES_JS)
        img = info['imgs'][0]
        check('page image scaled to 3000 px (JPEG), page in photo proportions', max(img['w'], img['h']) == 3000 and '/DCTDecode' in img['f'] and abs(info['pages'][0]['width'] / info['pages'][0]['height'] - 4 / 3) < 0.01, info)
        pg.screenshot(path=os.path.join(OUT, 'phone_big.png'))
        t0 = time.time()
        pg.evaluate("location.hash = '#/werkzeuge'")
        pg.wait_for_selector('#view-werkzeuge .area-tile', state='visible', timeout=20000)
        check('the app reacts right away afterwards', time.time() - t0 < 3, round(time.time() - t0, 2))
        ctx.close()
    step('big phone photo', big_photo)

    def orientation_png():
        ctx, pg = new_page(browser, 'rot')
        make_pdf(pg, [rot, png])
        info = pg.evaluate(PAGES_JS)
        p1, p2 = info['pages']
        check('EXIF rotation applied: sideways-stored photo becomes a portrait page', p1['width'] < p1['height'] and abs(p1['width'] / p1['height'] - 0.75) < 0.01, p1)
        pngs = [i for i in info['imgs'] if '/FlateDecode' in i['f'] and (i['w'], i['h']) == (640, 480)]
        check('small PNG stays a lossless PNG (640×480)', len(pngs) >= 1 and abs(p2['width'] - 480) < 1, info['imgs'])
        ctx.close()
    step('EXIF rotation + PNG', orientation_png)

    def fallback():
        ctx, pg = new_page(browser, 'fallback', extra="try { delete window.OffscreenCanvas; window.OffscreenCanvas = undefined; } catch (e) {}")
        make_pdf(pg, [rot])
        info = pg.evaluate(PAGES_JS)
        p1 = info['pages'][0]
        check('without OffscreenCanvas: main-thread path, EXIF rotation still right', p1['width'] < p1['height'], p1)
        check('…no worker started', not pg.evaluate("performance.getEntriesByType('resource').some(e => e.name.includes('imgprep-worker.js'))"))
        ctx.close()
    step('fallback without worker', fallback)

    def straight():
        ctx, pg = new_page(browser, 'straight')
        make_pdf(pg, [big], straight=True)
        info = pg.evaluate(PAGES_JS)
        img = info['imgs'][0]
        check('„gerade ausrichten“ with a big photo still makes a page', len(info['pages']) == 1 and 1000 < max(img['w'], img['h']) <= 3300, info)
        ctx.close()
    step('straighten', straight)
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

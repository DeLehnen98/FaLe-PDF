"""„Blatt gerade ausrichten“ – photos of paper (handheld camera) made straight, only when the person wants it.
- Bilder → PDF: option „Fotos von Papier gerade ausrichten“ (off by default, remembered)
  · sheet on a dark table, tilted 7° with perspective → page = the sheet only, text lines level
  · sheet fills the photo, text tilted 4° → turned straight; a straight photo stays as it is
  · without the option the photos stay untouched
- Viewer: photo PDF → banner button „Blatt ausrichten“ and menu item „Blatt gerade ausrichten“ (not for text PDFs)
  → scanner review with the pages (corners adjustable) → „<name> (ausgerichtet).pdf“
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, io, math, base64, subprocess, traceback
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SUITES, 'out_straighten')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


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


# ---------------------------------------------------------------- synthetic photos
def sheet(w=1240, h=1754):
    im = Image.new('RGB', (w, h), (246, 244, 238))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, 34)
    fb = ImageFont.truetype(FONT, 52)
    d.text((110, 120), 'Vollmacht', fill=(20, 20, 20), font=fb)
    y = 260
    for i in range(22):
        d.text((110, y), ('Hiermit bevollmaechtige ich meinen Sohn in allen Angelegenheiten zum Vertrag ' * 2)[:52 + (i * 7) % 12], fill=(25, 25, 25), font=f)
        y += 62
    d.line((110, 1650, 600, 1650), fill=(30, 30, 30), width=3)
    return im


def on_table(angle=7):
    """sheet tilted + perspective on a dark wooden table (edges visible)."""
    s = np.array(sheet())[:, :, ::-1]
    H, W = 2400, 1900
    bg = np.zeros((H, W, 3), np.uint8)
    bg[:] = (40, 62, 92)
    noise = np.random.default_rng(1).integers(0, 18, (H, W, 1), dtype=np.uint8)
    bg = cv2.add(bg, np.repeat(noise, 3, axis=2))
    sh, sw = s.shape[:2]
    a = math.radians(angle)
    cx, cy = W / 2, H / 2
    pts = []
    for (x, y) in [(-sw / 2, -sh / 2), (sw / 2, -sh / 2), (sw / 2, sh / 2), (-sw / 2, sh / 2)]:
        pts.append([cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)])
    pts[0][0] += 40; pts[1][0] -= 40  # perspective: top edge shorter
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [sw, 0], [sw, sh], [0, sh]]), np.float32(pts))
    warped = cv2.warpPerspective(s, M, (W, H), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full((sh, sw), 255, np.uint8), M, (W, H))
    out = bg.copy()
    out[mask > 0] = warped[mask > 0]
    return out


def filling(angle=4):
    """sheet fills the photo, rotated by `angle` (no edges to find)."""
    s = np.array(sheet())[:, :, ::-1]
    h, w = s.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), -angle, 1.12)
    return cv2.warpAffine(s, M, (w, h), borderMode=cv2.BORDER_REPLICATE)


def save_jpg(arr, name):
    p = os.path.join(OUT, name)
    cv2.imwrite(p, arr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return p


def tilt_of(img):
    """text line tilt in degrees (projection profile sharpness)."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    ink = (g < 110).astype(np.uint8)
    ys, xs = np.nonzero(ink)
    if len(xs) < 500:
        return None
    best, bs = 0, -1
    for d in np.arange(-10, 10.01, 0.1):
        t = math.tan(math.radians(d))
        b = np.round(ys - (xs - g.shape[1] / 2) * t).astype(int)
        b -= b.min()
        s = np.bincount(b).astype(float)
        v = (s * s).sum()
        if v > bs:
            bs, best = v, d
    return best


def dark_border(img):
    """share of dark (table) pixels in a 3 % frame around the page."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    m = max(4, int(min(h, w) * 0.03))
    fr = np.concatenate([g[:m].ravel(), g[-m:].ravel(), g[:, :m].ravel(), g[:, -m:].ravel()])
    return float((fr < 100).mean())


def render_page(pdf_path, page=1, tag='p'):
    base = os.path.join(OUT, tag)
    subprocess.run(['pdftoppm', '-r', '60', '-png', '-f', str(page), '-l', str(page), '-singlefile', pdf_path, base], check=True)
    return cv2.imread(base + '.png')


IMPORT = """async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
  return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }"""
FILES = "async () => (await (await import('./js/db.js')).listFiles()).map(f => ({ id: f.id, name: f.name }))"
BLOB = """async (id) => { const db = await import('./js/db.js'); const b = await db.getFile(id); if (!b) return null;
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }); }"""


def ctx_page(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    return ctx, page


def images_to_pdf(page, files, straight):
    page.evaluate("location.hash = '#/start'")
    page.wait_for_timeout(400)
    page.evaluate("location.hash = '#/werkzeug/bilder'")
    page.wait_for_selector('[data-pick]', timeout=15000)
    box = page.locator('[data-straight]')
    if box.is_checked() != straight:
        box.click()
    with page.expect_file_chooser() as fc:
        page.locator('[data-pick]').click()
    fc.value.set_files(files)
    page.wait_for_selector('.img-card', timeout=10000)
    before = len(page.evaluate(FILES))
    page.locator('[data-make]').click()
    page.wait_for_selector('[data-result] .result-card, [data-result] .card', timeout=60000)
    page.wait_for_timeout(400)
    docs = page.evaluate(FILES)
    assert len(docs) > before
    d = docs[0] if docs[0]['name'].startswith('Bilder') else [x for x in docs if x['name'].startswith('Bilder')][0]
    path = os.path.join(OUT, f"out_{'s' if straight else 'n'}_{len(docs)}.pdf")
    open(path, 'wb').write(base64.b64decode(page.evaluate(BLOB, d['id'])))
    return d, path


def run(p):
    browser = p.chromium.launch()
    ctx, page = ctx_page(browser, 'desktop', viewport={'width': 1280, 'height': 900})
    st = {}
    table = save_jpg(on_table(7), 'table_7deg.jpg')
    fill = save_jpg(filling(4), 'filling_4deg.jpg')
    straight_photo = save_jpg(np.array(sheet())[:, :, ::-1], 'straight.jpg')
    check('test photo: text tilted as made (≈4°)', abs(abs(tilt_of(cv2.imread(fill))) - 4) < 1, tilt_of(cv2.imread(fill)))

    def unit():
        r = page.evaluate("""async () => { const m = await import('./js/tools/scanproc.js');
          return [m.sheetLike([[0.07, 0.55], [0.99, 0.5], [0.98, 0.64], [0.08, 0.69]], 1064, 1465),
                  m.sheetLike([[0.1, 0.08], [0.9, 0.1], [0.88, 0.93], [0.12, 0.9]], 1900, 2400),
                  m.sheetLike([[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]], 1000, 1400)]; }""")
        check('found edges: a bright band across the page / a small patch is not taken for the sheet; a real sheet is', r == [False, True, False], r)
    step('sheet check', unit)

    def off():
        page.evaluate("location.hash = '#/werkzeug/bilder'")
        page.wait_for_selector('[data-straight]', timeout=15000)
        check('Bilder → PDF: „gerade ausrichten“ is off by default', not page.locator('[data-straight]').is_checked())
        d, path = images_to_pdf(page, [table], False)
        img = render_page(path, 1, 'n1')
        check('option off: photo stays as it is (table still visible)', dark_border(img) > 0.3, dark_border(img))
        st['photo_pdf'] = d['id']
    step('option off', off)

    def on():
        d, path = images_to_pdf(page, [table, fill, straight_photo], True)
        note = page.locator('[data-result]').inner_text()
        check('result: „3 von 3“ or „2 von 3 gerade ausgerichtet“ and „Ecken selbst anpassen“', 'gerade ausgerichtet' in note and page.locator('[data-result] [data-fix]').count() == 1, note)
        a = render_page(path, 1, 's1')
        cv2.imwrite(os.path.join(OUT, 'result_table.png'), a)
        check('sheet on the table: only the sheet is left (no dark table at the edges)', dark_border(a) < 0.08, dark_border(a))
        check('sheet on the table: text lines level (|tilt| < 1°)', abs(tilt_of(a)) < 1.0, tilt_of(a))
        check('sheet on the table: page is upright (portrait)', a.shape[0] > a.shape[1], a.shape)
        b = render_page(path, 2, 's2')
        cv2.imwrite(os.path.join(OUT, 'result_filling.png'), b)
        check('sheet fills the photo: turned straight (|tilt| < 1°)', abs(tilt_of(b)) < 1.0, tilt_of(b))
        c = render_page(path, 3, 's3')
        check('straight photo stays straight', abs(tilt_of(c)) < 0.6, tilt_of(c))
        page.goto(URL)
        page.wait_for_selector('#view-start .hero', timeout=30000)
        page.evaluate("location.hash = '#/werkzeug/bilder'")
        page.wait_for_selector('[data-straight]', timeout=15000)
        check('the choice is remembered', page.locator('[data-straight]').is_checked())
        page.locator('[data-straight]').click()
    step('option on', on)

    def viewer():
        did = st['photo_pdf']
        page.evaluate(f"location.hash = '#/ansicht/{did}'")
        page.wait_for_selector('.pdfViewer .page canvas', timeout=30000)
        page.wait_for_selector('.ocr-banner [data-straighten]', timeout=15000)
        check('photo PDF: banner offers „Blatt ausrichten“', page.locator('.ocr-banner [data-straighten]').is_visible())
        page.locator('[data-v="more"]').click()
        page.wait_for_selector('.menu-layer .menu-item', timeout=5000)
        check('photo PDF: menu item „Blatt gerade ausrichten“', page.locator('.menu-layer .menu-item', has_text='Blatt gerade ausrichten').count() == 1)
        page.locator('.menu-layer .menu-item', has_text='Blatt gerade ausrichten').click()
        page.wait_for_selector('.sc-body [data-allf]', timeout=60000)
        page.wait_for_timeout(800)
        txt = page.locator('main, body').first.inner_text()
        check('scanner opens with the page and detected corners', 'Blatt ausrichten' in txt and ('erkannt' in txt or 'Ecken' in txt), txt[:300])
        page.screenshot(path=os.path.join(OUT, 'scanner_review.png'))
        before = {d['name'] for d in page.evaluate(FILES)}
        page.locator('.screen-foot .btn-primary', has_text='PDF speichern').click()
        for _ in range(120):
            names = {d['name'] for d in page.evaluate(FILES)} - before
            if names:
                break
            page.wait_for_timeout(500)
        new = [d for d in page.evaluate(FILES) if d['name'] not in before]
        check('saved as „<name> (ausgerichtet).pdf“', new and new[0]['name'].endswith('(ausgerichtet).pdf'), [d['name'] for d in new])
        if new:
            path = os.path.join(OUT, 'from_viewer.pdf')
            open(path, 'wb').write(base64.b64decode(page.evaluate(BLOB, new[0]['id'])))
            img = render_page(path, 1, 'v1')
            cv2.imwrite(os.path.join(OUT, 'result_viewer.png'), img)
            check('viewer → straightened page: no table, level text', dark_border(img) < 0.08 and abs(tilt_of(img)) < 1.0, (dark_border(img), tilt_of(img)))
        # a normal text PDF: no straighten item
        tid = page.evaluate(IMPORT, [base64.b64encode(open(os.path.join(SUITES, 'formcheck', 'antrag.pdf'), 'rb').read()).decode(), 'Text.pdf'])
        page.evaluate(f"location.hash = '#/ansicht/{tid}'")
        page.wait_for_selector('.pdfViewer .page canvas', timeout=30000)
        page.wait_for_timeout(1500)
        page.locator('[data-v="more"]').click()
        page.wait_for_selector('.menu-layer .menu-item', timeout=5000)
        check('text PDF: no „Blatt gerade ausrichten“', page.locator('.menu-layer .menu-item', has_text='Blatt gerade ausrichten').count() == 0)
        page.keyboard.press('Escape')
    step('viewer → scanner', viewer)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} passed')
    for n, c, i in results:
        if not c:
            print('  FAIL', n, i[:300])

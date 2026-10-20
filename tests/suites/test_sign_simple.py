"""Ausfüllen & unterschreiben made simple (js/tools/sign.js) – on a phone (360 px) and a desktop window.

- Text: tap "Text", tap the page → a big text field appears in the bottom bar; typing there writes on the page
- A− / A+ change the size in steps (shown as a number), colour dots (black/blue/green), "Löschen", "Fertig"
- "Häkchen": ✓ / ✗ / ● for paper forms, size and colour in the bar
- signature: "Größer" / "Kleiner" in the bar; deleting via the bar
- the bar never overflows 360 px; the placing hint is visible on phones (bar), "Abbrechen" ends placing
- saved PDF: typed text (real text, in the chosen colour), check mark and cross drawn as vector lines at the right spot
- PDF bearbeiten: A− / A+ stepper for the font size
Run: python3 test_sign_simple.py   (server: python3 -m http.server 8798 --bind 127.0.0.1 in the repo; URL via SIGN_URL)
"""
import os, re, subprocess, sys, zlib
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('SIGN_URL', 'http://127.0.0.1:8798/')
TD = '/home/claude/FalePDF/tests/base/testdata'
OUT = os.path.join(HERE, 'out_sign_simple')
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


DOCS = """async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const res = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name}))); });
  db.close(); return res; }"""
FILE_JS = """async id => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const rec = await new Promise(r => { const g = db.transaction('files').objectStore('files').get(id); g.onsuccess = () => r(g.result); });
  db.close(); const u = new Uint8Array(await rec.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }"""


def doc(pg, name):
    return next((d for d in pg.evaluate(DOCS) if d['name'] == name), None)


def ctx(b, phone):
    kw = dict(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True, device_scale_factor=2) if phone else dict(viewport={'width': 1280, 'height': 860})
    c = b.new_context(locale='de-DE', **kw)
    c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-simple-hint', 'hidden'); } catch (e) {}")
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=20000)
    pg.set_input_files('#pdf-input', [os.path.join(TD, 'bericht.pdf')])
    for _ in range(40):
        if doc(pg, 'bericht.pdf'):
            break
        pg.wait_for_timeout(250)
    return c, pg, errs


def tap_page(pg, fx, fy):
    box = pg.locator('.sign-page').first.bounding_box()
    vh = pg.viewport_size['height']
    y = box['y'] + box['height'] * fy
    if y > vh * 0.72 or y < 80:  # target outside the visible area or under the bottom bar (e.g. below the paper-form hint card): scroll there first
        pg.evaluate("d => document.querySelector('.sign-stage').scrollBy(0, d)", y - vh / 2)
        pg.wait_for_timeout(200)
        box = pg.locator('.sign-page').first.bounding_box()
    pg.mouse.click(box['x'] + box['width'] * fx, box['y'] + box['height'] * fy)
    pg.wait_for_timeout(250)


def pinch(pg, cx, cy, d0, d1, steps=10):
    """Two-finger pinch (spread when d1 > d0) at (cx, cy) – real touch events via the DevTools protocol."""
    cdp = pg.context.new_cdp_session(pg)
    def pts(d):
        return [{'x': cx - d / 2, 'y': cy, 'id': 1}, {'x': cx + d / 2, 'y': cy, 'id': 2}]
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(d0)})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(d0 + (d1 - d0) * i / steps)})
        pg.wait_for_timeout(30)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    cdp.detach()


def rel(pg, sel):
    """position of an item relative to its page (0…1) – must not move when zooming"""
    return pg.evaluate("""s => { const e = document.querySelector(s), p = e.closest('.sign-page'); const a = e.getBoundingClientRect(), b = p.getBoundingClientRect();
      return [(a.left - b.left) / b.width, (a.top - b.top) / b.height, a.width / b.width]; }""", sel)


def overflow(pg):
    return pg.evaluate("() => { const b = document.querySelector('.sign-bar'); return b && !b.hidden ? [b.scrollWidth, b.clientWidth, document.documentElement.scrollWidth] : null; }")


def run(p):
    b = p.chromium.launch()
    # ---------------- phone
    c, pg, errs = ctx(b, True)
    d = doc(pg, 'bericht.pdf')
    pg.goto(URL + f'#/werkzeug/unterschreiben?doc={d["id"]}')
    pg.wait_for_selector('.sign-page canvas', timeout=20000)
    pg.wait_for_timeout(500)
    check('phone: bar hidden while nothing is selected', pg.locator('.sign-bar').is_hidden())
    pg.locator('[data-mode="text"]').click()
    pg.wait_for_timeout(200)
    hint = pg.locator('.sign-bar').inner_text()
    check('phone: placing hint visible in the bar, with "Abbrechen"', 'Tippe auf die Stelle' in hint and 'Abbrechen' in hint, hint)
    pg.locator('[data-bar-cancel]').click()
    pg.wait_for_timeout(200)
    check('phone: "Abbrechen" ends placing', pg.locator('[data-mode="text"][aria-pressed="true"]').count() == 0 and pg.locator('.sign-bar').is_hidden())
    pg.locator('[data-mode="text"]').click()
    tap_page(pg, 0.25, 0.08)
    inp = pg.locator('[data-bar-text]')
    check('text: big text field in the bar, focused', inp.count() == 1 and pg.evaluate("document.activeElement && document.activeElement.matches('[data-bar-text]')"))
    fs = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('[data-bar-text]')).fontSize)")
    check('text: the field uses ≥ 16 px (readable, no zoom on phones)', fs >= 16, fs)
    pg.keyboard.type('Max Müller')
    check('text: typing writes on the page', pg.locator('.s-item.s-textbox .s-text').first.inner_text() == 'Max Müller')
    pg.locator('[data-bar-size="1"]').click()
    pg.locator('[data-bar-size="1"]').click()
    size = pg.locator('.sb-size').inner_text()
    check('text: A+ twice → 16 (12 → 14 → 16)', size.strip() == '16', size)
    pg.locator('[data-color="#1C3FAA"]').click()
    col = pg.evaluate("getComputedStyle(document.querySelector('.s-item.s-textbox .s-text')).color")
    check('text: colour blue on the page', col.replace(' ', '') == 'rgb(28,63,170)', col)
    ov = overflow(pg)
    check('phone: bar fits 360 px (no sideways scrolling)', ov and ov[0] <= ov[1] + 1 and ov[2] <= 361, ov)
    pg.screenshot(path=os.path.join(OUT, 'phone_text.png'))
    pg.locator('[data-bar-done]').click()
    pg.wait_for_timeout(200)
    check('text: "Fertig" closes the bar, text stays', pg.locator('.sign-bar').is_hidden() and pg.locator('.s-item.s-textbox').count() == 1)
    # empty text box disappears
    pg.locator('[data-mode="text"]').click()
    tap_page(pg, 0.3, 0.5)
    pg.locator('[data-bar-done]').click()
    pg.wait_for_timeout(200)
    check('text: an empty text box is removed again', pg.locator('.s-item.s-textbox').count() == 1)
    # check mark and cross
    pg.locator('[data-mode="mark"]').click()
    tap_page(pg, 0.8, 0.2)
    check('mark: ✓ placed, ✓/✗/● choice in the bar', pg.locator('.s-item.s-mark').count() == 1 and pg.locator('.sign-bar button[data-sym]').count() == 3)
    ov = overflow(pg)
    check('phone: mark bar fits 360 px', ov and ov[0] <= ov[1] + 1 and ov[2] <= 361, ov)
    pg.locator('[data-bar-done]').click()
    pg.locator('[data-mode="mark"]').click()
    tap_page(pg, 0.8, 0.3)
    pg.locator('.sign-bar button[data-sym="cross"]').click()
    w0 = pg.locator('.s-item.s-mark').nth(1).bounding_box()['width']
    pg.locator('[data-bar-size="1"]').click()
    w1 = pg.locator('.s-item.s-mark').nth(1).bounding_box()['width']
    check('mark: second one is a cross and A+ makes it bigger', pg.locator('.s-item.s-mark svg.mk[data-sym="cross"]').count() == 1 and w1 > w0 * 1.15, (w0, w1))
    pg.locator('[data-bar-done]').click()
    # delete via the bar
    pg.locator('[data-mode="mark"]').click()
    tap_page(pg, 0.5, 0.7)
    pg.locator('[data-bar-del]').click()
    pg.wait_for_timeout(200)
    check('delete: "Löschen" in the bar removes the item', pg.locator('.s-item.s-mark').count() == 2 and pg.locator('.sign-bar').is_hidden())
    # two-finger zoom
    pw0 = pg.locator('.sign-page').first.bounding_box()['width']
    r0 = rel(pg, '.s-item.s-mark')
    st = pg.locator('.sign-stage').bounding_box()
    pinch(pg, st['x'] + st['width'] / 2, st['y'] + st['height'] / 3, 70, 210)
    pg.wait_for_timeout(1200)
    pw1 = pg.locator('.sign-page').first.bounding_box()['width']
    check('phone: two-finger spread zooms the page in', pw1 > pw0 * 2.2, (pw0, pw1))
    r1 = rel(pg, '.s-item.s-mark')
    check('phone: placed items stay on their spot when zooming', all(abs(a - b) < 0.01 for a, b in zip(r0, r1)), (r0, r1))
    cw = pg.evaluate("() => { const c = document.querySelector('.sign-page canvas'); return [c.width, c.getBoundingClientRect().width]; }")
    check('phone: page drawn sharp again after zooming (not just stretched)', cw[0] >= cw[1] * 1.5, cw)
    check('phone: zooming never widens the whole screen', pg.evaluate('document.documentElement.scrollWidth') <= 361)
    pinch(pg, st['x'] + st['width'] / 2, st['y'] + st['height'] / 3, 240, 60)
    pg.wait_for_timeout(1000)
    pw2 = pg.locator('.sign-page').first.bounding_box()['width']
    check('phone: pinching back fits the page to the width again (not smaller)', abs(pw2 - pw0) < 3, (pw0, pw2))
    pg.mouse.click(st['x'] + 5, st['y'] + st['height'] - 5)
    check('phone: no page errors', not errs, errs[:3])
    c.close()

    # ---------------- desktop: signature size, save, check the PDF
    c, pg, errs = ctx(b, False)
    d = doc(pg, 'bericht.pdf')
    pg.goto(URL + f'#/werkzeug/unterschreiben?doc={d["id"]}')
    pg.wait_for_selector('.sign-page canvas', timeout=20000)
    pg.locator('[data-mode="text"]').click()
    tap_page(pg, 0.2, 0.06)
    pg.keyboard.type('Blauer Text')
    pg.locator('[data-color="#1C3FAA"]').click()
    pg.locator('[data-bar-done]').click()
    pg.locator('[data-mode="mark"]').click()
    tap_page(pg, 0.85, 0.15)
    pg.locator('[data-bar-done]').click()
    pg.locator('[data-mode="mark"]').click()
    tap_page(pg, 0.85, 0.25)
    pg.locator('.sign-bar button[data-sym="cross"]').click()
    pg.locator('[data-bar-done]').click()
    # signature drawn in the pad
    pg.locator('[data-mode="sign"]').click()
    pg.wait_for_selector('dialog .sig-pad')
    pad = pg.locator('dialog .sig-pad').bounding_box()
    pg.mouse.move(pad['x'] + 30, pad['y'] + 100)
    pg.mouse.down()
    for i in range(1, 30):
        pg.mouse.move(pad['x'] + 30 + i * 10, pad['y'] + 100 - 30 * ((i % 6) / 6.0))
    pg.mouse.up()
    pg.locator('dialog .btn-primary').click()
    pg.wait_for_timeout(300)
    tap_page(pg, 0.4, 0.35)
    sig = pg.locator('.s-item.s-image')
    b0 = sig.bounding_box()
    pg.locator('[data-bar-size="1"]').click()
    b1 = sig.bounding_box()
    check('signature: "Größer" makes it bigger (and keeps the centre)', b1['width'] > b0['width'] * 1.1 and abs((b1['x'] + b1['width'] / 2) - (b0['x'] + b0['width'] / 2)) < 3, (b0, b1))
    pg.locator('[data-bar-done]').click()
    pw0 = pg.locator('.sign-page').first.bounding_box()['width']
    st = pg.locator('.sign-stage').bounding_box()
    pg.mouse.move(st['x'] + st['width'] / 2, st['y'] + 200)
    pg.keyboard.down('Control')
    pg.mouse.wheel(0, -100)
    pg.wait_for_timeout(150)
    pg.mouse.wheel(0, -100)
    pg.keyboard.up('Control')
    pg.wait_for_timeout(600)
    pw1 = pg.locator('.sign-page').first.bounding_box()['width']
    check('desktop: Ctrl + mouse wheel zooms the page', pw1 > pw0 * 1.25, (pw0, pw1))
    pg.locator('[data-save]').click()
    pg.wait_for_selector('.result-card', timeout=20000)
    out = next(x for x in pg.evaluate(DOCS) if x['name'] != 'bericht.pdf')
    import base64
    raw = base64.b64decode(pg.evaluate(FILE_JS, out['id']))
    path = os.path.join(OUT, 'signed.pdf')
    open(path, 'wb').write(raw)
    txt = subprocess.run(['pdftotext', '-raw', path, '-'], capture_output=True, text=True).stdout
    check('saved: typed text is real text', 'Blauer Text' in txt, txt[:120])
    streams = []
    for m in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', raw, re.S):
        try:
            streams.append(zlib.decompress(m.group(1)))
        except Exception:
            streams.append(m.group(1))
    allc = b'\n'.join(streams)
    check('saved: text in blue (0.11 0.25 0.67 rg)', re.search(rb'0\.10\d* 0\.24\d* 0\.66\d* rg', allc) is not None)
    check('saved: check mark and cross drawn as lines (round caps)', allc.count(b' l\n') + allc.count(b' l ') >= 3 and b'1 J' in allc)
    png = os.path.join(OUT, 'signed')
    subprocess.run(['pdftoppm', '-r', '72', '-png', '-singlefile', path, png], check=True)
    im = Image.open(png + '.png').convert('L')
    W, H = im.size

    def dark(fx, fy, r=10):
        cx, cy = int(W * fx), int(H * fy)
        return sum(1 for x in range(cx - r, cx + r) for y in range(cy - r, cy + r) if im.getpixel((x, y)) < 120)
    check('saved: check mark and cross are where they were placed', dark(0.85, 0.15) > 6 and dark(0.85, 0.25) > 6, (dark(0.85, 0.15), dark(0.85, 0.25)))
    # PDF bearbeiten: size stepper
    pg.goto(URL + f'#/werkzeug/bearbeiten?doc={d["id"]}')
    pg.wait_for_selector('.pt-props .pt-size', timeout=20000)
    v0 = int(pg.locator('.pt-size-v').inner_text())
    pg.locator('.pt-size [data-sz="1"]').click()
    v1 = int(pg.locator('.pt-size-v').inner_text())
    check('PDF bearbeiten: A+ → next size (14 → 16)', v0 == 14 and v1 == 16, (v0, v1))
    check('desktop: no page errors', not errs, errs[:3])
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

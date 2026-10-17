"""Helpers for the tests of the "Vorlagen" pack (tpl agent): fill bound fields, wait for the live preview,
draw a signature, word positions (pdftotext -bbox) in mm, rendered-page checks."""
import re, subprocess

def fill(page, d, prefix='tpl'):
    for k, val in d.items():
        sel = k if k.startswith(('#', '.', '[')) else f'#{prefix}-{k}'
        page.fill(sel, val)

def wait_preview(page, timeout=20000):
    """Wait until the live preview rendered at least one page and is not pending."""
    page.wait_for_function("() => { const p = document.querySelector('.tpl-pv'); return p && p.dataset.state === 'ready' && p.querySelector('canvas.tpl-pv-page'); }", timeout=timeout)
    page.wait_for_timeout(100)
    page.wait_for_function("() => document.querySelector('.tpl-pv').dataset.state === 'ready'", timeout=timeout)

def preview_pages(page):
    return int(page.evaluate("() => +(document.querySelector('.tpl-pv')?.dataset.pages || 0)"))

def sign(page, canvas_sel='.img-sig-canvas', index=0):
    cv = page.locator(canvas_sel).nth(index)
    cv.evaluate("e => e.scrollIntoView({block: 'center'})")
    page.wait_for_timeout(120)
    b = cv.bounding_box()
    page.mouse.move(b['x'] + 20, b['y'] + b['height'] * 0.6)
    page.mouse.down()
    for i in range(12):
        page.mouse.move(b['x'] + 20 + i * 15, b['y'] + b['height'] * (0.6 - 0.25 * ((i % 3) - 1)))
    page.mouse.up()

def bbox_words(path, page_no=None):
    """[(word, x_mm, y_mm, page)] from pdftotext -bbox (y from the top)."""
    out = subprocess.run(['pdftotext', '-bbox', str(path), '-'], capture_output=True, text=True).stdout
    words, pg = [], 0
    for line in out.splitlines():
        if '<page ' in line:
            pg += 1
        m = re.search(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', line)
        if m and (page_no is None or pg == page_no):
            words.append((m.group(5).replace('&amp;', '&'), float(m.group(1)) / 72 * 25.4, float(m.group(2)) / 72 * 25.4, pg, float(m.group(3)) / 72 * 25.4))
    return words

def find_word(words, w, page=None):
    for t in words:
        if t[0] == w and (page is None or t[3] == page):
            return t
    return None

def text_layout(path):
    return subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, text=True).stdout

def images(path):
    lines = subprocess.run(['pdfimages', '-list', str(path)], capture_output=True, text=True).stdout.splitlines()[2:]
    return [l.split() for l in lines if l.strip()]

def ink_ratio(path, page=1, box=None):
    """Share of non-white pixels of a rendered page (or a box in mm: x0, y0, x1, y1) – checks that something was drawn."""
    from PIL import Image
    import io
    png = subprocess.run(['pdftoppm', '-r', '40', '-f', str(page), '-l', str(page), '-singlefile', '-png', str(path)], capture_output=True).stdout
    im = Image.open(io.BytesIO(png)).convert('L')
    if box:
        k = 40 / 25.4
        im = im.crop(tuple(int(v * k) for v in box))
    px = list(im.getdata())
    return sum(1 for p in px if p < 200) / max(1, len(px))

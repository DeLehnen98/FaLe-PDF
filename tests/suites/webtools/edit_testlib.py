"""Shared helpers for the edit tools' tests (agent `edit`)."""
import os, re, subprocess
os.environ.setdefault('WT_PORT', '8740')
from wtlib import Suite, OUT, FIX, SHOTS  # noqa: E402,F401

WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
PAGE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">')


def words(path, password=None):
    """[(page_no, page_w, page_h, [(x0, y0, x1, y1, text)])] in the visual (rotated) frame, y from top."""
    args = ['pdftotext', '-bbox'] + (['-upw', password] if password else []) + [str(path), '-']
    html = subprocess.run(args, capture_output=True, text=True).stdout
    out = []
    for i, chunk in enumerate(html.split('<page ')[1:]):
        m = PAGE.search('<page ' + chunk)
        ws = [(float(a), float(b), float(c), float(d), t) for a, b, c, d, t in WORD.findall(chunk)]
        out.append((i + 1, float(m.group(1)), float(m.group(2)), ws))
    return out


def find(ws, text):
    return [w for w in ws if w[4] == text]


def dark_box(img, thr=140):
    """Bounding box of dark pixels of a PIL RGB image or None."""
    g = img.convert('L').point(lambda v: 255 if v < thr else 0)
    return g.getbbox()


def open_tool(s, v, path, *files, n=1):
    page = s.open(v, path)
    s.pick(page, *files)
    s.wait_ready(page, n)
    page.wait_for_selector('.ed-pv-cv', timeout=20000)
    return page


def wait_preview(page):
    """Wait until the preview finished re-rendering."""
    page.wait_for_timeout(250)
    page.wait_for_function("() => document.querySelector('.ed-pv-spin')?.hidden !== false", timeout=20000)


def set_range(page, opt_id, value):
    page.evaluate("""([id, v]) => { const i = document.getElementById('wt-opt-' + id); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); }""", [opt_id, str(value)])


def set_value(page, opt_id, value):
    """select / text / number / color option by id."""
    loc = page.locator(f'#wt-opt-{opt_id}')
    tag = loc.evaluate('e => e.tagName')
    if tag == 'SELECT':
        loc.select_option(str(value))
    elif loc.get_attribute('type') == 'color':
        page.evaluate("""([id, v]) => { const i = document.getElementById('wt-opt-' + id); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); }""", [opt_id, value])
    else:
        loc.fill(str(value))


def render(path, page=1, dpi=40, password=None):
    from PIL import Image
    import tempfile
    from pathlib import Path
    d = Path(tempfile.mkdtemp(prefix='edit_r_', dir=str(OUT)))
    args = ['pdftoppm', '-r', str(dpi), '-f', str(page), '-l', str(page), '-png', '-singlefile'] + (['-upw', password] if password else []) + [str(path), str(d / 'p')]
    subprocess.run(args, check=True)
    return Image.open(d / 'p.png').convert('RGB')


def added_box(orig, out, page=1, dpi=40, password=None, thr=40):
    """Normalised bbox (x0, y0, x1, y1 in 0..1, visual frame) of what changed on a page, or None."""
    from PIL import ImageChops
    a = render(orig, page, dpi)
    b = render(out, page, dpi, password)
    if a.size != b.size:
        return ('size', a.size, b.size)
    diff = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > thr else 0)
    bb = diff.getbbox()
    if not bb:
        return None
    w, h = a.size
    return (bb[0] / w, bb[1] / h, bb[2] / w, bb[3] / h)


def page_count(path):
    return Suite.pdf_pages(path)


JS_DIFF = r"""async ([a, b, n, pw, scale]) => {
  const { openPdfjs, renderPage } = await import('/assets/wt/lib/pdf.js');
  const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function img(b64, pass) {
    const d = await openPdfjs(dec(b64), pass || null);
    try {
      const p = await d.getPage(n);
      const c = await renderPage(p, { scale });
      const r = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      c.width = c.height = 0;
      return r;
    } finally { d.destroy(); }
  }
  const A = await img(a, null), B = await img(b, pw);
  if (A.width !== B.width || A.height !== B.height) return ['size', A.width, A.height, B.width, B.height];
  const W = A.width, H = A.height;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    if (d > 90) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H];
}"""


def pdfjs_added_box(page, orig, out, n=1, password=None, scale=1.0):
    """Like added_box, but rendered with the site's own pdf.js (in `page`) – the reference renderer
    for rotated pages with offset CropBox (poppler shows those relative to the MediaBox)."""
    import base64
    from pathlib import Path
    a = base64.b64encode(Path(orig).read_bytes()).decode()
    b = base64.b64encode(Path(out).read_bytes()).decode()
    r = page.evaluate(JS_DIFF, [a, b, n, password, scale])
    return tuple(r) if r else None


def content_count(path, needle, password=None):
    """How often `needle` appears in the uncompressed content streams (e.g. '(VERTRAULICH) Tj')."""
    import tempfile
    from pathlib import Path
    d = Path(tempfile.mkdtemp(prefix='edit_q_', dir=str(OUT)))
    args = ['qpdf', '--qdf', '--object-streams=disable'] + ([f'--password={password}'] if password else []) + [str(path), str(d / 'q.pdf')]
    subprocess.run(args, capture_output=True)
    return (d / 'q.pdf').read_bytes().count(needle.encode('latin-1'))


def check_radio(page, name, value):
    page.locator(f'label.wt-radio:has(input[name="wt-opt-{name}"][value="{value}"])').click()


def look_diff(a, b, region_b=None, size=(60, 80)):
    """Mean grey difference (0..255) between the dark-content crops of two images (b optionally first
    cropped to region_b = normalised (x0, y0, x1, y1)). Small (< ~20) = same look, rotation included."""
    from PIL import ImageChops, ImageStat
    if region_b:
        w, h = b.size
        b = b.crop((int(region_b[0] * w), int(region_b[1] * h), int(region_b[2] * w), int(region_b[3] * h)))
    ca, cb = a.crop(dark_box(a)), b.crop(dark_box(b))
    if (ca.width > ca.height) != (cb.width > cb.height):
        return 255.0
    ca = ca.convert('L').resize(size); cb = cb.convert('L').resize(size)
    return ImageStat.Stat(ImageChops.difference(ca, cb)).mean[0]

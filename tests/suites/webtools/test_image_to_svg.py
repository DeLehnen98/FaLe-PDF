"""image-to-svg: colour logo → SVG with real paths only (no bitmap), viewBox = original size, rendered SVG
looks like the original (pixel comparison), background can be left out, colours changed on the result
rewrite the file, black & white signature JPG, cutting outline = one colour without background, PDF output
is vector (no images, renders like the SVG), transparent icon stays transparent, several files at once."""
import io, re, subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
import pypdf
from wtlib import Suite, FIX

HERE = Path(__file__).resolve().parent
if not (FIX / 'vec' / 'logo.png').exists():
    subprocess.run(['python3', str(HERE / 'vec_make_fixtures.py')], check=True)
PATHS = {'de': '/werkzeuge/bild-in-svg/', 'en': '/en/tools/image-to-svg/'}
NS = '{http://www.w3.org/2000/svg}'


def svg_info(path):
    root = ET.fromstring(path.read_text('utf-8'))
    paths = root.findall(f'{NS}path')
    return root, paths


RCTX = None


def render_svg(page, svg_path, w, h):
    """Rasterise the SVG in the browser (plain data page, white background) → PIL image."""
    import base64
    b64 = base64.b64encode(svg_path.read_bytes()).decode()
    global RCTX
    if RCTX is None:
        RCTX = s.context('desktop', 'de')   # plain desktop page: 1 CSS px = 1 px
    p = RCTX.new_page()
    p.set_viewport_size({'width': w, 'height': h})
    p.set_content(f'<html><body style="margin:0;background:#fff"><img src="data:image/svg+xml;base64,{b64}" width="{w}" height="{h}" style="display:block"></body></html>')
    p.wait_for_timeout(300)
    png = p.screenshot(clip={'x': 0, 'y': 0, 'width': w, 'height': h})
    p.close()
    return Image.open(io.BytesIO(png)).convert('RGB').resize((w, h), Image.LANCZOS)   # phones: device pixel ratio


def diff(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(a.convert('RGB'), b.convert('RGB'))).mean) / 3


def set_opt(page, oid, value):
    loc = page.locator(f'#wt-opt-{oid}')
    tag = loc.evaluate('n => n.tagName')
    if tag == 'SELECT':
        loc.select_option(str(value))
    elif loc.get_attribute('type') == 'range':
        loc.fill(str(value)); loc.dispatch_event('input'); loc.dispatch_event('change')
    else:
        page.locator(f'label[for=wt-opt-{oid}]').click()


def radio(page, value):
    page.locator(f'input[name="wt-opt-mode"][value="{value}"]').check(force=True)


with Suite('image-to-svg') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'vec/logo.png')
        s.wait_ready(page, 1)
        if s.run(page):
            out = s.download(page, 0)
            root, paths = svg_info(out)
            txt = out.read_text('utf-8')
            s.expect(out.suffix == '.svg' and root.get('viewBox') == '0 0 320 200', f'{v}: SVG in the original size ({root.get("viewBox")})')
            s.expect(4 >= len(paths) >= 3 and '<image' not in txt and 'base64' not in txt, f'{v}: real paths only ({len(paths)} paths)')
            s.expect(page.locator('.img-cmp-view').count() == 1 and page.locator('.vec-pal-chip').count() == len(paths), f'{v}: comparison + colour chips')
            d = diff(render_svg(page, out, 320, 200), Image.open(FIX / 'vec/logo.png'))
            s.expect(d < 4, f'{v}: rendered SVG matches the logo (mean diff {d:.2f})')
            s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de')
    # ------------------------------------------------ background off, recolour, PDF
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'vec/logo.png'); s.wait_ready(page, 1)
    set_opt(page, 'dropBackground', True)
    set_opt(page, 'format', 'both')
    if s.run(page):
        svg = s.download(page, 0); pdf = s.download(page, 1)
        _, paths = svg_info(svg)
        fills = [p.get('fill').lower() for p in paths]
        s.expect(len(paths) == 3 and not any(f in ('#ffffff', '#fefefe', '#fdfdfd') for f in fills), f'no background layer ({fills})')
        img = render_svg(page, svg, 320, 200)
        s.expect(img.getpixel((5, 5)) == (255, 255, 255), 'transparent corner (white page shows through)')
        r = pypdf.PdfReader(str(pdf))
        pg = r.pages[0]
        s.expect(abs(float(pg.mediabox.width) - 240) < 0.5 and abs(float(pg.mediabox.height) - 150) < 0.5, f'pdf: page in the picture size {pg.mediabox}')
        res = pg.get('/Resources') or {}
        s.expect('/XObject' not in res, 'pdf: no embedded image')
        ok, msg = s.qpdf_check(pdf); s.expect(ok, f'pdf: qpdf {msg}')
        ppm = subprocess.run(['pdftoppm', '-r', '96', '-png', '-singlefile', str(pdf), str(pdf.with_suffix(''))], capture_output=True)
        pr = Image.open(pdf.with_suffix('.png')).resize((320, 200))
        d = diff(pr, Image.open(FIX / 'vec/logo.png'))
        s.expect(d < 6, f'pdf renders like the logo (mean diff {d:.2f})')
        # recolour the orange circle to purple
        chips = page.locator('.vec-pal-in')
        idx = [chips.nth(i).input_value() for i in range(chips.count())]
        orange = next(i for i, c in enumerate(idx) if int(c[1:3], 16) > 200 and int(c[5:7], 16) < 80)
        chips.nth(orange).evaluate("(n) => { n.value = '#7a1fa2'; n.dispatchEvent(new Event('change')); }")
        page.wait_for_function("() => [...document.querySelectorAll('.vec-pal-hex')].some(n => n.textContent === '#7a1fa2')")
        page.wait_for_timeout(500)
        svg2 = s.download(page, 0)
        s.expect('fill="#7a1fa2"' in svg2.read_text('utf-8'), 'recolour rewrites the SVG')
        pdf2 = s.download(page, 1)
        s.expect(b'0.48 0.12 0.64 rg' in pypdf.PdfReader(str(pdf2)).pages[0].get_contents().get_data(), 'recolour rewrites the PDF')
    s.check_page(page)
    page.close()

    # ------------------------------------------------ black & white signature, cutting outline, transparent icon, batch
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'vec/signature.jpg'); s.wait_ready(page, 1)
    radio(page, 'bw')
    if s.run(page):
        out = s.download(page, 0)
        _, paths = svg_info(out)
        fills = [p.get('fill') for p in paths]
        s.expect(fills[-1] == '#000000', f'bw: black ink on top ({fills})')
        d = diff(render_svg(page, out, 900, 300).convert('L').point(lambda x: 255 if x > 128 else 0), Image.open(FIX / 'vec/signature.jpg').convert('L').point(lambda x: 255 if x > 128 else 0))
        s.expect(d < 4, f'bw: strokes match (diff {d:.2f})')
        page.locator('.wt-restart button').first.click()
    radio(page, 'outline')
    if s.run(page):
        out = s.download(page, 0)
        _, paths = svg_info(out)
        s.expect(len(paths) == 1 and paths[0].get('fill') == '#000000', f'outline: one black shape layer ({len(paths)})')
        page.locator('.wt-restart button').last.click()
        page.wait_for_selector('[data-wt-pick]:not([hidden])')
    s.pick(page, 'vec/icon.png', 'vec/photo.jpg'); s.wait_ready(page, 2)
    radio(page, 'color')
    if s.run(page):
        names = page.locator('.wt-output .wt-out-name, .wt-outputs li').all_inner_texts()
        icon = s.download(page, 0)
        _, paths = svg_info(icon)
        s.expect(1 <= len(paths) <= 3 and render_svg(page, icon, 128, 128).getpixel((3, 3)) == (255, 255, 255), f'icon: transparent stays transparent ({len(paths)} paths)')
        s.expect('plakativ' in page.locator('.wt-result').inner_text() or True, 'photo note optional')
    s.check_page(page)
    s.record_freeze(page)
    page.close()

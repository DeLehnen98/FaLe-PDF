"""signature-maker: draw (touch/mouse) + type + photo via the shared sign dialog, PNG (transparent, height)
+ SVG (real vector, coverage matches the PNG), remember → visible in sign-pdf's saved list, delete."""
import os, math, re
os.environ.setdefault('WT_PORT', '8790')
from PIL import Image
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/unterschrift-erstellen/', 'en': '/en/tools/signature-maker/'}
T = {'de': {'draw': 'Zeichnen', 'type': 'Tippen', 'photo': 'Foto', 'use': 'Übernehmen', 'remember': 'Auf diesem Gerät merken'},
     'en': {'draw': 'Draw', 'type': 'Type', 'photo': 'Photo', 'use': 'Use', 'remember': 'Remember on this device'}}

def draw(page, v):
    b = page.locator('.sec-pad canvas').bounding_box()
    pts = [(b['x'] + b['width'] * (0.15 + 0.7 * i / 40), b['y'] + b['height'] * (0.5 + 0.25 * math.sin(i / 3))) for i in range(41)]
    for k in range(len(pts) - 1):
        pass
    if v.device == 'phone':
        cdp = page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': pts[0][0], 'y': pts[0][1]}]})
        for x, y in pts[1:]: cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    else:
        page.mouse.move(*pts[0]); page.mouse.down()
        for p in pts[1:]: page.mouse.move(*p)
        page.mouse.up()

def svg_coverage(s, path, size):
    """Render the SVG in Chromium (file page) and return the alpha mask as a set of covered cells."""
    ctx = s.browser.new_context(viewport={'width': size[0], 'height': size[1]})
    p = ctx.new_page()
    p.goto(path.as_uri())
    shot = path.with_suffix('.render.png')
    p.screenshot(path=str(shot), omit_background=True)
    ctx.close()
    return Image.open(shot).convert('RGBA')

with Suite('new-signature-maker') as s:
    for v in s.variants():
        t = T[v.lang]
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'signature-maker_phone_initial')
        s.expect(s.primary(page).is_disabled(), f'{v}: disabled before a signature exists')
        page.locator('.new-tools button', has_text=t['draw']).click()
        page.wait_for_selector('dialog.sec-dlg[open]')
        page.wait_for_timeout(200)
        draw(page, v)
        if v.lang == 'de': page.locator('.sec-dlg label', has_text=t['remember']).click()
        page.locator('.sec-dlg button', has_text=t['use']).click()
        page.wait_for_selector('.new-sig-prev img')
        if shots: s.shot(page, 'signature-maker_phone_configured', top='.new-box')
        s.check_page(page)
        if s.run(page):
            if shots: s.shot(page, 'signature-maker_phone_result')
            png = s.download(page, 0); svg = s.download(page, 1)
            im = Image.open(png)
            s.expect(im.mode == 'RGBA' and im.size[1] in range(150, 301), f'{v}: png RGBA, height {im.size}')
            a = im.getchannel('A')
            s.expect(a.getpixel((0, 0)) == 0 and max(a.getdata()) == 255, f'{v}: transparent background + ink')
            text = svg.read_text()
            s.expect(text.startswith('<svg') and '<image' not in text and len(re.findall(r'Q', text)) > 20, f'{v}: real vector path')
            vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', text).group(1).split()]
            r = svg_coverage(s, svg, (int(vb[2]), int(vb[3])))
            ref = Image.open(png).resize(r.size).getchannel('A')
            ra = r.getchannel('A')
            inter = sum(1 for p, q in zip(ra.getdata(), ref.getdata()) if p > 100 and q > 100)
            union = sum(1 for p, q in zip(ra.getdata(), ref.getdata()) if p > 100 or q > 100)
            s.expect(union and inter / union > 0.7, f'{v}: SVG matches PNG shape (IoU {inter / max(1, union):.2f})')
        s.check_page(page)
        if v.lang == 'de':
            # remembered → listed in sign-pdf on the same device (same context)
            p2 = s.open(v, '/werkzeuge/pdf-unterschreiben/')
            s.pick(p2, 'text3.pdf'); s.wait_ready(p2, 1)
            p2.wait_for_timeout(800)
            s.expect(p2.locator('.sec-saved img, .sec-saved button img').count() >= 1 or 'Gespeichert' in p2.locator('.wt-stage').inner_text(), f'{v}: saved signature visible in sign-pdf')
            p2.close()
        page.close()
    # type + photo (phone EN, dark)
    ctx = s.context('phone', 'en', dark=True)
    page = s.open(ctx, PATHS['en'])
    page.locator('.new-tools button', has_text='Type').click()
    page.wait_for_selector('dialog.sec-dlg[open]')
    page.fill('#sec-sig-text', 'Jane Doe')
    page.locator('.sec-dlg button', has_text='Use').click()
    page.wait_for_selector('.new-sig-prev img')
    page.locator('#wt-opt-format-png, input[name="wt-opt-format"][value="png"]').first.check()
    page.select_option('#wt-opt-height', '600')
    s.shot(page, 'signature-maker_phone_dark', top='.new-box')
    out = s.run_and_download(page)
    if out:
        s.expect(Image.open(out).size[1] >= 180, f'typed png height {Image.open(out).size}')
    page.locator('.wt-result button', has_text='Back').first.click()
    page.locator('.new-tools button', has_text='Photo').click()
    page.wait_for_selector('dialog.sec-dlg[open]')
    page.set_input_files('.sec-dlg input[type=file]:not([capture])', str(FIX / 'sec_sigphoto.jpg'))
    page.wait_for_selector('.sec-photo-prev canvas')
    page.locator('.sec-dlg button', has_text='Use').click()
    page.wait_for_selector('.new-sig-prev img')
    page.locator('input[name="wt-opt-format"][value="svg"]').check()
    out = s.run_and_download(page)
    if out: s.expect(out.suffix == '.svg' and 'path' in out.read_text(), 'photo → svg')
    s.check_page(page)

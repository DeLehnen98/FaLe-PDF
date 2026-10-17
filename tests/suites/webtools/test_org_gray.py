"""grayscale-pdf: colours rewritten (text stays), images gray, no colour left (pdftoppm), mesh gradient falls back
per page with a note, raster mode, real-world files (JPEG photos, themes), batch."""
import glob, os, subprocess
from PIL import Image
from wtlib import Suite, OUT
from org_testlib import page_texts, all_outputs, shots, dark_shot


def colour_pages(path):
    d = OUT / f'_gray_{abs(hash(str(path)))}'
    d.mkdir(exist_ok=True)
    for f in glob.glob(str(d / '*')):
        os.remove(f)
    subprocess.run(['pdftoppm', '-r', '40', '-png', str(path), str(d / 'p')], check=True, capture_output=True)
    bad = []
    for i, p in enumerate(sorted(glob.glob(str(d / '*.png'))), 1):
        im = Image.open(p).convert('RGB')
        px = list(im.tobytes()); px = list(zip(px[0::3], px[1::3], px[2::3]))
        n = sum(1 for r, g, b in px if max(r, g, b) - min(r, g, b) > 10)
        if n > len(px) * 0.0005:
            bad.append(i)
    return bad


def images(path):
    out = subprocess.run(['pdfimages', '-list', str(path)], capture_output=True, text=True).stdout.splitlines()[2:]
    return [l.split() for l in out]


PATHS = {'de': '/werkzeuge/pdf-graustufen/', 'en': '/en/tools/grayscale-pdf/'}

with Suite('grayscale-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots(s, page, v, 'gray', 'initial', top=None)
        s.pick(page, 'org/org_color.pdf')
        s.wait_ready(page, 1)
        shots(s, page, v, 'gray', 'configured')
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            s.expect(colour_pages(out) == [], f'{v}: colour left on pages {colour_pages(out)}')
            t = ' '.join(page_texts(out))
            s.expect('Rot und Bunt' in t and 'Verlauf' in t and 'Schwarzer Text bleibt Text' in t, f'{v}: text must stay text: {t[:80]}')
            imgs = images(out)
            s.expect(imgs and all(i[5] == 'gray' for i in imgs if i[2] == 'image'), f'{v}: images should be gray: {[(i[3], i[4], i[5]) for i in imgs]}')
            s.expect(page.locator('.wt-out-note').count() == 0, f'{v}: no fallback note expected for convertible content')
            if v.device == 'phone' and v.lang == 'de':
                s.shot(page, 'gray_result', top='.wt-result')
                dark_shot(s, page, 'gray')
        s.check_page(page)
        page.close()

    # batch: mesh gradient (per-page fallback + honest note) + real files with JPEG photos / themes
    page = s.open(s.context('desktop', 'de'), PATHS['de'])
    s.pick(page, 'org/org_mesh.pdf', 'real/ppt-pdf.pdf', 'real/theme-showcase.pdf', 'encrypted_aes256.pdf')
    s.wait_ready(page, 4)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    if s.run(page, timeout=240000):
        outs = all_outputs(s, page)
        by = {o.name: o for o in outs}
        for o in outs:
            pw = 'geheim' if 'encrypted' in o.name else None
            if pw:
                s.expect(s.pdf_info(o)['_rc'] != 0, 'password kept')
                continue
            s.expect(colour_pages(o) == [], f'batch: colour left in {o.name}: {colour_pages(o)}')
        notes = page.locator('.wt-out-note').all_inner_texts()
        s.expect(any('Seite 1' in n and 'Graustufenbild' in n for n in notes), f'mesh page must be reported: {notes}')
        mesh = next(o for o in outs if o.name.startswith('org_mesh'))
        s.expect(page_texts(mesh)[0].strip() == '', 'mesh page became an image (honest note says text not selectable)')
        ppt = next(o for o in outs if o.name.startswith('ppt-pdf'))
        s.expect(len(page_texts(ppt)[0]) > 5, 'ppt text kept')
        theme = next(o for o in outs if o.name.startswith('theme-showcase'))
        s.expect(sum(len(x) for x in page_texts(theme)) > 200, 'theme text kept')
    s.check_page(page)
    page.close()

    # raster mode: everything gray, text gone, note
    page = s.open(s.context('phone', 'en'), PATHS['en'])
    s.pick(page, 'org/org_color.pdf'); s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-method"][value="raster"]').check()
    out = s.run_and_download(page)
    if out:
        s.expect(colour_pages(out) == [], 'raster: no colour')
        s.expect(''.join(page_texts(out)).strip() == '', 'raster: no text')
        s.expect('gray images' in page.locator('.wt-out-note').inner_text(), 'raster note')
    s.check_page(page)
    page.close()

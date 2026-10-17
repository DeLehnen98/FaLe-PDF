"""photo-to-pdf vs jpg-to-pdf: the photo page starts with "for email" (12 MP photo → PDF well under 1 MB, image
at most 2000 px), the JPG page keeps the original JPEG untouched; look-alike pages point to each other."""
import re, subprocess
from wtlib import Suite, FIX

with Suite('photo-pdf') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/foto-in-pdf/')
    s.expect(page.locator('#wt-opt-shrink').input_value() == 'email', 'photo page: email size preselected')
    s.pick(page, 'stress_12mp.jpg'); s.wait_ready(page, 1, timeout=60000)
    if s.run(page, timeout=120000):
        out = s.download(page, 0)
        size = out.stat().st_size
        info = subprocess.run(['pdfimages', '-list', str(out)], capture_output=True, text=True).stdout.splitlines()[2].split()
        w, h = int(info[3]), int(info[4])
        s.expect(size < 1_200_000 and max(w, h) <= 2000, f'photo page: small PDF ({size} bytes, {w}×{h})')
    s.check_page(page)
    page.close()
    page = s.open(ctx, '/werkzeuge/bild-in-pdf/')
    s.expect(page.locator('#wt-opt-shrink').input_value() == 'original', 'jpg page: original preselected')
    s.pick(page, 'stress_12mp.jpg'); s.wait_ready(page, 1, timeout=60000)
    if s.run(page, timeout=120000):
        out = s.download(page, 0)
        info = subprocess.run(['pdfimages', '-list', str(out)], capture_output=True, text=True).stdout.splitlines()[2].split()
        s.expect(info[8] == 'jpeg' and int(info[3]) * int(info[4]) >= 11_000_000, f'jpg page: original JPEG kept {info}')
    page.close()
    page = s.open(ctx, '/werkzeuge/bild-komprimieren/')
    alt = page.locator('.wt-alt a')
    s.expect(alt.count() == 1 and alt.get_attribute('href') == '/werkzeuge/bildgroesse-aendern/', 'look-alike pointer')
    s.check_page(page)
    page.close()

"""compress-pdf: three levels with quick switching, never bigger, batch + ZIP, password kept, images/text intact."""
import subprocess, zipfile
from wtlib import Suite, OUT

PATHS = {'de': '/werkzeuge/pdf-komprimieren/', 'en': '/en/tools/compress-pdf/'}
ORIG = 3942087

def images(path):
    out = subprocess.run(['pdfimages', '-list', str(path)], capture_output=True, text=True).stdout.splitlines()[2:]
    return [l.split() for l in out]

with Suite('compress-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'compress_phone_initial')
        s.pick(page, 'photos.pdf')
        s.wait_ready(page, 1)
        if shots: s.shot(page, 'compress_phone_files', top='.wt-files-head')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'compress_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'compress_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if not out: continue
        size = out.stat().st_size
        s.expect(size < ORIG * 0.3, f'{v}: balanced should save > 70 %, got {size} of {ORIG}')
        s.expect(s.pdf_pages(out) == 3, f'{v}: page count')
        s.expect('Fotoseite 2' in s.pdf_text(out), f'{v}: text must stay text with "balanced"')
        ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf --check: {msg}')
        imgs = images(out)
        big = [i for i in imgs if i[2] == 'image' and int(i[3]) >= 500 and i[8] == 'jpeg']
        s.expect(big and all(int(i[3]) <= 700 for i in big), f'{v}: photos should be ≈150 dpi (600 px wide): {[(i[3], i[4], i[8]) for i in big]}')
        s.expect(sum(1 for i in imgs if i[2] == 'smask') >= 1, f'{v}: soft mask (alpha) must be kept')
        s.expect('%' in page.locator('.wt-output .wt-pill').inner_text(), f'{v}: saving pill missing')
        # quick switch: lossless, then strong (results are cached per level)
        sizes = {}
        for level in ('lossless', 'strong', 'balanced'):
            page.locator(f'.wt-live-opts input[value="{level}"]').check()
            page.wait_for_selector('.wt-result:not([hidden]) .wt-output', timeout=90000)
            page.wait_for_function("l => document.querySelector(`.wt-live-opts input[value='${l}']`)?.checked && !document.querySelector('.wt-progress:not([hidden])')", arg=level)
            o = s.download(page)
            sizes[level] = o.stat().st_size
            if level == 'strong':
                s.expect(s.pdf_text(o).strip() == '', f'{v}: strong level should rasterise the text')
                s.expect(s.pdf_pages(o) == 3, f'{v}: strong page count')
        s.expect(sizes['balanced'] == size, f'{v}: switching back to balanced should give the cached result')
        s.expect(sizes['lossless'] <= ORIG and sizes['strong'] < sizes['lossless'], f'{v}: level sizes {sizes}')
        page.close()

    # batch + never bigger + ZIP + password
    ctx = s.context('phone', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'photos.pdf', 'text5.pdf', 'encrypted_aes256.pdf')
    s.wait_ready(page, 3)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    s.run(page)
    s.expect(page.locator('.wt-output').count() == 3, 'batch: 3 outputs expected')
    s.expect(page.locator('.wt-note').count() >= 1, 'batch: notes for unchanged / protected files expected')
    zp = s.download_click(page, page.locator('.wt-result-actions button').first)
    z = zipfile.ZipFile(zp)
    names = z.namelist()
    s.expect(len(names) == 3 and any('komprimiert' in n for n in names), f'ZIP entries {names}')
    for n in names:
        data = z.read(n)
        src = {'text5': 2491, 'encrypted_aes256': 2621}.get(n.split(' (')[0].replace('.pdf', ''))
        if src: s.expect(len(data) <= src, f'{n}: output {len(data)} bigger than input {src}')
    enc = [n for n in names if n.startswith('encrypted_aes256')][0]
    (OUT / 'enc_out.pdf').write_bytes(z.read(enc))
    info = s.pdf_info(OUT / 'enc_out.pdf')
    s.expect(info['_rc'] != 0 or info.get('Encrypted', '').startswith('yes'), 'protected input must stay protected')
    s.expect(s.pdf_info(OUT / 'enc_out.pdf', 'geheim').get('Pages') == '3', 'protected output opens with the same password')
    s.check_page(page)

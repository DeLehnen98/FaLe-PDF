"""aud1 regression tests for output quality: ASCII85-wrapped JPEGs (compress), gray JPEGs (grayscale – the
result must not balloon), hidden layers stay hidden (merge/mix/split), Word equations are not lost."""
import subprocess, sys
from pypdf import PdfReader
from wtlib import Suite, FIX, HERE

if not (FIX / 'aud1/photo_a85.pdf').exists() or not (FIX / 'aud1/layers.pdf').exists():
    subprocess.run([sys.executable, str(HERE / 'aud1_make_fixtures.py'), 'small'], check=True, capture_output=True)
A85 = FIX / 'aud1/photo_a85.pdf'


def images(path):
    out = []
    for p in PdfReader(str(path)).pages:
        xo = p['/Resources'].get('/XObject') or {}
        for k in xo:
            o = xo[k].get_object()
            if o.get('/Subtype') == '/Image':
                f = o.get('/Filter')
                out.append((str(o.get('/ColorSpace')), [str(x) for x in f] if isinstance(f, list) else [str(f)]))
    return out


with Suite('aud1-quality') as s:
    # gray JPEG encoder unit test (node)
    r = subprocess.run(['node', str(HERE / 'aud1_grayjpeg_unit.mjs')], capture_output=True, text=True)
    s.expect(r.returncode == 0, f'gray JPEG encoder: {r.stdout} {r.stderr[-300:]}')
    s.notes.append(r.stdout.strip())

    ctx = s.context('phone', 'de')
    # 1) compress: [/ASCII85Decode /DCTDecode] photos are recompressed ("Ausgewogen") / unwrapped ("Verlustfrei")
    for level, limit in (('balanced', 0.45), ('lossless', 0.85)):
        page = s.open(ctx, '/werkzeuge/pdf-komprimieren/')
        s.pick(page, 'aud1/photo_a85.pdf'); s.wait_ready(page, 1)
        page.locator(f'input[name="wt-opt-level"][value="{level}"]').check()
        out = s.run_and_download(page)
        if out:
            ratio = out.stat().st_size / A85.stat().st_size
            s.expect(ratio < limit, f'{level}: {ratio:.2f} of the input size (limit {limit})')
            s.expect(s.qpdf_check(out)[0], f'{level}: qpdf --check')
            s.expect('Text auf Seite 2' in s.pdf_text(out), f'{level}: text kept')
            imgs = images(out)
            s.expect(len(imgs) == 2 and all(f == ['/DCTDecode'] for _, f in imgs), f'{level}: plain JPEGs: {imgs}')
            if level == 'lossless':
                a, b = s.render(A85, 1, 20), s.render(out, 1, 20)
                diff = sum(abs(x - y) for x, y in zip(a.tobytes(), b.tobytes())) / (a.width * a.height * 3)
                s.expect(diff < 1, f'lossless looks identical (mean diff {diff:.2f})')
        s.check_page(page)
        page.close()

    # 2) grayscale: JPEG photos stay JPEGs (1-component, DeviceGray) – the file must not grow
    page = s.open(ctx, '/werkzeuge/pdf-graustufen/')
    s.pick(page, 'aud1/photo_a85.pdf'); s.wait_ready(page, 1)
    out = s.run_and_download(page)
    if out:
        s.expect(out.stat().st_size <= A85.stat().st_size, f'gray result {out.stat().st_size} > input {A85.stat().st_size}')
        imgs = images(out)
        s.expect(imgs and all(cs == '/DeviceGray' and f == ['/DCTDecode'] for cs, f in imgs), f'gray images: {imgs}')
        s.expect(s.qpdf_check(out)[0], 'gray: qpdf --check')
        raw = s.render(out, 1, 20).tobytes()
        s.expect(max(max(raw[i:i + 3]) - min(raw[i:i + 3]) for i in range(0, len(raw), 3)) <= 6, 'rendered page is gray')
        s.expect('Text auf Seite 1' in s.pdf_text(out), 'gray: text stays text')
    s.check_page(page)
    page.close()

    # 3) optional content: a hidden layer stays hidden after merge / mix / split
    for path, files, setup in (('/werkzeuge/pdf-zusammenfuegen/', ['aud1/layers.pdf', 'text3.pdf'], None),
                               ('/werkzeuge/pdf-seiten-mischen/', ['aud1/layers.pdf', 'text3.pdf'], None),
                               ('/werkzeuge/pdf-teilen/', ['aud1/rich.pdf'], 'ranges')):
        page = s.open(ctx, path)
        s.pick(page, *files); s.wait_ready(page, len(files))
        page.wait_for_timeout(500)
        if setup:
            page.locator('#wt-opt-ranges').fill('1, 2-3')
        out = s.run_and_download(page)
        if out and 'layers' in files[0]:
            txt = s.pdf_text(out)
            s.expect('Notizen' in txt and 'Versteckt' not in txt, f'{path}: hidden layer must stay hidden: {txt[:120]!r}')
            s.expect('/OCProperties' in PdfReader(str(out)).trailer['/Root'], f'{path}: /OCProperties written')
        page.close()

    # 4) Word equations (OMML) arrive as readable text, with a note
    page = s.open(ctx, '/werkzeuge/word-in-pdf/')
    s.pick(page, 'aud1/office/math_real.docx'); s.wait_ready(page, 1)
    if s.run(page):
        s.expect('Formeln wurden als einfacher Text' in page.locator('.wt-result').inner_text(), 'equation note')
        out = s.download(page, 0)
        txt = s.pdf_text(out)
        s.expect(len(txt.strip()) > 100 and ('/' in txt or '^' in txt), f'equation text in the PDF: {txt[:100]!r}')
    s.check_page(page)

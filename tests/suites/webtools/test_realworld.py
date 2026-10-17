"""Robustness on real-world PDFs (LaTeX docs, slides, photos, emoji sheets): compress (lossless + balanced)
must keep page count, text and appearance, and produce files qpdf accepts; merge of all of them works."""
from pathlib import Path
from PIL import ImageChops, ImageStat
from wtlib import Suite, FIX

REAL = sorted((FIX / 'real').glob('*.pdf'))

def diff(a, b):
    a, b = a.convert('L'), b.convert('L').resize(a.size)
    return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]

with Suite('real-world PDFs') as s:
    if not REAL:
        s.notes.append('no files in fixtures/real – skipped')
    ctx = s.context('desktop', 'de')
    for f in REAL:
        for level in ('lossless', 'balanced'):
            page = s.open(ctx, '/werkzeuge/pdf-komprimieren/')
            s.pick(page, 'real/' + f.name)
            s.wait_ready(page, 1, timeout=60000)
            page.locator(f'input[value="{level}"]').check()
            out = s.run_and_download(page)
            s.check_page(page)
            page.close()
            if not out: continue
            tag = f'{f.name} [{level}]'
            s.expect(out.stat().st_size <= f.stat().st_size, f'{tag}: bigger than input')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'{tag}: qpdf: {msg}')
            s.expect(s.pdf_pages(out) == s.pdf_pages(f), f'{tag}: page count')
            t0, t1 = s.pdf_text(f), s.pdf_text(out)
            s.expect(abs(len(t0) - len(t1)) <= max(5, len(t0) * 0.01), f'{tag}: text changed {len(t0)} → {len(t1)}')
            d = diff(s.render(f, 1, 40), s.render(out, 1, 40))
            s.expect(d < (1.0 if level == 'lossless' else 6.0), f'{tag}: page 1 looks different (mean diff {d:.2f})')
            s.notes.append(f'{tag}: {f.stat().st_size // 1024} KB → {out.stat().st_size // 1024} KB, diff {d:.2f}')
    if REAL:
        page = s.open(ctx, '/werkzeuge/pdf-zusammenfuegen/')
        s.pick(page, *['real/' + f.name for f in REAL])
        s.wait_ready(page, len(REAL), timeout=60000)
        out = s.run_and_download(page)
        if out:
            s.expect(s.pdf_pages(out) == sum(s.pdf_pages(f) for f in REAL), 'merge of all real-world PDFs: page count')
            ok, msg = s.qpdf_check(out); s.expect(ok, f'merge qpdf: {msg}')
        s.check_page(page)

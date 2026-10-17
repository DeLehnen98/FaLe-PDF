"""text-to-pdf (agent conv): TXT with Unicode (Cyrillic/Greek/Polish via embedded font subset, emoji/CJK
reported), Markdown typeset, CSV as table, Windows-1252 detection, options (font, size, page, margins,
page numbers), binary file rejected."""
import subprocess
from wtlib import Suite, FIX
from conv_testlib import shots, check_radio, set_range, toggle, back_to_files

P = {'de': '/werkzeuge/text-in-pdf/', 'en': '/en/tools/text-to-pdf/'}


def fonts(path):
    out = subprocess.run(['pdffonts', str(path)], capture_output=True, text=True).stdout.splitlines()[2:]
    return [l.split()[0] for l in out]


(FIX / 'conv_binary.txt').write_bytes(bytes(range(256)) * 8)

with Suite('conv-textpdf') as s:
    for v in s.variants():
        page = s.open(v, P[v.lang])
        sh = v.device == 'phone' and v.lang == 'de'
        if sh: shots(s, page, 'text-to-pdf', 'initial')
        s.pick(page, 'conv_text.txt'); s.wait_ready(page, 1)
        if sh: shots(s, page, 'text-to-pdf', 'configured', top='.wt-opts')
        s.check_page(page)
        out = s.run_and_download(page)
        if sh: shots(s, page, 'text-to-pdf', 'result', top='.wt-result', dark=True)
        s.check_page(page)
        if not out: continue
        t = s.pdf_text(out)
        for w in ('Äpfel, Birnen und Öl – 3,50 €', 'Привет мир', 'Ελληνικά', 'Zażółć gęślą jaźń'):
            s.expect(w in t, f'{v}: text "{w}" extractable')
        f = fonts(out)
        s.expect(any('LiberationSans' in x for x in f) and 'Helvetica' in f, f'{v}: Helvetica + Unicode subset {f}')
        s.expect(out.stat().st_size < 60000, f'{v}: subset keeps the file small ({out.stat().st_size} B)')
        res = page.locator('.wt-result').inner_text()
        s.expect('🙂' in res and '漢' in res, f'{v}: emoji/CJK reported')
        try: page.wait_for_function("() => document.querySelectorAll('.cv-pages canvas').length >= 1", timeout=15000)
        except Exception: pass
        n_prev = page.locator('.cv-pages canvas').count()
        s.expect(n_prev == 1, f'{v}: preview ({n_prev} canvases)')
        ok = subprocess.run(['qpdf', '--check', str(out)], capture_output=True, text=True)
        s.expect(ok.returncode in (0, 3), f'{v}: qpdf check {ok.stdout[-200:]}')
        page.close()

    ctx = s.context('desktop', 'de')
    page = s.open(ctx, P['de'])
    s.pick(page, 'conv_text.md', 'conv_text.csv', 'conv_latin1.txt'); s.wait_ready(page, 3)
    s.expect(page.locator('#wt-opt-markdown').count() == 1, 'markdown option shown for .md')
    if s.run(page):
        md, csvp, lat = (s.download(page, i) for i in range(3))
        t = s.pdf_text(md)
        s.expect('Überschrift eins' in t and '# ' not in t and '**' not in t, 'markdown typeset (no raw markers)')
        s.expect('Courier' in fonts(md) and 'Helvetica-Bold' in fonts(md), f'code in Courier, headings bold: {fonts(md)}')
        tc = s.pdf_text(csvp)
        s.expect('Özdemir' in tc and 'Saarbrücken' in tc and 'Łukasz' in tc, 'CSV table text')
        s.expect('Grüße aus Saarbrücken – Größe 3½' in s.pdf_text(lat), 'Windows-1252 decoded')
        s.expect('Windows-Zeichensatz' in page.locator('.wt-result').inner_text(), 'cp1252 note')
    back_to_files(page)
    # options: monospace, 14 pt, Letter, narrow, no page numbers
    check_radio(page, 'wt-opt-font', 'mono')
    set_range(page, 'wt-opt-size', 14)
    page.select_option('#wt-opt-page', 'letter')
    check_radio(page, 'wt-opt-margin', '12')
    toggle(page, 'wt-opt-pageNumbers', False)
    toggle(page, 'wt-opt-markdown', False)
    if s.run(page):
        md = s.download(page, 0)
        s.expect(s.page_sizes(md)[0] == (612.0, 792.0), f'Letter page {s.page_sizes(md)[0]}')
        s.expect('Courier' in fonts(md) and 'Helvetica-Bold' not in fonts(md), f'monospace, raw markdown {fonts(md)}')
        s.expect('# Überschrift eins' in s.pdf_text(md), 'markdown off → raw text')
        s.expect(' / ' not in s.pdf_text(md).splitlines()[-1], 'no page numbers')
    s.check_page(page)
    page.close()
    # binary rejected
    page = s.open(ctx, P['de'])
    s.pick(page, 'conv_binary.txt'); s.wait_ready(page, 1)
    s.expect('keine Textdatei' in page.locator('.wt-file-err').inner_text(), 'binary rejected')
    page.close()

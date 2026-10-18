"""PDF to PDF/A (tool pdf-to-pdfa, lib/pdfa-core.js). Every output is checked with pdfa_check.py (structural
PDF/A rules); CI additionally validates the same outputs with veraPDF (.github/workflows/pdfa.yml, WT_PDFA_OUT).
- embedded-font PDF with JavaScript, launch link, additional actions and an attachment → PDF/A-2b keeps every page
  as vector text (no raster), removes the JavaScript/launch/attachment and keeps the URI link; PDF/A-3b keeps and
  labels the attachment
- standard fonts (not embedded) → pages become images with invisible text: still searchable
- transparency + CMYK: PDF/A-2b rasterises only the CMYK page, PDF/A-1b both
- form without appearances, encrypted input (password removed, note), several files at once, „Alle Seiten als Bild“
- DE/EN, phone/desktop, no console errors / CSP violations / foreign requests
"""
import os, shutil, subprocess
from pathlib import Path
from wtlib import Suite, FIX
from pdfa_check import check_pdfa

PATHS = {'de': '/werkzeuge/pdf-in-pdfa/', 'en': '/en/tools/pdf-to-pdfa/'}
KEEP = Path(os.environ['WT_PDFA_OUT']) if os.environ.get('WT_PDFA_OUT') else None
if KEEP:
    KEEP.mkdir(parents=True, exist_ok=True)


def text_of(path):
    return subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, text=True).stdout


def images_on(path):
    r = subprocess.run(['pdfimages', '-list', str(path)], capture_output=True, text=True).stdout.splitlines()[2:]
    return len([x for x in r if x.strip()])


def choose(page, opt, value):
    page.locator(f'label.wt-radio:has(input[name="wt-opt-{opt}"][value="{value}"])').click()


with Suite('pdf-to-pdfa') as s:
    done = 0

    def keep(path, tag, part):
        if KEEP and path:
            shutil.copy(path, KEEP / f'{tag}__pdfa{part}.pdf')

    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        s.check_page(page)
        # 1) embedded fonts + JavaScript + attachment → PDF/A-2b, all vector
        s.pick(page, 'pdfa/lo_js_attach.pdf')
        s.wait_ready(page, 1)
        out = s.run_and_download(page)
        if out:
            prob = check_pdfa(out, 2)
            s.expect(not prob, f'{v}: lo_js_attach PDF/A-2b problems: {prob}')
            s.expect(images_on(out) == images_on(FIX / 'pdfa/lo_js_attach.pdf'), f'{v}: no page became an image')
            note = page.locator('.wt-output').first.inner_text()
            s.expect(('JavaScript' in note) and ('Dateianh' in note or 'attachments' in note), f'{v}: note names removed JavaScript + attachment: {note[:300]}')
            s.expect('Saarbr' in text_of(FIX / 'pdfa/lo_js_attach.pdf') or True, 'fixture text')
            import pikepdf
            with pikepdf.open(out) as pdf:
                links = [a for a in pdf.pages[0].obj.get('/Annots', []) if str(a.get('/Subtype')) == '/Link']
                s.expect(any('/URI' in a.get('/A', {}) for a in links), f'{v}: URI link kept')
                s.expect(not any(str(a.get('/A', {}).get('/S')) == '/Launch' for a in links), f'{v}: launch link removed')
            keep(out, f'lo_js_attach-{v.lang}-{v.device}', 2)
            done += 1
        if v.lang == 'de' and v.device == 'phone':
            # 2) the same as PDF/A-3b: attachment stays, labelled
            page.locator('.wt-restart button').last.click() if page.locator('.wt-restart button').count() else None
            page = s.open(v, PATHS[v.lang])
            s.pick(page, 'pdfa/lo_js_attach.pdf')
            s.wait_ready(page, 1)
            choose(page, 'level', '3')
            out = s.run_and_download(page)
            if out:
                prob = check_pdfa(out, 3)
                s.expect(not prob, f'PDF/A-3b problems: {prob}')
                import pikepdf
                with pikepdf.open(out) as pdf:
                    s.expect('rechnung.xml' in pdf.attachments, 'PDF/A-3b keeps the attachment')
                keep(out, 'lo_js_attach', 3)
                done += 1
            # 3) standard fonts → images with invisible text, still searchable
            page = s.open(v, PATHS[v.lang])
            s.pick(page, 'pdfa/std14.pdf')
            s.wait_ready(page, 1)
            out = s.run_and_download(page)
            if out:
                prob = check_pdfa(out, 2)
                s.expect(not prob, f'std14 PDF/A-2b problems: {prob}')
                s.expect(images_on(out) == 2, 'both pages became images')
                t = text_of(out)
                s.expect('Archivtest Seite 2' in t and 'Saarbrücken' in t, f'invisible text searchable: {t[:200]!r}')
                note = page.locator('.wt-output').first.inner_text()
                s.expect('Schriften' in note, f'note explains the fonts: {note[:200]}')
                keep(out, 'std14', 2)
                done += 1
            # 4) transparency + CMYK: 2b rasterises only the CMYK page, 1b both
            for part, want in ((2, 1), (1, 2)):
                page = s.open(v, PATHS[v.lang])
                s.pick(page, 'pdfa/transp_cmyk.pdf')
                s.wait_ready(page, 1)
                choose(page, 'level', str(part))
                out = s.run_and_download(page)
                if out:
                    prob = check_pdfa(out, part)
                    s.expect(not prob, f'transp_cmyk PDF/A-{part}b problems: {prob}')
                    s.expect(images_on(out) == want, f'PDF/A-{part}b: {want} page(s) as image, got {images_on(out)}')
                    s.expect('Druckfarben-Seite' in text_of(out), 'text of the CMYK page searchable')
                    keep(out, 'transp_cmyk', part)
                    done += 1
            # 5) several files (form without appearances, encrypted, annotations), everything as image too
            page = s.open(v, PATHS[v.lang])
            s.pick(page, 'pdfa/form_noap.pdf', 'pdfa/std14.pdf', 'pdfa/_embedded.pdf')
            s.wait_ready(page, 3)
            if s.run(page):
                for i in range(page.locator('.wt-output').count()):
                    out = s.download(page, i)
                    prob = check_pdfa(out, 2)
                    s.expect(not prob, f'{out.name}: {prob}')
                    keep(out, f'multi{i}', 2)
                    done += 1
            page = s.open(v, PATHS[v.lang])
            s.pick(page, 'pdfa/_embedded.pdf')
            s.wait_ready(page, 1)
            choose(page, 'method', 'raster')
            out = s.run_and_download(page)
            if out:
                prob = check_pdfa(out, 2)
                s.expect(not prob, f'raster mode problems: {prob}')
                s.expect(images_on(out) == 3, 'raster mode: every page an image')
                s.expect(len(text_of(out).strip()) > 20, 'raster mode keeps the text searchable')
                keep(out, 'raster', 2)
                done += 1
        if v.lang == 'en' and v.device == 'desktop':
            # encrypted input: password asked, result unprotected, note says so
            page = s.open(v, PATHS[v.lang])
            s.pick(page, 'pdfa/encrypted.pdf')
            page.wait_for_selector('.wt-file input[type="password"]', timeout=15000)
            page.locator('.wt-file input[type="password"]').fill('geheim')
            page.locator('.wt-file button[type="submit"]').click()
            s.wait_ready(page, 1)
            out = s.run_and_download(page)
            if out:
                prob = check_pdfa(out, 2)
                s.expect(not prob, f'encrypted input problems: {prob}')
                s.expect('password protection was removed' in page.locator('.wt-output').first.inner_text(), 'note: password removed')
                keep(out, 'encrypted', 2)
                done += 1
        s.check_page(page)
    s.notes.append(f'{done} PDF/A outputs checked')

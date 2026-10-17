"""pdf-to-text / pdf-to-markdown (agent conv): reading order, paragraphs, lists, tables, two columns,
headers/footers dropped, page markers, Unicode, scan message, encrypted input, 120-page PDF, copy button."""
import time
from wtlib import Suite
from conv_testlib import shots, toggle, back_to_files

TXT = {'de': '/werkzeuge/pdf-in-text/', 'en': '/en/tools/pdf-to-text/'}
MD = {'de': '/werkzeuge/pdf-in-markdown/', 'en': '/en/tools/pdf-to-markdown/'}

with Suite('conv-text') as s:
    for v in s.variants():
        page = s.open(v, TXT[v.lang])
        sh = v.device == 'phone' and v.lang == 'de'
        if sh: shots(s, page, 'pdf-to-text', 'initial')
        s.pick(page, 'conv_report.pdf'); s.wait_ready(page, 1)
        if sh: shots(s, page, 'pdf-to-text', 'configured', top='.wt-opts')
        s.check_page(page)
        out = s.run_and_download(page)
        if sh: shots(s, page, 'pdf-to-text', 'result', top='.wt-result', dark=True)
        s.check_page(page)
        if not out: continue
        t = out.read_text(encoding='utf-8')
        word = 'Seite' if v.lang == 'de' else 'Page'
        s.expect(f'—— {word} 2 ——' in t, f'{v}: page marker')
        s.expect('Dieser Satz enthält fett gedruckte und kursive Wörter.' in t, f'{v}: mixed-style line joined')
        s.expect('• Umsatz um 12 % gestiegen' in t and '1. Budget freigeben' in t, f'{v}: lists')
        s.expect('Nord\t1.250,00 €\t800,50 €\t449,50 €' in t, f'{v}: table row tab separated')
        s.expect('Die Übersicht fasst die Ergebnisse des dritten Quartals zusammen. Wir erklären' in t, f'{v}: paragraph joined over lines')
        s.expect(page.locator('.cv-text').count() == 1 and 'Quartalsbericht' in page.locator('.cv-text').inner_text(), f'{v}: text preview')
        s.expect(page.locator('.cv-preview button').count() >= 1, f'{v}: copy button')
        page.close()

    ctx = s.context('desktop', 'de', permissions=['clipboard-read', 'clipboard-write'])
    page = s.open(ctx, TXT['de'])
    # two columns + running header/footer
    s.pick(page, 'conv_columns.pdf'); s.wait_ready(page, 1)
    out = s.run_and_download(page)
    if out:
        t = out.read_text(encoding='utf-8')
        s.expect('Gemeindeblatt' not in t and 'Seite 1 von 4' not in t, 'running header/footer dropped')
        i1, i2, i3 = t.find('Links 3'), t.find('Thema 2'), t.find('Rechts 1')
        s.expect(0 <= i1 < i2 < i3, f'two columns read column by column ({i1}, {i2}, {i3})')
        s.expect('Spalte für Spalte' in page.locator('.wt-result').inner_text(), 'columns note')
        page.locator('.cv-preview button').first.click()
        page.wait_for_function("() => /Kopiert|markiert/.test(document.querySelector('.cv-copy-status').textContent)")
        clip = page.evaluate("() => navigator.clipboard.readText()")
        s.expect(clip.strip() == t.strip(), 'copy all → clipboard equals the file')
    back_to_files(page)
    toggle(page, 'wt-opt-running', False)
    toggle(page, 'wt-opt-pageMarks', False)
    out = s.run_and_download(page)
    if out:
        t = out.read_text(encoding='utf-8')
        s.expect('Gemeindeblatt' in t and '——' not in t, 'options off: header kept, no markers')
    page.close()
    # unicode
    page = s.open(ctx, TXT['de'])
    s.pick(page, 'conv_unicode.pdf'); s.wait_ready(page, 1)
    out = s.run_and_download(page)
    if out:
        t = out.read_text(encoding='utf-8')
        for w in ('Привет, мир!', 'Γειά σου Κόσμε', 'Zażółć gęślą jaźń', 'İstanbul', 'příliš žluťoučký kůň'):
            s.expect(w in t, f'unicode: {w}')
    page.close()
    # scanned → OCR hint
    page = s.open(ctx, TXT['de'])
    s.pick(page, 'conv_scan.pdf'); s.wait_ready(page, 1)
    s.primary(page).click()
    page.wait_for_selector('.wt-error:not([hidden])', timeout=30000)
    s.expect('OCR' in page.locator('.wt-error').inner_text() and 'Texterkennung' in page.locator('.wt-error').inner_text(), 'scan: OCR hint')
    page.close()
    # encrypted + long
    page = s.open(ctx, TXT['de'])
    s.pick(page, 'encrypted_aes256.pdf', 'conv_long.pdf'); s.wait_ready(page, 2)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    t0 = time.time()
    if s.run(page, timeout=240000):
        s.expect(page.locator('.wt-output').count() == 2, 'encrypted + long: 2 outputs')
        o = s.download(page, 1)
        t = o.read_text(encoding='utf-8')
        s.expect('Kapitel 120' in t and t.count('——') >= 238, 'long: 120 pages with markers')
        s.notes.append(f'120 pages → text in {time.time() - t0:.1f}s')
    s.check_page(page)
    page.close()

    # Markdown
    for v in s.variants(devices=('phone',)):
        page = s.open(v, MD[v.lang])
        sh = v.lang == 'de'
        if sh: shots(s, page, 'pdf-to-markdown', 'initial')
        s.pick(page, 'conv_report.pdf'); s.wait_ready(page, 1)
        if sh: shots(s, page, 'pdf-to-markdown', 'configured', top='.wt-opts')
        out = s.run_and_download(page)
        if sh: shots(s, page, 'pdf-to-markdown', 'result', top='.wt-result')
        s.check_page(page)
        if not out: continue
        t = out.read_text(encoding='utf-8')
        s.expect(out.suffix == '.md', f'{v}: .md')
        s.expect('# Quartalsbericht Größenwachstum' in t and '## Einleitung' in t, f'{v}: headings')
        s.expect('**fett gedruckte**' in t and '*kursive*' in t, f'{v}: bold/italic')
        s.expect('- Umsatz um 12 % gestiegen' in t and '1. Budget freigeben' in t, f'{v}: lists')
        s.expect('| Region | Umsatz | Kosten | Gewinn |' in t and '| --- | --- | --- | --- |' in t, f'{v}: table')
        page.close()

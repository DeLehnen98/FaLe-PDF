"""enex-to-markdown: two notebooks → one ZIP (folders, index), formatting → Markdown (headings, bold/italic/strike,
links, checklists, nested + ordered lists, table, code), images/attachments matched by MD5 and linked, YAML header,
encrypted text marked, duplicate/awkward titles, empty note, wrong file → clear error; EN page."""
import io, os, re, subprocess, zipfile, hashlib
os.environ.setdefault('WT_PORT', '8793')
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/enex-in-markdown/', 'en': '/en/tools/enex-to-markdown/'}
if not (FIX / 'enex' / 'Haushalt.enex').exists():
    subprocess.run(['python3', str(FIX.parent / 'enex_make_fixtures.py')], check=True)

with Suite('enex-to-markdown') as s:
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        s.pick(page, 'enex/Haushalt.enex', 'enex/Reise.enex')
        page.wait_for_selector('.wt-file >> nth=1')
        if v.device == 'phone': s.shot(page, f'enex_{v.lang}_phone_files')
        out = s.run_and_download(page)
        if not out: continue
        z = zipfile.ZipFile(out)
        names = z.namelist()
        att = 'Anhänge' if de else 'Attachments'
        idx = 'Inhaltsverzeichnis.md' if de else 'Contents.md'
        want = [idx, 'Haushalt/Einkauf & Planung.md', 'Haushalt/Geheimes.md', 'Haushalt/Projekt Ideen 2026.md', 'Haushalt/Projekt Ideen 2026 (2).md',
                f'Haushalt/{att}/rotes Rechteck.png', f'Haushalt/{att}/Vertrag.pdf', 'Reise/Reise.md']
        for w in want: s.expect(w in names, f'{v}: ZIP has {w!r}: {names}')
        s.expect(len([n for n in names if n.endswith('.md')]) == 8, f'{v}: 7 notes + index: {names}')
        fo = z.read('Reise/Fotos.md').decode('utf-8')
        s.expect(f'![Strand.png]({att}/Strand.png)' in fo and f'[📎 Fahrplan.txt]({att}/Fahrplan.txt)' in fo, f'{v}: wrong hash resolved by order + unreferenced file listed: {fo}')
        md = z.read('Haushalt/Einkauf & Planung.md').decode('utf-8')
        for need in ['title: "Einkauf & Planung"', 'created: 2024-01-15T08:30:00.000Z', 'tags: ["Haushalt", "Liste"]', 'source: "https://example.com/quelle"',
                     '# Einkauf & Planung', '**fett**', '*kursiv*', '~~durch~~', '[Link](https://fale.network/werkzeuge/)', '[x] Milch kaufen', '[ ] Brot holen',
                     '- Punkt eins\n  - Unterpunkt\n- Punkt zwei', '1. Erstens\n2. Zweitens', '| Artikel | Preis |\n| --- | --- |\n| Äpfel | 2,49 € |',
                     f'![rotes Rechteck.png]({att}/rotes%20Rechteck.png)', f'[📎 Vertrag.pdf]({att}/Vertrag.pdf)', '5 < 6 > 4 und \\*Sternchen\\*']:
            s.expect(need in md, f'{v}: note contains {need!r}\n---\n{md}')
        img = z.read(f'Haushalt/{att}/rotes Rechteck.png')
        s.expect(hashlib.md5(img).hexdigest() == (FIX / 'enex' / 'hashes.txt').read_text().split()[0], f'{v}: attachment bytes intact (MD5)')
        sec = z.read('Haushalt/Geheimes.md').decode('utf-8')
        s.expect('verschlüsselter Text' in sec and 'AbCdEf' not in sec, f'{v}: encrypted text marked: {sec}')
        p3 = z.read('Haushalt/Projekt Ideen 2026.md').decode('utf-8')
        s.expect('Nur Text ohne div.  \nZweite Zeile.' in p3 and '```\ncode  block\n  eingerückt\n```' in p3, f'{v}: plain text + pre: {p3}')
        ix = z.read(idx).decode('utf-8')
        s.expect('## Haushalt' in ix and '## Reise' in ix and '(Haushalt/Einkauf%20&%20Planung.md)' in ix, f'{v}: index links: {ix}')
        s.expect(any(n.startswith('Haushalt/') and ('Ohne Titel' in n) for n in names), f'{v}: empty note gets a name: {names}')
        if v.device == 'phone': s.shot(page, f'enex_{v.lang}_phone_result')
        page.close()
    # header off + wrong file
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'enex/Reise.enex')
    page.wait_for_selector('.wt-file')
    page.locator('.wt-opt-toggle label.wt-switch').click()
    out = s.run_and_download(page)
    if out:
        md = zipfile.ZipFile(out).read('Reise.md' if False else 'Reise/Reise.md').decode('utf-8')
        s.expect(md.startswith('# Reise\n\nPackliste'), f'no YAML header when switched off: {md!r}')
        page.locator('.wt-restart button').first.click()
    page.close()
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'enex/falsch.enex')
    page.wait_for_selector('.wt-file')
    s.primary(page).click()
    page.wait_for_selector('.wt-error:not([hidden])', timeout=20000)
    s.expect('keine ENEX-Datei' in page.locator('.wt-error').inner_text(), f'wrong file → clear error: {page.locator(".wt-error").inner_text()}')
    s.check_page(page)

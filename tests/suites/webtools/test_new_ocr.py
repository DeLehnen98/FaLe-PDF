"""ocr-pdf: German scan (umlauts) becomes searchable (pdftotext), scan images untouched, text panel + TXT,
sideways page detected, page range, mixed PDF (text page skipped, no duplicate), encrypted input, text-only PDF
explained, cancel, phone/desktop DE/EN."""
import os, re, subprocess
os.environ.setdefault('WT_PORT', '8790')
from wtlib import Suite, FIX

PATHS = {'de': '/werkzeuge/pdf-texterkennung/', 'en': '/en/tools/ocr-pdf/'}
WORDS = ['Grüßen', 'Größe', 'Saarbrücken', 'übermorgen', 'Äpfel', 'Jürgen', 'Müller']

def raw(p):  # reading order without layout (skewed baselines)
    return subprocess.run(['pdftotext', str(p), '-'], capture_output=True, text=True).stdout

def images(p):
    return [l.split()[3:5] for l in subprocess.run(['pdfimages', '-list', str(p)], capture_output=True, text=True).stdout.splitlines()[2:]]

with Suite('new-ocr-pdf') as s:
    for v in s.variants():
        shots = v.device == 'phone' and v.lang == 'de'
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'ocr-pdf_phone_initial')
        s.pick(page, 'new_scan_1p.pdf')
        s.wait_ready(page, 1)
        page.locator('input[name="wt-opt-lang"][value="deu"]').check()
        if shots: s.shot(page, 'ocr-pdf_phone_configured', top='.wt-opts-sec')
        s.check_page(page)
        if s.run(page, timeout=240000):
            if shots: s.shot(page, 'ocr-pdf_phone_result', top='.wt-result')
            out = s.download(page, 0)
            t = raw(out)
            for w in WORDS: s.expect(w in t, f'{v}: searchable text contains {w!r}')
            s.expect(images(out) == images(FIX / 'new_scan_1p.pdf'), f'{v}: scan image unchanged')
            bb = subprocess.run(['pdftotext', '-bbox', str(out), '-'], capture_output=True, text=True).stdout
            m = re.search(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Saarbrücken', bb)
            # the word sits on line 5 of the scan: about 1.2 in + 4 × 24.7 pt from the top, right part of the line
            s.expect(m and 185 < float(m.group(2)) < 225 and float(m.group(1)) > 250, f'{v}: text layer position {m.groups() if m else None}')
            s.expect(s.pdf_pages(out) == 1, f'{v}: page count')
            panel = page.locator('#new-text-out').input_value()
            s.expect('Saarbrücken' in panel, f'{v}: text panel')
            txt = s.download_click(page, page.locator('.new-txt'))
            s.expect(txt.suffix == '.txt' and 'Größe' in txt.read_text(encoding='utf-8'), f'{v}: TXT download')
            s.expect(page.locator('.wt-next a, .wt-next button').count() >= 1 or page.locator('text=Weiter mit').count() + page.locator('text=Continue with').count() >= 1, f'{v}: continue-with offered')
        s.check_page(page)
        page.close()
    # desktop DE: 2 pages incl. a sideways one, both languages
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'new_scan_de.pdf')
    s.wait_ready(page, 1)
    page.locator('input[name="wt-opt-lang"][value="deu+eng"]').check()
    out = s.run_and_download(page) if True else None
    if out:
        t = raw(out)
        s.expect('Quarterly report' in t and 'Shipments increased' in t, 'sideways page 2 recognised')
        s.expect('gedreht' in page.locator('.wt-result').inner_text(), 'sideways note')
    page.locator('.wt-result button', has_text='Zurück').first.click()
    # page range: only page 2
    page.locator('#wt-opt-pages').fill('2')
    out = s.run_and_download(page)
    if out:
        t = raw(out)
        s.expect('Quarterly' in t and 'Lieferschein Nr. 4711\n\nSehr geehrte' not in t.split('Quarterly')[0], 'page range: page 2 only')
    # cancel
    page.locator('.wt-result button', has_text='Zurück').first.click()
    page.locator('#wt-opt-pages').fill('')
    page.locator('input[name="wt-opt-lang"][value="deu"]').check()
    s.primary(page).click()
    page.wait_for_selector('.wt-progress:not([hidden])')
    page.wait_for_timeout(800)
    page.locator('.wt-progress button').click()
    page.wait_for_selector('.wt-progress', state='hidden')
    s.expect(page.locator('.wt-error:not([hidden])').count() == 0, 'cancel: no error')
    s.check_page(page)
    page.close()
    # mixed PDF: text page skipped, not duplicated; encrypted; text-only PDF
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'new_mixed.pdf', 'new_scan_enc.pdf')
    page.wait_for_selector('.wt-lock input')
    page.locator('.wt-lock input').fill('geheim'); page.locator('.wt-lock button').click()
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    s.wait_ready(page, 2)
    if s.run(page, timeout=240000):
        a = s.download(page, 0); b = s.download(page, 1)
        ta = raw(a)
        s.expect(ta.count('bereits echten Text') == 1, 'mixed: existing text not duplicated')
        s.expect('Kartons' in ta, 'mixed: scan page recognised')
        res = page.locator('.wt-result').inner_text()
        s.expect('schon Text' in res and 'Passwort' in res, f'mixed/encrypted notes: {res[:400]}')
        s.expect(s.pdf_info(b)['_rc'] == 0 and 'Müller' in raw(b), 'encrypted input → readable searchable output')
    page.close()
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'text3.pdf'); s.wait_ready(page, 1)
    s.primary(page).click()
    # aud2: a hint in the sticky bar (the user switches the option off on the same screen), not an error card
    page.wait_for_selector('.wt-bar-hint:not([hidden])', timeout=60000)
    s.expect('bereits durchsuchbar' in page.locator('.wt-bar-hint').inner_text(), 'text-only PDF explained')
    s.expect(page.locator('.wt-error:not([hidden])').count() == 0, 'text-only PDF: no error card')
    s.check_page(page)
    ctx2 = s.context('phone', 'en', dark=True)
    page = s.open(ctx2, PATHS['en'])
    s.pick(page, 'new_scan_1p.pdf'); s.wait_ready(page, 1)
    s.shot(page, 'ocr-pdf_phone_dark', top='.wt-opts-sec')
    s.check_page(page)

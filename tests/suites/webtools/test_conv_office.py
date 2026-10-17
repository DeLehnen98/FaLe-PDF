"""word-to-pdf / excel-to-pdf / pptx-to-pdf (agent conv): text stays text (umlauts, €), page setup, tables,
images, hidden sheets left out, formulas without cached values, honest note on unsupported characters,
old binary formats and broken files rejected on the card, page preview on the result card."""
import subprocess
from uni_testlib import UNI, UNI_WORDS, check_unicode_pdf
from wtlib import Suite, OUT, FIX
from conv_testlib import shots

W = {'de': '/werkzeuge/word-in-pdf/', 'en': '/en/tools/word-to-pdf/'}
X = {'de': '/werkzeuge/excel-in-pdf/', 'en': '/en/tools/excel-to-pdf/'}
PP = {'de': '/werkzeuge/powerpoint-in-pdf/', 'en': '/en/tools/powerpoint-to-pdf/'}

# old binary Word file (OLE header) and a non-zip ".docx"
(FIX / 'conv_old.doc').write_bytes(bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + b'\0' * 504)
(FIX / 'conv_fake.docx').write_bytes(b'this is not a word file')
(FIX / 'conv_oldname.docx').write_bytes((FIX / 'conv_old.doc').read_bytes())


def images(path):
    out = subprocess.run(['pdfimages', '-list', str(path)], capture_output=True, text=True).stdout.splitlines()[2:]
    return [l.split() for l in out if l.split() and l.split()[2] == 'image']


with Suite('conv-office') as s:
    for v in s.variants():
        page = s.open(v, W[v.lang])
        sh = v.device == 'phone' and v.lang == 'de'
        if sh: shots(s, page, 'word-to-pdf', 'initial')
        s.pick(page, 'conv_doc.docx'); s.wait_ready(page, 1)
        s.expect(page.locator('.wt-file .wt-thumb.has-img canvas').count() == 1, f'{v}: DOCX tile on the card')
        if sh: shots(s, page, 'word-to-pdf', 'configured', top='.wt-files-head')
        s.check_page(page)
        out = s.run_and_download(page)
        if sh: shots(s, page, 'word-to-pdf', 'result', top='.wt-result', dark=True)
        s.check_page(page)
        if not out: continue
        t = s.pdf_text(out)
        s.expect('Projektbericht Ölförderung & Süßwaren' in t and '1.234,56 €' in t, f'{v}: umlauts + € as text')
        s.expect('Erster Punkt' in t and 'Schritt zwei' in t and '13.100 €' in t, f'{v}: lists + table text')
        s.expect(s.pdf_pages(out) >= 2, f'{v}: page break → ≥ 2 pages')
        s.expect(len(images(out)) == 1, f'{v}: image embedded')
        s.expect(abs(s.page_sizes(out)[0][0] - 612) < 2 or abs(s.page_sizes(out)[0][0] - 595.3) < 2, f'{v}: page size from the document {s.page_sizes(out)[0]}')
        res = page.locator('.wt-result').inner_text()
        # Cyrillic + Greek are real text now (embedded Unicode subset); the note lists only CJK and ✓
        s.expect('Привет, Ελληνικά' in t, f'{v}: Cyrillic + Greek as text')
        s.expect(('Zeichen' in res or 'characters' in res) and '漢' in res and '✓' in res and 'П' not in res and 'Ε' not in res, f'{v}: honest note only about CJK/✓: {res[:300]!r}')
        try: page.wait_for_function("() => document.querySelectorAll('.cv-pages canvas').length >= 2", timeout=15000)
        except Exception: pass
        s.expect(page.locator('.cv-pages canvas').count() >= 2, f'{v}: page preview')
        page.close()

    ctx = s.context('desktop', 'de')
    # rejected inputs on the card
    page = s.open(ctx, W['de'])
    s.pick(page, 'conv_oldname.docx', 'conv_fake.docx'); s.wait_ready(page, 2)
    errs = page.locator('.wt-file-err').all_inner_texts()
    s.expect(len(errs) == 2 and 'alten Word-Format' in errs[0] and 'keine gültige DOCX' in errs[1], f'card errors: {errs}')
    s.expect(s.primary(page).is_disabled(), 'no usable file → button disabled')
    s.check_page(page)
    page.close()

    for v in s.variants(devices=('phone',)):
        page = s.open(v, X[v.lang])
        sh = v.lang == 'de'
        if sh: shots(s, page, 'excel-to-pdf', 'initial')
        s.pick(page, 'conv_sheet.xlsx', 'conv_nocache.xlsx'); s.wait_ready(page, 2)
        if sh: shots(s, page, 'excel-to-pdf', 'configured', top='.wt-files-head')
        if not s.run(page): continue
        if sh: shots(s, page, 'excel-to-pdf', 'result', top='.wt-result')
        s.check_page(page)
        a = s.download(page, 0); b = s.download(page, 1)
        ta, tb = s.pdf_text(a), s.pdf_text(b)
        s.expect('Umsätze' in ta and 'Mitarbeiter' in ta and 'Person 60' in ta and 'Dezember' in ta, f'{v}: all sheets')
        s.expect('15.12.2024' in ta, f'{v}: dates formatted')
        s.expect('geheim' not in tb and ' 14' in tb, f'{v}: hidden sheet left out, formulas recalculated')
        res = page.locator('.wt-result').inner_text()
        s.expect('ausgeblendetes Blatt' in res or 'hidden sheet' in res, f'{v}: hidden sheet note')
        page.close()

    for v in s.variants(devices=('phone',)):
        page = s.open(v, PP[v.lang])
        sh = v.lang == 'de'
        if sh: shots(s, page, 'pptx-to-pdf', 'initial')
        s.pick(page, 'conv_slides.pptx'); s.wait_ready(page, 1)
        if sh: shots(s, page, 'pptx-to-pdf', 'configured', top='.wt-files-head')
        out = s.run_and_download(page)
        if sh: shots(s, page, 'pptx-to-pdf', 'result', top='.wt-result')
        s.check_page(page)
        if not out: continue
        s.expect(s.pdf_pages(out) == 3, f'{v}: 3 slides → 3 pages')
        w, h = s.page_sizes(out)[0]
        s.expect(abs(w / h - 4 / 3) < 0.02, f'{v}: slide format 4:3 ({w}×{h})')
        t = s.pdf_text(out)
        s.expect('Präsentation über Größen' in t and 'Begrüßung' in t and '2024' in t, f'{v}: searchable text layer')
        page.close()

    # Unicode (fixtures from uni_make_fixtures.py): Polish, Greek, Cyrillic, Turkish, € stay real text, no note
    ctx = s.context('phone', 'de')
    for path, fx, words in ((W['de'], 'uni_doc.docx', UNI_WORDS + ['Kopf: Привет', 'fett Ελληνικά', 'kursiv Привет', 'Mono: Ελληνικά']),
                            (X['de'], 'uni_sheet.xlsx', ['Łukasz', 'Kowalski-Müller', 'Ελληνικά', 'Привет', 'Türkçe', 'İğ', '€ 12', 'Łódź Привет']),
                            (PP['de'], 'uni_slides.pptx', UNI_WORDS)):
        page = s.open(ctx, path)
        s.pick(page, fx); s.wait_ready(page, 1)
        out = s.run_and_download(page)
        s.check_page(page)
        if out:
            check_unicode_pdf(s, out, words, fx)
            res = page.locator('.wt-result').inner_text()
            s.expect('nicht darstellen' not in res, f'{fx}: no replacement note: {res[:200]!r}')
        page.close()

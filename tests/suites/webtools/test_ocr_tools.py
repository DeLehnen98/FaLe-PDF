"""image-to-word, image-to-excel, business-card (OCR): synthetic page photo with heading, hyphenated paragraph
and a borderless table; table screenshots (German numbers, sum row – one deliberately wrong); a business card.
Checks the DOCX structure (heading, joined paragraph, Word table), real XLSX values + sum check note, vCard
fields, international phone numbers, edited form → saved .vcf, QR code, CSV for several cards."""
import os, zipfile, re
os.environ.setdefault('WT_PORT', '8793')
from PIL import Image, ImageDraw, ImageFont
from wtlib import Suite, FIX

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
f = lambda size, bold=False: ImageFont.truetype(BOLD if bold else FONT, size)


def make_doc(path):
    im = Image.new('RGB', (1240, 1500), 'white'); d = ImageDraw.Draw(im)
    d.text((100, 90), 'Jahresbericht 2026', fill='black', font=f(64, True))
    y = 220
    for line in ['Im vergangenen Jahr ist der Ver-', 'kauf in allen Regionen deutlich', 'gestiegen. Besonders gut lief das', 'Geschäft mit Gartenmöbeln.']:
        d.text((100, y), line, fill='black', font=f(36)); y += 50
    y += 50
    for line in ['Für das nächste Jahr planen wir neue', 'Filialen in Saarbrücken und Trier.']:
        d.text((100, y), line, fill='black', font=f(36)); y += 50
    y += 70
    rows = [('Artikel', 'Menge', 'Preis'), ('Stuhl', '12', '49,90'), ('Tisch', '4', '189,00'), ('Bank', '7', '129,50'), ('Schirm', '9', '59,00')]
    for r in rows:
        for x, cell in zip((100, 560, 860), r):
            d.text((x, y), cell, fill='black', font=f(36, r is rows[0]))
        y += 58
    im.save(path)


def make_table(path, total):
    im = Image.new('RGB', (1100, 520), 'white'); d = ImageDraw.Draw(im)
    rows = [('Monat', 'Umsatz', 'Kosten'), ('Januar', '1.250,00', '830,50'), ('Februar', '1.480,25', '910,00'), ('März', '1.320,75', '875,25'), ('Summe', total, '2.615,75')]
    y = 40
    for r in rows:
        for x, cell in zip((60, 460, 800), r):
            d.text((x, y), cell, fill='black', font=f(38, r is rows[0] or r is rows[-1]))
        y += 90
    im.save(path)


def make_card(path):
    im = Image.new('RGB', (1400, 820), (250, 250, 247)); d = ImageDraw.Draw(im)
    d.text((80, 70), 'Erika Mustermann', fill=(20, 20, 30), font=f(66, True))
    d.text((80, 160), 'Projektleiterin', fill=(60, 60, 70), font=f(40))
    d.text((80, 230), 'Beispiel Bau GmbH', fill=(20, 60, 120), font=f(46, True))
    y = 360
    for line in ['Hauptstraße 12', '66111 Saarbrücken', 'Tel. 0681 123456', 'Mobil 0171 2345678', 'erika.mustermann@beispielbau.de', 'www.beispielbau.de']:
        d.text((80, y), line, fill=(20, 20, 30), font=f(38)); y += 62
    im.save(path)


for name, fn in [('ocr_doc.png', make_doc), ('ocr_card.png', make_card)]:
    if not (FIX / name).exists(): fn(FIX / name)
if not (FIX / 'ocr_table.png').exists(): make_table(FIX / 'ocr_table.png', '4.051,00')
if not (FIX / 'ocr_table_bad.png').exists(): make_table(FIX / 'ocr_table_bad.png', '4.151,00')


def docx_xml(path):
    return zipfile.ZipFile(path).read('word/document.xml').decode('utf-8')


with Suite('ocr-tools') as s:
    # ---------- image → Word
    for lang, dev, path in [('de', 'desktop', '/werkzeuge/bild-in-word/'), ('en', 'phone', '/en/tools/image-to-word/')]:
        ctx = s.context(dev, lang)
        page = s.open(ctx, path)
        s.pick(page, 'ocr_doc.png')
        s.wait_ready(page, 1)
        page.locator('input[name="wt-opt-lang"][value="deu"]').check()
        s.check_page(page)
        out = s.run_and_download(page) if True else None
        if out:
            x = docx_xml(out)
            text = re.sub(r'<[^>]+>', '', x.replace('</w:p>', '\n'))
            s.expect('Jahresbericht 2026' in text, f'{lang}: heading text')
            s.expect(re.search(r'<w:pStyle w:val="Heading\d"', x) or 'Heading' in x, f'{lang}: heading style used')
            s.expect('Verkauf in allen Regionen' in text, f'{lang}: hyphenated line re-joined into one paragraph')
            s.expect('<w:tbl>' in x and 'Stuhl' in text and 'Gartenmöbeln' in text, f'{lang}: table as Word table + umlauts')
        page.close()

    # ---------- image → Excel (sum check)
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/bild-in-excel/')
    s.pick(page, 'ocr_table.png', 'ocr_table_bad.png')
    s.wait_ready(page, 2)
    page.locator('input[name="wt-opt-lang"][value="deu"]').check()
    page.locator('input[name="wt-opt-sheets"][value="images"]').check()
    s.check_page(page)
    out = s.run_and_download(page)
    if out:
        z = zipfile.ZipFile(out)
        sheets = [n for n in z.namelist() if n.startswith('xl/worksheets/sheet')]
        s.expect(len(sheets) == 2, f'one sheet per image {sheets}')
        x1 = z.read(sheets[0]).decode()
        s.expect('<v>1250</v>' in x1 and '<v>1480.25</v>' in x1, 'German numbers became real numbers')
        notes = ' '.join(page.locator('.wt-note').all_inner_texts())
        s.expect('Summenprüfung' in notes and '4.151' in notes and '4.051' in notes, f'wrong sum reported once: {notes[:300]}')
        s.expect(notes.count('≠') == 1, 'only the wrong sum is reported')
        s.expect(page.locator('.wt-result table').count() >= 1, 'table preview shown')
    page.close()

    # ---------- business card
    for lang, dev, path in [('de', 'phone', '/werkzeuge/visitenkarte-scannen/'), ('en', 'desktop', '/en/tools/scan-business-card/')]:
        ctx = s.context(dev, lang)
        page = s.open(ctx, path)
        s.pick(page, 'ocr_card.png')
        s.wait_ready(page, 1)
        page.locator('input[name="wt-opt-lang"][value="deu"]').check()
        s.check_page(page)
        out = s.run_and_download(page)
        if out:
            v = out.read_text('utf-8')
            for want in ['FN:Erika Mustermann', 'ORG:Beispiel Bau GmbH', 'TITLE:Projektleiterin', 'EMAIL;TYPE=INTERNET,WORK:erika.mustermann@beispielbau.de', '+49 681 123456', '+49 171 2345678', '66111', 'Saarbr']:
                s.expect(want in v, f'{lang}: vCard has {want!r}')
            # correct a field in the editor → the saved file has it
            page.fill('#bc-0-position', 'Bauleiterin')
            saved = s.download_click(page, page.locator('.bc-card .wt-btn-primary').first)
            s.expect('TITLE:Bauleiterin' in saved.read_text('utf-8'), f'{lang}: edited field saved')
            page.locator('.bc-card .wt-btn-quiet').first.click()
            page.wait_for_selector('.bc-qr canvas')
            s.expect(page.locator('.bc-qr canvas').evaluate('c => c.width') >= 150, f'{lang}: QR code shown')
            s.check_page(page)
        page.close()

    # several cards → one vcf + CSV
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/visitenkarte-scannen/')
    s.pick(page, 'ocr_card.png', 'ocr_doc.png')
    s.wait_ready(page, 2)
    page.locator('input[name="wt-opt-lang"][value="deu"]').check()
    if s.run(page, timeout=240000):
        names = [t.strip() for t in page.locator('.wt-output').all_inner_texts()]
        s.expect(any('Kontakte.vcf' in n for n in names) and any('Kontakte.csv' in n for n in names), f'vcf + csv for several cards {names}')
    page.close()

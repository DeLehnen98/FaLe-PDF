"""aud2 fixtures (deterministic): redaction leak traps, invoice/QR data, misc."""
import io
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (DictionaryObject, NameObject, TextStringObject, ArrayObject, FloatObject, NumberObject)
D = Path(__file__).resolve().parent / 'fixtures' / 'aud2'
D.mkdir(parents=True, exist_ok=True)

def redact_traps():
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=A4)
    c.drawString(72, 760, 'Seite 1: Kontakt siehe Link unten.'); c.drawString(72, 700, 'Hier klicken'); c.showPage()
    c.drawString(72, 760, 'Seite 2: Vertrag mit Erika Geheimnis.'); c.showPage()
    c.drawString(72, 760, 'Seite 3: nur ein Kommentar.'); c.showPage(); c.save()
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(buf.getvalue())))
    def annot(page, d):
        a = w._add_object(DictionaryObject(d))
        w.pages[page].setdefault(NameObject('/Annots'), ArrayObject()).append(a)
    rect = ArrayObject([FloatObject(70), FloatObject(690), FloatObject(160), FloatObject(712)])
    annot(0, {NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Link'), NameObject('/Rect'): rect,
              NameObject('/A'): DictionaryObject({NameObject('/S'): NameObject('/URI'), NameObject('/URI'): TextStringObject('mailto:erika.geheimnis@example.com')})})
    annot(2, {NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Text'),
              NameObject('/Rect'): ArrayObject([FloatObject(300), FloatObject(700), FloatObject(320), FloatObject(720)]),
              NameObject('/T'): TextStringObject('Erika Geheimnis'), NameObject('/Contents'): TextStringObject('Bitte pruefen')})
    w.write(D / 'redact_traps.pdf')

redact_traps()
print('ok')

def hard_form():
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=A4); f = c.acroForm
    c.drawString(72, 800, 'Antrag (Formular-Test)')
    y = 760
    for name, label, kw in [('Titel', 'Titel', {}), ('Geburtsort', 'Geburtsort', {}), ('Geburtsdatum', 'Geburtsdatum', {}),
                            ('Telefon', 'Telefon', {}), ('Bemerkung', 'Bemerkung', {'fieldFlags': 'multiline', 'height': 60})]:
        c.drawString(72, y + 4, label)
        h = kw.pop('height', 20)
        f.textfield(name=name, x=200, y=y - h + 20, width=300, height=h, borderWidth=1, fontSize=0 if name == 'Bemerkung' else 11, **kw)
        y -= h + 16
    c.drawString(72, y + 4, 'PLZ (Kammfeld)')
    f.textfield(name='PLZ', x=200, y=y, width=125, height=20, maxlen=5, fieldFlags='comb', borderWidth=1)
    y -= 40
    c.drawString(72, y + 4, 'Familienstand')
    for i, v in enumerate(['ledig', 'verheiratet', 'geschieden']):
        f.radio(name='Familienstand', value=v, x=200 + i * 110, y=y, size=16, selected=False)
        c.drawString(220 + i * 110, y + 4, v)
    y -= 40
    c.drawString(72, y + 4, 'Bundesland')
    f.choice(name='Bundesland', value='Saarland', options=['Bayern', 'Berlin', 'Saarland', 'Thüringen'], x=200, y=y, width=200, height=20)
    y -= 40
    c.drawString(72, y + 4, 'Einverstanden')
    f.checkbox(name='Einverstanden', x=200, y=y, size=16, checked=False, buttonStyle='check')
    c.showPage()
    c.drawString(72, 500, 'Seite 2 (gedreht)')
    f.textfield(name='Unterschrift Ort', x=72, y=400, width=200, height=20, borderWidth=1)
    c.showPage(); c.save()
    r = PdfReader(io.BytesIO(buf.getvalue())); w = PdfWriter(clone_from=r)
    w.pages[1].rotate(90)
    w.write(D / 'hard_form.pdf')

hard_form()
print('form ok')

def images():
    from PIL import Image, ImageDraw
    import numpy as np
    rng = np.random.default_rng(7)
    p = D / 'big48mp.jpg'
    if not p.exists():
        w, h = 8000, 6000
        y, x = np.mgrid[0:h:8, 0:w:8]
        base = np.stack([(x * 255 // w), (y * 255 // h), ((x + y) * 255 // (w + h))], -1).astype(np.uint8)
        im = Image.fromarray(base).resize((w, h))
        d = ImageDraw.Draw(im); d.rectangle([200, 200, 1800, 900], fill=(250, 20, 20)); d.text((300, 400), 'OBEN', fill=(255, 255, 255))
        ex = Image.Exif(); ex[274] = 6; ex[0x010F] = 'TestCam'; ex[0x0110] = 'Model X'
        gps = ex.get_ifd(0x8825); gps[1] = 'N'; gps[2] = (49.0, 14.0, 0.0); gps[3] = 'E'; gps[4] = (7.0, 0.0, 0.0)
        im.save(p, quality=88, exif=ex)
    a = Image.new('RGBA', (600, 400), (0, 0, 0, 0)); d = ImageDraw.Draw(a); d.ellipse([50, 50, 550, 350], fill=(20, 120, 220, 180))
    a.save(D / 'Łukasz Ελληνικά Привет 😀.png')
    Image.new('RGB', (1, 1), (255, 0, 0)).save(D / 'tiny1.jpg')

images()
print('img ok')

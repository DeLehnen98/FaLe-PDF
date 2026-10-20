"""Test form for „Prüfen vor dem Speichern“: Pflichtfelder, a date field with the PDF's own format (AFDate_FormatEx),
an amount field (AFNumber_Format), IBAN, E-Mail, PLZ, a required consent checkbox and a free „Ort, Datum“ field."""
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, DictionaryObject, TextStringObject

HERE = os.path.dirname(os.path.abspath(__file__))
RAW, OUT = os.path.join(HERE, '_raw.pdf'), os.path.join(HERE, 'antrag.pdf')

c = canvas.Canvas(RAW, pagesize=A4)
c.setFont('Helvetica-Bold', 16); c.drawString(60, 790, 'Antrag auf Erstattung')
c.setFont('Helvetica', 10)
af = c.acroForm
rows = [('Name', 'name', 'required'), ('Geburtsdatum', 'geburtsdatum', ''), ('E-Mail', 'email', ''), ('PLZ', 'plz', ''),
        ('IBAN', 'iban', 'required'), ('Betrag', 'betrag', ''), ('Termin', 'termin', ''), ('Ort, Datum', 'ort_datum', '')]
y = 740
for label, name, flags in rows:
    c.drawString(60, y + 5, label + ':')
    af.textfield(name=name, x=180, y=y, width=260, height=20, fieldFlags=flags, borderWidth=1)
    y -= 40
c.drawString(60, y + 5, 'Einwilligung:')
af.checkbox(name='einwilligung', x=180, y=y, size=16, fieldFlags='required')
c.save()

r = PdfReader(RAW); w = PdfWriter(); w.append(r)
JS = {'termin': 'AFDate_FormatEx("dd.mm.yyyy");', 'betrag': 'AFNumber_Format(2, 2, 0, 0, "", false);'}
for annot in w.pages[0]['/Annots']:
    a = annot.get_object()
    nm = a.get('/T') or (a.get('/Parent') and a['/Parent'].get_object().get('/T'))
    if nm in JS:
        a[NameObject('/AA')] = DictionaryObject({NameObject('/F'): DictionaryObject({NameObject('/S'): NameObject('/JavaScript'), NameObject('/JS'): TextStringObject(JS[nm])})})
    if nm == 'geburtsdatum':
        a[NameObject('/TU')] = TextStringObject('Geburtsdatum')
w.write(OUT); os.remove(RAW)
print('written', OUT)

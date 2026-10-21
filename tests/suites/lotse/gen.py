"""Test form for the Formular-Lotse: fields only called Text1, Text2 … with their labels printed next to them, a row of
check boxes (Familienstand), a radio group (Geschlecht), a dropdown, a field with a tooltip, a multi-line field with
its label above, a term the offline glossary does not know (Mietstufe), a required consent box, page 2 with
„Ort, Datum“ and a signature field."""
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, DictionaryObject, TextStringObject, ArrayObject, FloatObject, NumberObject

HERE = os.path.dirname(os.path.abspath(__file__))
RAW, OUT = os.path.join(HERE, '_raw.pdf'), os.path.join(HERE, 'wohngeld.pdf')

c = canvas.Canvas(RAW, pagesize=A4)
af = c.acroForm
c.setFont('Helvetica-Bold', 15); c.drawString(50, 800, 'Antrag auf Mietzuschuss (Testformular)')
c.setFont('Helvetica', 10)
y = 750
rows = [('Familienname:', 'required'), ('Vorname:', ''), ('Geburtsdatum:', ''), ('Staatsangehörigkeit:', ''),
        ('Straße und Hausnummer:', ''), ('PLZ / Ort:', ''), ('E-Mail:', ''), ('IBAN:', 'required'), ('Mietstufe der Gemeinde:', '')]
n = 1
for label, flags in rows:
    c.drawString(50, y + 6, label)
    af.textfield(name=f'Text{n}', x=200, y=y, width=300, height=20, fieldFlags=flags, borderWidth=1)
    n += 1; y -= 34
# Familienstand: a row of boxes with their words to the right
c.drawString(50, y + 4, 'Familienstand:')
x = 200
for i, word in enumerate(['ledig', 'verheiratet', 'geschieden', 'verwitwet']):
    af.checkbox(name=f'Check{i + 1}', x=x, y=y, size=13, borderWidth=1, fieldFlags='')
    c.drawString(x + 18, y + 3, word)
    x += 85
y -= 34
# Geschlecht: radio group (export values are meaningless, the words are on the page)
c.drawString(50, y + 4, 'Geschlecht:')
x = 200
for i, word in enumerate(['männlich', 'weiblich', 'divers']):
    af.radio(name='Gruppe1', value=f'Auswahl{i + 1}', x=x, y=y, size=13, borderWidth=1, fieldFlags='noToggleToOff radio')
    c.drawString(x + 18, y + 3, word)
    x += 90
y -= 34
c.drawString(50, y + 6, 'Bundesland:')
af.choice(name='Kombinationsfeld1', x=200, y=y, width=200, height=20, options=['Bitte wählen', 'Bayern', 'Berlin', 'Saarland'], value='Bitte wählen', fieldFlags='combo')
y -= 34
c.drawString(50, y + 6, 'Kassenzeichen:')
af.textfield(name='kz', tooltip='Kassenzeichen', x=200, y=y, width=200, height=20, borderWidth=1)
y -= 40
c.drawString(50, y + 4, 'Begründung des Antrags:')
y -= 64
af.textfield(name='Text20', x=50, y=y, width=450, height=58, fieldFlags='multiline', borderWidth=1)
y -= 30
af.checkbox(name='Check9', x=50, y=y, size=13, borderWidth=1, fieldFlags='required')
c.drawString(70, y + 3, 'Ich versichere, dass alle Angaben richtig sind.')
c.showPage()
c.setFont('Helvetica', 10)
c.drawString(50, 760, 'Ort, Datum:')
af.textfield(name='Text30', x=200, y=754, width=250, height=20, borderWidth=1)
c.drawString(50, 700, 'Unterschrift:')
c.save()

r = PdfReader(RAW); w = PdfWriter(); w.append(r)
# a real signature field on page 2
page = w.pages[1]
sig = DictionaryObject({
    NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Widget'), NameObject('/FT'): NameObject('/Sig'),
    NameObject('/T'): TextStringObject('Unterschrift1'), NameObject('/F'): NumberObject(4),
    NameObject('/Rect'): ArrayObject([FloatObject(200), FloatObject(680), FloatObject(450), FloatObject(720)]),
})
ref = w._add_object(sig)
page[NameObject('/Annots')] = ArrayObject(list(page.get('/Annots', ArrayObject())) + [ref])
w._root_object['/AcroForm']['/Fields'].append(ref)
w.write(OUT); os.remove(RAW)
print('written', OUT)

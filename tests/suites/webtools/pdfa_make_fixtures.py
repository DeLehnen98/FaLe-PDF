"""Fixtures for the PDF/A tool (fixtures/pdfa/): JavaScript + attachment + launch link, transparency, std fonts,
optional content. Run: python3 pdfa_make_fixtures.py"""
from pathlib import Path
import pikepdf
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, CMYKColor

D = Path(__file__).resolve().parent / 'fixtures' / 'pdfa'
D.mkdir(parents=True, exist_ok=True)

# 1. standard fonts (not embedded), RGB, two pages
c = canvas.Canvas(str(D / 'std14.pdf'))
for i in range(2):
    c.setFont('Helvetica', 18); c.drawString(72, 760, f'Archivtest Seite {i + 1} – Grüße aus Saarbrücken')
    c.setFillColorRGB(0.2, 0.4, 0.8); c.rect(72, 600, 200, 100, fill=1)
    c.showPage()
c.save()

# 1b. Times (not embedded; no metric-compatible font ships with the tool → pages become images)
c = canvas.Canvas(str(D / 'times.pdf'), initialFontName='Times-Roman')
c.setFont('Times-Roman', 18); c.drawString(72, 760, 'Seite in Times – Grüße aus Saarbrücken')
c.showPage(); c.save()

# 2. transparency (allowed in PDF/A-2, not in PDF/A-1) + CMYK colour on page 2 – embedded font, so only those count
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
LIB = Path(__file__).resolve().parents[3] / 'vendor' / 'pdfjs' / 'standard_fonts' / 'LiberationSans-Regular.ttf'
pdfmetrics.registerFont(TTFont('LibSans', str(LIB)))
c = canvas.Canvas(str(D / 'transp_cmyk.pdf'), initialFontName='LibSans')
c.setFont('LibSans', 16); c.drawString(72, 760, 'Transparenz-Seite')
c.setFillColor(Color(1, 0, 0, alpha=0.5)); c.rect(72, 500, 300, 200, fill=1)
c.showPage()
c.setFont('LibSans', 16); c.setFillColor(CMYKColor(0, 0, 0, 1)); c.drawString(72, 760, 'Druckfarben-Seite (CMYK)')
c.setFillColor(CMYKColor(0, 1, 1, 0)); c.rect(72, 500, 300, 200, fill=1)
c.showPage()
c.save()

# 3. embedded-font PDF (TrueType subset, image, three pages) with JavaScript, launch link, additional actions and an
#    attachment – self-contained (no office suite needed, also runs in CI)
from reportlab.lib.utils import ImageReader
from PIL import Image as PILImage
import io
src = D / '_embedded.pdf'
c = canvas.Canvas(str(src), initialFontName='LibSans')
img = PILImage.new('RGB', (240, 160), (30, 120, 200))
for x in range(240):
    for y in range(0, 160, 8):
        img.putpixel((x, y), (250, 200, 40))
buf = io.BytesIO(); img.save(buf, 'JPEG', quality=85); buf.seek(0)
for i in range(3):
    c.setFont('LibSans', 14)
    c.drawString(72, 760, f'Vertrag Seite {i + 1}: Grüße aus Saarbrücken – Größe, Maß, Straße')
    for k in range(20):
        c.drawString(72, 720 - k * 18, f'Zeile {k + 1}: Dieser Text ist eingebettet und bleibt Text.')
    c.drawImage(ImageReader(buf), 330, 80, 200, 133)
    c.showPage()
c.save()
pdf = pikepdf.open(src)
js = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String('app.alert("hi")')))
pdf.Root.OpenAction = js
pdf.Root.AA = pikepdf.Dictionary(WC=js)
names = pdf.Root.get('/Names') or pikepdf.Dictionary()
names.JavaScript = pikepdf.Dictionary(Names=pikepdf.Array([pikepdf.String('a'), js]))
pdf.Root.Names = names
pdf.attachments['rechnung.xml'] = pikepdf.AttachedFileSpec(pdf, b'<?xml version="1.0"?><Invoice/>', mime_type='text/xml')
page = pdf.pages[0]
launch = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[72, 72, 200, 100], Border=[0, 0, 0],
                                              A=pikepdf.Dictionary(S=pikepdf.Name.Launch, F=pikepdf.String('calc.exe'))))
uri = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[72, 110, 200, 130], Border=[0, 0, 0],
                                           A=pikepdf.Dictionary(S=pikepdf.Name.URI, URI=pikepdf.String('https://fale.network/'))))
page.obj.Annots = pdf.make_indirect(pikepdf.Array(list(page.obj.get('/Annots', [])) + [launch, uri]))
pdf.docinfo['/Title'] = 'Testdokument für PDF/A'
pdf.docinfo['/Author'] = 'Erika Muster'
pdf.save(D / 'lo_js_attach.pdf')

# 4. form field without appearance (NeedAppearances) + sticky note without appearance + a FreeText note
pdf = pikepdf.open(src)
page = pdf.pages[0]
field = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Widget, FT=pikepdf.Name.Tx,
                                             T=pikepdf.String('Name'), V=pikepdf.String('Erika Muster'), Rect=[72, 300, 300, 324],
                                             DA=pikepdf.String('/Helv 12 Tf 0 g'), F=4, P=page.obj))
note = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Text, Rect=[400, 700, 420, 720],
                                            Contents=pikepdf.String('Bitte prüfen'), F=0))
page.obj.Annots = pdf.make_indirect(pikepdf.Array([field, note]))
helv = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica, Encoding=pikepdf.Name.WinAnsiEncoding))
pdf.Root.AcroForm = pikepdf.Dictionary(Fields=[field], NeedAppearances=True, DR=pikepdf.Dictionary(Font=pikepdf.Dictionary(Helv=helv)), DA=pikepdf.String('/Helv 0 Tf 0 g'))
pdf.save(D / 'form_noap.pdf')

# 5. the embedded document, AES-256 encrypted (password: geheim)
pikepdf.open(src).save(D / 'encrypted.pdf', encryption=pikepdf.Encryption(user='geheim', owner='geheim', R=6))
print('fixtures written to', D)

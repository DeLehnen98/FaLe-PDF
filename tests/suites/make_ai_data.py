"""Creates the fixtures for test_ai.py in ai_data/ (git-ignored): a 4-page rental contract whose pages answer the
test questions (start of tenancy → p. 2, notice period → p. 3, rent → p. 4) and a sign photo for on-device OCR.
Run: python3 make_ai_data.py"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai_data')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
PAGES = [
    ("Mietvertrag über eine Wohnung", ["Zwischen Vermieterin Erika Beispiel und Mieter Max Muster wird folgender Vertrag geschlossen.",
     "Gegenstand ist die Wohnung im zweiten Obergeschoss, drei Zimmer, Küche, Bad, Balkon, etwa 72 Quadratmeter.",
     "Zur Wohnung gehören ein Kellerraum und ein Stellplatz für Fahrräder."]),
    ("§ 2 Mietbeginn", ["Das Mietverhältnis beginnt am 1. März 2026 und läuft auf unbestimmte Zeit.",
     "Wann die Schlüssel übergeben werden, wird gemeinsam vereinbart; dabei wird ein Übergabeprotokoll erstellt.",
     "Zählerstände für Strom, Wasser und Heizung werden bei der Übergabe notiert."]),
    ("§ 3 Kündigung", ["Die Kündigungsfrist für den Mieter beträgt drei Monate zum Monatsende.",
     "Die Kündigung muss schriftlich erfolgen. Wie lang die Frist für die Vermieterin ist, richtet sich nach der Wohndauer.",
     "Maßgeblich für die Rechtzeitigkeit ist der Zugang der Kündigung."]),
    ("§ 4 Miete und Nebenkosten", ["Die Miete ist so hoch: monatlich 780 Euro Grundmiete zuzüglich 190 Euro Vorauszahlung auf die Betriebskosten.",
     "Die Miete ist jeweils bis zum dritten Werktag eines Monats auf das Konto der Vermieterin zu zahlen.",
     "Die Kaution beträgt drei Grundmieten und kann in drei Raten gezahlt werden."]),
]

os.makedirs(D, exist_ok=True)
pdfmetrics.registerFont(TTFont('DV', FONT))
c = canvas.Canvas(os.path.join(D, 'vertrag.pdf'), pagesize=A4)
for title, lines in PAGES:
    c.setFont('DV', 18); c.drawString(60, 770, title)
    c.setFont('DV', 11); y = 730
    for line in lines:
        cur = ''
        for w in line.split():
            if pdfmetrics.stringWidth(cur + ' ' + w, 'DV', 11) > 470:
                c.drawString(60, y, cur.strip()); y -= 18; cur = ''
            cur += ' ' + w
        c.drawString(60, y, cur.strip()); y -= 28
    c.showPage()
c.save()

img = Image.new('RGB', (1000, 400), (250, 250, 245))
d = ImageDraw.Draw(img)
d.text((120, 90), 'Notausgang', font=ImageFont.truetype(BOLD, 90), fill=(20, 20, 20))
d.text((120, 220), 'Bitte freihalten', font=ImageFont.truetype(FONT, 60), fill=(20, 20, 20))
img.save(os.path.join(D, 'schild.png'))
print('ai_data ready')

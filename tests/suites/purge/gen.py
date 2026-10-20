"""Fixtures for „Abdecken löscht wirklich“ (tests/suites/test_cover_purge.py). Invented content.
rl_std.pdf    ReportLab, standard font (no /Widths) – secret word in the middle of a line
rl_ttf.pdf    ReportLab, embedded TrueType (DejaVu Sans) + a form XObject with text
rl_img.pdf    ReportLab, text + a picture (covering the picture must rebuild the page as image)
lo.pdf        LibreOffice from a .odt-like HTML: subset TrueType, kerning (TJ)"""
import os, subprocess, tempfile
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image

D = os.path.dirname(os.path.abspath(__file__))
W, H = A4
LINE = 'Kontonummer: GEHEIM4711 bitte nicht weitergeben, Rest bleibt'

c = canvas.Canvas(os.path.join(D, 'rl_std.pdf'), pagesize=A4)
c.setFont('Helvetica', 12); c.drawString(72, H - 100, LINE)
c.drawString(72, H - 130, 'Zweite Zeile ohne Geheimnis')
c.setFont('Helvetica-Bold', 14); c.drawString(72, H - 170, 'Fett: STRENGGEHEIM steht hier')
c.save()

pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
c = canvas.Canvas(os.path.join(D, 'rl_ttf.pdf'), pagesize=A4)
c.setFont('DejaVu', 12); c.drawString(72, H - 100, 'Zażółć: GEHEIM4711 und weiter im Text')
c.beginForm('box')
c.setFont('DejaVu', 11); c.drawString(72, H - 200, 'Im Formular: FORMGEHEIM bleibt nicht')
c.endForm()
c.doForm('box')
c.save()

img = Image.new('RGB', (200, 100), (200, 30, 30))
p = os.path.join(tempfile.gettempdir(), 'purge_img.png'); img.save(p)
c = canvas.Canvas(os.path.join(D, 'rl_img.pdf'), pagesize=A4)
c.setFont('Helvetica', 12); c.drawString(72, H - 100, 'Foto unten: BILDGEHEIM')
c.drawImage(p, 72, H - 300, 200, 100)
c.save()

html = os.path.join(tempfile.gettempdir(), 'purge_lo.html')
open(html, 'w', encoding='utf-8').write('<html><body style="font-family:Liberation Serif;font-size:12pt"><p>Sehr geehrte Frau Muster, Ihre Kundennummer LOGEHEIM99 ist vertraulich. Weitere Angaben folgen.</p><p>AVAVAV Tolle Kerning-Probe WAVE</p></body></html>')
subprocess.run(['soffice', '--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', tempfile.gettempdir(), html], check=True, capture_output=True, timeout=120)
os.replace(os.path.join(tempfile.gettempdir(), 'purge_lo.pdf'), os.path.join(D, 'lo.pdf'))
print('ok')

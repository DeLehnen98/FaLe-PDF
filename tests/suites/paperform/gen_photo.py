"""A paper form photographed with a phone (invented people, invented content): a Vollmacht with thin write-on lines
(„Geburtsdatum: ____“, „Anschrift: ____“, „Ort, Datum“ and „Unterschrift“ under their lines) – printed, then
photographed slightly from the side (perspective), tilted ~2.5°, warm uneven light with a bright spot and a shadow,
a little blur and JPEG noise, a dark table at the top edge.
photo_form.pdf + photo_truth.json (expected fields in points of the photo page, top-left origin)."""
import json, os, subprocess, io
import numpy as np
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from PIL import Image, ImageFilter, ImageDraw

D = os.path.dirname(os.path.abspath(__file__))
W, H = A4
RAW = os.path.join(D, '_photo_src.pdf')
c = canvas.Canvas(RAW, pagesize=A4)
T = lambda x, y: (x, H - y)
c.setFont('Helvetica-Bold', 15); c.drawString(*T(60, 90), 'Vollmacht')
c.setFont('Helvetica-Bold', 10); c.drawString(*T(60, 120), 'Vollmachtgeber (Versicherungsnehmer):')
c.setFont('Helvetica', 10); c.drawString(*T(60, 134), 'Erika Beispiel')
c.drawString(*T(60, 150), 'Geburtsdatum:'); c.setLineWidth(0.6); c.line(*T(130, 152), *T(330, 152))
c.drawString(*T(60, 168), 'Anschrift:'); c.line(*T(108, 170), *T(470, 170))
c.setFont('Helvetica-Bold', 10); c.drawString(*T(60, 200), 'Bevollmächtigter:')
c.setFont('Helvetica', 10); c.drawString(*T(60, 214), 'Max Muster, geb. 01.02.1990'); c.drawString(*T(60, 228), 'Musterweg 1, 12345 Musterstadt')
c.setFont('Helvetica-Bold', 10); c.drawString(*T(60, 258), 'Versicherer:')
c.setFont('Helvetica', 10)
for i, t in enumerate(['Beispiel Versicherung AG', 'Vertrag: 123/456789-X (Vorgang 987654321)', 'Fahrzeug: Kleinwagen, Kennzeichen XY-AB 123']):
    c.drawString(*T(60, 272 + i * 14), t)
para = ['Hiermit bevollmächtige ich meinen Sohn Max Muster, mich gegenüber der Versicherung',
        'in allen Angelegenheiten zum oben genannten Kfz-Versicherungsvertrag zu vertreten.',
        'Dies umfasst insbesondere Auskünfte zum Vertrag, zur Schadenfreiheitsklasse und zum',
        'Versichererwechsel sowie Änderungen am Vertrag zu veranlassen.']
for i, t in enumerate(para):
    c.drawString(*T(60, 330 + i * 15), t)
c.drawString(*T(60, 410), 'Die Vollmacht gilt bis auf schriftlichen Widerruf.')
c.line(*T(60, 480), *T(260, 480)); c.line(*T(310, 480), *T(535, 480))
c.setFont('Helvetica', 8); c.drawString(*T(60, 491), 'Ort, Datum'); c.drawString(*T(390, 491), 'Unterschrift Erika Beispiel')
c.showPage(); c.save()

subprocess.run(['pdftoppm', '-r', '150', '-png', '-singlefile', RAW, os.path.join(D, '_photo')], check=True)
src = Image.open(os.path.join(D, '_photo.png')).convert('RGB')
sw, sh = src.size
k = sw / W  # pixels per point of the printed page
# photographed: a darker table around, the sheet seen a little from the side (keystone) and turned ~2.5°
OW, OH = int(sw * 1.04), int(sh * 0.96)
quad = [(0.06 * OW, 0.05 * OH), (0.99 * OW, 0.025 * OH), (1.02 * OW, 1.04 * OH), (0.01 * OW, 1.03 * OH)]  # corners of the sheet in the photo

def coeffs(dst, srcp):
    A, B = [], []
    for (x, y), (u, v) in zip(dst, srcp):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]; B += [u, v]
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

srcq = [(0, 0), (sw, 0), (sw, sh), (0, sh)]
photo = Image.new('RGB', (OW, OH), (70, 55, 40))
sheet = src.transform((OW, OH), Image.PERSPECTIVE, coeffs(quad, srcq), Image.BICUBIC, fillcolor=(70, 55, 40))
mask = Image.new('L', (OW, OH), 0); ImageDraw.Draw(mask).polygon(quad, fill=255)
photo.paste(sheet, (0, 0), mask)
a = np.asarray(photo).astype(np.float32)
yy, xx = np.mgrid[0:OH, 0:OW]
light = 0.78 + 0.22 * (1 - yy / OH) - 0.12 * (xx / OW)                       # darker to the bottom right
light += 0.18 * np.exp(-(((xx - OW * 0.55) / (OW * 0.25)) ** 2 + ((yy - OH * 0.45) / (OH * 0.12)) ** 2))  # lamp glare
light -= 0.10 * np.exp(-(((yy - OH * 0.82) / (OH * 0.08)) ** 2))             # shadow of the phone
tint = np.array([1.0, 0.93, 0.82])                                          # warm room light
a = np.clip(a * light[..., None] * tint, 0, 255)
a += np.random.default_rng(7).normal(0, 4, a.shape)
photo = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))
buf = io.BytesIO(); photo.save(buf, 'JPEG', quality=70); buf.seek(0)
PW, PH = OW / k, OH / k  # photo page in points (150 dpi photo, same scale as the sheet)
out = canvas.Canvas(os.path.join(D, 'photo_form.pdf'), pagesize=(PW, PH))
from reportlab.lib.utils import ImageReader
out.drawImage(ImageReader(buf), 0, 0, PW, PH); out.showPage(); out.save()

# where the four write-on lines end up in the photo (points, top-left origin)
inv = coeffs(srcq, quad)  # sheet pixels → photo pixels
def to_photo(xp, yp):
    x, y = xp * k, yp * k
    a_, b_, c_, d_, e_, f_, g_, h_ = inv
    den = g_ * x + h_ * y + 1
    return ((a_ * x + b_ * y + c_) / den) / k, ((d_ * x + e_ * y + f_) / den) / k
lines = [('Geburtsdatum', 130, 330, 152), ('Anschrift', 108, 470, 170), ('Ort, Datum', 60, 260, 480), ('Unterschrift', 310, 535, 480)]
truth = []
for name, x0, x1, y in lines:
    (ax, ay), (bx, by) = to_photo(x0, y), to_photo(x1, y)
    truth.append({'name': name, 'line': [round(ax, 1), round(ay, 1), round(bx, 1), round(by, 1)]})
json.dump({'page': [round(PW, 1), round(PH, 1)], 'lines': truth}, open(os.path.join(D, 'photo_truth.json'), 'w'), indent=1)
for f in (RAW, os.path.join(D, '_photo.png')):
    os.remove(f)
print('written photo_form.pdf', truth)

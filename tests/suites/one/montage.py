"""montage.png: phone screenshots (light + dark) and the desktop shots in one sheet."""
import os
from PIL import Image, ImageDraw, ImageFont
SP = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(SP, 'shots')
files = sorted(f for f in os.listdir(S) if f.endswith('.png'))
phones = [f for f in files if f.startswith('phone_')]
desks = [f for f in files if f.startswith('desktop_')]
W = 260; cols = 8
def thumb(path, w):
    im = Image.open(path).convert('RGB'); h = int(im.height * w / im.width); return im.resize((w, h), Image.LANCZOS)
tp = [thumb(os.path.join(S, f), W) for f in phones]
td = [thumb(os.path.join(S, f), W * 2 + 16) for f in desks]
ph = max([t.height for t in tp] or [0]); rows = (len(tp) + cols - 1) // cols
dh = max([t.height for t in td] or [0])
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except Exception: font = ImageFont.load_default()
Wt = cols * (W + 16) + 16
Ht = 16 + rows * (ph + 40) + ((len(td) + 3) // 4) * (dh + 40) + 16
sheet = Image.new('RGB', (Wt, Ht), (232, 234, 244)); d = ImageDraw.Draw(sheet)
for i, (t, f) in enumerate(zip(tp, phones)):
    x = 16 + (i % cols) * (W + 16); y = 16 + (i // cols) * (ph + 40)
    sheet.paste(t, (x, y)); d.text((x, y + t.height + 6), f[6:-4][:34], fill=(40, 40, 70), font=font)
y0 = 16 + rows * (ph + 40)
for i, (t, f) in enumerate(zip(td, desks)):
    x = 16 + (i % 4) * (W * 2 + 32); y = y0 + (i // 4) * (dh + 40)
    sheet.paste(t, (x, y)); d.text((x, y + t.height + 6), f[:-4], fill=(40, 40, 70), font=font)
sheet.save(os.path.join(SP, 'montage.png'), optimize=True)
print('montage', sheet.size, len(phones), 'phone', len(desks), 'desktop')

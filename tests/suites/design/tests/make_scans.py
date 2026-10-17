"""Synthetic document photos with known corners → testdata/scan_*.jpg + scan_truth.json"""
import json, random, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(7); np.random.seed(7)

def find_coeffs(pa, pb):
    # PIL perspective: maps output (pa) → input (pb)
    m = []
    for p1, p2 in zip(pa, pb):
        m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0]*p1[0], -p2[0]*p1[1]])
        m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1]*p1[0], -p2[1]*p1[1]])
    A = np.array(m, dtype=float); B = np.array(pb, dtype=float).reshape(8)
    return np.linalg.solve(A, B).tolist()

def paper(w=850, h=1100, card=False):
    img = Image.new('RGB', (w, h), (248, 246, 240) if not card else (210, 225, 240))
    d = ImageDraw.Draw(img)
    try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 26 if not card else 34)
    except Exception: f = ImageFont.load_default()
    if card:
        d.rectangle([40, 60, 300, 400], fill=(170, 180, 200))
        for i, t in enumerate(['MUSTERMANN', 'ERIKA', '12.08.1983', 'BERLIN']):
            d.text((340, 80 + i * 70), t, fill=(30, 30, 50), font=f)
        d.rectangle([0, 0, w, 40], fill=(40, 90, 160))
    else:
        d.text((70, 60), 'Rechnung Nr. 2026-0815', fill=(20, 20, 20), font=f)
        for i in range(30):
            d.text((70, 130 + i * 30), ('Position %d  Lorem ipsum dolor sit amet, consectetur ' % (i + 1))[:44], fill=(30, 30, 30), font=f)
    return img

def background(W, H, kind):
    if kind == 'wood':
        x = np.linspace(0, 30, W)[None, :] + np.random.rand(H, 1) * 3
        base = (np.sin(x) * 18 + 110)[..., None] * np.array([1.0, 0.72, 0.45])[None, None, :]
        noise = np.random.randn(H, W, 1) * 6
        arr = np.clip(base + noise, 0, 255).astype(np.uint8)
        return Image.fromarray(arr)
    if kind == 'dark':
        arr = np.clip(np.random.randn(H, W, 3) * 8 + 50, 0, 255).astype(np.uint8)
        return Image.fromarray(arr)
    if kind == 'gray':
        arr = np.clip(np.random.randn(H, W, 3) * 5 + 150, 0, 255).astype(np.uint8)
        return Image.fromarray(arr)
    return Image.new('RGB', (W, H), (90, 110, 90))

truth = {}
W, H = 1200, 1600
def project(wmm, hmm, rx, ry, rz, dist, f=1400, shift=(0, 0)):
    # rectangle centred at origin in plane z=0, rotated, placed at distance dist; pinhole camera at centre
    pts = np.array([[-wmm/2, -hmm/2, 0], [wmm/2, -hmm/2, 0], [wmm/2, hmm/2, 0], [-wmm/2, hmm/2, 0]], float)
    a, b, c = np.radians([rx, ry, rz])
    Rx = np.array([[1,0,0],[0,np.cos(a),-np.sin(a)],[0,np.sin(a),np.cos(a)]])
    Ry = np.array([[np.cos(b),0,np.sin(b)],[0,1,0],[-np.sin(b),0,np.cos(b)]])
    Rz = np.array([[np.cos(c),-np.sin(c),0],[np.sin(c),np.cos(c),0],[0,0,1]])
    P = pts @ (Rz @ Ry @ Rx).T + np.array([shift[0], shift[1], dist])
    return [(W/2 + f * x / z, H/2 + f * y / z) for x, y, z in P]
cases = [('wood', project(210, 297, 18, -8, 4, 420), False),
         ('dark', project(210, 297, -12, 10, -3, 400, shift=(5, 10)), False),
         ('gray', project(210, 297, 25, 6, 8, 450, shift=(-8, 0)), False),
         ('green', project(85.6, 54, 15, -10, 5, 190, shift=(0, 5)), True)]
for i, (kind, quad, card) in enumerate(cases):
    bg = background(W, H, kind)
    pap = paper(856, 540, True) if card else paper(840, 1188)
    pw, ph = pap.size
    coeffs = find_coeffs(quad, [(0, 0), (pw, 0), (pw, ph), (0, ph)])
    warped = pap.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new('L', (pw, ph), 255).transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    bg.paste(warped, (0, 0), mask)
    # uneven lighting + blur + noise
    arr = np.asarray(bg).astype(float)
    yy, xx = np.mgrid[0:H, 0:W]
    light = 0.78 + 0.25 * (xx / W) * (1 - 0.3 * yy / H)
    arr = np.clip(arr * light[..., None] + np.random.randn(H, W, 3) * 3, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(1.2))
    name = f'scan_{i + 1}_{kind}.jpg'
    img.save('testdata/' + name, quality=88)
    truth[name] = [[x / W, y / H] for x, y in quad]
json.dump(truth, open('testdata/scan_truth.json', 'w'), indent=1)
print(truth)

"""Fixtures for test_qr_scanner.py: QR codes from our own encoder (via node), drawn with PIL – clean PNGs,
a tilted noisy "photo" JPG, several codes in one picture, a two-page PDF with the code on page 2, a picture
without a code. Run: python3 qrscan_make_fixtures.py (writes into fixtures/qrscan/)."""
import json, math, random, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
OUT = HERE / 'fixtures' / 'qrscan'
ENC = (HERE / '../../../network/assets/wt/lib/shared/qr.js').resolve()

PAYLOADS = {
    'link': ('https://fale.network/werkzeuge/', 'M'),
    'phish': ('https://login.konto-sicherheit.example.xyz/verify?id=7', 'M'),
    'wifi': ('WIFI:T:WPA;S:Café Netz;P:geheim123;;', 'Q'),
    'epc': ('BCD\n002\n1\nSCT\nBFSWDE33XXX\nFale Test e.V.\nDE89370400440532013000\nEUR12.50\n\nRF18539007547034\n\n', 'M'),
    'vcard': ('BEGIN:VCARD\nVERSION:3.0\nN:Mustermann;Erika;;;\nFN:Erika Mustermann\nORG:Muster GmbH\nTEL:+49 681 123456\nEMAIL:erika@example.de\nEND:VCARD', 'M'),
    'otp': ('otpauth://totp/Beispiel:erika@example.de?secret=JBSWY3DPEHPK3PXP&issuer=Beispiel', 'M'),
    'formula': ('=HYPERLINK("http://example.com")', 'M'),
    'text': ('Hallo aus dem Test – äöü 👋', 'M'),
    'big': ('https://fale.network/werkzeuge/?' + 'x' * 260, 'L'),
}


def matrices():
    js = f"""import {{ encodeQR }} from '{ENC.as_posix()}';
const P = {json.dumps(PAYLOADS)};
const out = {{}};
for (const [k, [t, e]] of Object.entries(P)) {{ const q = encodeQR(t, {{ ecc: e }}); const rows = [];
  for (let y = 0; y < q.size; y++) {{ let r = ''; for (let x = 0; x < q.size; x++) r += q.get(x, y) ? '1' : '0'; rows.push(r); }} out[k] = rows; }}
console.log(JSON.stringify(out));"""
    res = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def draw(rows, px=8, border=4, dark=(20, 20, 20), light=(255, 255, 255)):
    n = len(rows)
    img = Image.new('RGB', ((n + 2 * border) * px,) * 2, light)
    d = ImageDraw.Draw(img)
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c == '1':
                d.rectangle([(x + border) * px, (y + border) * px, (x + border + 1) * px - 1, (y + border + 1) * px - 1], fill=dark)
    return img


def perspective_coeffs(src, dst):
    # PIL wants the mapping from output to input: solve the 8 coefficients
    import numpy as np  # noqa – only for the solve
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return list(np.linalg.solve(np.array(A, float), np.array(b, float)))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    m = matrices()
    for k in ['link', 'phish', 'wifi', 'epc', 'vcard', 'otp', 'formula', 'text']:
        draw(m[k]).save(OUT / f'qr_{k}.png')
    # tilted photo: perspective + rotation + uneven light + noise + blur, as JPG
    random.seed(5)
    base = draw(m['big'], px=6)
    W = int(base.width * 1.5)
    canvas = Image.new('RGB', (W, W), (235, 230, 220))
    canvas.paste(base, ((W - base.width) // 2, (W - base.height) // 2))
    s, o = base.width, (W - base.width) / 2
    src = [(o, o), (o + s, o), (o + s, o + s), (o, o + s)]
    dst = [(o + 40, o + 10), (o + s - 10, o + 50), (o + s + 20, o + s - 5), (o - 10, o + s - 30)]
    photo = canvas.transform(canvas.size, Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC, fillcolor=(235, 230, 220))
    photo = photo.rotate(17, resample=Image.BICUBIC, fillcolor=(235, 230, 220))
    px = photo.load()
    for y in range(photo.height):
        for x in range(photo.width):
            f = 0.7 + 0.3 * x / photo.width
            r, g, b = px[x, y]
            nz = random.randint(-18, 18)
            px[x, y] = tuple(max(0, min(255, int(c * f) + nz)) for c in (r, g, b))
    photo.filter(ImageFilter.GaussianBlur(0.8)).save(OUT / 'qr_photo.jpg', quality=82)
    # two codes in one picture
    a, b = draw(m['vcard'], px=6), draw(m['text'], px=6)
    multi = Image.new('RGB', (a.width + b.width + 60, max(a.height, b.height) + 40), 'white')
    multi.paste(a, (20, 20)); multi.paste(b, (a.width + 40, 20))
    multi.save(OUT / 'qr_multi.png')
    # PDF: page 1 text only, page 2 an invoice-like page with the payment code bottom right
    p1 = Image.new('RGB', (1240, 1754), 'white')
    ImageDraw.Draw(p1).text((100, 100), 'Rechnung – Seite 1 ohne Code', fill='black')
    p2 = Image.new('RGB', (1240, 1754), 'white')
    ImageDraw.Draw(p2).text((100, 100), 'Zahlungsinformationen', fill='black')
    p2.paste(draw(m['epc'], px=5), (800, 1300))
    p1.save(OUT / 'qr_invoice.pdf', save_all=True, append_images=[p2], resolution=150)
    # no code at all
    nc = Image.new('RGB', (800, 600), (200, 210, 230))
    d = ImageDraw.Draw(nc)
    for i in range(40):
        x0, y0 = random.randint(0, 700), random.randint(0, 500)
        d.rectangle([x0, y0, x0 + random.randint(10, 100), y0 + random.randint(10, 100)], outline=(random.randint(0, 255),) * 3, width=3)
    nc.save(OUT / 'no_code.png')
    print('fixtures in', OUT)


if __name__ == '__main__':
    main()

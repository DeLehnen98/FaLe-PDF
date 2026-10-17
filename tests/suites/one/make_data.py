"""Test data for the FaLe One UI tests → data/ (photos with EXIF/GPS, a video, a fake HEIC, a folder tree, a big file,
a Google Takeout zip with JSON sidecars and an album folder)."""
import os, io, json, zipfile, shutil, subprocess, random
from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational as R
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D + '/photos'); os.makedirs(D + '/tree/Projekt/Unterordner'); os.makedirs(D + '/takeout')
random.seed(7)

def deg(v):
    v = abs(v); d = int(v); m = int((v - d) * 60); s = round(((v - d) * 60 - m) * 60 * 100)
    return (R(d, 1), R(m, 1), R(s, 100))

def photo(name, when, color, gps=None, make='Canon', model='Canon EOS R6', size=(1200, 800), offset='+02:00'):
    im = Image.new('RGB', size, color)
    dr = ImageDraw.Draw(im)
    for i in range(14):
        x0, x1 = sorted((random.randint(0, size[0]), random.randint(0, size[0]))); y0, y1 = sorted((random.randint(0, size[1]), random.randint(0, size[1])))
        dr.rectangle([x0, y0, x1, y1], outline=(255, 255, 255), width=6)
    dr.text((40, 40), name, fill=(255, 255, 255))
    ex = Image.Exif()
    ex[0x010f] = make; ex[0x0110] = model; ex[0x0132] = when
    ifd = ex.get_ifd(0x8769)
    ifd[0x9003] = when; ifd[0x9011] = offset; ifd[0x8827] = 200; ifd[0x829d] = R(28, 10); ifd[0x829a] = R(1, 250); ifd[0x920a] = R(35, 1)
    if gps:
        g = ex.get_ifd(0x8825)
        g[1] = 'N' if gps[0] >= 0 else 'S'; g[2] = deg(gps[0]); g[3] = 'E' if gps[1] >= 0 else 'W'; g[4] = deg(gps[1])
    im.save(os.path.join(D, 'photos', name), 'JPEG', quality=88, exif=ex)

photo('IMG_0001.jpg', '2026:07:14 10:22:00', (40, 90, 160), gps=(54.1234, 7.8912))
photo('IMG_0002.jpg', '2026:07:14 18:05:00', (160, 60, 40), size=(800, 1200))
photo('IMG_0003.jpg', '2026:07:02 09:00:00', (40, 140, 90))
photo('IMG_0004.jpg', '2026:05:20 12:00:00', (120, 40, 140), make='Google', model='Pixel 8')
photo('IMG_0005.jpg', '2025:12:24 19:30:00', (200, 160, 40), size=(1600, 900))
photo('IMG_0006.jpg', '2025:12:24 19:31:00', (90, 90, 90))
shutil.copy(os.path.join(D, 'photos', 'IMG_0003.jpg'), os.path.join(D, 'photos', 'IMG_0003-Kopie.jpg'))  # same content twice
Image.new('RGB', (640, 480), (20, 180, 200)).save(os.path.join(D, 'photos', 'Screenshot.png'))
# a short video (poster frame + duration) and a "HEIC" this browser cannot decode
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', '-c:v', 'libvpx', '-b:v', '300k', os.path.join(D, 'photos', 'VID_0001.webm')], check=True)
with open(os.path.join(D, 'photos', 'IMG_9999.HEIC'), 'wb') as f:
    f.write(b'\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic' + os.urandom(60000))

# folder tree for Drive
open(D + '/tree/Projekt/Notizen.txt', 'w').write('GEHEIM-ONE-4711\nDas ist eine geheime Notiz.\n')
open(D + '/tree/Projekt/Unterordner/tabelle.csv', 'w').write('a;b\n1;2\n')
def tiny_pdf(text):
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', None,
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    stream = f'BT /F1 18 Tf 30 100 Td ({text}) Tj ET'.encode()
    objs[3] = f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream'
    out = io.BytesIO(); out.write(b'%PDF-1.4\n'); offs = []
    for i, o in enumerate(objs):
        offs.append(out.tell()); out.write(f'{i+1} 0 obj\n'.encode()); out.write(o if isinstance(o, bytes) else o.encode()); out.write(b'\nendobj\n')
    x = out.tell(); out.write(f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'.encode())
    for o in offs: out.write(f'{o:010d} 00000 n \n'.encode())
    out.write(f'trailer << /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n'.encode())
    return out.getvalue()
open(D + '/tree/Projekt/Unterordner/Bericht.pdf', 'wb').write(tiny_pdf('Bericht 2026'))
open(D + '/Notizen-v2.txt', 'w').write('GEHEIM-ONE-4711\nZweite Version.\n')
with open(D + '/big.bin', 'wb') as f: f.write(os.urandom(2 * 1024 * 1024 + 12345))

# Google Takeout
tz = zipfile.ZipFile(D + '/takeout/takeout-20260101.zip', 'w', zipfile.ZIP_DEFLATED)
buf = io.BytesIO(); Image.new('RGB', (900, 600), (220, 90, 120)).save(buf, 'JPEG'); jpg = buf.getvalue()
side = {'title': 'IMG_T1.jpg', 'photoTakenTime': {'timestamp': '1556712000'}, 'geoData': {'latitude': 54.3233, 'longitude': 10.1228, 'altitude': 5.0}, 'favorited': True, 'description': 'Kieler Förde'}
tz.writestr('Takeout/Google Fotos/Photos from 2019/IMG_T1.jpg', jpg)
tz.writestr('Takeout/Google Fotos/Photos from 2019/IMG_T1.jpg.supplemental-metadata.json', json.dumps(side))
tz.writestr('Takeout/Google Fotos/Urlaub Ostsee/IMG_T1.jpg', jpg)
tz.writestr('Takeout/Google Fotos/Urlaub Ostsee/IMG_T1.jpg.supplemental-metadata.json', json.dumps(side))
tz.writestr('Takeout/Google Fotos/Urlaub Ostsee/metadata.json', json.dumps({'title': 'Urlaub Ostsee'}))
buf = io.BytesIO(); Image.new('RGB', (600, 900), (60, 200, 120)).save(buf, 'JPEG')
tz.writestr('Takeout/Google Fotos/Photos from 2018/IMG_T2_with_a_very_long_name_that_google_truncates.jpg', buf.getvalue())
tz.writestr('Takeout/Google Fotos/Photos from 2018/IMG_T2_with_a_very_long_name_that_google_trunc.json', json.dumps({'photoTakenTime': {'timestamp': '1530000000'}}))
tz.close()
import datetime
for name, when in [('Screenshot.png', '2026-01-10 08:00'), ('IMG_9999.HEIC', '2025-11-01 12:00'), ('VID_0001.webm', '2026-03-03 15:00')]:
    ts = datetime.datetime.strptime(when, '%Y-%m-%d %H:%M').timestamp()
    os.utime(os.path.join(D, 'photos', name), (ts, ts))
print('data ready', D)

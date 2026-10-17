"""aud1: harder real-world-like fixtures in fixtures/aud1/ (idempotent; skips files that exist)."""
import io, os, random, subprocess, shutil, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import NameObject, NumberObject

HERE = Path(__file__).resolve().parent
D = HERE / 'fixtures' / 'aud1'
D.mkdir(parents=True, exist_ok=True)
random.seed(7)
FONT = None
for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf']:
    if os.path.exists(f):
        FONT = f


def font(sz):
    return ImageFont.truetype(FONT, sz) if FONT else ImageFont.load_default()


def need(name):
    return not (D / name).exists()


def latex(name, body):
    if not need(name):
        return
    with tempfile.TemporaryDirectory() as t:
        Path(t, 'x.tex').write_text(body)
        Path(t, 'anhang.txt').write_text('Anhang: Rechnungsdaten 2026\n')
        for _ in range(2):
            subprocess.run(['pdflatex', '-interaction=nonstopmode', 'x.tex'], cwd=t, capture_output=True)
        shutil.copy(Path(t, 'x.pdf'), D / name)


# 1) links + bookmarks + form fields + attachment + metadata (hyperref / attachfile-free: embedfile via \pdfobj)
latex('rich.pdf', r"""
\documentclass[a4paper]{article}
\usepackage[T1]{fontenc}\usepackage[utf8]{inputenc}
\usepackage[pdftitle={Vertrag Müller},pdfauthor={FaLe Test},pdfsubject={Testvertrag},pdfkeywords={vertrag,test},bookmarks=true,colorlinks=true]{hyperref}
\usepackage{embedfile}
\embedfile{anhang.txt}
\begin{document}
\section{Einleitung}\label{s1} Dies ist ein Vertrag mit Umlauten: Größe, Übergabe, Straße. Siehe \href{https://example.org/agb}{AGB} und Abschnitt~\ref{s3}.
\begin{Form}
\TextField[name=vorname,width=6cm]{Vorname:}\par
\CheckBox[name=agb]{AGB gelesen}
\end{Form}
\newpage\section{Leistungen} Text auf Seite zwei. \subsection{Details} Mehr Text.
\newpage\section{Kündigung}\label{s3} Seite drei. \href{mailto:info@example.org}{Mail}
\end{document}
""")

# 2) layers (OCG)
latex('layers.pdf', r"""
\documentclass[a4paper]{article}
\usepackage{ocgx2}
\begin{document}
Basis-Ebene sichtbar.
\begin{ocg}{Notizen}{n1}{1}Ebene Notizen: sichtbar\end{ocg}
\begin{ocg}{Versteckt}{n2}{0}Ebene Versteckt: unsichtbar\end{ocg}
\end{document}
""")


# 3) mixed page sizes + /Rotate values
def mixed_rot():
    if not need('mixed_rot.pdf'):
        return
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4, A5, letter, A3, landscape
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    sizes = [A4, landscape(A4), A5, letter, A3, (200, 600)]
    for i, s in enumerate(sizes):
        c.setPageSize(s)
        c.setFont('Helvetica', 28)
        c.drawString(40, s[1] - 80, f'Seite {i + 1} TOP')
        c.drawString(40, 40, f'bottom {i + 1}')
        c.showPage()
    c.save()
    r = PdfReader(io.BytesIO(buf.getvalue()))
    w = PdfWriter()
    for i, p in enumerate(r.pages):
        w.add_page(p)
        w.pages[-1][NameObject('/Rotate')] = NumberObject([0, 90, 180, 270, -90, 450][i])
    w.write(D / 'mixed_rot.pdf')


# 4) 300 pages text
def long300():
    if not need('long300.pdf'):
        return
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(str(D / 'long300.pdf'))
    for i in range(300):
        c.setFont('Helvetica', 14)
        c.drawString(72, 770, f'Kapitel {i // 10 + 1} – Seite {i + 1} von 300')
        for k in range(40):
            c.drawString(72, 740 - k * 16, f'Zeile {k + 1}: Lorem ipsum dolor sit amet, Änderung Nummer {i * 40 + k}.')
        c.showPage()
    c.save()


def noisy_photo(w, h, seed, label=''):
    rnd = random.Random(seed)
    img = Image.new('RGB', (w // 8, h // 8))
    px = img.load()
    a, b, c = rnd.random(), rnd.random(), rnd.random()
    for y in range(h // 8):
        for x in range(w // 8):
            px[x, y] = (int(120 + 100 * a * (x / (w / 8))) % 256, int(80 + 150 * b * (y / (h / 8))) % 256, int(60 + 120 * c) % 256)
    img = img.resize((w, h), Image.BILINEAR)
    noise = Image.effect_noise((w, h), 40).convert('RGB')
    img = Image.blend(img, noise, 0.25)
    if label:
        d = ImageDraw.Draw(img)
        d.text((w // 10, h // 10), label, fill=(255, 255, 255), font=font(max(20, w // 12)))
    return img


# 5) 40 phone photos (JPEG, EXIF orientation on some, portrait/landscape)
def photos():
    pd = D / 'photos40'
    pd.mkdir(exist_ok=True)
    if len(list(pd.glob('*.jpg'))) >= 40:
        return
    for i in range(40):
        img = noisy_photo(2016, 1512, i, f'IMG {i + 1:02d}')
        exif = Image.Exif()
        exif[0x0112] = 6 if i % 5 == 0 else 1  # every 5th: portrait via EXIF rotate
        exif[0x010F] = 'Phone'
        img.save(pd / f'IMG_2026{i + 1:04d}.jpg', quality=88, exif=exif.tobytes())


# 6) image-heavy ~80 MB PDF (noisy JPEG pages) – qpdf-joined
def heavy():
    if not need('heavy80.pdf'):
        return
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    c = canvas.Canvas(str(D / 'heavy80.pdf'))
    for i in range(32):
        img = noisy_photo(2480, 3508, 100 + i, f'Scan {i + 1}')
        b = io.BytesIO()
        img.save(b, 'JPEG', quality=82)
        c.setPageSize((595, 842))
        c.drawImage(ImageReader(io.BytesIO(b.getvalue())), 0, 0, 595, 842)
        c.showPage()
    c.save()


# 7) scanned-looking PDF: grey noisy page images, slightly skewed, text as pixels only
def scanned():
    if not need('scanned.pdf'):
        return
    pages = []
    for i in range(4):
        img = Image.new('L', (1240, 1754), 235)
        d = ImageDraw.Draw(img)
        d.text((120, 120), f'Mietvertrag – Seite {i + 1}', fill=20, font=font(48))
        for k in range(40):
            d.text((120, 240 + k * 36), f'§ {k + 1} Der Mieter verpflichtet sich zur Zahlung der Miete.', fill=40, font=font(26))
        if i == 2:
            img = Image.new('L', (1240, 1754), 238)  # nearly blank page (scanner back side)
            ImageDraw.Draw(img).point([(random.randint(0, 1239), random.randint(0, 1753)) for _ in range(300)], fill=120)
        img = img.rotate(0.8, fillcolor=235, resample=Image.BICUBIC)
        img = Image.blend(img, Image.effect_noise(img.size, 30).convert('L'), 0.12).filter(ImageFilter.GaussianBlur(0.6))
        pages.append(img.convert('RGB'))
    pages[0].save(D / 'scanned.pdf', save_all=True, append_images=pages[1:], resolution=150)


# 8) PNG with alpha, tiny 1-page, odd names, broken, password
def misc():
    if need('alpha_logo.png'):
        img = Image.new('RGBA', (800, 600), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((100, 100, 700, 500), fill=(220, 40, 90, 200))
        d.text((250, 260), 'Logo', fill=(255, 255, 255, 255), font=font(80))
        img.save(D / 'alpha_logo.png')
    if need('tiny.pdf'):
        from reportlab.pdfgen import canvas
        c = canvas.Canvas(str(D / 'tiny.pdf'), pagesize=(200, 100))
        c.drawString(10, 50, 'Hallo')
        c.save()
    long = 'Überweisung März 2026 – Kündigung Mietvertrag Müller 📄 ' + 'sehr langer Dateiname ' * 6
    tgt = D / (long.strip() + '.pdf')
    if not tgt.exists():
        shutil.copy(HERE / 'fixtures' / 'text3.pdf', tgt)
    (D / 'longname.txt').write_text(tgt.name)
    if need('Grüße 😀 Ä.pdf'):
        shutil.copy(HERE / 'fixtures' / 'text5.pdf', D / 'Grüße 😀 Ä.pdf')
    if need('rich_pw.pdf'):
        subprocess.run(['qpdf', '--encrypt', '1234', 'owner', '256', '--', str(D / 'rich.pdf'), str(D / 'rich_pw.pdf')], check=True)
    if need('truncated.pdf'):
        b = (D / 'rich.pdf').read_bytes()
        (D / 'truncated.pdf').write_bytes(b[: int(len(b) * 0.7)])
    if need('fake.pdf'):
        (D / 'fake.pdf').write_bytes(b'<html><body>not a pdf</body></html>')
    if need('zero.pdf'):
        (D / 'zero.pdf').write_bytes(b'')
    if need('portrait_exif.jpg'):
        img = noisy_photo(1600, 1200, 999, 'HOCH')
        ex = Image.Exif(); ex[0x0112] = 6
        img.save(D / 'portrait_exif.jpg', quality=85, exif=ex.tobytes())


def photo_a85():
    # 2 photo pages as [/ASCII85Decode /DCTDecode] – how ReportLab and other generators often store JPEGs
    if not need('photo_a85.pdf'):
        return
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    c = canvas.Canvas(str(D / 'photo_a85.pdf'))
    for i in range(2):
        b = io.BytesIO()
        noisy_photo(1240, 1754, 500 + i, f'Foto {i + 1}').save(b, 'JPEG', quality=90)
        c.setPageSize((595, 842))
        c.drawImage(ImageReader(io.BytesIO(b.getvalue())), 0, 0, 595, 842)
        c.setFont('Helvetica', 20)
        c.drawString(40, 40, f'Text auf Seite {i + 1}')
        c.showPage()
    c.save()


def office():
    od = D / 'office'
    od.mkdir(exist_ok=True)
    src = Path('/usr/share/texmf/doc/fonts/lm-math/test-word-latinmodern_math.docx')  # a real Word file full of equations
    if not (od / 'math_real.docx').exists():
        if src.exists():
            shutil.copy(src, od / 'math_real.docx')
        else:  # minimal OMML document
            import zipfile
            body = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><m:oMathPara><m:oMath>'
                    '<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>'
                    '<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>'
                    '</m:oMath></m:oMathPara></w:p></w:body></w:document>')
            with zipfile.ZipFile(od / 'math_real.docx', 'w') as z:
                z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
                z.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
                z.writestr('word/document.xml', body)


def p20():
    if not need('p20.pdf'):
        return
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(str(D / 'p20.pdf'))
    for i in range(20):
        c.setFont('Helvetica', 30); c.drawString(72, 700, f'Seite {i + 1}'); c.showPage()
    c.save()


mixed_rot(); scanned(); misc(); photo_a85(); office(); p20()
if 'small' not in sys.argv:
    long300(); photos(); heavy()

# real office files: LibreOffice round-trip from the existing conv fixtures (already present) + real PDFs
for p in sorted(D.rglob('*')):
    if p.is_file() and p.parent == D:
        print(f'{p.stat().st_size:>10}  {p.name}')

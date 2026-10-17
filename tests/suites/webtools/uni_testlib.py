"""Unicode checks shared by the tests of tools that draw text into PDFs (agent `uni`, lib/unifont.js)."""
import re, subprocess
from pathlib import Path

# the probe words every text-drawing tool must keep as real, extractable text
UNI_WORDS = ['Łukasz', 'Kowalski-Müller', 'Ελληνικά', 'Привет', 'Türkçe', 'İğ', '€']
UNI = 'Łukasz Kowalski-Müller Ελληνικά Привет Türkçe İğ €'
UNI_EXTRA = 'ł Ł ő ű ç ş ğ İ Ж Ω €'


def pdffonts(path, password=None):
    args = ['pdffonts'] + (['-upw', password] if password else []) + [str(path)]
    return subprocess.run(args, capture_output=True, text=True).stdout


def check_unicode_pdf(s, path, words=UNI_WORDS, label='', password=None, need_embedded=True, page=None):
    """qpdf --check, pdftotext has every word exactly, an embedded Unicode (CID TrueType) subset, pdftoppm renders."""
    lab = f'{label}: ' if label else ''
    ok, msg = s.qpdf_check(path, password)
    s.expect(ok, f'{lab}qpdf --check: {msg}')
    args = ['pdftotext'] + (['-upw', password] if password else []) + (['-f', str(page), '-l', str(page)] if page else []) + [str(path), '-']
    txt = subprocess.run(args, capture_output=True, text=True).stdout
    flat = re.sub(r'\s+', ' ', txt)
    missing = [w for w in words if w not in flat]
    s.expect(not missing, f'{lab}pdftotext misses {missing}: {flat[:300]!r}')
    if need_embedded:
        f = pdffonts(path, password)
        s.expect(re.search(r'CID TrueType\s+Identity-H\s+yes\s+yes\s+yes', f) is not None, f'{lab}embedded Unicode subset font: {f}')
    try:
        img = s.render(path, page or 1, 40) if password is None else None
        if img is not None:
            s.expect(img.convert('L').getextrema()[0] < 120, f'{lab}pdftoppm renders the page')
    except Exception as e:  # noqa: BLE001
        s.expect(False, f'{lab}pdftoppm failed: {e}')
    return txt

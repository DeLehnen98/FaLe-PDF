"""App (FaLe PDF) Unicode PDF export under the real CSP + Trusted Types (agent `uni`): docpdf, sheetpdf, handout
write Polish/Greek/Cyrillic/Turkish/€ as real text with an embedded subset. Server: node sec/csp_server.mjs <port>.
  APP_URL=http://127.0.0.1:8772/ python3 uni_app_unicode.py"""
import base64, os, re, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
URL = os.environ.get('APP_URL', 'http://127.0.0.1:8772/')
OUT = Path(__file__).resolve().parent / 'out' / 'uni_app'
OUT.mkdir(parents=True, exist_ok=True)
WORDS = ['Łukasz', 'Kowalski-Müller', 'Ελληνικά', 'Привет', 'Türkçe', 'İğ', '€']
fails = []
def check(name, cond, info=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  [{info}]'))
    if not cond: fails.append(name)

JS = """async (kind) => {
  const T = 'Łukasz Kowalski-Müller Ελληνικά Привет Türkçe İğ €';
  let bytes;
  if (kind === 'doc') {
    const { modelToPdf } = await import('./js/office/docpdf.js');
    bytes = await modelToPdf({ blocks: [{ type: 'para', tag: 'h1', runs: [{ text: 'Łukasz Kowalski-Müller' }] },
      { type: 'para', tag: 'p', runs: [{ text: T }, { text: ' fett Ελληνικά', b: true }, { text: ' serif Привет', serif: true }] }] },
      { title: T, hf: { header: 'Kopf Türkçe İğ', footer: '', pageNumbers: 'footer-right' } });
  } else if (kind === 'sheet') {
    const { workbookToPdf } = await import('./js/office/sheetpdf.js');
    const W = await import('./js/office/workbook.js');
    const wb = W.newWorkbook ? W.newWorkbook() : null;
    if (!wb) return 'no newWorkbook';
    const sh = wb.sheets[0]; sh.name = 'Łódź Привет';
    W.setCell(sh, 0, 0, { v: T }); W.setCell(sh, 1, 0, { v: 'Ελληνικά', s: { b: true } }); sh.colW[0] = 400;
    bytes = await workbookToPdf(wb, { title: 'x' });
  } else {
    const { textToPdf } = await import('./js/office/docpdf.js');
    bytes = await textToPdf('ASCII only: Hallo Welt, Grüße 5 €');
  }
  const u = new Uint8Array(bytes); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context().new_page()
    csp = []
    page.on('console', lambda m: csp.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    page.wait_for_timeout(1500)
    for kind in ('doc', 'sheet', 'ascii'):
        r = page.evaluate(JS, kind)
        if len(r) < 100:
            check(f'{kind}: export', False, r); continue
        f = OUT / f'{kind}.pdf'
        f.write_bytes(base64.b64decode(r))
        q = subprocess.run(['qpdf', '--check', str(f)], capture_output=True, text=True)
        check(f'{kind}: qpdf --check', q.returncode in (0, 3), q.stdout[-200:])
        txt = re.sub(r'\s+', ' ', subprocess.run(['pdftotext', str(f), '-'], capture_output=True, text=True).stdout)
        fonts = subprocess.run(['pdffonts', str(f)], capture_output=True, text=True).stdout
        if kind == 'doc':
            check('doc: all words extractable', all(w in txt for w in WORDS) and 'Kopf Türkçe İğ' in txt and 'serif Привет' in txt, txt[:300])
            check('doc: embedded Unicode subsets', 'CID TrueType' in fonts and 'LiberationSans-Bold' in fonts, fonts)
        elif kind == 'sheet':
            check('sheet: words + sheet name', all(w in txt for w in WORDS) and 'Łódź Привет' in txt, txt[:300])
        else:
            check('ascii: standard fonts only, nothing embedded', 'CID TrueType' not in fonts and 'Grüße 5 €' in txt, fonts)
        subprocess.run(['pdftoppm', '-r', '40', '-f', '1', '-l', '1', '-png', '-singlefile', str(f), str(OUT / kind)], check=True)
    check('no console errors (CSP/Trusted Types)', not csp, csp[:3])
    b.close()
print(f'==== {"ALL PASSED" if not fails else str(len(fails)) + " FAILED"} ====')
sys.exit(1 if fails else 0)

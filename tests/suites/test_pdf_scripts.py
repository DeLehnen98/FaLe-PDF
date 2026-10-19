"""Text in scripts no embedded font has (Chinese, Japanese, Hindi, Arabic …) in generated PDFs.

js/office/unifont.js drawTextImage: such free text is drawn as a picture by the browser instead of "?".
Checks (in the real app page, Chinese UI = locale zh-CN):
- stampPdf watermark with Chinese text: the page gets coloured pixels where the watermark is, the PDF holds an image,
  the text layer has no "?"
- page numbers in the user's language: "第 1 页，共 2 页" (picture) for zh, "Page 1 of 2" (real text) for en,
  "Seite 1 von 2" for de – and dates in the user's format
- Polish/Cyrillic text still uses the embedded Unicode font (real, searchable text – no picture)
- drawTextImage keeps the position: rotated (90°) picture lands where the text would
Run: python3 test_pdf_scripts.py   (server: python3 -m http.server 8798 --bind 127.0.0.1 in the repo; URL via SCRIPTS_URL)
"""
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('SCRIPTS_URL', 'http://127.0.0.1:8798/')
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


PROBE = r"""async ([mode, settings]) => {
  const { stampPdf } = await import('./js/tools/stamp.js');
  const { loadPdfLib } = await import('./js/pdflib.js');
  const { pdfjsLib } = await import('./js/pdfcore.js');
  const PDFLib = await loadPdfLib();
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595, 842]); d.addPage([595, 842]);
  const out = await stampPdf(await d.save(), mode, settings, { name: 'Test' });
  const raw = new TextDecoder('latin1').decode(out);
  const pdf = await pdfjsLib.getDocument({ data: out.slice() }).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  // coloured / dark pixels per band: top 15 %, middle, bottom 15 %
  const band = (y0, y1) => { let n = 0; for (let y = Math.floor(y0 * c.height); y < y1 * c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (px[i] + px[i + 1] + px[i + 2] < 600) n++; } return n; };
  return { text: tc.items.map(i => i.str).join(' '), images: (raw.match(/\/Subtype\s*\/Image/g) || []).length,
    top: band(0, 0.15), mid: band(0.3, 0.7), bottom: band(0.85, 1) };
}"""

ROT = r"""async () => {
  const U = await import('./js/office/unifont.js');
  const { loadPdfLib } = await import('./js/pdflib.js');
  const { pdfjsLib } = await import('./js/pdfcore.js');
  const PDFLib = await loadPdfLib();
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([400, 400]);
  // rotated 90° at (200, 100): the text runs upwards from there, so ink must be right of/above x≈200, y≥100 (PDF coords)
  const drew = await U.drawTextImage(p, d, '你好世界', { x: 200, y: 100, size: 24, color: PDFLib.rgb(0, 0, 0), rotate: PDFLib.degrees(90) });
  const latin = await U.drawTextImage(p, d, 'Łódź Иван', { x: 10, y: 10, size: 12 });
  const out = await d.save();
  const pdf = await pdfjsLib.getDocument({ data: out }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const px = ctx.getImageData(0, 0, 400, 400).data;
  let minX = 400, maxX = 0, minY = 400, maxY = 0;
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) { const i = (y * 400 + x) * 4; if (px[i] < 128) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
  return { drew, latin, minX, maxX, minY: 400 - maxY, maxY: 400 - minY };
}"""


def ctx_for(b, locale):
    c = b.new_context(locale=locale, viewport={'width': 1200, 'height': 900})
    c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=20000)
    pg.wait_for_timeout(600)
    return c, pg, errs


with sync_playwright() as p:
    b = p.chromium.launch()
    # ---- Chinese UI
    c, pg, errs = ctx_for(b, 'zh-CN')
    check('zh: UI language is Chinese', pg.evaluate('document.documentElement.lang') == 'zh', pg.evaluate('document.documentElement.lang'))
    r = pg.evaluate(PROBE, ['watermark', {'text': '机密文件', 'size': 64, 'color': '#E03131', 'opacity': 60, 'rotation': 45, 'position': 'm-c'}])
    check('zh watermark: drawn as a picture (image in the PDF)', r['images'] >= 1, r)
    check('zh watermark: visible in the middle of the page', r['mid'] > 2000, r)
    check('zh watermark: no "?" in the text layer', '?' not in r['text'], r['text'])
    r = pg.evaluate(PROBE, ['numbers', {'format': 'sv', 'position': 'b-c', 'size': 11}])
    check('zh page numbers: picture at the bottom', r['images'] >= 1 and r['bottom'] > 60, r)
    check('zh page numbers: no German "Seite" and no "?"', 'Seite' not in r['text'] and '?' not in r['text'], r['text'])
    r = pg.evaluate(PROBE, ['header', {'hl': '{datum}', 'fr': '{seite}'}])
    check('zh header date: Chinese date format (2026/10/19), real text', r['images'] == 0 and '/' in r['text'] and '.' not in r['text'], r)
    rr = pg.evaluate(ROT)
    check('drawTextImage: Chinese drawn, Polish/Cyrillic left to the Unicode font', rr['drew'] is True and rr['latin'] is False, rr)
    check('drawTextImage: rotated picture starts at the text origin (x≈200, y≥100, runs upwards)',
          170 <= rr['minX'] <= 205 and rr['maxX'] <= 240 and 95 <= rr['minY'] <= 112 and rr['maxY'] > 160, rr)
    check('zh: no page errors', not errs, errs[:3])
    c.close()
    # ---- English UI: real text "Page 1 of 2"
    c, pg, errs = ctx_for(b, 'en-GB')
    r = pg.evaluate(PROBE, ['numbers', {'format': 'sv', 'position': 'b-c', 'size': 11}])
    check('en page numbers: "Page 1 of 2" as real text', 'Page 1 of 2' in r['text'] and r['images'] == 0, r)
    r = pg.evaluate(PROBE, ['watermark', {'text': 'Łódź – Иван', 'size': 40, 'opacity': 60}])
    check('en: Polish/Cyrillic watermark stays real text (no picture)', r['images'] == 0 and 'Łódź' in r['text'] and 'Иван' in r['text'], r)
    check('en: no page errors', not errs, errs[:3])
    c.close()
    # ---- German UI: unchanged
    c, pg, errs = ctx_for(b, 'de-DE')
    r = pg.evaluate(PROBE, ['numbers', {'format': 'sv', 'position': 'b-c', 'size': 11}])
    check('de page numbers: "Seite 1 von 2" as real text', 'Seite 1 von 2' in r['text'] and r['images'] == 0, r)
    r = pg.evaluate(PROBE, ['header', {'hl': '{datum}'}])
    import re
    check('de header date: dd.mm.yyyy', re.search(r'\d\d\.\d\d\.\d{4}', r['text']), r['text'])
    check('de: no page errors', not errs, errs[:3])
    c.close()
    b.close()

bad = [r for r in results if not r[1]]
print(f'\n{len(results) - len(bad)}/{len(results)} passed')
for r in bad:
    print('  FAIL', r[0], str(r[2])[:400])
sys.exit(1 if bad else 0)

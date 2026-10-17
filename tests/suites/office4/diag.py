"""Export a template as DOCX + PDF from the running app; print basic checks.  python3 diag.py <tid>"""
import sys, json, base64, os, subprocess
from playwright.sync_api import sync_playwright
tid = sys.argv[1] if len(sys.argv) > 1 else 'hausarbeit'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'); os.makedirs(OUT, exist_ok=True)
JS = """async () => { const api = document.querySelector('.writer')._writerApi;
  const b = await api.serialize('docx'); const u8 = new Uint8Array(await b.arrayBuffer());
  const { modelToPdf } = await import('./js/office/docpdf.js');
  const pdf = await modelToPdf(api.model(), { title: 'T', page: api.page(), hf: api.hf() });
  const enc = a => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  return [enc(u8), enc(new Uint8Array(pdf))]; }"""
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}, service_workers='block', locale='de-DE')
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.goto('http://127.0.0.1:8880/'); pg.wait_for_timeout(600)
    pg.evaluate(f"location.hash = '#/neu/dokument?vorlage={tid}'"); pg.wait_for_selector('.doc-page'); pg.wait_for_timeout(1200)
    d, f = pg.evaluate(JS)
    open(f'{OUT}/{tid}.docx', 'wb').write(base64.b64decode(d)); open(f'{OUT}/{tid}.pdf', 'wb').write(base64.b64decode(f))
    print('\n'.join(errs) or 'no console errors')
    b.close()
print(subprocess.run(['pdfinfo', f'{OUT}/{tid}.pdf'], capture_output=True, text=True).stdout.split('Pages:')[1].split('\n')[0].strip(), 'pages (own PDF)')
subprocess.run(['soffice', '--headless', f'-env:UserInstallation=file://{OUT}/lo', '--convert-to', 'pdf', '--outdir', f'{OUT}/lo_out', f'{OUT}/{tid}.docx'], capture_output=True, timeout=120)
print(subprocess.run(['pdfinfo', f'{OUT}/lo_out/{tid}.pdf'], capture_output=True, text=True).stdout.split('Pages:')[1].split('\n')[0].strip(), 'pages (LibreOffice)')

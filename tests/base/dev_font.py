import os, base64
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__))
b64 = base64.b64encode(open(os.path.join(SP, 'testdata/struktur.pdf'), 'rb').read()).decode()
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page()
    page.goto('http://127.0.0.1:8792/')
    page.wait_for_selector('#view-start .hero')
    r = page.evaluate("""async (b64) => {
      const m = await import('./js/pdfcore.js');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const { pdf } = await m.loadPdf(bytes, {});
      const page = await pdf.getPage(1);
      await page.getOperatorList();
      const tc = await page.getTextContent();
      const out = [];
      const seen = new Set();
      for (const it of tc.items) {
        if (seen.has(it.fontName)) continue; seen.add(it.fontName);
        let f = null; try { f = page.commonObjs.has(it.fontName) ? page.commonObjs.get(it.fontName) : null; } catch (e) { f = 'ERR ' + e.message; }
        out.push({ id: it.fontName, style: tc.styles[it.fontName], name: f && f.name, bold: f && f.bold, italic: f && f.italic, black: f && f.black, keys: f && typeof f === 'object' ? Object.keys(f).slice(0, 30) : null, proto: f && typeof f === 'object' ? Object.getOwnPropertyNames(Object.getPrototypeOf(f)).slice(0, 40) : null });
      }
      return out;
    }""", b64)
    import json; print(json.dumps(r, indent=1)[:3000])
    b.close()

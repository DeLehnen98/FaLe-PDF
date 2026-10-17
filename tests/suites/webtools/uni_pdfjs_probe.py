"""pdf.js (the previews' renderer) reads the embedded Unicode subsets: text content + ink (agent `uni`)."""
import base64, os, sys
from playwright.sync_api import sync_playwright
from wtlib import ORIGIN, FIX
f = FIX / 'uni_v2.pdf'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.goto(ORIGIN + '/werkzeuge/')
    r = pg.evaluate("""async (b64) => {
      const { openPdfjs, renderPage } = await import('/assets/wt/lib/pdf.js');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const doc = await openPdfjs(bytes);
      const page = await doc.getPage(1);
      const tc = await page.getTextContent();
      const c = await renderPage(page, { scale: 1 });
      const d = c.getContext('2d').getImageData(0, 0, c.width, Math.round(c.height * 0.15)).data;
      let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) ink++;
      return { text: tc.items.map(i => i.str).join(' '), ink };
    }""", base64.b64encode(f.read_bytes()).decode())
    b.close()
ok = 'Привет Türkçe İğ' in r['text'] and 'Łukasz' in r['text'] and r['ink'] > 500
print(('PASS' if ok else 'FAIL'), r)
sys.exit(0 if ok else 1)

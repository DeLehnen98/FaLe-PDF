import sys, base64
from wtlib import Suite, FIX
with Suite('conv-items') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/pdf-in-text/')
    b64 = base64.b64encode((FIX / sys.argv[1]).read_bytes()).decode()
    res = page.evaluate("""async ([b64, pn, n]) => {
      const m = await import('/assets/wt/lib/pdf.js');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const doc = await m.openPdfjs(bytes);
      const page = await doc.getPage(pn);
      const tc = await page.getTextContent();
      return tc.items.slice(0, n).map(it => [it.str, it.transform.map(v => Math.round(v*10)/10), Math.round(it.width*10)/10, it.hasEOL]);
    }""", [b64, int(sys.argv[2]), int(sys.argv[3])])
    for r in res: print(r)

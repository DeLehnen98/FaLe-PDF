import sys, base64, json
from wtlib import Suite, FIX
with Suite('conv-chunks') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/pdf-in-text/')
    b64 = base64.b64encode((FIX / sys.argv[1]).read_bytes()).decode()
    res = page.evaluate("""async ([b64, pn]) => {
      const m = await import('/assets/wt/lib/pdf.js');
      const pm = await import('/assets/wt/lib/conv-pdfmodel.js');
      const tb = await import('/assets/wt/lib/conv-tables.js');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const doc = await m.openPdfjs(bytes);
      const ctx = { tick: async () => {} };
      const [p] = await pm.analysePdf(doc, [pn - 1], ctx);
      const out = { regions: p.regions.length, columns: p.columns };
      const lines = p.regions[0].lines;
      const al = tb.alignedEdges(lines);
      out.starts = [...al.starts]; out.ends = [...al.ends];
      out.chunks = lines.slice(0, 4).map(l => tb.lineChunks(l, al).map(c => [c.str, Math.round(c.x), Math.round(c.w)]));
      out.items = lines.slice(0, 2).map(l => l.items.map(i => [i.str, Math.round(i.x), Math.round(i.w)]));
      out.tables = tb.detectTables(lines).map(t => t.rows.slice(0, 3));
      const cl = lines.map(l => tb.lineChunks(l, al)).filter(c => c.length >= 2);
      out.seps = tb.columnSeparators(cl, 2);
      const sc = new Map(); for (const ch of cl) for (const c of ch.slice(1)) { const x = Math.round(c.x); sc.set(x, (sc.get(x) || 0) + 1); } out.sc = [...sc]; out.n = cl.length; out.src = (await (await fetch('/assets/wt/lib/conv-tables.js')).text()).includes('startCount');
      return out;
    }""", [b64, int(sys.argv[2])])
    print(json.dumps(res, ensure_ascii=False, indent=0)[:3000])

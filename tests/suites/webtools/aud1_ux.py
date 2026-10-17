"""aud1 UX scan: every tool at 320/360 px phone, landscape, 200 % text, dark mode – overflow, tap targets,
contrast, sticky bar overlap. usage: python3 aud1_ux.py [tool ...]"""
import os, sys
os.environ.setdefault('WT_PORT', '8780')
from wtlib import Suite

A = 'aud1/'
TOOLS = {
    'merge-pdf': ('/werkzeuge/pdf-zusammenfuegen/', ['text3.pdf', A + 'Grüße 😀 Ä.pdf']),
    'compress-pdf': ('/werkzeuge/pdf-komprimieren/', [A + 'rich.pdf']),
    'jpg-to-pdf': ('/werkzeuge/bild-in-pdf/', [A + 'portrait_exif.jpg', A + 'alpha_logo.png']),
    'split-pdf': ('/werkzeuge/pdf-teilen/', ['text5.pdf']),
    'delete-pages': ('/werkzeuge/pdf-seiten-loeschen/', ['text5.pdf']),
    'extract-pages': ('/werkzeuge/pdf-seiten-extrahieren/', ['text5.pdf']),
    'organize-pdf': ('/werkzeuge/pdf-seiten-sortieren/', ['text5.pdf']),
    'rotate-pdf': ('/werkzeuge/pdf-drehen/', ['text5.pdf']),
    'remove-blank-pages': ('/werkzeuge/leere-seiten-entfernen/', [A + 'scanned.pdf']),
    'alternate-mix': ('/werkzeuge/pdf-seiten-mischen/', ['text3.pdf', 'text5.pdf']),
    'split-halves': ('/werkzeuge/doppelseiten-teilen/', [A + 'mixed_rot.pdf']),
    'repair-pdf': ('/werkzeuge/pdf-reparieren/', [A + 'rich.pdf']),
    'grayscale-pdf': ('/werkzeuge/pdf-graustufen/', [A + 'rich.pdf']),
    'pdf-to-jpg': ('/werkzeuge/pdf-in-jpg/', ['text3.pdf']),
    'pdf-to-png': ('/werkzeuge/pdf-in-png/', ['text3.pdf']),
    'extract-images': ('/werkzeuge/bilder-aus-pdf-extrahieren/', [A + 'scanned.pdf']),
    'pdf-to-text': ('/werkzeuge/pdf-in-text/', [A + 'rich.pdf']),
    'pdf-to-markdown': ('/werkzeuge/pdf-in-markdown/', [A + 'rich.pdf']),
    'pdf-to-word': ('/werkzeuge/pdf-in-word/', [A + 'rich.pdf']),
    'pdf-to-excel': ('/werkzeuge/pdf-in-excel/', ['conv_tables.pdf']),
    'pdf-to-pptx': ('/werkzeuge/pdf-in-powerpoint/', ['text3.pdf']),
    'word-to-pdf': ('/werkzeuge/word-in-pdf/', ['conv_doc.docx']),
    'excel-to-pdf': ('/werkzeuge/excel-in-pdf/', ['conv_sheet.xlsx']),
    'pptx-to-pdf': ('/werkzeuge/powerpoint-in-pdf/', ['conv_slides.pptx']),
    'text-to-pdf': ('/werkzeuge/text-in-pdf/', ['conv_text.txt']),
}
SCAN = r"""(min) => {
  const out = [];
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const nm = e => (e.getAttribute('aria-label') || e.textContent || e.className || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
  const sw = document.documentElement.scrollWidth, iw = innerWidth;
  if (sw > iw + 1) {
    const wide = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.getBoundingClientRect().right > iw + 1 && !e.closest('.pg-grid, [data-scroll-x]')).slice(0, 3).map(e => e.tagName + '.' + e.className);
    out.push(`hscroll ${sw}>${iw}: ${wide.join(' | ')}`);
  }
  const targets = [...document.querySelectorAll('#wt-app button, #wt-app [role=button], #wt-app a[href], #wt-app input[type=checkbox], #wt-app input[type=radio], #wt-app select, #wt-app summary, #wt-app label.wt-chipbtn')]
    .filter(vis).filter(e => !(e.type === 'radio' && e.closest('.wt-radio')) && !(e.closest('.wt-switch') && e.tagName === 'INPUT'));
  for (const b of targets) { const r = b.getBoundingClientRect(); if (r.height < min - 0.5 || r.width < min - 0.5) out.push(`small ${Math.round(r.width)}x${Math.round(r.height)} ${nm(b)}`); }
  // contrast of visible text in the tool area
  const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(v => { v = +v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return { L: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m[3] == null ? 1 : +m[3] }; };
  const bgOf = e => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const l = lum(c); if (l && l.a > 0.5) return l.L; } return lum(getComputedStyle(document.body).backgroundColor)?.L ?? 1; };
  const seen = new Set();
  for (const e of document.querySelectorAll('#wt-app *')) {
    if (!vis(e) || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const st = getComputedStyle(e); if (+st.opacity < 0.6 || e.closest('[disabled]')) continue;
    const f = lum(st.color); if (!f) continue;
    const b = bgOf(e); const cr = (Math.max(f.L, b) + 0.05) / (Math.min(f.L, b) + 0.05);
    const big = parseFloat(st.fontSize) >= 24 || (parseFloat(st.fontSize) >= 18.6 && +st.fontWeight >= 700);
    if (cr < (big ? 3 : 4.5)) { const k = e.className + st.color; if (!seen.has(k)) { seen.add(k); out.push(`contrast ${cr.toFixed(2)} ${e.tagName}.${e.className} "${e.textContent.trim().slice(0, 30)}"`); } }
  }
  // sticky bar covering a focused control
  const bar = document.querySelector('.wt-bar:not([hidden])');
  if (bar && document.activeElement && document.activeElement !== document.body && !bar.contains(document.activeElement)) {
    const r = document.activeElement.getBoundingClientRect(), br = bar.getBoundingClientRect();
    if (r.bottom > br.top + 2 && r.top < br.bottom) out.push('focused element under sticky bar: ' + nm(document.activeElement));
  }
  return out;
}"""

sel = sys.argv[1:]
VIEWS = [('p320', dict(viewport={'width': 320, 'height': 640}), False, False),
         ('p360', dict(viewport={'width': 360, 'height': 740}), False, False),
         ('land', dict(viewport={'width': 844, 'height': 390}), False, False),
         ('dark360', dict(viewport={'width': 360, 'height': 740}), True, False),
         ('zoom200', dict(viewport={'width': 390, 'height': 844}), False, True)]
VIEWS = [v for v in VIEWS if not os.environ.get('VIEWS') or v[0] in os.environ['VIEWS'].split(',')]
with Suite('aud1-ux') as s:
    report = {}
    for vname, vp, dark, zoom in VIEWS:
        ctx = s.context('phone', 'de', dark=dark, **vp)
        for tool, (path, files) in TOOLS.items():
            if sel and tool not in sel:
                continue
            page = s.open(ctx, path)
            if zoom:
                page.add_style_tag(content='html{font-size:200% !important}') if False else page.evaluate("() => { document.documentElement.style.fontSize = '200%'; }")
            probs = [f'pick: {p}' for p in page.evaluate(SCAN, 44)]
            s.pick(page, *files)
            try:
                s.wait_ready(page, len(files), timeout=30000)
            except Exception:
                probs.append('not ready')
            page.wait_for_timeout(600)
            probs += [f'files: {p}' for p in page.evaluate(SCAN, 44)]
            # focus each text/number input: must not sit under the sticky bar (keyboard case: short viewport)
            for i in range(page.locator('#wt-app input[type=text], #wt-app input[type=number], #wt-app input:not([type])').count()):
                inp = page.locator('#wt-app input[type=text], #wt-app input[type=number], #wt-app input:not([type])').nth(i)
                if inp.is_visible():
                    page.set_viewport_size({'width': vp['viewport']['width'], 'height': 330})
                    inp.focus(); page.wait_for_timeout(250)
                    probs += [f'keyboard: {p}' for p in page.evaluate(SCAN, 44) if 'sticky' in p]
                    page.set_viewport_size(vp['viewport'])
            btn = s.primary(page)
            if btn.is_enabled():
                btn.click()
                try:
                    page.wait_for_function("() => !document.querySelector('.wt-result').hidden || !document.querySelector('.wt-error').hidden || !document.querySelector('.wt-bar-hint').hidden", timeout=60000)
                    page.wait_for_timeout(500)
                    probs += [f'result: {p}' for p in page.evaluate(SCAN, 44)]
                except Exception:
                    probs.append('no result')
            s.check_page(page)
            if probs:
                print(f'[{vname}] {tool}:'); [print('   ', p) for p in probs[:14]]
            page.close()

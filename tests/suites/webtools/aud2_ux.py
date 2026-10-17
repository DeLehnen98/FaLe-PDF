"""aud2 UX scan: every tool at 320/360 px phone, landscape, 200 % text, dark mode – overflow, tap targets,
contrast, sticky bar overlap. usage: python3 aud1_ux.py [tool ...]"""
import os, sys
os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite

A = 'aud1/'
TOOLS = {
 'edit-pdf-text': ('/werkzeuge/pdf-bearbeiten/', ['edit_letter.pdf']),
 'add-page-numbers': ('/werkzeuge/seitenzahlen-einfuegen/', ['edit_rot.pdf']),
 'watermark-pdf': ('/werkzeuge/wasserzeichen-einfuegen/', ['edit_mixed.pdf']),
 'header-footer': ('/werkzeuge/kopf-und-fusszeile/', ['edit_p6.pdf']),
 'crop-pdf': ('/werkzeuge/pdf-zuschneiden/', ['edit_margins.pdf']),
 'resize-pdf': ('/werkzeuge/seitengroesse-aendern/', ['edit_mixed.pdf']),
 'n-up': ('/werkzeuge/mehrere-seiten-pro-blatt/', ['edit_p6.pdf']),
 'booklet': ('/werkzeuge/broschuere-drucken/', ['edit_p10.pdf']),
 'overlay-pdf': ('/werkzeuge/briefpapier-pdf/', ['edit_letter.pdf']),
 'sign-pdf': ('/werkzeuge/pdf-unterschreiben/', ['sec_form.pdf']),
 'fill-pdf-form': ('/werkzeuge/pdf-formular-ausfuellen/', ['sec_form.pdf']),
 'redact-pdf': ('/werkzeuge/pdf-schwaerzen/', ['sec_private.pdf']),
 'protect-pdf': ('/werkzeuge/pdf-mit-passwort-schuetzen/', ['text3.pdf']),
 'unlock-pdf': ('/werkzeuge/pdf-passwort-entfernen/', ['restricted.pdf']),
 'flatten-pdf': ('/werkzeuge/pdf-glaetten/', ['sec_form.pdf']),
 'edit-metadata': ('/werkzeuge/pdf-metadaten/', ['sec_private.pdf']),
 'compare-pdf': ('/werkzeuge/pdf-vergleichen/', ['sec_v1.pdf','sec_v2.pdf']),
 'compress-image': ('/werkzeuge/bild-komprimieren/', ['img/portrait.jpg']),
 'resize-image': ('/werkzeuge/bildgroesse-aendern/', ['img/portrait.jpg']),
 'convert-image': ('/werkzeuge/bild-umwandeln/', ['img/logo.png']),
 'png-to-jpg': ('/werkzeuge/png-in-jpg/', ['img/logo.png']),
 'jpg-to-png': ('/werkzeuge/jpg-in-png/', ['img/portrait.jpg']),
 'webp-to-jpg': ('/werkzeuge/webp-in-jpg/', ['photo.webp']),
 'heic-to-jpg': ('/werkzeuge/heic-in-jpg/', ['iphone.heic']),
 'remove-exif': ('/werkzeuge/exif-entfernen/', ['img/gps_photo.jpg']),
 'scan-to-pdf': ('/werkzeuge/dokument-scannen/', ['img/doc_photo.jpg']),
 'passport-photo': ('/werkzeuge/passfoto/', ['img/portrait.jpg']),
 'qr-code': ('/werkzeuge/qr-code-erstellen/', []),
 'cancellation-letter': ('/werkzeuge/kuendigung-schreiben/', []),
 'ocr-pdf': ('/werkzeuge/pdf-texterkennung/', ['new_scan_1p.pdf']),
 'image-to-text': ('/werkzeuge/bild-in-text/', ['new_note.jpg']),
 'invoice-generator': ('/werkzeuge/rechnung-schreiben/', []),
 'signature-maker': ('/werkzeuge/unterschrift-erstellen/', []),
 'crop-image': ('/werkzeuge/bild-zuschneiden/', ['img/portrait.jpg']),
 'rotate-image': ('/werkzeuge/bild-drehen/', ['img/portrait.jpg']),
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
  for (const b of targets) { const r = b.getBoundingClientRect(); if ((r.height < min - 0.5 || r.width < min - 0.5) && !(b.closest('.wt-file-actions') && r.width >= 40) && !(b.tagName === 'INPUT' && b.closest('label'))) out.push(`small ${Math.round(r.width)}x${Math.round(r.height)} ${nm(b)}`); }
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
with Suite('aud2-ux') as s:
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
            if files: s.pick(page, *files)
            try:
              if files:
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

import os; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite
with Suite('aud2-bar') as s:
    for w in (320, 390):
        ctx = s.context('phone', 'de', viewport={'width': w, 'height': 330})
        for path, f in (('/werkzeuge/kuendigung-schreiben/', None), ('/werkzeuge/pdf-metadaten/', 'sec_private.pdf'), ('/werkzeuge/rechnung-schreiben/', None)):
            page = s.open(ctx, path)
            if f: s.pick(page, f); s.wait_ready(page, 1)
            page.wait_for_timeout(800)
            r = page.evaluate("""() => { const b = document.querySelector('.wt-bar'); const out = [Math.round(b.getBoundingClientRect().height), getComputedStyle(document.documentElement).scrollPaddingBottom];
              const bad = [];
              for (const i of [...document.querySelectorAll('#wt-app input.wt-input, #wt-app textarea')].filter(e => e.offsetParent).slice(0, 12)) {
                i.focus(); const r = i.getBoundingClientRect(), br = b.getBoundingClientRect(); if (r.bottom > br.top + 2) bad.push((i.id||i.name) + ' ' + Math.round(r.bottom - br.top)); }
              return [out, bad]; }""")
            print(w, path, r)
            page.close()

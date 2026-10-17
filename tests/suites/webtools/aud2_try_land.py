import os; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite
with Suite('aud2-land') as s:
    ctx = s.context('phone', 'de', viewport={'width': 844, 'height': 390})
    page = s.open(ctx, '/werkzeuge/pdf-unterschreiben/')
    s.pick(page, 'text3.pdf'); s.wait_ready(page, 1); page.wait_for_selector('.sec-page canvas')
    page.locator('.sec-chip', has_text='Unterschrift').first.click(); page.wait_for_selector('dialog.sec-dlg[open]'); page.wait_for_timeout(400)
    page.screenshot(path='out/aud2_land_sign.png')
    r = page.evaluate("""() => { const d = document.querySelector('dialog.sec-dlg[open]'); const r = d.getBoundingClientRect();
      const btns = [...d.querySelectorAll('button')].filter(b => b.offsetParent).map(b => { const q = b.getBoundingClientRect(); return [b.textContent.trim().slice(0,20), Math.round(q.top), Math.round(q.bottom)]; });
      const pad = d.querySelector('.sec-pad')?.getBoundingClientRect(); return { dlg: [Math.round(r.top), Math.round(r.bottom), d.scrollHeight, d.clientHeight], pad: pad && [Math.round(pad.width), Math.round(pad.height)], btns, vh: innerHeight }; }""")
    print(r)
    page.close()
    page = s.open(ctx, '/werkzeuge/unterschrift-erstellen/')
    page.locator('.new-tools button', has_text='Zeichnen').click(); page.wait_for_selector('dialog.sec-dlg[open]'); page.wait_for_timeout(400)
    page.screenshot(path='out/aud2_land_sigmaker.png')

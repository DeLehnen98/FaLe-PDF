import os, time, subprocess; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite
import sys
f = sys.argv[1]
with Suite('aud2-ocr') as s:
    ctx = s.context('phone', 'de')
    ctx.add_init_script("window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });")
    page = s.open(ctx, '/werkzeuge/pdf-texterkennung/')
    s.pick(page, f); s.wait_ready(page, 1)
    page.evaluate("() => window.__lt = []")
    t0 = time.time(); s.primary(page).click()
    seen = []
    while time.time() - t0 < 600:
        if page.locator('.wt-result:not([hidden]), .wt-error:not([hidden]), .wt-bar-hint:not([hidden])').count(): break
        t = page.locator('.wt-prog-text').inner_text(); v = page.locator('.wt-prog-bar').evaluate('e => e.value')
        if not seen or seen[-1][1:] != (t, round(v or 0, 2)): seen.append((round(time.time() - t0, 1), t, round(v or 0, 2)))
        page.wait_for_timeout(250)
    print('total', round(time.time() - t0, 1), 's')
    for x in seen[:40]: print(x)
    print('longtasks>200', [x for x in page.evaluate('() => window.__lt') if x > 200][:20])
    print(page.locator('#wt-app').inner_text()[-900:])

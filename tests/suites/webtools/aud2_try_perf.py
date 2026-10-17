import os, sys, time, zipfile, io; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite, FIX, OUT
from PIL import Image
LT = """window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });"""
path = sys.argv[1]; files = sys.argv[2:]
with Suite('aud2-perf') as s:
    ctx = s.context('phone', 'de'); ctx.add_init_script(LT)
    page = s.open(ctx, path)
    cdp = page.context.new_cdp_session(page); cdp.send('Performance.enable')
    heap = lambda: round(page.evaluate("() => performance.memory.usedJSHeapSize") / 1e6)
    h0 = heap(); t0 = time.time()
    s.pick(page, *files); s.wait_ready(page, len(files), timeout=120000)
    t1 = time.time(); page.evaluate("() => window.__lt = []")
    print('ready', round(t1 - t0, 1), 's heap', heap())
    ok = s.run(page, timeout=600000); t2 = time.time()
    lts = page.evaluate("() => window.__lt")
    print('run', round(t2 - t1, 1), 's; longtasks >200ms:', [x for x in lts if x > 200][:20], 'count', len(lts), 'heap', heap())
    rows = page.locator('.wt-output').all_inner_texts()
    print(len(rows), rows[:3])
    if ok:
        o = s.download(page, 0)
        if o.suffix != '.jpg': print(o.name, o.stat().st_size); raise SystemExit
        im = Image.open(o); ex = im.getexif()
        print(o.name, o.stat().st_size, im.size, 'orient', ex.get(274), 'gps', bool(ex.get_ifd(0x8825)), 'make', ex.get(0x010F))
    # re-run repeatedly to check heap growth
    for i in range(2):
        page.locator('.wt-restart button').first.click(); page.wait_for_timeout(300)
        s.run(page, timeout=600000)
    page.evaluate("() => gc && gc()") if False else None
    print('heap after 3 runs', heap())

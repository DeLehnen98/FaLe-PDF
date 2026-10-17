import sys, time
from playwright.sync_api import sync_playwright
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    msgs = []
    pg.on('console', lambda m: msgs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: msgs.append('ERR ' + str(e)))
    pg.goto(url)
    for i in range(20):
        n = pg.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
        if n: break
        time.sleep(0.5)
    print('regs', n, pg.evaluate("navigator.serviceWorker.controller ? 'ctl' : 'noctl'"))
    print(pg.evaluate("navigator.serviceWorker.register('sw.js').then(r => 'ok '+r.scope, e => 'ERR '+e.message)"))
    print('\n'.join(msgs[:20]))
    b.close()

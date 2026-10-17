from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width':390,'height':844}); pg = ctx.new_page(); msgs=[]
    pg.on('console', lambda m: msgs.append(m.type+': '+m.text[:200])); pg.on('pageerror', lambda e: msgs.append('ERR '+str(e)[:200]))
    pg.on('requestfailed', lambda r: msgs.append('REQFAIL '+r.url))
    pg.goto('http://127.0.0.1:9415/#/teilen'); pg.wait_for_selector('html.ready'); pg.wait_for_timeout(500)
    pg.wait_for_selector('.sh-hub')
    print("ctl", pg.evaluate("[!!navigator.serviceWorker.controller, navigator.serviceWorker.getRegistration().then(r=>r&&r.active&&r.active.state)]"), pg.evaluate("navigator.serviceWorker.getRegistration().then(r=>r && r.active && r.active.state)"))
    ctx.set_offline(True); pg.evaluate("window.dispatchEvent(new Event('offline'))"); pg.wait_for_timeout(400)
    pg.evaluate("location.hash='#/teilen/link'"); pg.wait_for_timeout(900)
    pg.evaluate("location.hash='#/verbinden'"); pg.wait_for_timeout(2000)
    print(pg.evaluate("[location.hash, document.querySelectorAll('[data-host]').length, (document.querySelector('#tool-screen')||{}).innerText?.slice(0,300)]"))
    print('\n'.join(msgs[-15:])); b.close()

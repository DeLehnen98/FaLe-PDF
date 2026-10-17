from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:8941/'); pg.wait_for_timeout(3000)
    print(pg.eval_on_selector_all('a[href*="datenschutz"], a[href*="impressum"]', 'els => els.map(e => e.href)'))
    print(pg.evaluate("async () => { const m = await import('./js/views/notfall.js'); const s = await import('./js/views/settings.js'); return Object.keys(m).length + Object.keys(s).length; }"))
    print('errors:', errs[:5]); b.close()

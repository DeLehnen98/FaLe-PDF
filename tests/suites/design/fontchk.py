from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    msgs=[]; pg.on('console', lambda m: msgs.append(m.text))
    pg.on('requestfailed', lambda r: msgs.append('FAILED '+r.url))
    pg.goto('http://127.0.0.1:9101/'); pg.wait_for_timeout(1500)
    print(pg.evaluate("[...document.fonts].map(f => f.family+' '+f.status)"))
    print(pg.evaluate("document.fonts.check('700 20px \"Bricolage Grotesque\"')"))
    print(pg.evaluate("getComputedStyle(document.querySelector('.hero h1')).fontFamily"))
    print(msgs[:5]); b.close()

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    msgs=[]
    pg.on('console', lambda m: msgs.append(f'[{m.type}] {m.text[:300]}'))
    pg.on('pageerror', lambda e: msgs.append(f'[pageerror] {e}'))
    pg.goto('http://127.0.0.1:9404/'); pg.wait_for_timeout(2500)
    print(pg.evaluate("document.querySelector('#view-start') && document.querySelector('#view-start').innerHTML.length"))
    for m in msgs[:20]: print(m)
    b.close()

from playwright.sync_api import sync_playwright
import sys
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); m=[]
    pg.on('console', lambda x: m.append(x.type+': '+x.text)); pg.on('pageerror', lambda e: m.append('PAGEERR '+str(e)))
    pg.goto(sys.argv[1]); pg.wait_for_timeout(3000)
    print(pg.evaluate("document.querySelector('#view-start').innerHTML.length"), pg.evaluate("location.hash"))
    print('\n'.join(m[:20])); b.close()

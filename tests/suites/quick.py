import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':390,'height':844}, locale='en-US')
    pg = ctx.new_page()
    errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
    pg.goto('http://127.0.0.1:8798/#/' + (sys.argv[1] if len(sys.argv)>1 else 'start'))
    pg.wait_for_timeout(1500)
    print(pg.evaluate('document.documentElement.lang'))
    print(pg.evaluate('document.body.innerText')[:1500])
    pg.screenshot(path='/home/claude/FalePDF/tests/suites/quick.png')
    print(errs)

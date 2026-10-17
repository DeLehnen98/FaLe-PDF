from playwright.sync_api import sync_playwright
import sys
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    for vp in [(390,844),(1440,900)]:
        pg = b.new_page(viewport={'width':vp[0],'height':vp[1]})
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        pg.goto(url); pg.wait_for_timeout(2500)
        for h in ['#/start','#/dateien','#/werkzeuge','#/ich','#/briefkasten','#/steuer','#/gedaechtnis','#/ki','#/neu/dokument','#/neu/tabelle']:
            pg.evaluate(f"location.hash='{h}'"); pg.wait_for_timeout(900)
        pg.screenshot(path=f'/home/claude/FalePDF/tests/suites/smoke_{vp[0]}.png')
        print(vp, 'errors:', errs[:8])
    b.close()

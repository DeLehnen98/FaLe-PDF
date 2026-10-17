import sys, os
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(__file__), 'out')
URL = 'http://127.0.0.1:9202/'
what = sys.argv[1] if len(sys.argv) > 1 else 'sheet'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1366, 'height': 860}, locale='de-DE')
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero')
    if what == 'sheet':
        pg.evaluate("location.hash = '#/neu/tabelle'")
        pg.wait_for_selector('.sheet-app', timeout=10000)
        api = "document.querySelector('.sheet-app')._sheetApi"
        for a, v in [('A1','Monat'),('B1','Umsatz'),('A2','Januar'),('B2','1200'),('A3','Februar'),('B3','1500'),('C1','=SORTIEREN(B2:B3;1;-1)'),('D1','=SUMME(C1#)')]:
            pg.evaluate(f"{api}.input('{a}', {repr(v)})")
        pg.evaluate(f"{api}.select('A2:A3')")
        pg.evaluate(f"{api}.fill('down', 4)")
        pg.wait_for_timeout(300)
        print('A4..A7', [pg.evaluate(f"{api}.text('A{i}')") for i in range(4, 8)])
        print('C1,C2,D1', [pg.evaluate(f"{api}.text('{a}')") for a in ['C1','C2','D1']])
        pg.evaluate(f"{api}.freeze(1, 1)")
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, 'smoke_sheet.png'))
    print('\n'.join(errs) or 'no console errors')
    b.close()

import sys, os
from playwright.sync_api import sync_playwright
OUT = os.path.dirname(os.path.abspath(__file__))
URL = 'http://127.0.0.1:8796/'
routes = sys.argv[1].split(',') if len(sys.argv) > 1 else ['#/start', '#/dateien', '#/werkzeuge', '#/einstellungen', '#/profil', '#/schreiben', '#/schreiben/kuendigung?art=fitness', '#/fristen', '#/tresor', '#/papierkorb', '#/duplikate']
vp = sys.argv[2] if len(sys.argv) > 2 else 'desk'
theme = sys.argv[3] if len(sys.argv) > 3 else 'light'
with sync_playwright() as p:
    b = p.chromium.launch()
    size = {'width': 1366, 'height': 860} if vp == 'desk' else {'width': 390, 'height': 844}
    ctx = b.new_context(viewport=size, locale='de-DE', device_scale_factor=1 if vp == 'desk' else 2, has_touch=(vp != 'desk'), is_mobile=(vp != 'desk'))
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero')
    if theme == 'dark':
        pg.evaluate("localStorage.setItem('fale-theme','dark'); document.documentElement.dataset.theme='dark'")
    for r in routes:
        pg.evaluate(f"location.hash = {r!r}")
        pg.wait_for_timeout(900)
        name = r.replace('#/', '').replace('/', '_').replace('?', '_').replace('=', '-') or 'start'
        pg.screenshot(path=os.path.join(OUT, f'{vp}_{theme}_{name}.png'))
    print('\n'.join(errs) or 'no console errors')
    b.close()

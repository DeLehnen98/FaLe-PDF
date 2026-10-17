import sys, os
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(__file__), 'out')
URL = 'http://127.0.0.1:9202/'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1366, 'height': 860}, locale='de-DE', bypass_csp=True)
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero')
    pg.evaluate("location.hash = '#/neu/dokument'")
    pg.wait_for_selector('.doc-page', timeout=10000)
    pg.wait_for_timeout(500)
    paras = ''.join(f'<p>Absatz {i}: ' + ('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' * 6) + '</p>' for i in range(14))
    pg.evaluate("h => { const ed = document.querySelector('.doc-page'); ed.innerHTML = h; ed.dispatchEvent(new Event('input', {bubbles:true})); }", '<h1>Titel</h1>' + paras + '<table><tr data-hdr><td>A</td><td>B</td></tr>' + ''.join('<tr><td>x%d</td><td>y</td></tr>' % i for i in range(30)) + '</table><p>Ende</p>')
    pg.wait_for_timeout(800)
    print(pg.evaluate("() => ({pages: document.querySelectorAll('.pv-page').length, pg: document.querySelectorAll('[data-pg]').length, pgr: document.querySelectorAll('[data-pgr]').length, info: document.querySelector('[data-pageinfo]').textContent, scale: document.querySelector('.doc-page').getBoundingClientRect().width / document.querySelector('.doc-page').offsetWidth})"))
    pg.screenshot(path=os.path.join(OUT, 'wsmoke1.png'))
    pg.evaluate("document.querySelector('.writer-scroll').scrollTop = 2050")
    pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(OUT, 'wsmoke2.png'))
    print('\n'.join(errs) or 'no console errors')
    b.close()

import json, urllib.request, sys, os, re
from playwright.sync_api import sync_playwright
APP = 'http://127.0.0.1:8922/'; API = 'http://127.0.0.1:8920'
def H(path):
    with urllib.request.urlopen(API + path) as r: return json.loads(r.read().decode())
H('/__test/reset?ONE_CHUNK_KB=64')
INIT = "try{localStorage.setItem('fale-one-dev-api','%s');localStorage.setItem('fale-one-dev-pdf','%s');localStorage.setItem('fale-one-lang','de')}catch(e){}" % (API, API)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 780}, has_touch=True, is_mobile=True, device_scale_factor=2)
    ctx.add_init_script(INIT)
    pg = ctx.new_page()
    pg.goto(APP)
    pg.get_by_role('button', name='Anmelden oder Konto erstellen').click()
    pg.fill('#g-email', 'x@example.com'); pg.locator('form.gate-form button[type=submit]').click()
    pg.wait_for_selector('#g-code'); pg.fill('#g-code', H('/__test/otp?email=x@example.com')['code']); pg.locator('form.gate-form button[type=submit]').click()
    pg.wait_for_selector('#g-pw1', timeout=15000); pg.fill('#g-pw1', 'Korrekt-Pferd-Batterie-42'); pg.fill('#g-pw2', 'Korrekt-Pferd-Batterie-42')
    pg.locator('form.gate-form button[type=submit]').click()
    pg.wait_for_selector('[data-rk]', timeout=30000); pg.check('text=Ich habe den Schlüssel sicher aufbewahrt.'); pg.get_by_role('button', name='Weiter zu FaLe One').click()
    pg.wait_for_timeout(2500)
    for h in sys.argv[1:] or ['#/fotos', '#/drive', '#/einstellungen']:
        pg.evaluate(f"location.hash='{h}'"); pg.wait_for_timeout(1200)
        r = pg.evaluate("""() => { const W = document.documentElement.clientWidth; return { sw: document.scrollingElement.scrollWidth, cw: W, wide: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > W + 0.5 && r.width > 0; }).slice(0, 12).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)) }; }""")
        print(h, json.dumps(r, indent=0))
    pg.screenshot(path='dbg/ov.png')
    b.close()

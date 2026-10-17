import json, urllib.request, sys, os
from playwright.sync_api import sync_playwright
APP = 'http://127.0.0.1:8922/'
API = 'http://127.0.0.1:8920'
OUT = os.path.dirname(os.path.abspath(__file__)) + '/dbg'
os.makedirs(OUT, exist_ok=True)
def H(path):
    with urllib.request.urlopen(API + path) as r: return json.loads(r.read().decode())
INIT = "try{localStorage.setItem('fale-one-dev-api','%s');localStorage.setItem('fale-one-dev-pdf','%s');localStorage.setItem('fale-one-lang','de')}catch(e){}" % (API, API)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    ctx.add_init_script(INIT)
    pg = ctx.new_page()
    msgs = []
    pg.on('console', lambda m: msgs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: msgs.append(f'[pageerror] {e}'))
    pg.goto(APP)
    pg.wait_for_timeout(1500)
    pg.screenshot(path=OUT + '/s1.png')
    pg.get_by_role('button', name='Anmelden oder Konto erstellen').click()
    pg.fill('#g-email', 'anna@example.com')
    pg.get_by_role('button', name='Code senden').click()
    pg.wait_for_selector('#g-code')
    code = H('/__test/otp?email=anna@example.com')['code']
    pg.fill('#g-code', code)
    pg.get_by_role('button', name='Anmelden').click()
    pg.wait_for_selector('#g-pw1', timeout=15000)
    pg.fill('#g-pw1', 'Korrekt-Pferd-Batterie-42')
    pg.fill('#g-pw2', 'Korrekt-Pferd-Batterie-42')
    pg.screenshot(path=OUT + '/s2.png')
    pg.get_by_role('button', name='Sync-Passwort festlegen').click()
    pg.wait_for_selector('[data-rk]', timeout=30000)
    pg.screenshot(path=OUT + '/s3.png')
    pg.check('text=Ich habe den Schlüssel sicher aufbewahrt.')
    pg.get_by_role('button', name='Weiter zu FaLe One').click()
    pg.wait_for_timeout(3000)
    pg.screenshot(path=OUT + '/s4.png')
    pg.goto(APP + '#/drive')
    pg.wait_for_timeout(1500)
    pg.screenshot(path=OUT + '/s5.png')
    print('\n'.join(msgs))
    b.close()

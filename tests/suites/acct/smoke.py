import json, urllib.request, time
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8804/'
def H(p): return json.loads(urllib.request.urlopen(URL.rstrip('/')+p).read())
H('/__test/reset')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width':1280,'height':900}, locale='de-DE')
    pg = ctx.new_page()
    pg.on('console', lambda m: print('CONSOLE', m.type, m.text) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: print('PAGEERR', e))
    pg.goto(URL+'#/konto'); pg.wait_for_timeout(1500)
    pg.screenshot(path='s1.png')
    pg.fill('input[name=email]', 'test@example.com'); pg.click('[data-submit]'); pg.wait_for_timeout(800)
    code = H('/__test/otp?email=test@example.com')['code']; print('code', code)
    pg.fill('input[name=code]', code); pg.wait_for_timeout(2000)
    pg.screenshot(path='s2.png')
    print(pg.locator('.acct-wrap').inner_text()[:800])
    b.close()

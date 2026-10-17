import os, sys
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
ids = sys.argv[1].split(',')
mode = sys.argv[2] if len(sys.argv) > 2 else 'desk'
with sync_playwright() as p:
    b = p.chromium.launch()
    phone = mode == 'phone'
    ctx = b.new_context(viewport={'width': 390, 'height': 844} if phone else {'width': 1440, 'height': 900}, has_touch=phone, is_mobile=phone, device_scale_factor=2 if phone else 1, locale='de-DE')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: print('PAGEERR', e))
    pg.on('console', lambda m: print('CONSOLE', m.type, m.text) if m.type in ('error', 'warning') else None)
    pg.add_init_script("try { localStorage.setItem('fale-lang', 'de'); } catch {}")
    pg.goto('http://127.0.0.1:8850/'); pg.wait_for_timeout(800)
    for i in ids:
        sheet = None
        if ':' in i: i, sheet = i.split(':')
        pg.evaluate(f"location.hash = '#/neu/tabelle?vorlage={i}'"); pg.wait_for_selector('.sheet-app'); pg.wait_for_timeout(700)
        if sheet: pg.evaluate(f"() => document.querySelector('.sheet-app')._sheetApi.switchSheet({sheet})"); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, f'tpl_{i}{sheet or ""}_{mode}.png'))
        pg.evaluate("location.hash = '#/start'"); pg.wait_for_timeout(300)
        d = pg.locator('dialog', has_text='Änderungen speichern?')
        if d.count(): d.locator('button[value="discard"]').click(); pg.wait_for_timeout(300)
    b.close()

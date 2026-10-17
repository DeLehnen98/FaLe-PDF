import sys
from playwright.sync_api import sync_playwright
pages = [('net_home','http://127.0.0.1:8803/'),('net_tools','http://127.0.0.1:8803/werkzeuge/'),('net_vorlagen','http://127.0.0.1:8803/vorlagen/'),('net_tool','http://127.0.0.1:8803/werkzeuge/pdf-zusammenfuegen/'),('net_apps_pdf','http://127.0.0.1:8803/apps/pdf/'),('one','http://127.0.0.1:8804/'),('pdf_app','http://127.0.0.1:8805/')]
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, is_mobile=True, has_touch=True, locale='de-DE')
    for name,url in pages:
        pg = ctx.new_page()
        try:
            pg.goto(url, wait_until='networkidle', timeout=20000)
        except Exception as e: print(name, 'ERR', e)
        pg.wait_for_timeout(800)
        h = pg.evaluate('document.documentElement.scrollHeight')
        print(name, 'height', h)
        pg.screenshot(path=f'{name}.png', full_page=True)
        pg.close()
    b.close()

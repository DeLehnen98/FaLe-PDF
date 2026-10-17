import sys
from playwright.sync_api import sync_playwright
O='http://127.0.0.1:8870'
path, out = sys.argv[1], sys.argv[2]
dev = sys.argv[3] if len(sys.argv) > 3 else 'phone'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(**({'viewport': {'width': 390, 'height': 844}, 'device_scale_factor': 2, 'is_mobile': True, 'has_touch': True} if dev == 'phone' else {'viewport': {'width': 1280, 'height': 900}}))
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: m.type in ('error', 'warning') and errs.append(m.text[:200]))
    pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)[:300]))
    pg.goto(O + path); pg.wait_for_timeout(2500)
    if len(sys.argv) > 4: pg.locator(sys.argv[4]).scroll_into_view_if_needed(); pg.wait_for_timeout(500)
    pg.screenshot(path=out, full_page=len(sys.argv) <= 4)
    print('\n'.join(errs) or 'no console errors')
    print(pg.evaluate('() => [document.documentElement.scrollWidth, innerWidth]'))
    b.close()

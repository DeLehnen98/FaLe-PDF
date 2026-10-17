import sys
from playwright.sync_api import sync_playwright
path, out = sys.argv[1], sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 390
full = '--full' in sys.argv
dark = '--dark' in sys.argv
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': w, 'height': 844}, device_scale_factor=1 if full else 2, is_mobile=w < 600, has_touch=w < 600, color_scheme='dark' if dark else 'light')
    pg = c.new_page()
    errs = []
    pg.on('console', lambda m: m.type in ('error', 'warning') and errs.append(m.text[:200]))
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.goto('http://127.0.0.1:8840' + path)
    pg.wait_for_timeout(800)
    pg.screenshot(path=out, full_page=full)
    print('errors:', errs, 'scroll', pg.evaluate('() => [document.documentElement.scrollWidth, innerWidth]'))
    b.close()

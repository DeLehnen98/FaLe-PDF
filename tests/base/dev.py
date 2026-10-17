"""Dev helper: python3 dev.py <route-template> <pdf> <outname> [phone|desktop] [dark] [js-after]"""
import sys, os, json
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__))
route, pdf, out = sys.argv[1], sys.argv[2], sys.argv[3]
mode = sys.argv[4] if len(sys.argv) > 4 else 'desktop'
dark = len(sys.argv) > 5 and sys.argv[5] == 'dark'
after = sys.argv[6] if len(sys.argv) > 6 else ''
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    vp = {'width': 390, 'height': 844} if mode == 'phone' else {'width': 1366, 'height': 860}
    ctx = b.new_context(viewport=vp, device_scale_factor=2 if mode == 'phone' else 1, is_mobile=mode == 'phone', has_touch=mode == 'phone', color_scheme='dark' if dark else 'light', locale='de-DE', permissions=['camera'])
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto('http://127.0.0.1:8792/')
    page.wait_for_selector('#view-start .hero')
    docid = ''
    if pdf != '-':
        page.set_input_files('#pdf-input', [os.path.join(SP, 'testdata', pdf) if not os.path.isabs(pdf) else pdf])
        page.wait_for_function("location.hash.startsWith('#/ansicht/') || document.querySelector('dialog')", timeout=15000)
        if page.locator('dialog input[type=password]').count():
            page.locator('dialog input[type=password]').fill('geheim'); page.keyboard.press('Enter')
            page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=15000)
        docid = page.evaluate("location.hash.split('/')[2].split('?')[0]")
        page.wait_for_function("document.querySelector('[data-v=loading]') && document.querySelector('[data-v=loading]').hidden", timeout=15000)
        page.wait_for_timeout(300)
    page.evaluate(f"location.hash = {json.dumps(route.replace('DOC', docid))}")
    page.wait_for_timeout(2500)
    if after:
        page.evaluate(after)
        page.wait_for_timeout(1200)
    page.screenshot(path=os.path.join(SP, 'out_protools', out + '.png'))
    print('\n'.join(logs) or 'no console problems')
    b.close()

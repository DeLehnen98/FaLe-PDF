import os, sys, json
sys.argv = [sys.argv[0], 'none']
SP = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SP)
import test_native as T
from playwright.sync_api import sync_playwright
URL = 'http://127.0.0.1:8890/'

def tap(page, sel, idx=0):
    b = page.locator(sel).nth(idx).bounding_box()
    page.touchscreen.tap(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)

def drag(cdp, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': pts[0][0], 'y': pts[0][1]}]})
    for x, y in pts[1:]:
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', is_mobile=True, has_touch=True, device_scale_factor=2.6)
    ctx.add_init_script(T.MOCK_PLUGINS)
    page = ctx.new_page()
    page.on('console', lambda m: print('  console', m.type, m.text[:200]) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print('  PAGEERROR', str(e)[:300]))
    pdf = open(os.path.join(SP, 'testdata', 'bericht.pdf'), 'rb').read()
    page.route('**/_capacitor_file_/**', lambda r: r.fulfill(status=200, body=pdf, headers={'Content-Type': 'application/pdf'}))
    page.goto(URL)
    page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
    did = page.evaluate("location.hash.split('/')[2].split('?')[0]")
    print('doc', did)
    cdp = ctx.new_cdp_session(page)
    mode = sys.argv[1] if False else os.environ.get('MODE', 'edit')
    if mode == 'edit':
        page.evaluate(f"location.hash = '#/werkzeug/bearbeiten?doc={did}'")
        page.wait_for_selector('.pt-stage canvas', timeout=20000)
        page.wait_for_timeout(1200)
        tap(page, '[data-tool="text"]')
        box = page.locator('.pt-stage canvas').first.bounding_box()
        print('canvas box', box)
        page.touchscreen.tap(box['x'] + 80, box['y'] + 120)
        page.wait_for_timeout(500)
        print('active', page.evaluate("document.activeElement && document.activeElement.outerHTML.slice(0,200)"))
        page.keyboard.type('E2E Hallo')
        page.wait_for_timeout(300)
        print('items', page.evaluate("Array.from(document.querySelectorAll('.pt-html .pt-item')).map(e => e.outerHTML.slice(0,200))"))
        print('spantext', page.evaluate("document.querySelector('.pt-etext-in').innerText"), 'active after', page.evaluate('document.activeElement.className'))
        print('foot', page.evaluate("document.querySelector('.screen-foot, .tool-foot') && document.querySelector('.screen-foot, .tool-foot').innerText"))
        btn = page.locator('button:has-text("Speichern")').last
        print('save disabled', btn.is_disabled())
        tap(page, 'button:has-text("Speichern")', page.locator('button:has-text("Speichern")').count() - 1)
        page.wait_for_timeout(2500)
        print('active after save tap', page.evaluate('document.activeElement.className'), page.evaluate("document.querySelector('.pt-foot, .screen-foot') ? 1:0"))
        print('toasts', page.evaluate("Array.from(document.querySelectorAll('.toast')).map(t => t.innerText)"))
        print('docs', [d['name'] for d in T.docs(page)])
    else:
        page.evaluate(f"location.hash = '#/werkzeug/unterschreiben?doc={did}'")
        page.wait_for_selector('.sign-page canvas', timeout=20000)
        page.wait_for_timeout(1000)
        tap(page, '[data-mode="sign"]')
        page.wait_for_selector('dialog[open] canvas.sig-pad', timeout=10000)
        page.wait_for_timeout(500)
        pb = page.locator('dialog[open] canvas.sig-pad').bounding_box()
        print('pad', pb)
        x0, y0 = pb['x'] + 30, pb['y'] + pb['height'] / 2
        drag(cdp, [(x0 + i * 8, y0 + (20 if i % 2 else -20)) for i in range(25)])
        page.wait_for_timeout(300)
        print('hint hidden', page.evaluate("document.querySelector('dialog[open] .sig-pad-hint').hidden"))
        print('dialog buttons', page.evaluate("Array.from(document.querySelectorAll('dialog[open] button')).map(b => b.innerText.trim()).filter(Boolean)"))
        names = page.evaluate("Array.from(document.querySelectorAll('dialog[open] .dialog-actions button, dialog[open] footer button')).map(b => b.innerText.trim())")
        print('actions', names)
        tap(page, 'dialog[open] button.btn-primary', page.locator('dialog[open] button.btn-primary').count() - 1)
        page.wait_for_timeout(1000)
        print('dialog open?', page.locator('dialog[open]').count(), page.evaluate("Array.from(document.querySelectorAll('.toast')).map(t => t.innerText)"))
        if page.locator('dialog[open]').count():
            print('dialog html', page.evaluate("document.querySelector('dialog[open]').innerText.slice(0,600)"))
        box = page.locator('.sign-page').first.bounding_box()
        page.touchscreen.tap(box['x'] + 120, box['y'] + 200)
        page.wait_for_timeout(500)
        print('items', page.locator('.s-item').count())
        tap(page, '[data-save]')
        page.wait_for_timeout(2500)
        print('toasts', page.evaluate("Array.from(document.querySelectorAll('.toast')).map(t => t.innerText)"))
        print('docs', [d['name'] for d in T.docs(page)])
    page.screenshot(path=os.path.join(SP, f'probe_{mode}.png'))
    br.close()

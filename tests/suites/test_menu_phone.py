"""Viewer „Mehr“ menu on a phone (bottom sheet) – every item reachable.
- 360 × 640 and 412 × 780 (touch): the sheet fits between the screen edges, it scrolls, first and last item reachable
- „Text einfügen“ at the top → fill & sign tool with the text mode already on (tap hint)
- „Unterschreiben“ at the top → the signature picker opens
- desktop: dropdown fits in a small window and scrolls
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, base64, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SUITES, 'out_menu_phone')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


IMPORT = """async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
  return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }"""
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
PDF = os.path.join(SUITES, 'formcheck', 'antrag.pdf')


def ctx_page(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    return ctx, page


def open_menu(page, did):
    page.evaluate(f"location.hash = '#/ansicht/{did}'")
    page.wait_for_selector('.pdfViewer .page canvas, .v-stage .page canvas', timeout=30000)
    page.wait_for_timeout(600)
    page.locator('[data-v="more"]').click()
    page.wait_for_selector('.menu-layer.open .menu-item', timeout=5000)
    page.wait_for_timeout(500)


GEO = """() => { const m = document.querySelector('.menu-layer .menu'); const r = m.getBoundingClientRect();
  const items = [...m.querySelectorAll('.menu-item')]; return { top: r.top, bottom: r.bottom, h: innerHeight, scrollH: m.scrollHeight, clientH: m.clientHeight,
  overflow: getComputedStyle(m).overflowY, first: items[0].textContent.trim(), n: items.length }; }"""


def run(p):
    browser = p.chromium.launch()
    for (w, hgt) in [(360, 640), (412, 780)]:
        ctx, page = ctx_page(browser, f'{w}', viewport={'width': w, 'height': hgt}, is_mobile=True, has_touch=True)

        def phone():
            did = page.evaluate(IMPORT, [b64(PDF), 'Vollmacht.pdf'])
            open_menu(page, did)
            g = page.evaluate(GEO)
            check(f'{w}×{hgt}: sheet inside the screen (top ≥ 0, bottom ≤ height)', g['top'] >= 0 and g['bottom'] <= g['h'], g)
            check(f'{w}×{hgt}: long menu scrolls inside the sheet', g['overflow'] in ('auto', 'scroll') and g['scrollH'] > g['clientH'], g)
            check(f'{w}×{hgt}: „Text einfügen“ is the first item', g['first'] == 'Text einfügen', g['first'])
            page.screenshot(path=os.path.join(OUT, f'menu_{w}_top.png'))
            # (headless Chromium does not run compositor touch scrolling – check that nothing blocks it, then scroll)
            ta = page.evaluate("() => { const out = []; for (let e = document.querySelector('.menu-layer .menu'); e; e = e.parentElement) out.push(getComputedStyle(e).touchAction); return out; }")
            check(f'{w}×{hgt}: nothing blocks touch scrolling (touch-action)', all(t in ('auto', 'pan-y', 'pan-x pan-y', 'manipulation') for t in ta), ta)
            page.evaluate("document.querySelector('.menu-layer .menu').scrollTop = 1e6")
            page.wait_for_timeout(300)
            last = page.locator('.menu-layer .menu-item').last
            lb = last.bounding_box()
            st = page.evaluate("document.querySelector('.menu-layer .menu').scrollTop")
            check(f'{w}×{hgt}: scrolled to the end, the last item („{last.inner_text().strip()}“) is on screen', st > 0 and lb['y'] + lb['height'] <= hgt, (st, lb))
            page.screenshot(path=os.path.join(OUT, f'menu_{w}_bottom.png'))
            last.click()  # e.g. „Unterschrift anfordern“ – any item works after scrolling
            page.wait_for_timeout(400)
            check(f'{w}×{hgt}: item at the bottom can be tapped (menu closes)', page.locator('.menu-layer').count() == 0)
            # „Text einfügen“ → text mode on
            open_menu(page, did)
            page.locator('.menu-layer .menu-item', has_text='Text einfügen').click()
            page.wait_for_selector('.sign-page canvas', timeout=30000)
            page.wait_for_timeout(1200)
            on = page.evaluate("document.querySelector('[data-mode=\"text\"]').getAttribute('aria-pressed')")
            check(f'{w}×{hgt}: „Text einfügen“ opens the tool with the text mode on', on == 'true' and 'modus' not in page.evaluate('location.hash'), on)
            page.locator('.sign-page').first.click(position={'x': 80, 'y': 120})
            page.wait_for_timeout(500)
            check(f'{w}×{hgt}: a tap on the page places a text box', page.locator('.s-item').count() >= 1)
            # „Unterschreiben“ → signature picker
            open_menu(page, did)
            page.locator('.menu-layer .menu-item', has_text='Unterschreiben').first.click()
            page.wait_for_selector('.sign-page canvas', timeout=30000)
            ok = False
            for _ in range(20):
                if page.locator('dialog[open]').count():
                    ok = True
                    break
                page.wait_for_timeout(250)
            check(f'{w}×{hgt}: „Unterschreiben“ opens the signature dialog', ok)
        step(f'phone {w}', phone)
        ctx.close()

    ctx, page = ctx_page(browser, 'desktop-small', viewport={'width': 1000, 'height': 560})

    def desk():
        did = page.evaluate(IMPORT, [b64(PDF), 'Klein.pdf'])
        open_menu(page, did)
        g = page.evaluate(GEO)
        check('small desktop window: dropdown inside the window and scrollable', g['top'] >= 0 and g['bottom'] <= g['h'] + 1 and g['scrollH'] > g['clientH'], g)
        page.mouse.move(800, g['top'] + 100)
        page.mouse.wheel(0, 3000)
        page.wait_for_timeout(300)
        lb = page.locator('.menu-layer .menu-item').last.bounding_box()
        check('small desktop window: mouse wheel reaches the last item', lb['y'] + lb['height'] <= g['h'] + 1, lb)
    step('desktop', desk)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} passed')
    for n, c, i in results:
        if not c:
            print('  FAIL', n, i[:300])

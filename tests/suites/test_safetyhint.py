"""Hinweis-Karte bei Schwärzen und Abdecken (js/tools/safetyhint.js).
- Schwärzen: Karte mit Animation erscheint beim Öffnen; „Verstanden“ blendet sie aus, beim nächsten Öffnen ist sie wieder da;
  „Nicht mehr anzeigen“ → kommt nie wieder (auch nach Neuladen)
- PDF bearbeiten: Karte nur im Modus „Abdecken“, verschwindet beim Wechsel, kommt beim nächsten Abdecken wieder; „Nicht mehr anzeigen“ wirkt
- Animation läuft (Fläche, Text darunter, Haken); bei „Bewegung reduzieren“ keine Animation, Endzustand sichtbar
- Handy 360 px: kein waagerechtes Scrollen, große Knöpfe; keine Konsolenfehler
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, base64, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.join(SUITES, 'purge', 'rl_std.pdf')
OUT = os.path.join(SUITES, 'out_safetyhint')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:500], flush=True)
        traceback.print_exc()


IMPORT = """async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js');
  return (await lib.importPdf(bin, { name: 'Hinweis.pdf', source: 'Test', silent: true })).id; }"""
ANIMS = "() => [...document.querySelectorAll('.sh-card .sh-box, .sh-card .sh-check, .sh-card .sh-secret rect')].reduce((n, e) => n + e.getAnimations().filter(a => a.playState === 'running').length, 0)"


def open_tool(page, tool, did, wait='.pt-page canvas'):
    page.evaluate("location.hash = '#/werkzeuge'"); page.wait_for_timeout(300)
    page.evaluate(f"location.hash = '#/werkzeug/{tool}?doc={did}'")
    page.wait_for_selector(wait, timeout=20000)
    page.wait_for_timeout(600)


def ctx_page(browser, label, **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=30000)
    did = page.evaluate(IMPORT, base64.b64encode(open(PDF, 'rb').read()).decode())
    return ctx, page, did


def run(p):
    browser = p.chromium.launch()
    ctx, page, did = ctx_page(browser, 'desktop', viewport={'width': 1280, 'height': 860})

    def redact():
        open_tool(page, 'schwaerzen', did)
        card = page.locator('.sh-card.sh-redact')
        check('Schwärzen: hint card shown with title and text', card.count() == 1 and 'So funktioniert Schwärzen' in card.inner_text() and 'endgültig gelöscht' in card.inner_text())
        page.wait_for_timeout(1700)
        check('Schwärzen: animation running', page.evaluate(ANIMS) >= 3, page.evaluate(ANIMS))
        page.screenshot(path=os.path.join(OUT, 'redact.png'))
        page.locator('.sh-card [data-sh-ok]').click()
        page.wait_for_timeout(400)
        check('„Verstanden“ hides it now', page.locator('.sh-card').count() == 0)
        open_tool(page, 'schwaerzen', did)
        check('… and it is back next time', page.locator('.sh-card.sh-redact').count() == 1)
        page.locator('.sh-card [data-sh-never]').click()
        page.wait_for_timeout(400)
        open_tool(page, 'schwaerzen', did)
        page.reload(); page.wait_for_selector('.pt-page canvas', timeout=20000); page.wait_for_timeout(600)
        check('„Nicht mehr anzeigen“: gone for good (also after reload)', page.locator('.sh-card').count() == 0 and page.evaluate("localStorage.getItem('fale-hint-redact')") == 'hidden')
    step('Schwärzen', redact)

    def cover():
        open_tool(page, 'bearbeiten', did)
        check('Bearbeiten: no hint in text mode', page.locator('.sh-card').count() == 0)
        page.locator('.pt-tool[data-tool="cover"]').click()
        page.wait_for_timeout(500)
        card = page.locator('.sh-card.sh-cover')
        check('Abdecken: hint card appears', card.count() == 1 and 'So funktioniert Abdecken' in card.inner_text() and 'gelöscht' in card.inner_text())
        page.wait_for_timeout(1500)
        check('Abdecken: animation running', page.evaluate(ANIMS) >= 3)
        page.screenshot(path=os.path.join(OUT, 'cover.png'))
        page.locator('.pt-tool[data-tool="text"]').click(); page.wait_for_timeout(300)
        check('switching mode removes it', page.locator('.sh-card').count() == 0)
        page.locator('.pt-tool[data-tool="cover"]').click(); page.wait_for_timeout(300)
        page.locator('.sh-card [data-sh-ok]').click(); page.wait_for_timeout(400)
        page.locator('.pt-tool[data-tool="text"]').click(); page.locator('.pt-tool[data-tool="cover"]').click(); page.wait_for_timeout(300)
        check('after „Verstanden“ it comes back with the next Abdecken', page.locator('.sh-card.sh-cover').count() == 1)
        page.locator('.sh-card [data-sh-never]').click(); page.wait_for_timeout(400)
        page.locator('.pt-tool[data-tool="text"]').click(); page.locator('.pt-tool[data-tool="cover"]').click(); page.wait_for_timeout(300)
        check('„Nicht mehr anzeigen“ works for Abdecken', page.locator('.sh-card').count() == 0)
    step('Abdecken', cover)
    ctx.close()

    ctx, page, did = ctx_page(browser, 'reduced', viewport={'width': 1280, 'height': 860}, reduced_motion='reduce')

    def reduced():
        open_tool(page, 'schwaerzen', did)
        op = page.evaluate("getComputedStyle(document.querySelector('.sh-card .sh-secret rect')).opacity")
        check('reduced motion: no animation, end state shown (text gone)', page.evaluate(ANIMS) == 0 and float(op) == 0, (page.evaluate(ANIMS), op))
    step('reduced motion', reduced)
    ctx.close()

    ctx, page, did = ctx_page(browser, 'phone', viewport={'width': 360, 'height': 760}, is_mobile=True, has_touch=True)

    def phone():
        open_tool(page, 'schwaerzen', did)
        over = page.evaluate('document.documentElement.scrollWidth')
        bb = page.locator('.sh-card').bounding_box()
        btn = page.locator('.sh-card [data-sh-never]').bounding_box()
        check('phone: card fits, no horizontal scroll', over <= 361 and bb and bb['x'] >= 0 and bb['x'] + bb['width'] <= 361, (over, bb))
        check('phone: big buttons (≥ 44 px), card not taller than 40 % of the screen', btn['height'] >= 44 and bb['height'] <= 760 * 0.4, (btn, bb))
        check('phone: pages still visible below the card', page.locator('.pt-page').first.bounding_box()['y'] < 700)
        page.screenshot(path=os.path.join(OUT, 'phone.png'))
    step('phone', phone)
    ctx.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)

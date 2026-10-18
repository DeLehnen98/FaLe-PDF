"""pdf.fale.network: start page at / (site/), browser app at /app/ (web build, dist/).
- start page DE (/) and EN (/en/): renders without console errors or CSP violations, no horizontal scroll at 360 px,
  links into the app, store buttons "coming soon" – or real links when site/stores.json has them
- old links into the app that point at / are forwarded: #/s/… (shared file), #/konto, ?code=… (sign-in callback)
- /app/: the app starts, its service worker has the scope /app/, a web tool opens in its frame, a PDF imports
- the old app service worker with scope / is removed by the start page
Run: FALE_MINIFY=0 node scripts/vercel-build.mjs && node tests/suites/sec/csp_server.mjs 9412 /home/claude/FalePDF/dist
     python3 test_landing_split.py
"""
import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('DIST_URL', 'http://127.0.0.1:9412')
DIST = Path('/home/claude/FalePDF/dist')
TD = '/home/claude/FalePDF/tests/base/testdata'
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:500], flush=True)


CSP = "window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));"


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        def landing():
            for path, lang, w in (('/', 'de', 360), ('/en/', 'en', 1280)):
                c = b.new_context(viewport={'width': w, 'height': 800}, locale='de-DE' if lang == 'de' else 'en-GB')
                c.add_init_script(CSP)
                pg = c.new_page()
                errs = []
                pg.on('console', lambda m: m.type == 'error' and errs.append(m.text[:200]))
                pg.on('pageerror', lambda e: errs.append(str(e)))
                pg.goto(URL + path); pg.wait_for_timeout(1200)
                check(f'{path}: start page, not the app', pg.locator('h1').count() == 1 and pg.locator('#view-start').count() == 0)
                check(f'{path}: html lang {lang}', pg.evaluate('document.documentElement.lang') == lang)
                check(f'{path}: no console errors / CSP violations', not errs and not pg.evaluate('window.__csp'), (errs, pg.evaluate('window.__csp')))
                check(f'{path}: no horizontal scroll at {w} px', pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                hrefs = pg.evaluate("[...document.querySelectorAll('a.btn-main')].map(a => a.getAttribute('href'))")
                check(f'{path}: buttons open the app at /app/', hrefs and all(h == '/app/' for h in hrefs), hrefs)
                check(f'{path}: store buttons say "coming soon"', pg.locator('.store.is-soon').count() == 2)
                imgs = pg.evaluate("[...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').length")
                check(f'{path}: images load', imgs == 0, imgs)
                c.close()
        step('start page', landing)

        def stores():
            f = DIST / 'site' / 'stores.json'
            old = f.read_text()
            try:
                f.write_text(json.dumps({'android': 'https://play.google.com/store/apps/details?id=dev.fale.pdf', 'ios': ''}))
                c = b.new_context(); pg = c.new_page()
                pg.goto(URL + '/'); pg.wait_for_timeout(1200)
                a = pg.locator('a.store')
                check('store link from stores.json replaces "coming soon"', a.count() == 1 and 'id=dev.fale.pdf' in a.get_attribute('href') and pg.locator('.store.is-soon').count() == 1)
                c.close()
            finally:
                f.write_text(old)
        step('store links', stores)

        def forward():
            c = b.new_context(); pg = c.new_page()
            for src, want in (('/#/s/abc#k=xyz', '/app/#/s/abc#k=xyz'), ('/#/konto', '/app/#/konto'), ('/?code=123', '/app/?code=123')):
                pg.goto(URL + src); pg.wait_for_timeout(800)
                check(f'forward {src}', pg.url.startswith(URL + want), pg.url)
            c.close()
        step('old app links', forward)

        def app():
            c = b.new_context(viewport={'width': 390, 'height': 844})
            c.add_init_script("localStorage.setItem('fale-onboarded', '1');")
            pg = c.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(URL + '/app/'); pg.wait_for_selector('#view-start .hero', timeout=20000); pg.wait_for_timeout(2500)
            check('/app/: the app starts', True)
            scope = pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r && r.scope)")
            check('/app/: service worker scope /app/', scope == URL + '/app/', scope)
            pg.set_input_files('#pdf-input', os.path.join(TD, 'bericht.pdf'))
            pg.wait_for_function("() => location.hash.startsWith('#/ansicht/')", timeout=20000)
            check('/app/: PDF import opens the viewer', True)
            pg.goto(URL + '/app/#/web/n-up'); pg.wait_for_selector('iframe.wt-host-frame', timeout=10000)
            pg.frame_locator('iframe.wt-host-frame').locator('#wt-app').wait_for(timeout=15000)
            check('/app/: web tool opens in its frame', True)
            check('/app/: share links point at /app/', pg.evaluate("import('/js/share/api.js').then(m => m.linkBase())") == URL + '/app/')
            check('/app/: no page errors', not errs, errs[:3])
            # the start page removes an old service worker registered for "/"
            pg.goto(URL + '/')
            pg.wait_for_timeout(300)
            pg.evaluate("navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => true).catch(e => String(e))")
            pg.reload(); pg.wait_for_timeout(1500)
            scopes = pg.evaluate("navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.scope))")
            check('start page removes an app service worker for "/"', URL + '/' not in scopes and URL + '/app/' in scopes, scopes)
            c.close()
        step('app at /app/', app)
        b.close()
    ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
    print(f'\n{ok} passed, {len(bad)} failed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

"""pdf.fale.network: start page at / (site/), browser app at /app/ (web build, dist/).
- start page DE (/) and EN (/en/): renders without console errors or CSP violations, no horizontal scroll at 360 px,
  links into the app, store buttons "coming soon" (Android, iOS, Microsoft Store) – or real links when site/stores.json has them
- section "Für Windows und Mac": download button → /app/?install=1, named after the visitor's system; #computer stays here
- old links into the app that point at / are forwarded: #/s/… (shared file), #/konto, ?code=… (sign-in callback)
- /app/: the app starts, its service worker has the scope /app/, a web tool opens in its frame, a PDF imports
- the old app service worker with scope / is removed by the start page
Run: FALE_MINIFY=0 node scripts/vercel-build.mjs && node tests/suites/sec/csp_server.mjs 9412 <repo>/dist
     DIST_URL=http://127.0.0.1:9412 python3 test_landing_split.py   (FALE_DIST overrides <repo>/dist)
"""
import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('DIST_URL', 'http://127.0.0.1:9412')
REPO = Path(__file__).resolve().parents[2]
DIST = Path(os.environ.get('FALE_DIST') or REPO / 'dist')
TD = str(REPO / 'tests' / 'base' / 'testdata')
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
                hrefs = pg.evaluate("[...document.querySelectorAll('a.btn-main:not([data-dl])')].map(a => a.getAttribute('href'))")
                check(f'{path}: buttons open the app at /app/', hrefs and all(h == '/app/' for h in hrefs), hrefs)
                dl = pg.evaluate("[...document.querySelectorAll('a[data-dl]')].map(a => [a.getAttribute('href'), a.textContent])")
                check(f'{path}: download for Windows/Mac opens /app/?install=1', len(dl) == 1 and dl[0][0] == '/app/?install=1', dl)
                check(f'{path}: section "for Windows and Mac" with steps', pg.locator('#computer h2').count() == 1 and pg.locator('#computer .desk-steps li').count() == 3)
                check(f'{path}: store buttons say "coming soon" (Android, iOS, Microsoft Store)',
                      pg.evaluate("[...document.querySelectorAll('.store.is-soon')].map(e => e.dataset.store).join()") == 'android,ios,windows')
                pg.click('a[href="#computer"] >> nth=-1'); pg.wait_for_timeout(500)
                check(f'{path}: #computer is an anchor on the start page (not forwarded to the app)', pg.url.endswith(path + '#computer') and pg.locator('#computer').count() == 1, pg.url)
                imgs = pg.evaluate("[...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').length")
                check(f'{path}: images load', imgs == 0, imgs)
                c.close()
        step('start page', landing)

        def stores():
            f = DIST / 'site' / 'stores.json'
            old = f.read_text()
            try:
                f.write_text(json.dumps({'android': 'https://play.google.com/store/apps/details?id=dev.fale.pdf', 'ios': '', 'windows': ''}))
                c = b.new_context(); pg = c.new_page()
                pg.goto(URL + '/'); pg.wait_for_timeout(1200)
                a = pg.locator('a.store')
                check('store link from stores.json replaces "coming soon"', a.count() == 1 and 'id=dev.fale.pdf' in a.get_attribute('href') and pg.locator('.store.is-soon').count() == 2)
                f.write_text(json.dumps({'android': '', 'ios': '', 'windows': 'https://apps.microsoft.com/detail/9TESTTESTTEST'}))
                for path, label in (('/', 'Im Microsoft Store laden'), ('/en/', 'Get it from the Microsoft Store')):
                    pg.goto(URL + path); pg.wait_for_timeout(1200)
                    a = pg.locator('#computer a.store')
                    check(f'{path}: Microsoft Store link from stores.json ({label})', a.count() == 1 and a.get_attribute('href').endswith('/9TESTTESTTEST') and label in a.inner_text() and pg.locator('.store.is-soon').count() == 2, a.count())
                c.close()
            finally:
                f.write_text(old)
        step('store links', stores)

        def download_label():
            f = DIST / 'site' / 'stores.json'
            built = json.loads(f.read_text())
            check('build writes the windows key into site/stores.json', set(built) >= {'android', 'ios', 'windows'}, built)
            for ua, want_de, want_en in (
                    ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 'Für Windows herunterladen', 'Download for Windows'),
                    ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Für Mac herunterladen', 'Download for Mac'),
                    ('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', 'Herunterladen', 'Download')):
                c = b.new_context(user_agent=ua); pg = c.new_page()
                for path, want in (('/', want_de), ('/en/', want_en)):
                    pg.goto(URL + path); pg.wait_for_timeout(700)
                    got = pg.locator('a[data-dl]').inner_text().strip()
                    check(f'{path}: download button says "{want}"', got == want, got)
                c.close()
        step('download button', download_label)

        def forward():
            c = b.new_context(); pg = c.new_page()
            for src, want in (('/#/s/abc#k=xyz', '/app/#/s/abc#k=xyz'), ('/#/konto', '/app/#/konto'), ('/?code=123', '/app/?code=123')):
                pg.goto(URL + src); pg.wait_for_timeout(800)
                check(f'forward {src}', pg.url.startswith(URL + want), pg.url)
            pg.goto(URL + '/#access_token=abc&type=recovery'); pg.wait_for_timeout(800)
            check('forward a sign-in callback in the hash', pg.url.startswith(URL + '/app/#access_token=abc'), pg.url)
            for src in ('/#computer', '/en/#fragen'):
                pg.goto(URL + src); pg.wait_for_timeout(800)
                check(f'plain anchor {src} stays on the start page', pg.url == URL + src and pg.locator('#view-start').count() == 0, pg.url)
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

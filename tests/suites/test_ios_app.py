"""iPhone app behaviour of the web code (mocked Capacitor bridge with platform 'ios'):
- start page renders without errors; no FaLe Plus offer and no ad button / ad consent row (App Store purchases later)
- saving goes straight into Documents (Files app: „Auf meinem iPhone › FaLe PDF“), toast says where
- a file opened in place from the Files app (origin token, writable) → „Original ersetzen“ → writeBack(token, path)
- read-only original → no button; iOS wording for read-only errors
- printing goes to the FalePrint plugin
Run: python3 test_ios_app.py   (static server: python3 -m http.server 8797 --bind 127.0.0.1 in /home/claude/FalePDF)
"""
import base64, os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:8797/')
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


IOS = r"""
window.__ios = { calls: [], fs: [] };
const I = window.__ios;
const listeners = {};
const FaleIncoming = {
  takePending: async () => { const p = I.pending || []; I.pending = []; return { action: 'VIEW', files: p, skipped: [] }; },
  readFile: async o => ({ data: I.data[o.path] }),
  release: async () => {},
  writeBack: async o => { I.calls.push(['writeBack', o.token, o.path]); return { ok: true }; },
  setBarColors: async () => {}, setSecure: async () => {},
  addListener: async (n, cb) => { listeners[n] = cb; return { remove() {} }; },
};
I.fire = () => listeners.filesReady && listeners.filesReady({ count: 1 });
const Filesystem = {
  writeFile: async o => { I.fs.push(['write', o.path, o.directory]); return { uri: 'file:///var/mobile/Library/Caches/' + o.path }; },
  appendFile: async o => { I.fs.push(['append', o.path, o.directory]); },
  stat: async () => { throw new Error('nope'); },
  getUri: async o => ({ uri: 'file:///var/mobile/Library/Caches/' + o.path }),
  deleteFile: async () => {},
};
const FalePrint = { printPdf: async o => { I.calls.push(['print', o.path, o.name]); return { ok: true }; } };
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', convertFileSrc: p => 'http://invalid.invalid' + p,
  Plugins: { FaleIncoming, Filesystem, FalePrint, NativePurchases: {}, AdMob: { initialize: async () => {} } } };
"""


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', is_mobile=True, has_touch=True,
                                  user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148')
        ctx.add_init_script(IOS)
        ctx.add_init_script("localStorage.setItem('fale-onboarded', '1');")
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and 'invalid.invalid' not in m.text and errs.append(m.text))
        page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero'); page.wait_for_timeout(800)

        def basics():
            check('platform is ios', page.evaluate("async () => (await import('./js/platform.js')).platformName()") == 'ios')
            check('html marked is-ios', page.evaluate("document.documentElement.classList.contains('is-ios')"))
            page.goto(URL + '#/einstellungen'); page.wait_for_timeout(800)
            page.goto(URL + '#/ki'); page.wait_for_selector('.ai-hub', timeout=8000); page.wait_for_timeout(800)
            txt = page.locator('#tool-screen').inner_text()
            check('no FaLe Plus offer on iOS (yet)', 'FaLe Plus' not in txt and page.locator('a[href="#/ki/plus"]').count() == 0, txt[:300])
            check('no ad button on iOS', page.locator('[data-ai-ad]').count() == 0)
            page.goto(URL + '#/ki/einstellungen'); page.wait_for_selector('[data-cloud]', timeout=8000)
            check('no ad-consent row on iOS', page.locator('[data-adrow]').count() == 0)
            page.goto(URL + '#/ki/plus'); page.wait_for_timeout(800)
            check('#/ki/plus redirects on iOS', page.evaluate('location.hash') == '#/ki')
        step('basics', basics)

        def save_and_print():
            r = page.evaluate("async () => (await import('./js/platform.js')).saveFile(new Blob(['%PDF-1.4']), 'Rechnung.pdf', 'application/pdf')")
            w = page.evaluate('window.__ios.fs')
            check('saved straight into Documents (no subfolder)', r['ok'] and w[-1][1] == 'Rechnung.pdf' and w[-1][2] == 'DOCUMENTS', f'{r} {w}')
            check('toast tells where in the Files app', 'Dateien › Auf meinem iPhone › FaLe PDF › Rechnung.pdf' in page.locator('#toasts').inner_text(), page.locator('#toasts').inner_text())
            pr = page.evaluate("async () => (await import('./js/platform.js')).printPdf(new Uint8Array([37,80,68,70]), 'Brief')")
            c = page.evaluate('window.__ios.calls')
            check('print goes to FalePrint with a cache file', pr['method'] == 'native' and any(x[0] == 'print' and '/Library/Caches/print/' in x[1] and x[2] == 'Brief' for x in c), f'{pr} {c}')
        step('save + print', save_and_print)

        def open_in_place():
            for writable, name in ((True, 'vertrag.pdf'), (False, 'nurlesen.pdf')):
                page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero')
                page.evaluate("""([data, w, n]) => { window.__ios.data = { ['/x/Caches/incoming/1-' + n]: data };
                  window.__ios.pending = [{ name: n, mimeType: 'application/pdf', size: 1, path: '/x/Caches/incoming/1-' + n, origin: 'ios-tok-' + n, writable: w }]; window.__ios.fire(); }""",
                              [b64(os.path.join(TD, 'unkomprimiert.pdf')), writable, name])
                page.wait_for_function("() => location.hash.startsWith('#/ansicht/')", timeout=15000)
                did = page.evaluate("() => location.hash.split('/')[2].split('?')[0]")
                info = page.evaluate("async id => (await import('./js/origin.js')).originFor(id, '.pdf')", did)
                if not writable:
                    check('iOS read-only original: no write-back offered', info is None, info)
                    msg = page.evaluate("async id => { try { await (await import('./js/origin.js')).writeOriginal(id, new Blob(['x'])); return ''; } catch (e) { return e.userMessage || ''; } }", did)
                    check('iOS wording for read-only originals (Dateien-App, no „Bearbeiten mit“)', 'Dateien-App' in msg and 'Bearbeiten mit' not in msg, msg)
                    continue
                check('iOS open in place: origin known', info and info['where'] == 'app' and info['name'] == name, info)
                page.goto(URL + f"#/werkzeug/komprimieren?doc={did}"); page.wait_for_selector('[data-run]')
                page.locator('[data-run]').click(); page.wait_for_selector('.result-card [data-r="original"]', timeout=30000)
                page.locator('.result-card [data-r="original"]').click(); page.wait_for_selector('dialog.dlg')
                page.locator('dialog.dlg button.btn-primary').last.click()
                page.wait_for_function("() => window.__ios.calls.some(c => c[0] === 'writeBack')", timeout=10000)
                c = [x for x in page.evaluate('window.__ios.calls') if x[0] == 'writeBack'][0]
                check('iOS writeBack(token, cache path)', c[1] == 'ios-tok-vertrag.pdf' and c[2].startswith('writeback/ios-tok-vertrag.pdf-') and c[2].endswith('.pdf'), c)
        step('open in place', open_in_place)
        check('iOS: no page errors', not errs, errs[:3])
        browser.close()
    ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
    print(f'\n{ok} passed, {len(bad)} failed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

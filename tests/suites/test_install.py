"""FaLe PDF – "install as an app" in the web build (js/install.js, manifest.webmanifest).
- /app/?install=1 (start page "Herunterladen"): the install dialog opens at once; with the browser's install event
  it offers "Jetzt installieren" (→ prompt(), accepted → installed), without it plain steps in the browser's words
  (Edge/Chrome, Firefox on Windows, Safari on the Mac: Ablage › Zum Dock hinzufügen, iPhone: Zum Home-Bildschirm)
- Ich screen: "Auf diesem PC installieren" / "… Mac …" / "Als App installieren", "schon installiert" afterwards
- one-time desktop hint: only on desktop-size screens, from the second start, never again after "Nicht jetzt"
- nothing in the native apps (window.Capacitor) and nothing to install when already running as an installed app
  (Windows: "PDFs per Doppelklick öffnen" instead)
- English UI, no console errors / CSP violations, no horizontal scroll on a phone
- manifest: screenshots wide + narrow (same aspect ratio per form factor, real sizes), shortcuts, not precached
Run: FALE_MINIFY=0 node scripts/vercel-build.mjs && node tests/suites/sec/csp_server.mjs 9412 <repo>/dist
     DIST_URL=http://127.0.0.1:9412 python3 test_install.py [step name …]
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('DIST_URL', 'http://127.0.0.1:9412')
results = []

UA = {
    'win-edge': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    'win-firefox': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
    'mac-safari': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'mac-firefox': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:144.0) Gecko/20100101 Firefox/144.0',
    'iphone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
}

# The real browser may or may not fire its own install event in a test run: block it and fire a fake one on demand.
BASE = """
window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
window.addEventListener('beforeinstallprompt', e => { if (!e.__fake) e.stopImmediatePropagation(); }, true);
window.__bipCalls = 0;
window.__fireBip = (outcome) => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.__fake = true;
  e.prompt = () => { window.__bipCalls++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: outcome || 'accepted', platform: 'web' });
  window.dispatchEvent(e);
};
try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}
"""
FIRE = "setTimeout(() => window.__fireBip(), 250);"


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


ONLY = set(sys.argv[1:])  # optional: names of steps to run, e.g. python3 test_install.py standalone


def step(name, fn):
    if ONLY and name not in ONLY:
        return
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:500], flush=True)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        def ctx(ua, w=1280, h=800, lang='de', extra='', fire=False):
            c = b.new_context(user_agent=UA[ua], viewport={'width': w, 'height': h}, locale='de-DE' if lang == 'de' else 'en-GB',
                              is_mobile=w < 700, has_touch=w < 700)
            c.add_init_script(BASE + (f"try {{ localStorage.setItem('fale-lang', '{lang}'); }} catch (e) {{}}") + extra + (FIRE if fire else ''))
            pg = c.new_page()
            pg.__errs = []
            pg.on('console', lambda m: m.type == 'error' and pg.__errs.append(m.text[:200]))
            pg.on('pageerror', lambda e: pg.__errs.append(str(e)[:200]))
            return c, pg

        def clean(pg, label):
            check(f'{label}: no console errors / CSP violations', not pg.__errs and not pg.evaluate('window.__csp'), (pg.__errs, pg.evaluate('window.__csp')))

        def dialog_text(pg):
            return pg.locator('dialog[open] .dlg-inner').inner_text()

        # 1. Windows + Edge: the start page's download link, browser install event → "Jetzt installieren"
        def win_prompt():
            c, pg = ctx('win-edge', fire=True)
            pg.goto(URL + '/app/?install=1'); pg.wait_for_selector('dialog[open] [data-inst-go]', timeout=15000)
            check('win: dialog title "Auf diesem PC installieren"', pg.locator('dialog[open] .dlg-title').inner_text() == 'Auf diesem PC installieren')
            t = dialog_text(pg)
            check('win: benefits incl. double-click and Start menu', 'Doppelklick' in t and 'Startmenü' in t, t)
            check('win: ?install=1 removed from the address', 'install=1' not in pg.url and pg.url.endswith('/app/#/start'), pg.url)
            pg.click('dialog[open] [data-inst-go]')
            pg.wait_for_function("() => !document.querySelector('dialog[open]')", timeout=5000)
            check('win: prompt() called once, dialog closed', pg.evaluate('window.__bipCalls') == 1)
            check('win: success message', 'wird installiert' in pg.locator('.toasts').inner_text())
            check('win: remembered as installed', pg.evaluate("localStorage.getItem('fale-installed')") == '1')
            pg.evaluate("location.hash = '#/einstellungen'"); pg.wait_for_selector('[data-install-me] .inst-me', timeout=8000)
            card = pg.locator('[data-install-me]').inner_text()
            check('win: Ich card says already installed', 'Auf diesem PC installieren' in card and 'schon installiert' in card, card)
            pg.click('[data-inst-open]'); pg.wait_for_selector('dialog[open]', timeout=5000)
            check('win: dialog explains where to find it', 'schon installiert' in dialog_text(pg) and 'Startmenü' in dialog_text(pg), dialog_text(pg))
            pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            check('win: Escape closes the dialog', pg.locator('dialog[open]').count() == 0)
            clean(pg, 'win')
            c.close()
        step('windows prompt', win_prompt)

        # 2. Ich screen before installing; user dismisses the browser prompt
        def ich_entry():
            c, pg = ctx('win-edge', fire=True)
            pg.goto(URL + '/app/#/einstellungen'); pg.wait_for_selector('[data-install-me] .inst-me', timeout=15000); pg.wait_for_timeout(500)
            card = pg.locator('[data-install-me]').inner_text()
            check('ich: entry "Auf diesem PC installieren"', 'Auf diesem PC installieren' in card and 'kostenlos' in card, card)
            pg.click('[data-inst-open]')
            check('ich: entry opens the dialog with "Jetzt installieren"', pg.wait_for_selector('dialog[open] [data-inst-go]', timeout=5000) is not None)
            c.close()
            # the user says no in the browser's own prompt
            c, pg = ctx('win-edge', extra="setTimeout(() => window.__fireBip('dismissed'), 250);")
            pg.goto(URL + '/app/#/einstellungen'); pg.wait_for_selector('[data-install-me] .inst-me', timeout=15000); pg.wait_for_timeout(500)
            pg.click('[data-inst-open]'); pg.wait_for_selector('dialog[open] [data-inst-go]', timeout=5000)
            pg.click('dialog[open] [data-inst-go]'); pg.wait_for_timeout(600)
            t = dialog_text(pg)
            check('ich: dismissed prompt → dialog stays with manual steps', pg.locator('dialog[open]').count() == 1 and 'So geht' in t and 'Diese Website als App installieren' in t, t)
            check('ich: not marked installed after "dismissed"', pg.evaluate("localStorage.getItem('fale-installed')") is None)
            clean(pg, 'ich')
            c.close()
        step('ich entry', ich_entry)

        # 3. browsers without an install event: steps in the browser's own words
        def manual():
            for ua, w, title, want in (('win-firefox', 1280, 'Auf diesem PC installieren', 'Zur Taskleiste hinzufügen'),
                                       ('mac-safari', 1280, 'Auf diesem Mac installieren', 'Ablage'),
                                       ('mac-firefox', 1280, 'Auf diesem Mac installieren', 'Chrome oder Edge'),
                                       ('iphone', 390, 'Als App installieren', 'Zum Home-Bildschirm')):
                c, pg = ctx(ua, w=w, h=844 if w < 700 else 800)
                pg.goto(URL + '/app/?install=1'); pg.wait_for_selector('dialog[open]', timeout=15000)
                check(f'{ua}: waits briefly for the install event', 'Einen Moment' in dialog_text(pg))
                pg.wait_for_function("() => !document.querySelector('dialog[open] .inst-wait')", timeout=6000)
                t = dialog_text(pg)
                check(f'{ua}: title "{title}"', pg.locator('dialog[open] .dlg-title').inner_text() == title)
                check(f'{ua}: steps mention "{want}"', want in t and pg.locator('dialog[open] [data-inst-go]').count() == 0, t)
                if ua == 'mac-safari':
                    check('mac-safari: three numbered steps incl. „Zum Dock hinzufügen …“', pg.locator('dialog[open] .inst-steps li').count() == 3 and 'Zum Dock hinzufügen' in t)
                if w < 700:
                    check(f'{ua}: no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                    btn = pg.locator('dialog[open] .dlg-actions .btn').bounding_box()
                    check(f'{ua}: close button inside the screen', btn and btn['x'] >= 0 and btn['x'] + btn['width'] <= w + 1, btn)
                clean(pg, ua)
                c.close()
        step('manual steps', manual)

        # 4. English UI
        def english():
            c, pg = ctx('win-edge', lang='en', fire=True)
            pg.goto(URL + '/app/?install=1'); pg.wait_for_selector('dialog[open] [data-inst-go]', timeout=15000); pg.wait_for_timeout(400)
            t = dialog_text(pg)
            check('en: "Install on this PC" / "Install now"', pg.locator('dialog[open] .dlg-title').inner_text() == 'Install on this PC' and 'Install now' in t, t)
            check('en: no German left in the dialog', not re.search(r'[äöüß„]|\b(und|oder|nicht|dein|Fenster|installieren)\b', t), t)
            pg.keyboard.press('Escape'); pg.evaluate("location.hash = '#/einstellungen'"); pg.wait_for_selector('[data-install-me] .inst-me', timeout=8000); pg.wait_for_timeout(400)
            card = pg.locator('[data-install-me]').inner_text()
            check('en: Ich entry translated', 'Install on this PC' in card and not re.search(r'[äöüß]', card), card)
            c.close()
            c, pg = ctx('mac-safari', lang='en')
            pg.goto(URL + '/app/?install=1'); pg.wait_for_selector('dialog[open]', timeout=15000)
            pg.wait_for_function("() => !document.querySelector('dialog[open] .inst-wait')", timeout=6000); pg.wait_for_timeout(300)
            t = dialog_text(pg)
            check('en: Safari steps use the English menu names (File › Add to Dock)', '“File”' in t and 'Add to Dock' in t and not re.search(r'[äöüß„]', t), t)
            clean(pg, 'en')
            c.close()
        step('english', english)

        # 5. one-time hint on desktop screens
        def hint():
            force = "try { localStorage.setItem('fale-install-hint-force', '1'); if (!localStorage.getItem('fale-install-starts')) localStorage.setItem('fale-install-starts', '1'); } catch (e) {}"
            c, pg = ctx('win-edge', extra=force, fire=True)
            pg.goto(URL + '/app/'); pg.wait_for_selector('.inst-hint', timeout=12000)
            box = pg.locator('.inst-hint').bounding_box()
            check('hint: shown bottom right, inside the window', box and box['x'] + box['width'] <= 1280 and box['y'] + box['height'] <= 800 and box['x'] > 600, box)
            check('hint: text', 'Auf diesem PC installieren' in pg.locator('.inst-hint').inner_text())
            pg.click('.inst-hint [data-hint-no]'); pg.wait_for_timeout(300)
            check('hint: "Nicht jetzt" removes it for good', pg.locator('.inst-hint').count() == 0 and pg.evaluate("localStorage.getItem('fale-install-hint')") == '1')
            pg.reload(); pg.wait_for_timeout(8500)
            check('hint: not shown again after a reload', pg.locator('.inst-hint').count() == 0)
            clean(pg, 'hint')
            c.close()
            # "Installieren" in the hint calls the browser prompt directly
            c, pg = ctx('win-edge', extra=force, fire=True)
            pg.goto(URL + '/app/'); pg.wait_for_selector('.inst-hint', timeout=12000)
            pg.click('.inst-hint [data-hint-go]'); pg.wait_for_timeout(600)
            check('hint: "Installieren" → prompt()', pg.evaluate('window.__bipCalls') == 1 and pg.locator('.inst-hint').count() == 0)
            c.close()
            # first start, phone, test browser without the force flag: no hint
            for label, ua, w, extra in (('first start', 'win-edge', 1280, "try { localStorage.setItem('fale-install-hint-force', '1'); } catch (e) {}"),
                                        ('phone', 'iphone', 390, force), ('automated browser', 'win-edge', 1280, "try { localStorage.setItem('fale-install-starts', '5'); } catch (e) {}")):
                c, pg = ctx(ua, w=w, h=844 if w < 700 else 800, extra=extra, fire=True)
                pg.goto(URL + '/app/'); pg.wait_for_timeout(8500)
                check(f'hint: none ({label})', pg.locator('.inst-hint').count() == 0)
                c.close()
        step('desktop hint', hint)

        # 6. already running as an installed app
        def standalone():
            mm = """const _mm = window.matchMedia.bind(window);
              window.matchMedia = q => /display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : _mm(q);"""
            c, pg = ctx('win-edge', extra=mm, fire=True)
            pg.goto(URL + '/app/?install=1'); pg.wait_for_timeout(2500)
            check('standalone: no install dialog', pg.locator('dialog[open]').count() == 0)
            check('standalone: says it is already open as an app', 'schon als App geöffnet' in pg.locator('.toasts').inner_text())
            pg.evaluate("location.hash = '#/einstellungen'"); pg.wait_for_selector('[data-install-me] .inst-me', timeout=8000)
            check('standalone (Windows): Ich offers "PDFs per Doppelklick öffnen"', 'PDFs per Doppelklick öffnen' in pg.locator('[data-install-me]').inner_text())
            pg.click('[data-inst-default]'); pg.wait_for_selector('dialog[open]', timeout=5000)
            t = dialog_text(pg)
            check('standalone: default-app steps (Öffnen mit › Andere App auswählen › Immer)', 'Öffnen mit' in t and 'Immer' in t and 'Standard-Apps' in t, t)
            clean(pg, 'standalone')
            c.close()
            c, pg = ctx('mac-safari', extra=mm)
            pg.goto(URL + '/app/#/einstellungen'); pg.wait_for_selector('[data-ai-me], [data-account-me]', state='attached', timeout=15000); pg.wait_for_timeout(1500)
            check('standalone (Mac): no install entry', pg.locator('[data-install-me] .inst-me').count() == 0)
            c.close()
        step('standalone', standalone)

        # 7. native app (Capacitor): nothing
        def native():
            nat = "window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };"
            c, pg = ctx('win-edge', extra=nat, fire=True)
            pg.goto(URL + '/app/?install=1'); pg.wait_for_timeout(3000)
            check('native: no install dialog for ?install=1', pg.locator('dialog[open] .inst').count() == 0)
            pg.evaluate("location.hash = '#/einstellungen'"); pg.wait_for_selector('[data-install-me]', state='attached', timeout=8000); pg.wait_for_timeout(1200)
            check('native: no install entry on Ich', pg.locator('[data-install-me] *').count() == 0)
            check('native: no hint', pg.locator('.inst-hint').count() == 0)
            c.close()
        step('native', native)

        # 8. manifest for the browser install dialog / store package
        def manifest():
            c, pg = ctx('win-edge')
            pg.goto(URL + '/app/'); pg.wait_for_selector('#view-start', timeout=15000)
            m = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
            shots = m.get('screenshots') or []
            for ff in ('wide', 'narrow'):
                s = [x for x in shots if x.get('form_factor') == ff]
                dims = [pg.evaluate("src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r(null); i.src = src; })", x['src']) for x in s]
                ok = s and all(d and f"{d[0]}x{d[1]}" == x['sizes'] and x['type'] == 'image/jpeg' for d, x in zip(dims, s))
                ratios = {round(d[0] / d[1], 3) for d in dims if d}
                check(f'manifest: {len(s)} {ff} screenshots load with the declared size', ok, list(zip([x['src'] for x in s], dims)))
                check(f'manifest: {ff} screenshots share one aspect ratio (≤ 2.3)', len(ratios) == 1 and all(max(r, 1 / r) <= 2.3 for r in ratios), ratios)
            check('manifest: description ≤ 324 characters (install dialog)', len(m.get('description', '')) <= 324)
            names = [s['name'] for s in m.get('shortcuts', [])]
            check('manifest: shortcuts "Datei öffnen" and "Dokument scannen" first', names[:2] == ['Datei öffnen', 'Dokument scannen'] and len(names) <= 10, names)
            check('manifest: id, launch_handler, file_handlers (pdf), edge_side_panel',
                  m.get('id') == './' and m.get('launch_handler') and any('.pdf' in sum(fh['accept'].values(), []) for fh in m['file_handlers']) and m.get('edge_side_panel', {}).get('preferred_width'))
            for s in m.get('shortcuts', []):
                pg.evaluate("h => { location.hash = h; }", s['url'][1:]); pg.wait_for_timeout(900)
                check(f"manifest: shortcut {s['name']} opens", pg.locator('.view:not([hidden]), #tool-screen:not([hidden])').count() > 0 and not pg.__errs, pg.__errs[:2])
            sw = pg.evaluate("fetch('sw.js').then(r => r.text())")
            check('service worker does not precache the screenshots', 'screenshots/' not in sw and './js/install.js' in sw and './css/install.css' in sw)
            c.close()
        step('manifest', manifest)
        b.close()
    ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
    print(f'\n{ok} passed, {len(bad)} failed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

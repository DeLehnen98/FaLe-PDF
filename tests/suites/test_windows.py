"""FaLe PDF für Windows (windows/, Tauri): the web app inside the Windows program + the Setup.exe download.
- files opened with the program (double click / „Öffnen mit“) arrive via window.__faleDesktopQueue and open in the app,
  also when they arrive later (second start) and with several files
- legal pages open in an in-app dialog; links to other sites go to the system browser (the shell intercepts navigation)
- no „install“ card inside the program; in Edge/Chrome on Windows the „Ich“ page offers the Setup.exe
- the Tauri project and the build workflow are consistent (version, file types, smoke test, release)
- the window's X asks the app first: nothing unsaved → „close“ at once; unsaved work → „wait“ + the question
  „Änderungen speichern?“ (Abbrechen keeps the window, Verwerfen closes, a second X while asking does not close);
  the program closes anyway when the page does not answer; files can be dragged into the window; the window
  remembers its size
- PC: every icon-only button names itself on hover; in a wide window the PDF view labels its buttons
Run: node tests/suites/sec/csp_server.mjs 9202 <repo> ; python3 tests/suites/test_windows.py"""
import base64, json, os, re, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
results = []


def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not info else f'  [{str(info)[:300]}]'), flush=True)


def poll(page, js, ms=8000):
    end = time.time() + ms / 1000
    while time.time() < end:
        try:
            if page.evaluate(js):
                return True
        except Exception:
            pass
        time.sleep(0.08)
    return False


PDF = base64.b64encode(open(os.path.join(HERE, 'purge/rl_std.pdf'), 'rb').read()).decode()
WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
# what the Windows program injects before the page (main.rs initialization_script) + a file from the command line
SHELL = "window.__FALE_DESKTOP__ = Object.freeze({ version: '2.5.0', os: 'windows' });"


def main():
    # ---------------- project consistency ----------------
    pkg = json.load(open(os.path.join(APP, 'package.json')))
    conf = json.load(open(os.path.join(APP, 'windows/src-tauri/tauri.conf.json')))
    cargo = open(os.path.join(APP, 'windows/src-tauri/Cargo.toml')).read()
    main_rs = open(os.path.join(APP, 'windows/src-tauri/src/main.rs')).read()
    wf = open(os.path.join(APP, '.github/workflows/windows.yml')).read()
    check('version: package.json = tauri.conf.json = Cargo.toml', conf['version'] == pkg['version'] and f'version = "{pkg["version"]}"' in cargo)
    exts = sorted(e for fa in conf['bundle']['fileAssociations'] for e in fa['ext'])
    check('„Öffnen mit“: PDF, Word, Excel, PowerPoint', exts == ['docx', 'pdf', 'pptx', 'xlsx'], exts)
    check('installer: NSIS, per user (no admin), German', conf['bundle']['targets'] == ['nsis'] and conf['bundle']['windows']['nsis']['installMode'] == 'currentUser' and 'German' in conf['bundle']['windows']['nsis']['languages'])
    check('loads only the app over HTTPS', 'const START: &str = "https://pdf.fale.network/app/";' in main_rs and 'url.path().starts_with("/app")' in main_rs and 'open::that_detached' in main_rs)
    check('second start hands files to the open window (single instance)', 'tauri_plugin_single_instance::init' in main_rs and 'deliver(&w, file_args(&argv))' in main_rs)
    check('no secrets in the program', not re.search(r'(sk-[A-Za-z0-9]|api[_-]?key|secret)', main_rs + json.dumps(conf), re.I))
    check('workflow: smoke test (silent install, still running after 25 s) + release windows-latest',
          '/S' in wf and 'Start-Sleep -Seconds 25' in wf and 'HasExited' in wf and 'tag_name: windows-latest' in wf and 'FaLe-PDF-Setup.exe' in wf)

    check('X asks the app first, with a fallback when the page does not answer',
          'WindowEvent::CloseRequested' in main_rs and 'api.prevent_close()' in main_rs and 'window.__faleDesktopClose' in main_rs
          and 'CLOSE_PATIENCE' in main_rs and 'handle.exit(0)' in main_rs and 'const SIGNAL: &str = "/app/__desktop/";' in main_rs)
    check('an error page or a page that never loaded closes directly', 'if !on_app || w.eval(CLOSE_JS).is_err()' in main_rs)
    check('files can be dragged into the window (the app handles the drop)', '.disable_drag_drop_handler()' in main_rs)
    check('window size and position are remembered', 'tauri_plugin_window_state::Builder::default().build()' in main_rs and 'tauri-plugin-window-state = "2"' in cargo)
    check('workflow: the X closes the program, and it starts a second time', 'CloseMainWindow()' in wf and 'WaitForExit(15000)' in wf and 'second start' in wf)

    with sync_playwright() as p:
        br = p.chromium.launch()
        # ---------------- inside the Windows program ----------------
        ctx = br.new_context(viewport={'width': 1280, 'height': 820}, locale='de-DE', user_agent=WIN_UA)
        ctx.add_init_script(SHELL + f"window.__faleDesktopQueue = [['Mietvertrag.pdf', '{PDF}']];" + "try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}")
        ext = []
        ctx.route(re.compile(r'https://(www\.)?example\.org/.*'), lambda route: (ext.append(route.request.url), route.abort()))
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.goto(URL)
        page.wait_for_selector('#app', timeout=30000)
        opened = poll(page, "location.hash.startsWith('#/ansicht/') && !document.querySelector('#viewer').hidden", 15000)
        names = page.evaluate("async () => (await (await import('./js/db.js')).listFiles()).map(d => d.name)")
        check('file from „Öffnen mit“ (queued before the app started): imported and opened', opened and 'Mietvertrag.pdf' in names, (page.url, names))
        check('desktop marker class', page.evaluate("document.documentElement.classList.contains('desktop-app')"))
        # a second file while the app runs (single instance → eval)
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(600)
        page.evaluate(f"(window.__faleDesktopQueue = window.__faleDesktopQueue || []).push(['Rechnung.pdf', '{PDF}'], ['Notiz.txt', btoa('Hallo Windows')]); if (window.__faleDesktopOpen) window.__faleDesktopOpen();")
        poll(page, "location.hash.startsWith('#/ansicht/') || location.hash.startsWith('#/bearbeiten/')", 15000)
        page.wait_for_timeout(800)
        names = page.evaluate("async () => (await (await import('./js/db.js')).listFiles()).map(d => d.name)")
        check('files arriving later (second start, two files): both imported', 'Rechnung.pdf' in names and any(n.startswith('Notiz') for n in names), names)
        page.evaluate("location.hash = '#/einstellungen'")
        page.wait_for_selector('[data-me-app]', timeout=8000)
        page.wait_for_timeout(800)
        check('inside the program: no „install“ card and no Setup.exe offer', page.locator('[data-install-me] .inst-me').count() == 0)
        page.locator('.me-legal [data-impressum]').click()
        check('legal page opens in an in-app dialog (no new window)', poll(page, "!!document.querySelector('dialog[open] .legal-page')", 8000))
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        # a link to another site: the app navigates, the program sends it to the system browser
        page.evaluate("""() => { const a = document.createElement('a'); a.href = 'https://example.org/hilfe'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'x'; a.id = 'ext-link'; document.body.appendChild(a); }""")
        pages_before = len(ctx.pages)
        page.locator('#ext-link').click()
        page.wait_for_timeout(1200)
        check('link with target=_blank: same window navigates (shell opens the browser), no popup', len(ctx.pages) == pages_before and any('example.org/hilfe' in u for u in ext), (len(ctx.pages), ext))
        check('no console errors (Windows program)', not [e for e in errs if 'example.org' not in e and 'ERR_FAILED' not in e], errs[:4])
        ctx.close()

        # ---------------- Edge on Windows (no program): Setup.exe offered on „Ich“ ----------------
        ctx = br.new_context(viewport={'width': 1280, 'height': 820}, locale='de-DE', user_agent=WIN_UA)
        ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}")
        page = ctx.new_page()
        page.goto(URL + '#/einstellungen')
        page.wait_for_selector('[data-install-me] .inst-me', timeout=15000)
        page.wait_for_timeout(500)
        exe = page.locator('[data-inst-exe]')
        check('Edge on Windows: „Als Windows-Programm herunterladen“ next to „Installieren“',
              exe.count() == 1 and exe.get_attribute('href') == 'https://github.com/DeLehnen98/FaLe-PDF/releases/download/windows-latest/FaLe-PDF-Setup.exe', exe.count())
        check('no shell marker in a normal browser', not page.evaluate("document.documentElement.classList.contains('desktop-app')"))
        ctx.close()
        ctx = br.new_context(viewport={'width': 1280, 'height': 820}, locale='de-DE', user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')
        ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}")
        page = ctx.new_page()
        page.goto(URL + '#/einstellungen')
        page.wait_for_selector('[data-me-app]', timeout=15000)
        page.wait_for_timeout(800)
        check('Mac: no Setup.exe offer', page.locator('[data-inst-exe]').count() == 0)
        ctx.close()

        # ---------------- the window's X: the program calls __faleDesktopClose(), the app answers ----------------
        ctx = br.new_context(viewport={'width': 1280, 'height': 820}, locale='de-DE', user_agent=WIN_UA)
        ctx.add_init_script(SHELL + f"window.__faleDesktopQueue = [['Mietvertrag.pdf', '{PDF}']];" + "try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); localStorage.setItem('fale-hints-off', '1'); } catch (e) {}")
        sig = []
        # the program cancels these page changes; here they are answered with „no content“, which also keeps the page
        ctx.route(re.compile(r'.*/app/__desktop/.*'), lambda route: (sig.append(route.request.url.rsplit('/', 1)[-1]), route.fulfill(status=204, body='')))
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        beforeunload = []
        page.on('dialog', lambda d: (beforeunload.append(d.type), d.accept()))
        page.goto(URL)
        page.wait_for_selector('#app', timeout=30000)
        poll(page, "location.hash.startsWith('#/ansicht/') && !document.querySelector('#viewer').hidden", 15000)
        check('the app offers the close hook to the program', page.evaluate("typeof window.__faleDesktopClose === 'function'"))
        r = page.evaluate('window.__faleDesktopClose()'); page.wait_for_timeout(600)
        check('nothing unsaved: X → „close“ at once, no question', r == 'close' and sig == ['close'] and page.locator('dialog[open]').count() == 0, (r, sig))
        check('the page is still alive after the message (the program cancels the page change)', page.evaluate("!!document.querySelector('#viewer') && typeof window.__faleDesktopClose === 'function'"))
        # wide window: the buttons on top of the PDF say what they do; icon-only buttons name themselves on hover
        caps = page.evaluate("""() => [...document.querySelectorAll('.viewer .vbar-top .v-actions .icon-btn')].filter(b => b.getClientRects().length).map(b => getComputedStyle(b, '::after').content.replace(/"/g, ''))""")
        check('wide window: every button on top of the PDF view has its name', len(caps) >= 9 and all(c and c != 'none' for c in caps) and 'Drucken' in caps and 'Suchen' in caps, caps)
        over = page.evaluate("(() => { const bar = document.querySelector('.viewer .vbar-top'); const t = bar.querySelector('.v-title').getBoundingClientRect(); return { title: Math.round(t.width), over: bar.scrollWidth - bar.clientWidth, h: Math.round(bar.getBoundingClientRect().height) }; })()")
        check('… and the file name keeps its room', over['title'] >= 240 and over['over'] <= 0 and over['h'] <= 72, over)
        page.locator('.viewer .vbar-bottom [data-v="zoomin"]').hover(); page.wait_for_timeout(200)
        check('icon-only button: hover shows its name', page.evaluate("document.querySelector('.viewer .vbar-bottom [data-v=zoomin]').title") == 'Vergrößern')
        page.set_viewport_size({'width': 900, 'height': 700}); page.wait_for_timeout(300)
        caps = page.evaluate("""() => [...document.querySelectorAll('.viewer .vbar-top .v-actions .icon-btn')].filter(b => b.getClientRects().length).map(b => getComputedStyle(b, '::after').content)""")
        check('medium window: icons only (names on hover), nothing squeezed', all(c == 'none' for c in caps), caps)
        page.set_viewport_size({'width': 1280, 'height': 820})

        # unsaved page order in „Seiten verwalten“
        doc = page.evaluate("location.hash.split('/').pop()")
        sig.clear()
        page.evaluate(f"location.hash = '#/werkzeug/seiten?doc={doc}'")
        page.wait_for_selector('.pcard', timeout=20000); page.wait_for_timeout(600)
        page.locator('.pcard .icon-btn[aria-label*="drehen"]').first.click(); page.wait_for_timeout(400)
        page.evaluate('window.__faleDesktopRes = null; window.__faleDesktopClose().then(r => { window.__faleDesktopRes = r; }); 0')
        asked = poll(page, "!!document.querySelector('dialog[open]')", 5000)
        t = page.locator('dialog[open]').inner_text() if asked else ''
        check('unsaved work: X → „wait“ and the question „Änderungen speichern?“', asked and sig == ['wait'] and 'Änderungen speichern?' in t and 'Verwerfen' in t and 'Speichern' in t, (sig, t[:80]))
        r2 = page.evaluate('window.__faleDesktopClose()'); page.wait_for_timeout(300)
        check('a second X while the question is open: still „wait“, no close', r2 == 'wait' and 'close' not in sig and page.locator('dialog[open]').count() == 1, (r2, sig))
        page.locator('dialog[open] button', has_text='Abbrechen').click(); page.wait_for_timeout(500)
        check('„Abbrechen“: the window stays, the tool and the work too', page.evaluate('window.__faleDesktopRes') == 'stay' and 'close' not in sig and page.locator('.pcard').count() > 0 and 'Ungespeicherte' in page.locator('#tool-screen').inner_text(), (page.evaluate('window.__faleDesktopRes'), sig))
        sig.clear()
        page.evaluate('window.__faleDesktopRes = null; window.__faleDesktopClose().then(r => { window.__faleDesktopRes = r; }); 0')
        poll(page, "!!document.querySelector('dialog[open]')", 5000)
        page.locator('dialog[open] button', has_text='Verwerfen').click(); page.wait_for_timeout(600)
        check('„Verwerfen“: → „close“', page.evaluate('window.__faleDesktopRes') == 'close' and sig == ['wait', 'close'], (page.evaluate('window.__faleDesktopRes'), sig))
        check('no „leave page?“ warning of the browser gets in the way', beforeunload == [], beforeunload)

        # a Word document with unsaved text: „Speichern“ saves, then closes
        sig.clear()
        page.evaluate("location.hash = '#/neu/dokument'")
        opened = poll(page, "!!document.querySelector('.doc-page[contenteditable]')", 15000)
        if not opened:
            page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(500)
            if page.locator('dialog[open] button', has_text='Verwerfen').count(): page.locator('dialog[open] button', has_text='Verwerfen').click()
        else:
            page.wait_for_timeout(800)
            page.locator('.doc-page[contenteditable]').first.click(); page.keyboard.type('Sehr geehrte Damen und Herren'); page.wait_for_timeout(500)
            page.evaluate('window.__faleDesktopRes = null; window.__faleDesktopClose().then(r => { window.__faleDesktopRes = r; }); 0')
            poll(page, "!!document.querySelector('dialog[open]')", 5000)
            page.locator('dialog[open] button', has_text='Speichern').click()
            done = poll(page, "window.__faleDesktopRes === 'close'", 8000)
            saved = page.evaluate("async () => { const db = await import('./js/db.js'); const { getDocBytes } = await import('./js/library.js'); const d = (await db.listFiles()).filter(x => x.kind === 'docx').sort((a, b) => b.updated - a.updated)[0]; return d ? (await getDocBytes(d.id)).length : 0; }")
            check('Word editor: „Speichern“ in the question saves the document, then → „close“', done and sig == ['wait', 'close'] and saved > 1000, (done, sig, saved))
        check('editor route for the close test opened', opened)
        check('no console errors (closing the window)', not errs, errs[:4])
        ctx.close()
        br.close()

    # landing page + FaleNetwork page link to the Setup.exe
    land = open(os.path.join(APP, 'site/index.html'), encoding='utf-8').read()
    net = open(os.path.join(APP, 'network/apps/pdf/index.html'), encoding='utf-8').read()
    check('landing page (all languages) and FaleNetwork page link the Setup.exe', 'data-setup-exe' in land and 'FaLe-PDF-Setup.exe' in land and 'FaLe-PDF-Setup.exe' in net)

    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

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
- the program has its own look („Schreibtisch & Register“, css/windows.css): index tabs on top, one sheet, a status
  bar, the start page in two columns, DIN type for titles; light and dark; three window sizes without sideways
  scrolling; „Klassisch“ in the settings brings the old look back; a normal browser never gets the new look;
  moving through the tabs, a document and a tool does not stall (worst stall < 700 ms at CPU ×4)
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

        # ---------------- the look of the Windows program: „Schreibtisch & Register“ ----------------
        import test_nav_stress as N
        ctx = br.new_context(viewport={'width': 1280, 'height': 820}, locale='de-DE', user_agent=WIN_UA)
        ctx.add_init_script(SHELL + N.WATCH + f"window.__faleDesktopQueue = [['Mietvertrag.pdf', '{PDF}']];" + "try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); localStorage.setItem('fale-hints-off', '1'); } catch (e) {}")
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        cdp = ctx.new_cdp_session(page)
        page.goto(URL)
        page.wait_for_selector('#app', timeout=30000)
        poll(page, "location.hash.startsWith('#/ansicht/') && !document.querySelector('#viewer').hidden", 15000)
        doc = page.evaluate("location.hash.split('/').pop()")
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(1200)
        LOOK = """() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
          const cs = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : ''; };
          return { cls: document.documentElement.className, side: r('.sidebar'), main: r('.main-col'), tabs: [...document.querySelectorAll('.side-nav .nav-link')].map(a => Math.round(a.getBoundingClientRect().top + a.getBoundingClientRect().height)),
            tabsX: [...document.querySelectorAll('.side-nav .nav-link')].map(a => Math.round(a.getBoundingClientRect().left)), active: cs('.nav-link.active', 'backgroundColor'), sheet: cs('.main-col', 'backgroundColor'), desk: cs('.app', 'backgroundColor'),
            foot: r('.side-foot'), footText: (document.querySelector('.side-foot') || {}).innerText || '', homeMain: r('#view-start .home-main'), homeSide: r('#view-start .home-side'),
            tiles: [...document.querySelectorAll('#view-start .home-side .tile')].filter(t => t.getClientRects().length).length, h1: cs('#view-start .hero h1', 'fontFamily'), body: cs('body', 'fontFamily'),
            radius: cs('.btn-primary', 'borderRadius'), heroBorder: cs('#view-start .hero', 'borderTopStyle'), drop: cs('#view-start .hero-drop', 'display'), bnav: cs('.bottom-nav', 'display'),
            hs: document.documentElement.scrollWidth - innerWidth, vs: document.documentElement.scrollHeight - innerHeight, ih: innerHeight, iw: innerWidth }; }"""
        L = page.evaluate(LOOK)
        check('inside the program: the Windows look is on before anything is clicked', 'win-ui' in L['cls'].split() and 'desktop-app' in L['cls'].split(), L['cls'])
        check('index tabs on top: the navigation is one row above the sheet', L['side'][1] == 0 and L['side'][3] <= 60 and L['side'][2] >= 1200 and max(L['tabs']) - min(L['tabs']) <= 2 and L['tabsX'] == sorted(L['tabsX']) and len(L['tabsX']) == 5, (L['side'], L['tabs'], L['tabsX']))
        check('the tab in front is paper white and attached to the sheet; the desk is another colour', L['active'] == L['sheet'] and L['desk'] != L['sheet'] and abs(L['tabs'][0] - L['main'][1]) <= 2, (L['active'], L['sheet'], L['desk'], L['tabs'][0], L['main'][1]))
        check('status bar at the bottom says where the files are and which program this is', L['foot'] and L['foot'][1] + L['foot'][3] >= L['ih'] - 2 and L['foot'][3] <= 34 and 'Gerät' in L['footText'] and 'Windows 2.5.0' in L['footText'], (L['foot'], L['footText']))
        check('start page: files on the sheet, tasks as a list at the side', L['homeMain'] and L['homeSide'] and L['homeSide'][0] >= L['homeMain'][0] + L['homeMain'][2] and abs(L['homeSide'][1] - L['homeMain'][1]) <= 2 and L['tiles'] == 8, (L['homeMain'], L['homeSide'], L['tiles']))
        check('the tray invites to drag a file in', L['heroBorder'] == 'dashed' and L['drop'] == 'block')
        check('type: DIN (Bahnschrift) for titles, Segoe UI for text; crisp corners', L['h1'].startswith('Bahnschrift') and 'Segoe UI' in L['body'] and L['radius'] in ('5px', '4px', '6px'), (L['h1'][:40], L['body'][:40], L['radius']))
        check('no sideways or page scrolling in the default window', L['hs'] <= 0 and L['vs'] <= 0, (L['hs'], L['vs']))
        inner = page.evaluate("(() => { const d = document.createElement('div'); d.className = 'doc-page'; const a = document.createElement('h1'), b = document.createElement('h2'); a.textContent = 'x'; b.textContent = 'y'; d.append(a, b); document.body.appendChild(d); const r = [a, b].map(e => getComputedStyle(e).fontFamily + '|' + getComputedStyle(e).fontStretch); d.replaceWith(); return r; })()")
        check('headings inside a document keep their own type (the look never changes what is in a file)', all('Bahnschrift' not in x and x.endswith('|100%') for x in inner), inner)
        # keyboard: every stop shows where the focus is (the flat look must not swallow the focus ring)
        page.evaluate("document.querySelector('.sidebar .brand').focus()")
        rings = []
        for _ in range(14):
            page.keyboard.press('Tab'); page.wait_for_timeout(40)
            rings.append(page.evaluate("(() => { const e = document.activeElement; const s = getComputedStyle(e); return [e.className.toString().split(' ').slice(0, 2).join('.') || e.tagName, s.boxShadow !== 'none' || (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)]; })()"))
        check('keyboard focus is visible on tabs, buttons, the search field and the lists', len(rings) == 14 and all(r[1] for r in rings), [r for r in rings if not r[1]] or rings[:3])
        tipbtn = page.evaluate("(() => { const d = document.createElement('div'); d.className = 'ftip'; const f = document.createElement('div'); f.className = 'ftip-foot'; const b = document.createElement('button'); b.className = 'btn btn-ghost btn-sm'; b.textContent = 'x'; f.append(b); d.append(f); document.body.append(d); const s = getComputedStyle(b); const r = [s.backgroundColor, s.color]; d.replaceWith(); return r; })()")
        check('tip bubble: „Keine Tipps mehr“ stays light text on the dark bubble', tipbtn[0] in ('rgba(0, 0, 0, 0)', 'transparent') and tipbtn[1] != 'rgb(20, 24, 43)', tipbtn)
        # the colour of the tab follows the area
        cols = {}
        for nav in ('start', 'dateien', 'werkzeuge', 'suche', 'einstellungen'):
            page.evaluate(f"location.hash = '#/{nav}'"); page.wait_for_timeout(500)
            cols[nav] = page.evaluate("getComputedStyle(document.querySelector('.nav-link.active'), '::before').backgroundColor")
        check('every area has its own index colour', len(set(cols.values())) == 5 and all(c and c != 'rgba(0, 0, 0, 0)' for c in cols.values()), cols)
        # contrast of the tab texts (front and back) against their tab
        CON = """() => { const lum = c => { const a = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
          const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
          const rgb = s => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1); g.fillStyle = s; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
          return [...document.querySelectorAll('.side-nav .nav-link')].map(a => { const s = getComputedStyle(a); const f = rgb(s.color), b = rgb(s.backgroundColor); const L1 = lum(f), L2 = lum(b); return +((Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)).toFixed(2); }); }"""
        con = page.evaluate(CON)
        check('tab names are easy to read on their tabs (contrast ≥ 4.5)', min(con) >= 4.5, con)
        # dark
        page.evaluate("document.documentElement.dataset.theme = 'dark'"); page.wait_for_timeout(300)
        D = page.evaluate(LOOK); cond = page.evaluate(CON)
        check('dark: desk and sheet turn dark, the tab in front stays attached, names readable', D['sheet'] != L['sheet'] and D['desk'] != L['desk'] and D['active'] == D['sheet'] and min(cond) >= 4.5, (D['sheet'], D['desk'], cond))
        page.evaluate("document.documentElement.dataset.theme = 'light'")
        # other window sizes
        page.evaluate("location.hash = '#/start'")
        for w, h in ((960, 680), (1600, 900)):
            page.set_viewport_size({'width': w, 'height': h}); page.wait_for_timeout(400)
            M = page.evaluate(LOOK)
            fits = all(x >= 0 for x in M['tabsX']) and M['side'][2] <= w
            check(f'window {w}×{h}: tabs in one row, nothing runs out of the window', M['hs'] <= 0 and max(M['tabs']) - min(M['tabs']) <= 2 and fits and M['bnav'] == 'none', (M['hs'], M['tabs'], M['side']))
        page.set_viewport_size({'width': 420, 'height': 620}); page.wait_for_timeout(400)
        M = page.evaluate(LOOK)
        check('smallest window (420 px): the compact layout with the same colours and type, no sideways scrolling', M['hs'] <= 0 and M['bnav'] != 'none' and M['h1'].startswith('Bahnschrift') and (M['side'] is None or M['side'][2] == 0), (M['hs'], M['bnav'], M['side']))
        page.set_viewport_size({'width': 1280, 'height': 820}); page.wait_for_timeout(300)

        # moving around does not stall (CPU ×4): tabs, a document, a tool, back
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        page.evaluate('window.__d.length = 0')
        for hsh, sel in (('#/dateien', '#view-dateien .doc, #view-dateien .file-row'), ('#/werkzeuge', '#view-werkzeuge .tool-card, #view-werkzeuge [data-tool]'), (f'#/ansicht/{doc}', '#viewer .page canvas'), ('#/start', '#view-start .hero'),
                         (f'#/werkzeug/seiten?doc={doc}', '.pcard'), ('#/einstellungen', '[data-me-app]'), ('#/suche', '#view-suche input'), ('#/start', '#view-start .hero')):
            page.evaluate(f"location.hash = {json.dumps(hsh)}")
            try: page.wait_for_selector(sel, timeout=20000)
            except Exception: pass
            page.wait_for_timeout(500)
        gaps = [g for _, g in page.evaluate('window.__d')]
        worst = max(gaps or [0])
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        check(f'moving through tabs, a document and a tool does not stall (worst {worst} ms < 700)', worst < 700, worst)

        # „Klassisch“ brings the old look back, „Register“ the new one
        page.evaluate("location.hash = '#/einstellungen/allgemein'")
        page.wait_for_selector('[data-winui-row]', timeout=10000)
        pressed = page.evaluate("[...document.querySelectorAll('[data-winui-opt]')].map(b => b.dataset.winuiOpt + ':' + b.getAttribute('aria-pressed'))")
        check('settings: „Aussehen des Programms“ shows the current look', pressed == ['on:true', 'classic:false'], pressed)
        page.locator('[data-winui-opt="classic"]').click()
        page.wait_for_load_state('load'); page.wait_for_selector('#app', timeout=30000); page.wait_for_timeout(1500)
        C = page.evaluate(LOOK)
        check('„Klassisch“: the look of the app in the browser is back (navigation at the left), and it stays after a restart', 'win-ui' not in C['cls'].split() and C['side'][3] > 400 and C['side'][2] < 400 and C['homeSide'] is None, (C['cls'], C['side'], C['homeSide']))
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('[data-winui-row]', timeout=10000)
        page.locator('[data-winui-opt="on"]').click()
        page.wait_for_load_state('load'); page.wait_for_selector('#app', timeout=30000); page.wait_for_timeout(1500)
        check('„Register“: the Windows look is back', 'win-ui' in page.evaluate('document.documentElement.className').split())
        # a PDF without a single page (the old test file of the build): a clear message, no endless „wird geladen“
        empty = base64.b64encode(b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n").decode()
        n_before = page.evaluate("async () => (await (await import('./js/db.js')).listFiles()).length")
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(400)
        page.evaluate(f"(window.__faleDesktopQueue = window.__faleDesktopQueue || []).push(['leer.pdf', '{empty}']); window.__faleDesktopOpen();")
        said = poll(page, "/enthält keine Seiten/.test((document.querySelector('#toasts') || document.body).innerText)", 8000)
        page.wait_for_timeout(600)
        st = page.evaluate("async () => ({ n: (await (await import('./js/db.js')).listFiles()).length, viewer: !document.querySelector('#viewer').hidden, hash: location.hash })")
        check('PDF without pages: „… enthält keine Seiten“, nothing imported, no endless loading', said and st['n'] == n_before and not st['viewer'], (said, st))
        errs[:] = [e for e in errs if 'Invalid page request' not in e and 'keine Seiten' not in e]
        check('no console errors (Windows look)', not errs, errs[:4])
        ctx.close()

        # a normal browser never gets the Windows look – and has no switch for it
        ctx = br.new_context(viewport={'width': 1280, 'height': 820}, locale='de-DE', user_agent=WIN_UA)
        ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}")
        page = ctx.new_page()
        page.goto(URL + '#/einstellungen/allgemein'); page.wait_for_selector('.settings-row', timeout=30000); page.wait_for_timeout(800)
        B = page.evaluate("({ cls: document.documentElement.className, row: document.querySelectorAll('[data-winui-row]').length, side: document.querySelector('.sidebar').getBoundingClientRect().height, font: getComputedStyle(document.body).fontFamily, drop: getComputedStyle(document.querySelector('.hero-drop') || document.body).display })")
        check('normal browser: the look of the web app, no switch, no Windows styles', 'win-ui' not in B['cls'].split() and B['row'] == 0 and B['side'] > 400 and not B['font'].startswith('"Segoe UI Variable'), B)
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

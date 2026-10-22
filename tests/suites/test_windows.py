"""FaLe PDF für Windows (windows/, Tauri): the web app inside the Windows program + the Setup.exe download.
- files opened with the program (double click / „Öffnen mit“) arrive via window.__faleDesktopQueue and open in the app,
  also when they arrive later (second start) and with several files
- legal pages open in an in-app dialog; links to other sites go to the system browser (the shell intercepts navigation)
- no „install“ card inside the program; in Edge/Chrome on Windows the „Ich“ page offers the Setup.exe
- the Tauri project and the build workflow are consistent (version, file types, smoke test, release)
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

"""⋮ menus with direct editing, first-visit tips and the FaLe Pro extras (2026-11).
- file menu (Dateien): file on top, rename right in the menu (extension kept, list updates), four big quick actions
  (star toggles), groups (Bearbeiten / Umwandeln & mehr / Teilen & senden / Ordnen), „Löschen“ last
- folder menu: rename in place, subfolder quick action
- viewer menu: quick row, search filters items + hides empty groups, switches (Nachtmodus) keep the menu open,
  rename in the head updates the viewer title
- office editor menu: head with rename, quick row, groups, autosave switch
- tips: one bubble at a time, counter, „Weiter“ → next, each tip only once, „Keine Tipps mehr“ switches them off,
  Ich → Einstellungen brings them back; never on top of a dialog
- FaLe Pro: web shows no Pro row and no Pro page in the intro; Android shows the honest Pro page (marked PRO),
  the „App-Farbe“ row (marked PRO, locked colours explain first), Pro active → colour applied, Pro ended → back to default
- server: Pro reads longer documents (api/_lib/tasks.js forPlan)
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, base64, json, subprocess, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
SUITES = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SUITES, '..', '..'))
OUT = os.path.join(SUITES, 'out_menus_hints')
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


IMPORT = """async ([b64, name, mime]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const { importFiles } = await import('./js/library.js'); const [d] = await importFiles([new File([bin], name, { type: mime })], { source: 'Test', any: true, quiet: true }); return d.id; }"""
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
PDF = os.path.join(SUITES, 'formcheck', 'antrag.pdf')
DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
NATIVE = "window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { AdMob: { initialize: async () => {}, addListener: async () => ({ remove() {} }) } } };"
DOCS = "async () => { const db = await import('./js/db.js'); return (await (db.listFiles || db.listDocs)()).map(d => ({ id: d.id, name: d.name, starred: !!d.starred })); }"


def ctx_page(browser, label, init='', **kw):
    ctx = browser.new_context(locale='de-DE', **kw)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}" + init)
    page = ctx.new_page()
    page.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.goto(URL + '#/start')
    page.wait_for_selector('#view-start .hero', timeout=30000)
    return ctx, page


def run(p):
    browser = p.chromium.launch()

    # ------------------------------------------------------------------ menus (phone)
    ctx, page = ctx_page(browser, 'menus', viewport={'width': 412, 'height': 860}, is_mobile=True, has_touch=True)
    st = {}

    def file_menu():
        st['pdf'] = page.evaluate(IMPORT, [b64(PDF), 'Antrag Wohngeld.pdf', 'application/pdf'])
        page.evaluate("location.hash = '#/dateien'"); page.wait_for_selector('#view-dateien [data-files] .doc', timeout=10000); page.wait_for_timeout(500)
        row = page.locator('#view-dateien [data-files] .doc', has_text='Antrag Wohngeld').first
        row.locator('.more-btn').tap()
        page.wait_for_selector('.menu-layer.open .menu-head', timeout=5000)
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(OUT, 'file_menu.png'))
        secs = [x.strip() for x in page.locator('.menu-sec').all_inner_texts()]
        quick = [x.strip() for x in page.locator('.menu-quick .mq-btn').all_inner_texts()]
        items = [x.strip().split('\n')[0] for x in page.locator('.menu .menu-item').all_inner_texts()]
        check('file menu: the file on top (name + pages/size)', page.locator('.menu-head .mh-title').inner_text() == 'Antrag Wohngeld.pdf' and 'Seite' in page.locator('.menu-head .mh-sub').inner_text())
        check('file menu: 4 quick actions (Öffnen, Teilen, Stern setzen, In Ordner)', quick == ['Öffnen', 'Teilen', 'Stern setzen', 'In Ordner'], quick)
        check('file menu: groups in a clear order', secs[:2] == ['Bearbeiten', 'Umwandeln & mehr'] and 'Teilen & senden' in secs and secs[-1] == 'Ordnen', secs)
        check('file menu: edit actions with a short explanation', page.locator('.menu-item', has_text='PDF bearbeiten').locator('small').inner_text() == 'Text ändern oder hinzufügen')
        check('file menu: „Löschen“ is the last item', items[-1] == 'Löschen', items[-3:])
        g = page.evaluate("() => { const m = document.querySelector('.menu-layer .menu'); const r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, sheet: !!document.querySelector('.menu-layer.as-sheet') }; }")
        check('file menu: bottom sheet inside the screen on a phone', g['sheet'] and g['top'] >= 0 and g['bottom'] <= g['h'], g)
        hs = page.evaluate("() => [...document.querySelectorAll('.menu .menu-item, .menu .mq-btn')].map(b => b.getBoundingClientRect().height)")
        check('file menu: every row is a big touch target (≥ 48 px)', min(hs) >= 48, min(hs))
        # rename right in the menu
        page.locator('.menu-head .mh-edit').tap()
        inp = page.locator('.mh-form .input')
        page.wait_for_timeout(250)
        sel = page.evaluate("() => { const i = document.querySelector('.mh-form .input'); return [i.selectionStart, i.selectionEnd, document.activeElement === i]; }")
        check('rename: the name is selected without „.pdf“ and has focus', sel == [0, len('Antrag Wohngeld'), True], sel)
        inp.fill('  ')
        page.locator('.mh-form button[type=submit]').tap()
        page.wait_for_timeout(300)
        check('rename: an empty name is refused, the form stays', page.locator('.mh-form').count() == 1 and 'leer' in page.locator('#toasts').inner_text())
        inp.fill('Wohngeld 2026: Antrag')
        inp.press('Enter')
        page.wait_for_timeout(600)
        names = [d['name'] for d in page.evaluate(DOCS)]
        check('rename: saved with „.pdf“, bad characters replaced', 'Wohngeld 2026 Antrag.pdf' in names, names)
        check('rename: the head shows the new name, menu stays open', page.locator('.menu-head .mh-title').text_content() == 'Wohngeld 2026 Antrag.pdf' and page.locator('.menu-layer').count() == 1, page.locator('.menu-head .mh-title').text_content())
        check('rename: the list behind the menu updates', page.locator('#view-dateien .doc-name', has_text='Wohngeld 2026').count() == 1)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        check('Escape closes the menu after renaming', page.locator('.menu-layer').count() == 0)
        # star from the quick row
        page.locator('#view-dateien [data-files] .doc', has_text='Wohngeld').first.locator('.more-btn').tap()
        page.wait_for_selector('.menu-layer.open .mq-btn')
        page.locator('.mq-btn', has_text='Stern setzen').tap(); page.wait_for_timeout(500)
        d = [x for x in page.evaluate(DOCS) if x['id'] == st['pdf']][0]
        check('quick „Stern setzen“ stars the file (and closes the menu)', d['starred'] and page.locator('.menu-layer').count() == 0)
        page.locator('#view-dateien [data-files] .doc', has_text='Wohngeld').first.locator('.more-btn').tap()
        page.wait_for_selector('.menu-layer.open .mq-btn')
        check('quick button shows the state (pressed, „Stern entfernen“)', page.locator('.mq-btn[aria-pressed="true"]', has_text='Stern entfernen').count() == 1)
        page.locator('.menu-layer').tap(position={'x': 20, 'y': 20}); page.wait_for_timeout(300)
        # an action from a group opens the right tool
        page.locator('#view-dateien [data-files] .doc', has_text='Wohngeld').first.locator('.more-btn').tap()
        page.wait_for_selector('.menu-layer.open .menu-item')
        page.locator('.menu-item', has_text='Seiten verwalten').tap()
        page.wait_for_function("location.hash.startsWith('#/werkzeug/seiten?doc=')", timeout=5000)
        check('group item opens its tool with the file', True)
        page.evaluate("location.hash = '#/dateien'"); page.wait_for_timeout(800)
    step('file menu', file_menu)

    def folder_menu():
        page.locator('#view-dateien [data-newfolder]').tap()
        page.locator('dialog input').fill('Steuer')
        page.locator('dialog .btn-primary').tap(); page.wait_for_timeout(600)
        t = page.locator('.folder-tile[data-folder]', has_text='Steuer')
        t.locator('button').tap()
        page.wait_for_selector('.menu-layer.open .menu-head')
        quick = [x.strip() for x in page.locator('.menu-quick .mq-btn').all_inner_texts()]
        check('folder menu: head + quick (Öffnen, Unterordner)', page.locator('.menu-head .mh-title').inner_text() == 'Steuer' and quick == ['Öffnen', 'Unterordner'], quick)
        page.locator('.menu-head .mh-edit').tap()
        page.locator('.mh-form .input').fill('Steuer 2026')
        page.locator('.mh-form .input').press('Enter'); page.wait_for_timeout(600)
        check('folder menu: rename in place', page.locator('.menu-head .mh-title').inner_text() == 'Steuer 2026')
        page.keyboard.press('Escape'); page.wait_for_timeout(500)
        check('folder tile shows the new name', page.locator('.folder-tile[data-folder]', has_text='Steuer 2026').count() == 1)
    step('folder menu', folder_menu)

    def viewer_menu():
        page.evaluate(f"location.hash = '#/ansicht/{st['pdf']}'")
        page.wait_for_selector('.pdfViewer .page canvas', timeout=30000); page.wait_for_timeout(600)
        page.locator('[data-v="more"]').tap()
        page.wait_for_selector('.menu-layer.open .menu-search input')
        page.screenshot(path=os.path.join(OUT, 'viewer_menu.png'))
        quick = [x.strip() for x in page.locator('.menu-quick .mq-btn').all_inner_texts()]
        check('viewer menu: quick row Unterschreiben, Text einfügen, Teilen, Lesezeichen', quick == ['Unterschreiben', 'Text einfügen', 'Teilen', 'Lesezeichen'], quick)
        secs = [x.strip() for x in page.locator('.menu-sec').all_inner_texts()]
        check('viewer menu: groups', secs == ['Bearbeiten', 'Lesen & Ansicht', 'Umwandeln & mehr', 'Teilen & senden'], secs)
        page.locator('.menu-search input').fill('word')
        page.wait_for_timeout(200)
        vis = page.evaluate("() => [...document.querySelectorAll('.menu .menu-item')].filter(b => !b.hidden).map(b => b.textContent.trim())")
        vsec = page.evaluate("() => [...document.querySelectorAll('.menu .menu-sec')].filter(b => !b.hidden).map(b => b.textContent.trim())")
        check('search: only matching actions + their group', vis == ['PDF zu Word'] and vsec == ['Umwandeln & mehr'] and page.locator('.menu-quick').is_hidden(), (vis, vsec))
        page.locator('.menu-search input').fill('')
        page.wait_for_timeout(200)
        night = page.locator('.menu-item', has_text='Nachtmodus')
        check('Nachtmodus is a switch (off)', night.get_attribute('role') == 'menuitemcheckbox' and night.get_attribute('aria-checked') == 'false')
        night.tap(); page.wait_for_timeout(300)
        check('switch on: viewer dark, menu stays open', night.get_attribute('aria-checked') == 'true' and 'night' in page.locator('#viewer').get_attribute('class') and page.locator('.menu-layer').count() == 1)
        night.tap(); page.wait_for_timeout(300)
        check('switch off again', 'night' not in page.locator('#viewer').get_attribute('class'))
        page.locator('.menu-head .mh-edit').tap()
        page.locator('.mh-form .input').fill('Wohngeld fertig')
        page.locator('.mh-form .input').press('Enter'); page.wait_for_timeout(600)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        check('viewer: rename in the menu updates the title', 'Wohngeld fertig' in page.locator('[data-v="title"]').inner_text())
        page.locator('[data-v="back"]').tap(); page.wait_for_timeout(600)
    step('viewer menu', viewer_menu)

    def office_menu():
        page.evaluate("location.hash = '#/neu/dokument'")
        page.wait_for_selector('.doc-page[contenteditable]', timeout=20000); page.wait_for_timeout(600)
        page.locator('.doc-page[contenteditable]').click(); page.keyboard.type('Hallo')
        page.locator('[data-office-save]').tap(); page.wait_for_timeout(900)
        page.locator('[data-office-more]').tap()
        page.wait_for_selector('.menu-layer.open .menu-head')
        quick = [x.strip() for x in page.locator('.menu-quick .mq-btn').all_inner_texts()]
        check('editor menu: quick row (Als PDF, Teilen, Suchen, Kopie)', quick == ['Als PDF', 'Teilen', 'Suchen', 'Kopie'], quick)
        check('editor menu: autosave is a switch', page.locator('.menu-item[role="menuitemcheckbox"]', has_text='Automatisch speichern').count() == 1)
        page.locator('.menu-head .mh-edit').tap()
        page.locator('.mh-form .input').fill('Brief an Oma')
        page.locator('.mh-form .input').press('Enter'); page.wait_for_timeout(600)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        tt, nn = page.locator('.office-head .title-btn').text_content(), [d['name'] for d in page.evaluate(DOCS)]
        check('editor: rename from the menu → title + library', tt == 'Brief an Oma.docx' and 'Brief an Oma.docx' in nn, (tt, nn))
    step('office menu', office_menu)
    ctx.close()

    # ------------------------------------------------------------------ tips
    ctx, page = ctx_page(browser, 'hints', "localStorage.setItem('fale-hints-force', '1');", viewport={'width': 412, 'height': 860}, is_mobile=True, has_touch=True)

    def hints():
        page.wait_for_selector('.ftip.open', timeout=8000)
        check('start: exactly one tip bubble', page.locator('.ftip').count() == 1)
        check('start: first tip points at „Datei öffnen“', 'öffnest' in page.locator('.ftip-txt').inner_text() and page.locator('#view-start [data-action="open-file"].ftip-target').count() == 1)
        check('tip shows a counter', page.locator('.ftip-n').inner_text() == 'Tipp 1 von 3')
        page.screenshot(path=os.path.join(OUT, 'hint_start.png'))
        check('page stays usable under the tip (no overlay)', page.evaluate("() => { const r = document.querySelector('#home-search').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 10, r.top + r.height / 2); return !!(e && (e.id === 'home-search' || e.closest('.top-search') || e.closest('.ftip'))); }"))
        page.locator('[data-ftip-ok]').tap(); page.wait_for_timeout(700)
        check('„Weiter“ → second tip (search)', 'Suche' in page.locator('.ftip-txt').inner_text() and page.locator('.ftip').count() == 1)
        seen = page.evaluate("JSON.parse(localStorage.getItem('fale-hints-seen') || '[]')")
        check('shown tips are remembered', 'start-open' in seen and 'start-search' in seen, seen)
        page.evaluate("location.hash = '#/dateien'"); page.wait_for_timeout(300)
        check('changing the page closes the bubble', page.locator('.ftip.open').count() == 0)
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(2500)
        txt = page.locator('.ftip-txt').all_inner_texts()
        check('back on Start: the seen tips do not come again', not any('öffnest' in x or 'Suche findet' in x for x in txt), txt)
        if page.locator('.ftip').count():
            page.locator('[data-ftip-off]').tap(); page.wait_for_timeout(400)
        else:
            page.evaluate("localStorage.setItem('fale-hints-off', '1')")
        page.evaluate("location.hash = '#/werkzeuge'"); page.wait_for_timeout(2500)
        check('„Keine Tipps mehr“ → no tips anywhere', page.locator('.ftip').count() == 0 and page.evaluate("localStorage.getItem('fale-hints-off')") == '1')
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('[data-hints-toggle]')
        check('settings: switch shows „off“', not page.locator('[data-hints-toggle]').is_checked())
        page.locator('[data-hints-reset]').tap(); page.wait_for_timeout(300)
        check('„Alle Tipps wieder zeigen“ turns them on again', page.locator('[data-hints-toggle]').is_checked() and page.evaluate("localStorage.getItem('fale-hints-off')") is None and page.evaluate("localStorage.getItem('fale-hints-seen')") is None)
        page.evaluate("location.hash = '#/werkzeuge'"); page.wait_for_selector('.ftip.open', timeout=8000)
        check('Werkzeuge: tip about the areas', 'Bereich' in page.locator('.ftip-txt').inner_text())
        check('web: no Pro tip (Pro is not offered on the web)', page.evaluate("JSON.parse(localStorage.getItem('fale-hints-seen') || '[]')").count('tools-pro') == 0)
        page.locator('[data-ftip-ok]').tap(); page.wait_for_timeout(300)
        # a dialog open → no tip on top of it
        page.evaluate("() => { import('./js/ui.js').then(m => m.confirmDialog('Test', 'Dialog offen')); }"); page.wait_for_timeout(300)
        page.evaluate("location.hash = '#/einstellungen'"); page.wait_for_timeout(2500)
        check('no tip while a dialog is open', page.locator('.ftip').count() == 0)
    step('tips', hints)
    ctx.close()

    # ------------------------------------------------------------------ Pro: web vs Android
    ctx, page = ctx_page(browser, 'web-pro', viewport={'width': 412, 'height': 860}, is_mobile=True, has_touch=True)

    def web_pro():
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('[data-hints-toggle]')
        check('web: no „App-Farbe“ (no paid offer on the web)', page.locator('[data-accent-row]').count() == 0)
        page.evaluate("localStorage.removeItem('fale-onboarded'); import('./js/extras/onboarding.js').then(m => m.showOnboarding())")
        page.wait_for_selector('.onboard'); page.wait_for_timeout(400)
        check('web intro: no Pro page, privacy page says „keine Werbung“', page.locator('.ob-step-pro').count() == 0 and 'keine Werbung' in page.locator('.ob-step[data-step="2"]').inner_text())
    step('web: no Pro', web_pro)
    ctx.close()

    ctx, page = ctx_page(browser, 'android-pro', NATIVE, viewport={'width': 412, 'height': 860}, is_mobile=True, has_touch=True)

    def android_pro():
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('[data-accent-row]')
        row = page.locator('[data-accent-row]')
        check('Android: „App-Farbe“ marked PRO, 6 colours, extras locked', row.locator('.pro-tag').inner_text() == 'PRO' and row.locator('.accent-sw').count() == 6 and row.locator('.accent-sw.locked').count() == 5)
        row.locator('[data-accent="wald"]').tap(); page.wait_for_selector('dialog[open]')
        txt = page.locator('dialog[open]').inner_text()
        check('locked colour: explains first (Pro extra, PDF stays free) – no purchase screen jump', 'Extra von FaLe Pro' in txt and 'kostenlos' in txt and 'Nicht jetzt' in txt)
        page.locator('dialog[open] button', has_text='Nicht jetzt').tap(); page.wait_for_timeout(300)
        check('„Nicht jetzt“ stays here, colour unchanged', page.evaluate('location.hash') == '#/einstellungen/allgemein' and page.evaluate("document.documentElement.dataset.accent || ''") == '')
        page.evaluate("localStorage.removeItem('fale-onboarded'); import('./js/extras/onboarding.js').then(m => m.showOnboarding())")
        page.wait_for_selector('.onboard'); page.wait_for_timeout(400)
        n = page.locator('.ob-step').count()
        check('Android intro: Pro page exists, dots match the pages', page.locator('.ob-step-pro').count() == 1 and page.locator('.ob-dots span').count() == n, n)
        for _ in range(n):
            if page.locator('.ob-step-pro:not([hidden])').count(): break
            page.locator('[data-next]').tap(); page.wait_for_timeout(300)
        pt = page.locator('.ob-step-pro').inner_text()
        check('Pro page: honest („Alles Wichtige ist kostenlos“, freiwillig) and shows the PRO mark', 'Alles Wichtige ist kostenlos' in pt and 'freiwillig' in pt and page.locator('.ob-step-pro .pro-tag').count() >= 2)
        check('Pro page comes before the last page („Was möchtest du zuerst tun?“)', page.locator('.ob-step').nth(n - 2).get_attribute('class').find('ob-step-pro') >= 0)
        page.screenshot(path=os.path.join(OUT, 'intro_pro.png'))
        page.locator('[data-skip]').tap(); page.wait_for_timeout(400)
        # Pro active → the colour can be chosen and is applied; Pro ends → default again
        page.evaluate("localStorage.setItem('fale-plus-info', JSON.stringify({ lifetime: true })); import('./js/monetize.js').then(m => m.syncProMark())")
        page.evaluate("location.hash = '#/einstellungen'"); page.wait_for_timeout(300)
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('[data-accent-row]'); page.wait_for_timeout(300)
        check('Pro: colours unlocked', page.locator('[data-accent-row] .accent-sw.locked').count() == 0)
        page.locator('[data-accent-row] [data-accent="wald"]').tap(); page.wait_for_timeout(300)
        prim = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()")
        check('Pro: „Wald“ applied at once', page.evaluate("document.documentElement.dataset.accent") == 'wald' and prim.lower() == '#1e6b3a' and page.locator('[data-accent="wald"][aria-checked="true"]').count() == 1, prim)
        page.reload(); page.wait_for_selector('.view:not([hidden])', timeout=20000); page.wait_for_timeout(800)
        check('colour kept after restart', page.evaluate("document.documentElement.dataset.accent") == 'wald')
        page.evaluate("localStorage.removeItem('fale-plus-info'); localStorage.removeItem('fale-ai-quota'); import('./js/monetize.js').then(m => m.syncProMark())"); page.wait_for_timeout(300)
        check('Pro ended: default colour again (choice kept for later)', page.evaluate("document.documentElement.dataset.accent || ''") == '' and page.evaluate("localStorage.getItem('fale-accent')") == 'wald')
    step('Android: Pro extras', android_pro)
    ctx.close()
    browser.close()


def api_pro():
    js = """const T = require('./api/_lib/tasks.js'); const long = 'Ein Satz mit Inhalt. '.repeat(8000);
const free = T.TASKS.summarize.prepare({ text: long }, {}), pro = T.forPlan(T.TASKS.summarize, 'summarize', true).prepare({ text: long }, {});
const tr = T.forPlan(T.TASKS.translate, 'translate', true), letter = T.forPlan(T.TASKS.letter, 'letter', true);
console.log(JSON.stringify({ free: free.user.length, pro: pro.user.length, trMax: tr.maxInput, trBase: T.TASKS.translate.maxInput, letterSame: letter === T.TASKS.letter, notPlus: T.forPlan(T.TASKS.summarize, 'summarize', false) === T.TASKS.summarize }));"""
    r = json.loads(subprocess.run(['node', '-e', js], cwd=REPO, capture_output=True, text=True, check=True).stdout)
    check('API: Pro reads 2.5× longer documents for summaries', r['pro'] > 2.4 * r['free'] and r['free'] < 49000, r)
    check('API: translate part size doubles with Pro', r['trMax'] == 2 * r['trBase'], r)
    check('API: tasks without a Pro limit stay the same; without Pro nothing changes', r['letterSame'] and r['notPlus'], r)


if __name__ == '__main__':
    step('api', api_pro)
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} passed')
    for n, c, i in results:
        if not c:
            print('  FAIL', n, i[:300])

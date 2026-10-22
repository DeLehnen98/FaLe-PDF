"""„Ich“ as an overview with its own settings pages, storage + backup, the app's storage text, calendar export of a
deadline, the Werkzeuge list on phones and read-aloud in the Android app (js/speech-shim.js + FaleSpeech).
Run: node tests/suites/sec/csp_server.mjs 9202 <repo> ; python3 tests/suites/test_ich.py"""
import base64, io, json, os, re, sys, time, zipfile, subprocess, tempfile
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
results = []


def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not info else f'  [{str(info)[:300]}]'), flush=True)


def poll(page, js, ms=8000, arg=None):
    end = time.time() + ms / 1000
    while time.time() < end:
        try:
            if page.evaluate(js) if arg is None else page.evaluate(js, arg):
                return True
        except Exception:
            pass
        time.sleep(0.06)
    return False


ANDROID = """window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', convertFileSrc: x => x, Plugins: {} };"""
# Android WebView: no Web Speech API. The FaleSpeech mock answers like the native plugin (events via addListener).
SPEECH = """
Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true, writable: true });
delete window.speechSynthesis;
window.__sp = { calls: [], ls: [], avail: %(avail)s };
window.Capacitor.Plugins.FaleSpeech = {
  async isAvailable() { return { value: window.__sp.avail }; },
  async speak(o) { window.__sp.calls.push(['speak', o]); if (!window.__sp.avail) throw new Error('UNAVAILABLE');
    setTimeout(() => { window.__sp.ls.forEach(f => f({ id: o.id, type: 'start' })); setTimeout(() => window.__sp.ls.forEach(f => f({ id: o.id, type: 'end' })), 15); }, 10);
    return { id: o.id, langOk: true }; },
  async stop() { window.__sp.calls.push(['stop']); },
  addListener(ev, f) { if (ev === 'speech') window.__sp.ls.push(f); return Promise.resolve({ remove() {} }); },
};"""


def new_page(br, size=(390, 844), init='', downloads=False):
    mob = size[0] < 700
    ctx = br.new_context(viewport={'width': size[0], 'height': size[1]}, is_mobile=mob, has_touch=mob, locale='de-DE', accept_downloads=downloads)
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); localStorage.setItem('fale-ads-off', '1'); } catch (e) {}" + init)
    page = ctx.new_page()
    errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL)
    page.wait_for_selector('#app', timeout=30000)
    page.wait_for_timeout(1500)
    return ctx, page, errs


def go(page, h, sel=None, ms=900):
    page.evaluate(f"location.hash = '{h}'")
    if sel:
        page.wait_for_selector(sel, timeout=10000)
    page.wait_for_timeout(ms)


def import_pdf(page, name, folder=None):
    b = base64.b64encode(open(os.path.join(HERE, 'purge/rl_std.pdf'), 'rb').read()).decode()
    return page.evaluate("""async ([b64, name, folder]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const lib = await import('./js/library.js'); const d = await lib.importPdf(bin, { name, source: 'Test', silent: true });
      if (folder) { const O = await import('./js/extras/organize.js'); const f = await O.createFolder(folder); await O.moveDocsToFolder([d.id], f.id); }
      return d.id; }""", [b, name, folder])


def main():
    pkg = json.load(open(os.path.join(APP, 'package.json')))
    ver = re.search(r"APP_VERSION = '([^']+)'", open(os.path.join(APP, 'js/version.js')).read()).group(1)
    check('version shown in the app = package.json', ver == pkg['version'], (ver, pkg['version']))

    with sync_playwright() as p:
        br = p.chromium.launch()
        # ---------------- phone, web ----------------
        ctx, page, errs = new_page(br, downloads=True)
        go(page, '#/einstellungen', '[data-me-app]')
        check('Ich: overview with „Für dich“ (4) and „App“ (3) lists', page.locator('[data-me-links] .il-row').count() == 4 and page.locator('[data-me-app] .il-row').count() == 3)
        check('Ich: settings controls are not on the overview', page.locator('#set-lang').count() == 0 and page.locator('[data-clear]').count() == 0)
        check('Ich: no horizontal overflow (phone)', page.evaluate('document.documentElement.scrollWidth') <= 391)
        check('Ich: legal links stay one tap away', page.locator('#view-einstellungen .me-legal [data-impressum]').count() == 1)
        page.locator('[data-me-sub="allgemein"]').click()
        page.wait_for_selector('#set-lang', timeout=8000)
        page.wait_for_timeout(500)
        check('tap „Einstellungen“ → own page with the menus', page.url.endswith('#/einstellungen/allgemein') and page.locator('[data-simple-toggle]').count() == 1 and page.locator('[data-textsize-row]').count() == 1)
        check('settings page: „Ich“ stays active in the navigation', page.locator('.bottom-nav [data-nav="einstellungen"].active, .bnav [data-nav="einstellungen"].active, [data-nav="einstellungen"].active').count() >= 1)
        check('settings page: back button and title', page.locator('[data-me-back]').is_visible() and 'Einstellungen' in page.locator('#view-einstellungen .page-title').inner_text())
        page.locator('[data-theme-opt="dark"]').click()
        page.wait_for_timeout(400)
        check('theme switch on the settings page keeps the page', page.locator('#set-lang').count() == 1 and page.evaluate("document.documentElement.dataset.theme") == 'dark')
        page.locator('[data-theme-opt="auto"]').click()
        page.locator('[data-me-back]').click()
        poll(page, "location.hash === '#/einstellungen'", 4000)
        page.wait_for_timeout(500)
        check('back → overview', page.url.endswith('#/einstellungen') and page.locator('[data-me-app]').count() == 1)
        go(page, '#/einstellungen/quatsch', '[data-me-app]')
        check('unknown sub-page → overview', page.locator('[data-me-app]').count() == 1)
        # deep link straight into a sub-page: back goes to the overview, not out of the app
        page.goto(URL + '?deeplink=1#/einstellungen/info'); page.wait_for_selector('.license-list', timeout=15000); page.wait_for_timeout(800)
        check('Über: licences (incl. OCR parts) and legal rows', page.locator('.license-list li').count() >= 7 and page.locator('[data-privacy-link]').count() == 1)
        page.locator('[data-me-back]').click(); page.wait_for_timeout(800)
        check('deep link: back → „Ich“ overview', page.url.endswith('#/einstellungen') and page.locator('[data-me-app]').count() == 1, page.url)

        # storage: web browser asks, and a „no“ gets a calm explanation (not „install the app“)
        page.evaluate("navigator.storage.persist = async () => false; navigator.storage.persisted = async () => false;")
        go(page, '#/einstellungen/speicher', '[data-storage-me] .stat-row')
        check('Speicher (web): one „dauerhaft“ button, in the storage card', page.locator('[data-persist]').count() == 1 and page.locator('[data-storage-me] [data-persist]').count() == 1)
        page.locator('[data-persist]').click()
        page.wait_for_timeout(500)
        toast = page.locator('#toasts').inner_text()
        check('Speicher (web): refusal explained, backup suggested', 'entscheidet das selbst' in toast and 'Sicherung' in toast and 'Installiere' not in toast, toast)
        check('Speicher: OCR row and „Alles löschen“ on this page', poll(page, "!!document.querySelector('[data-ocr-slot] [data-ocr-row]')", 6000) and page.locator('[data-clear]').count() == 1)

        # backup ZIP with folders
        import_pdf(page, 'Brief.pdf')
        import_pdf(page, 'Bescheid.pdf', folder='Amt')
        go(page, '#/einstellungen/speicher', '[data-backup]')
        with page.expect_download(timeout=20000) as dl:
            page.locator('[data-backup]').click()
        path = dl.value.path()
        z = zipfile.ZipFile(path)
        names = sorted(n for n in z.namelist() if not n.endswith('/'))
        check('backup: one ZIP with every file, folders kept', names == ['Amt/Bescheid.pdf', 'Brief.pdf'] and dl.value.suggested_filename.startswith('FaLe PDF Sicherung'), (names, dl.value.suggested_filename))
        check('backup: files intact', all(z.read(n)[:5] == b'%PDF-' for n in names))
        page.wait_for_timeout(300)
        check('backup: „Letzte Sicherung“ shown', 'Letzte Sicherung' in page.locator('[data-backup-last]').inner_text(), page.locator('[data-backup-last]').inner_text())
        check('backup button ready again', not page.locator('[data-backup]').is_disabled())

        # calendar export of a deadline
        ics = page.evaluate("""async () => { const R = await import('./js/extras/reminders.js');
          return R.reminderIcs({ id: 'r1', title: 'Widerspruch, Bescheid; Amt', due: '2030-12-31', leads: [7, 1], yearly: true, note: 'Zeile 1\\nZeile 2' }, new Date('2030-01-01T10:00:00Z')); }""")
        lines = ics.split('\r\n')
        check('calendar: valid all-day event', 'BEGIN:VCALENDAR' in lines and 'DTSTART;VALUE=DATE:20301231' in lines and 'DTEND;VALUE=DATE:20310101' in lines and lines[-1] == '' and 'END:VCALENDAR' in lines, ics[:300])
        check('calendar: reminders 7 days and 1 day before (9:00) and on the day', 'TRIGGER:-PT159H' in lines and 'TRIGGER:-PT15H' in lines and 'TRIGGER:PT9H' in lines)
        check('calendar: yearly + escaped text', 'RRULE:FREQ=YEARLY' in lines and 'SUMMARY:Widerspruch\\, Bescheid\\; Amt' in lines and 'DESCRIPTION:Zeile 1\\nZeile 2' in lines, [l for l in lines if l.startswith(('SUMMARY', 'DESCRIPTION'))])
        check('calendar: lines folded at 75 bytes', all(len(l.encode()) <= 75 for l in lines))
        page.evaluate("""async () => { const R = await import('./js/extras/reminders.js'); await R.addReminder({ title: 'Kfz-Steuer', type: 'zahlung', due: '2030-06-30', leads: [7] }); }""")
        go(page, '#/fristen', '[data-more]')
        page.locator('[data-more]').first.click()
        item = page.locator('.menu-item', has_text='In meinen Kalender')
        item.first.wait_for(timeout=5000)
        check('Fristen: menu offers „In meinen Kalender“', item.count() == 1, item.count())
        with page.expect_download(timeout=10000) as dl2:
            item.click()
        check('Fristen: web downloads an .ics file', dl2.value.suggested_filename.endswith('.ics') and 'BEGIN:VEVENT' in open(dl2.value.path()).read())

        # Werkzeuge on phones: one grouped list per section
        go(page, '#/werkzeuge', '#view-werkzeuge .tool-grid .tool-card')
        gap = page.evaluate("getComputedStyle(document.querySelector('#view-werkzeuge .tool-grid')).rowGap")
        card = page.evaluate("getComputedStyle(document.querySelector('#view-werkzeuge .tool-grid .tool-card')).borderTopWidth")
        check('Werkzeuge (phone): grouped list – no gaps, no separate card borders', gap == '0px' and card == '0px', (gap, card))
        check('no console errors (phone, web)', not errs, errs[:4])
        ctx.close()

        # ---------------- desktop ----------------
        ctx, page, errs = new_page(br, size=(1280, 820))
        go(page, '#/einstellungen', '[data-me-app]')
        w = page.evaluate("document.querySelector('#view-einstellungen').getBoundingClientRect().width")
        check('desktop: „Ich“ keeps a readable width', w <= 861, w)
        page.keyboard.press('Tab')
        go(page, '#/einstellungen/allgemein', '#set-lang')
        check('desktop: settings page renders', page.locator('#set-zoom').count() == 1)
        check('no console errors (desktop)', not errs, errs[:4])
        ctx.close()

        # ---------------- Android app ----------------
        ctx, page, errs = new_page(br, init=ANDROID + SPEECH % {'avail': 'true'})
        go(page, '#/einstellungen/speicher', '[data-storage-me] .stat-row')
        check('app: no „Speicher dauerhaft machen“ (the WebView always says no)', page.locator('[data-persist]').count() == 0)
        check('app: says the files live in the app storage', 'Speicher der App' in page.locator('[data-storage-me]').inner_text())
        go(page, '#/dateien', '#view-dateien')
        check('app: Dateien page has no persist button either', page.locator('#view-dateien [data-persist]').count() == 0)
        page.evaluate("import('./js/views.js').then(m => m.requestPersist())")
        page.wait_for_timeout(400)
        check('app: persist request never shows „Browser hat abgelehnt“', 'abgelehnt' not in page.locator('#toasts').inner_text())
        go(page, '#/einstellungen/allgemein', '#set-lang')
        check('app (Android): „Werbe-Einwilligung“ row on the settings page', page.locator('[data-ads-me]').count() == 1)

        # read aloud through the system voice
        check('app: speechSynthesis provided by the shim', page.evaluate("!!window.speechSynthesis && window.__faleSpeechShim === true"))
        check('app: a German voice is offered', page.evaluate("speechSynthesis.getVoices().some(v => v.lang === 'de-DE')"))
        r = page.evaluate("""() => new Promise(done => { const u = new SpeechSynthesisUtterance('Guten Tag'); u.lang = 'de-DE'; u.rate = 1.25;
          const ev = []; u.onstart = () => ev.push('start'); u.onend = () => { ev.push('end'); done({ ev, calls: window.__sp.calls, speaking: speechSynthesis.speaking }); };
          speechSynthesis.speak(u); setTimeout(() => done({ ev, calls: window.__sp.calls, timeout: true }), 3000); })""")
        sp = [c for c in r['calls'] if c[0] == 'speak']
        check('app: speak → system voice with text, language and speed; start/end events', sp and sp[0][1]['text'] == 'Guten Tag' and sp[0][1]['lang'] == 'de-DE' and sp[0][1]['rate'] == 1.25 and r['ev'] == ['start', 'end'] and not r.get('timeout') and r['speaking'] is False, r)
        r = page.evaluate("""() => new Promise(done => { const u = new SpeechSynthesisUtterance('Lang'); let err = null; u.onerror = e => { err = e.error; };
          window.__sp.ls.length; const keep = window.__sp.ls.slice(); window.__sp.ls.length = 0; // engine slow: no events yet
          speechSynthesis.speak(u); setTimeout(() => { speechSynthesis.cancel(); setTimeout(() => { window.__sp.ls.push(...keep); done({ err, stop: window.__sp.calls.some(c => c[0] === 'stop') }); }, 30); }, 30); })""")
        check('app: cancel stops the system voice and ends the utterance (canceled)', r['err'] == 'canceled' and r['stop'], r)
        doc = import_pdf(page, 'Vorlesen.pdf')
        page.evaluate("window.__sp.calls.length = 0")
        go(page, f'#/ansicht/{doc}?vorlesen=1', None, 2500)
        said = page.evaluate("window.__sp.calls.filter(c => c[0] === 'speak').map(c => c[1].text)")
        check('app: viewer „Vorlesen“ reads the page through the system voice', len(said) >= 1 and len(''.join(said)) > 20, said[:2])
        page.evaluate("history.back()")
        page.wait_for_timeout(800)
        check('no console errors (Android app)', not errs, errs[:4])
        ctx.close()

        # Android without any voice: says so once, never hangs
        ctx, page, errs = new_page(br, init=ANDROID + SPEECH % {'avail': 'false'})
        r = page.evaluate("""() => new Promise(done => { const u = new SpeechSynthesisUtterance('Hallo'); u.onerror = e => done(e.error); u.onend = () => done('end');
          speechSynthesis.speak(u); setTimeout(() => done('timeout'), 3000); })""")
        page.wait_for_timeout(300)
        check('app without a voice: error event (no hang) and a hint where to set it up', r == 'synthesis-unavailable' and 'Sprachausgabe' in page.locator('#toasts').inner_text(), (r, page.locator('#toasts').inner_text()))
        ctx.close()

        # browsers and the iPhone app keep their own speech
        ctx, page, errs = new_page(br, init="window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', convertFileSrc: x => x, Plugins: {} };")
        check('iPhone app: no shim (WebKit speaks itself)', page.evaluate("!window.__faleSpeechShim"))
        ctx.close()
        ctx, page, errs = new_page(br)
        check('web: no shim', page.evaluate("!window.__faleSpeechShim && !!window.speechSynthesis"))
        ctx.close()
        br.close()

    # ---------------- Android project patch: FaleSpeech plugin + TTS query ----------------
    sys.path.insert(0, os.path.join(APP, 'tests/base/native')); sys.path.insert(0, os.path.join(APP, 'tests/base'))
    import fixture
    base = tempfile.mkdtemp(prefix='fale-speech-android-')
    andr = os.path.join(base, 'android'); fixture.make_android(andr)
    r = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr], capture_output=True, text=True)
    check('patch ok', r.returncode == 0, r.stderr[-400:])
    r = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr], capture_output=True, text=True)
    man = open(os.path.join(andr, 'app/src/main/AndroidManifest.xml')).read()
    check('manifest: TTS engine query (Android 11+), once after two runs', man.count('android.intent.action.TTS_SERVICE') == 1 and '<queries>' in man)
    java = {}
    for root, _, files in os.walk(os.path.join(andr, 'app/src/main/java')):
        for f in files:
            java[f] = open(os.path.join(root, f)).read()
    sp = java.get('FaleSpeechPlugin.java', '')
    check('FaleSpeechPlugin generated', '@CapacitorPlugin(name = "FaleSpeech")' in sp and 'QUEUE_ADD' in sp and 'notifyListeners("speech"' in sp and 'shutdown()' in sp)
    check('MainActivity registers FaleSpeech before super.onCreate', re.search(r'registerPlugin\(FaleSpeechPlugin\.class\);[\s\S]*super\.onCreate', java.get('MainActivity.java', '')))

    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

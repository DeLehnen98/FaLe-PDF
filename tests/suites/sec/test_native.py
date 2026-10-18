"""Native/Android packaging tests for FaLe PDF.

(a) js/platform.js in Playwright with a mocked window.Capacitor (Plugins API and raw bridge API),
    real tool flows (Komprimieren, Exportieren) → Filesystem.writeFile / Share; back button;
    notifications; incoming files; plus the unchanged plain-web behaviour.
(b) scripts/cap-patch-android.mjs against a fixture Capacitor project (+ idempotency, XML,
    javac compile of the generated Java against API stubs, icon PNGs).
(c) workflow YAML parse, node --check, native build target.

Needs: python3 -m http.server 8794 --bind 127.0.0.1 (cwd /home/claude/FalePDF).
"""
import os, sys, json, base64, hashlib, shutil, subprocess, tempfile, traceback, io, glob
import xml.etree.ElementTree as ET

SP = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SP, 'native'))
import fixture  # noqa: E402

APP = '/home/claude/FalePDF'
TD = os.path.join(SP, 'testdata')
import csp_compat  # noqa: F401,E402 – CSP-safe wait_for_function
URL = os.environ.get('NATIVE_URL', 'http://127.0.0.1:9408/')  # csp_server.mjs (vercel.json headers)
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
NM = '/opt/npm-tools/node_modules'

results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:500], flush=True)
        traceback.print_exc()


# =====================================================================================
# (a) platform.js in the browser
# =====================================================================================
MOCK_PLUGINS = r"""
(() => {
  const calls = []; window.__calls = calls;
  const fs = {}; window.__fs = fs;
  const listeners = {}; window.__listeners = listeners;
  const short = o => JSON.parse(JSON.stringify(o || {}, (k, v) => (k === 'data' && typeof v === 'string' && v.length > 120) ? `[b64:${v.length}]` : v));
  const rec = (plugin, method, opts) => calls.push({ plugin, method, opts: short(opts) });
  const addL = plugin => async (ev, cb) => { rec(plugin, 'addListener', { ev }); (listeners[plugin + ':' + ev] = listeners[plugin + ':' + ev] || []).push(cb); return { remove: async () => {} }; };
  const key = o => (o.directory || '') + '/' + o.path;
  window.__incoming = [{ name: 'bericht.pdf', mimeType: 'application/pdf', size: 1, path: '/data/user/0/dev.fale.pdf/cache/incoming/1-bericht.pdf' }];
  window.__skipped = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    convertFileSrc: p => location.origin + '/_capacitor_file_' + p.replace(/^file:\/\//, ''),
    Plugins: {
      Filesystem: {
        writeFile: async o => { rec('Filesystem', 'writeFile', o); fs[key(o)] = [o.data]; return { uri: 'file:///storage/mock/' + key(o) }; },
        appendFile: async o => { rec('Filesystem', 'appendFile', o); if (!fs[key(o)]) throw new Error('missing'); fs[key(o)].push(o.data); },
        stat: async o => { rec('Filesystem', 'stat', o); if (!fs[key(o)]) throw new Error('File does not exist'); return { type: 'file', size: 1, uri: 'file:///storage/mock/' + key(o) }; },
        getUri: async o => ({ uri: 'file:///storage/mock/' + key(o) }),
      },
      Share: { share: async o => { rec('Share', 'share', o); if (window.__shareCancel) throw new Error('Share canceled'); if (window.__shareFail) throw new Error('Something went wrong'); return {}; } },
      FalePrint: { printPdf: async o => { rec('FalePrint', 'printPdf', o); if (window.__printFail) throw new Error('printPdf failed'); return { started: true }; } },
      LocalNotifications: {
        checkPermissions: async () => { rec('LocalNotifications', 'checkPermissions'); return { display: window.__notifGranted ? 'granted' : 'prompt' }; },
        requestPermissions: async () => { rec('LocalNotifications', 'requestPermissions'); window.__notifGranted = true; return { display: 'granted' }; },
        schedule: async o => { rec('LocalNotifications', 'schedule', o); return { notifications: o.notifications.map(n => ({ id: n.id })) }; },
        cancel: async o => { rec('LocalNotifications', 'cancel', o); },
        addListener: addL('LocalNotifications'),
      },
      App: { addListener: addL('App'), exitApp: async () => rec('App', 'exitApp') },
      Haptics: { impact: async o => rec('Haptics', 'impact', o), notification: async o => rec('Haptics', 'notification', o) },
      FaleIncoming: {
        takePending: async () => { rec('FaleIncoming', 'takePending'); const files = window.__incoming, skipped = window.__skipped; window.__incoming = []; window.__skipped = []; return { action: window.__incomingAction || 'VIEW', files, skipped }; },
        release: async o => rec('FaleIncoming', 'release', o),
        readFile: async o => { rec('FaleIncoming', 'readFile', o); return { data: btoa('Hallo aus readFile') }; },
        setBarColors: async o => rec('FaleIncoming', 'setBarColors', o),
        addListener: addL('FaleIncoming'),
      },
    },
  };
})();
"""

# Raw bridge only (what Capacitor injects when @capacitor/core is not bundled)
MOCK_RAW = r"""
(() => {
  const calls = []; window.__calls = calls; const cbs = {}; window.__cbs = cbs; let n = 0;
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'android',
    nativePromise: (plugin, method, opts) => {
      calls.push({ plugin, method, opts: JSON.parse(JSON.stringify(opts || {}, (k, v) => (k === 'data' && typeof v === 'string' && v.length > 120) ? '[b64]' : v)) });
      if (plugin === 'Filesystem' && method === 'stat') return Promise.reject(new Error('File does not exist'));
      if (plugin === 'Filesystem' && method === 'writeFile') return Promise.resolve({ uri: 'file:///x/' + opts.path });
      if (plugin === 'FaleIncoming' && method === 'takePending') return Promise.resolve({ action: 'VIEW', files: [], skipped: [] });
      return Promise.resolve({});
    },
    nativeCallback: (plugin, method, opts, cb) => { const id = 'cb' + (++n); calls.push({ plugin, method, opts }); cbs[plugin + ':' + opts.eventName] = cb; return id; },
  };
})();
"""


def calls(page, plugin=None, method=None):
    cs = page.evaluate('window.__calls')
    return [c for c in cs if (plugin is None or c['plugin'] == plugin) and (method is None or c['method'] == method)]


def fs_bytes(page, key):
    chunks = page.evaluate(f'window.__fs[{json.dumps(key)}]')
    if chunks is None:
        return None
    return b''.join(base64.b64decode(c) for c in chunks)


def docs(page):
    return page.evaluate("""async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
      const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name}))); });
      db.close(); return res; }""")


def wait_toast(page, text, timeout=15000):
    page.locator('.toast', has_text=text).first.wait_for(timeout=timeout)


def fire(page, key, arg):
    return page.evaluate(f'window.__listeners[{json.dumps(key)}].forEach(cb => cb({json.dumps(arg)}))')


def native_plugins(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True, locale='de-DE', is_mobile=True, has_touch=True)
    ctx.add_init_script(MOCK_PLUGINS)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: (errors.append(str(e)), print('    pageerror at', page.url, str(e)[:120], (e.stack or '')[:600] if hasattr(e, 'stack') else '')))
    downloads = []
    page.on('download', lambda d: downloads.append(d.suggested_filename))
    pdf_bytes = open(os.path.join(TD, 'bericht.pdf'), 'rb').read()

    def cap_file(route):
        u = route.request.url
        if u.endswith('bericht.pdf'):
            route.fulfill(status=200, body=pdf_bytes, headers={'Content-Type': 'application/pdf'})
        elif u.endswith('unkomprimiert.pdf'):
            route.fulfill(status=200, body=open(os.path.join(TD, 'unkomprimiert.pdf'), 'rb').read(), headers={'Content-Type': 'application/pdf'})
        elif u.endswith('notiz.txt'):
            route.fulfill(status=200, body='Notiz aus WhatsApp\nZweite Zeile'.encode(), headers={'Content-Type': 'text/plain'})
        else:
            route.fulfill(status=404, body='')
    page.route('**/_capacitor_file_/**', cap_file)
    page.goto(URL)
    page.wait_for_selector('#view-start', state='attached')

    ids = {}

    def boot():
        check('isNative() true with mock', page.evaluate("import('/js/platform.js').then(m => m.isNative())"))
        check('html.is-native class', page.evaluate("document.documentElement.classList.contains('is-native')"))
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
        d = docs(page)
        check('cold-start incoming PDF imported', any(x['name'] == 'bericht.pdf' for x in d), str(d))
        ids['bericht'] = next(x['id'] for x in d if x['name'] == 'bericht.pdf')
        check('incoming opened in viewer', page.evaluate('location.hash') == f"#/ansicht/{ids['bericht']}")
        rel = calls(page, 'FaleIncoming', 'release')
        check('incoming copy released', rel and rel[0]['opts']['paths'] == ['/data/user/0/dev.fale.pdf/cache/incoming/1-bericht.pdf'], str(rel))
        check('filesReady listener registered', bool(calls(page, 'FaleIncoming', 'addListener')))
        check('backButton listener registered', any(c['opts'].get('ev') == 'backButton' for c in calls(page, 'App', 'addListener')))
        check('notification tap listener registered', any(c['opts'].get('ev') == 'localNotificationActionPerformed' for c in calls(page, 'LocalNotifications', 'addListener')))
        page.wait_for_timeout(500)
        regs = page.evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0")
        check('no service worker on native', regs == 0, str(regs))
        bars = calls(page, 'FaleIncoming', 'setBarColors')
        check('status bar colours set on start', bars and bars[-1]['opts']['color'].upper() == '#F2F3F9' and bars[-1]['opts']['dark'] is False, str(bars))
    step('native boot + incoming', boot)

    def incoming_event():
        page.evaluate("""window.__incoming = [{ name: 'notiz.txt', mimeType: 'text/plain', size: 30, path: '/data/user/0/dev.fale.pdf/cache/incoming/2-notiz.txt' }];
                         window.__skipped = [{ name: 'riesig.pdf', reason: 'too-large' }]; window.__incomingAction = 'SEND';""")
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(300)
        fire(page, 'FaleIncoming:filesReady', {'count': 2})
        wait_toast(page, 'zu groß')
        page.wait_for_function("""async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
            const n = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => d.name)); }); db.close(); return n.includes('notiz.txt'); }""", timeout=15000)
        check('shared .txt imported via filesReady event', True)
        check('too-large file reported', page.locator('.toast', has_text='riesig.pdf').count() >= 1)
        # readFile fallback when fetch(convertFileSrc) fails
        page.evaluate("""window.__incoming = [{ name: 'fallback.txt', mimeType: 'text/plain', size: 5, path: '/data/user/0/dev.fale.pdf/cache/incoming/3-fallback.bin' }];""")
        fire(page, 'FaleIncoming:filesReady', {'count': 1})
        page.wait_for_function("""async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
            const n = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => d.name)); }); db.close(); return n.includes('fallback.txt'); }""", timeout=15000)
        check('readFile fallback used when fetch fails', bool(calls(page, 'FaleIncoming', 'readFile')))
    step('incoming via event', incoming_event)

    def compress_save():
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(400)
        page.evaluate("""window.__incoming = [{ name: 'unkomprimiert.pdf', mimeType: 'application/pdf', size: 1, path: '/data/user/0/dev.fale.pdf/cache/incoming/4-unkomprimiert.pdf' }];""")
        fire(page, 'FaleIncoming:filesReady', {'count': 1})
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
        ids['unk'] = next(x['id'] for x in docs(page) if x['name'] == 'unkomprimiert.pdf')
        page.wait_for_timeout(1500)  # let the viewer finish loading (leaving it mid-load is a known pdf.js race, unrelated)
        page.evaluate(f"location.hash = '#/werkzeug/komprimieren?doc={ids['unk']}'")
        page.wait_for_selector('[data-run]', timeout=15000)
        page.locator('[data-run]').click()
        page.wait_for_selector('.result-card', timeout=30000)
        n0 = len(downloads)
        page.locator('.result-card [data-r="dl"]').last.click()
        wait_toast(page, 'Gespeichert in')
        w = [c for c in calls(page, 'Filesystem', 'writeFile') if c['opts'].get('directory') == 'DOCUMENTS']
        check('compress result → Filesystem.writeFile(DOCUMENTS)', len(w) == 1, str(w))
        path = w[0]['opts']['path']
        check('saved under "FaLe PDF/" with pdf name', path.startswith('FaLe PDF/') and path.endswith('.pdf') and w[0]['opts'].get('recursive') is True, path)
        check('binary write (no encoding param)', 'encoding' not in w[0]['opts'])
        data = fs_bytes(page, 'DOCUMENTS/' + path)
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(data))
        check('written base64 decodes to valid 6-page PDF', data[:5] == b'%PDF-' and len(r.pages) == 6, f'{len(data)} bytes')
        check('no browser download on native', len(downloads) == n0, str(downloads))
        toast = page.locator('.toast', has_text='Gespeichert in').first.inner_text()
        check('toast names Dokumente/FaLe PDF', 'Dokumente/FaLe PDF/' in toast, toast)
        # second save → unique name
        page.locator('.result-card [data-r="dl"]').last.click()
        page.wait_for_function("window.__calls.filter(c => c.method === 'writeFile' && c.opts.directory === 'DOCUMENTS').length >= 2", timeout=10000)
        w2 = [c for c in calls(page, 'Filesystem', 'writeFile') if c['opts'].get('directory') == 'DOCUMENTS'][1]['opts']['path']
        stem = path[:-4]
        check('second save gets " (2)" suffix', w2 == f'{stem} (2).pdf', w2)
        # share
        page.locator('.result-card [data-r="share"]').last.click()
        page.wait_for_function("window.__calls.some(c => c.plugin === 'Share')", timeout=10000)
        sh = calls(page, 'Share', 'share')[-1]['opts']
        cw = [c for c in calls(page, 'Filesystem', 'writeFile') if c['opts'].get('directory') == 'CACHE'][-1]['opts']
        check('share writes to cache share/<name>', cw['path'].startswith('share/') and cw['path'].endswith('.pdf'), cw['path'])
        check('Share.share gets the cache file uri', sh['files'] == ['file:///storage/mock/CACHE/' + cw['path']], json.dumps(sh))
        shared = fs_bytes(page, 'CACHE/' + cw['path'])
        check('shared bytes are the PDF', shared[:5] == b'%PDF-')
        # cancelled share → no error toast
        page.evaluate('window.__shareCancel = true')
        nerr = page.locator('.toast-error').count()
        page.locator('.result-card [data-r="share"]').last.click()
        page.wait_for_timeout(600)
        check('cancelled share shows no error', page.locator('.toast-error').count() == nerr)
        page.evaluate('window.__shareCancel = false')
    step('Komprimieren → save/share on native', compress_save)

    def export_txt():
        page.evaluate(f"location.hash = '#/werkzeug/exportieren?doc={ids['bericht']}'")
        page.wait_for_selector('[data-txt]', timeout=15000)
        page.locator('[data-txt]').click()
        page.wait_for_function("window.__calls.some(c => c.method === 'writeFile' && /\\.txt$/.test(c.opts.path) && c.opts.directory === 'DOCUMENTS')", timeout=20000)
        w = [c for c in calls(page, 'Filesystem', 'writeFile') if c['opts']['path'].endswith('.txt') and c['opts'].get('directory') == 'DOCUMENTS'][-1]['opts']
        txt = fs_bytes(page, 'DOCUMENTS/' + w['path']).decode('utf-8-sig')
        check('Exportieren text → FaLe PDF/bericht.txt', w['path'] == 'FaLe PDF/bericht.txt', w['path'])
        check('exported text content correct', 'Zitronenfalter' in txt and '===== Seite 6 =====' in txt)
    step('Exportieren → saveFile on native', export_txt)

    def chunked():
        r = page.evaluate("""async () => { const m = await import('/js/platform.js');
            const b = new Uint8Array(7 * 1024 * 1024 + 5); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 9)) & 255;
            const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b))).map(x => x.toString(16).padStart(2, '0')).join('');
            const res = await m.saveFile(b, 'gross/datei?.bin', 'application/octet-stream'); return { res, h }; }""")
        w = [c for c in calls(page, 'Filesystem') if 'gross datei' in c['opts'].get('path', '')]
        kinds = [c['method'] for c in w]
        check('7 MB save = stat + 1 writeFile + 2 appendFile', kinds == ['stat', 'writeFile', 'appendFile', 'appendFile'], str(kinds))
        data = fs_bytes(page, 'DOCUMENTS/FaLe PDF/gross datei .bin')
        check('chunked content byte-identical', data is not None and hashlib.sha256(data).hexdigest() == r['h'])
        check('saveFile resolves {ok, where}', r['res']['ok'] is True and r['res']['where'] == 'Dokumente/FaLe PDF/gross datei .bin', json.dumps(r['res']))
        # writeFile failure → share-sheet fallback
        r2 = page.evaluate("""async () => { const m = await import('/js/platform.js');
            const fs = window.Capacitor.Plugins.Filesystem; const orig = fs.writeFile;
            fs.writeFile = async o => { if (o.directory === 'DOCUMENTS') throw new Error('EACCES'); return orig(o); };
            try { return await m.saveFile(new Blob(['x'], {type: 'text/plain'}), 'kaputt.txt', 'text/plain'); } finally { fs.writeFile = orig; } }""")
        check('write failure falls back to share sheet', r2 == {'ok': True, 'where': 'share'} and calls(page, 'Share', 'share')[-1]['opts']['files'][0].endswith('share/kaputt.txt'), json.dumps(r2))
    step('chunked save + fallback', chunked)

    def viewer_print_share():
        # viewer → overflow menu → Drucken: PDF to cache/print + FalePrint.printPdf (no window.print on Android)
        page.evaluate("window.__printed = 0; window.print = () => { window.__printed++; window.__printStack = new Error().stack + ' | ' + location.hash + ' | ' + (document.activeElement && document.activeElement.outerHTML.slice(0, 120)) + ' | ' + (window.event && window.event.type); }; 0")
        page.evaluate(f"location.hash = '#/ansicht/{ids['bericht']}'")
        page.wait_for_selector('.pdfViewer .page canvas', timeout=20000)
        page.locator('[data-v="more"]').click()
        page.locator('.menu-layer .menu-item', has_text='Drucken').click()
        page.wait_for_function("window.__calls.some(c => c.plugin === 'FalePrint')", timeout=15000)
        pc = calls(page, 'FalePrint', 'printPdf')[-1]['opts']
        cw = [c for c in calls(page, 'Filesystem', 'writeFile') if c['opts'].get('directory') == 'CACHE' and c['opts']['path'].startswith('print/')][-1]['opts']
        check('print: PDF written to cache print/', cw['path'].endswith('bericht.pdf'), cw['path'])
        check('print: FalePrint.printPdf gets the cache uri + job name', pc['path'] == 'file:///storage/mock/CACHE/' + cw['path'] and pc['name'] == 'bericht', json.dumps(pc))
        check('print: bytes are the original PDF', fs_bytes(page, 'CACHE/' + cw['path']) == pdf_bytes)
        check('print: window.print not used on native', page.evaluate('window.__printed') == 0, str(page.evaluate('window.__printStack')))
        # plugin failure → share sheet as fallback (no dead button)
        page.evaluate('window.__printFail = true')
        n = len(calls(page, 'Share', 'share'))
        page.locator('[data-v="more"]').click()
        page.locator('.menu-layer .menu-item', has_text='Drucken').click()
        page.wait_for_function(f"window.__calls.filter(c => c.plugin === 'Share').length > {n}", timeout=15000)
        check('print failure falls back to the share sheet', calls(page, 'Share', 'share')[-1]['opts']['files'][0].endswith('bericht.pdf'))
        page.evaluate('window.__printFail = false')
        # Teilen from the viewer menu
        n = len(calls(page, 'Share', 'share'))
        page.locator('[data-v="more"]').click()
        page.locator('.menu-layer .menu-item', has_text='Teilen').first.click()
        page.wait_for_function(f"window.__calls.filter(c => c.plugin === 'Share').length > {n}", timeout=15000)
        sh = calls(page, 'Share', 'share')[-1]['opts']
        check('viewer Teilen → Share.share with the cache file', sh['files'] == ['file:///storage/mock/CACHE/share/bericht.pdf'] and sh.get('title') == 'bericht.pdf', json.dumps(sh))
        # a real failure → error toast with a "Herunterladen" way out
        page.evaluate('window.__shareFail = true')
        page.locator('[data-v="more"]').click()
        page.locator('.menu-layer .menu-item', has_text='Teilen').first.click()
        wait_toast(page, 'Teilen ist fehlgeschlagen')
        check('share failure: error toast', True)
        page.evaluate('window.__shareFail = false')
    step('viewer print/share on native', viewer_print_share)

    def edit_text_touch():
        page.evaluate(f"location.hash = '#/werkzeug/bearbeiten?doc={ids['bericht']}'")
        page.wait_for_selector('.pt-stage .pt-page canvas', timeout=20000)
        page.wait_for_timeout(500)
        b = page.locator('[data-tool="text"]').bounding_box()
        page.touchscreen.tap(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
        box = page.locator('.pt-stage .pt-page').first.bounding_box()
        page.touchscreen.tap(box['x'] + 60, box['y'] + 140)
        page.wait_for_timeout(300)
        page.keyboard.type('Touch Text')
        save = page.locator('.screen-foot button.btn-primary, button.btn-primary:has-text("Speichern")').last
        check('edit: Speichern enabled while still typing (no blur needed)', not save.is_disabled())
        sb = save.bounding_box()
        page.touchscreen.tap(sb['x'] + sb['width'] / 2, sb['y'] + sb['height'] / 2)
        page.wait_for_function("""async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
            const n = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => d.name)); }); db.close(); return n.some(x => x.includes('bearbeitet')); }""", timeout=15000)
        check('edit: first tap on Speichern saves', True)
    step('edit text with touch (native)', edit_text_touch)

    def notifications():
        r = page.evaluate("""async () => { const m = await import('/js/platform.js');
            return await m.scheduleNotification({ id: 'frist-1', at: new Date(Date.now() + 3600e3), title: 'Ausweis', body: 'läuft ab', route: '#/dateien' }); }""")
        check('scheduleNotification → true on native', r is True)
        check('permission requested lazily', bool(calls(page, 'LocalNotifications', 'requestPermissions')))
        s = calls(page, 'LocalNotifications', 'schedule')[-1]['opts']['notifications'][0]
        check('schedule payload (int id, extra.route, small icon)', isinstance(s['id'], int) and 0 < s['id'] < 2**31 and s['extra']['route'] == '#/dateien' and s['smallIcon'] == 'ic_stat_fale' and s['schedule']['allowWhileIdle'] is True, json.dumps(s))
        r2 = page.evaluate("import('/js/platform.js').then(m => m.scheduleNotification({ id: 1234567, at: Date.now() + 7200e3, title: 'Zahl' }))")
        check('numeric id kept as is', r2 is True and calls(page, 'LocalNotifications', 'schedule')[-1]['opts']['notifications'][0]['id'] == 1234567)
        lst = page.evaluate("import('/js/platform.js').then(m => m.listReminders().map(x => x.id))")
        check('reminders stored for in-app display', lst == ['frist-1', 1234567], str(lst))
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(300)
        fire(page, 'LocalNotifications:localNotificationActionPerformed', {'actionId': 'tap', 'notification': {'id': s['id'], 'extra': {'route': '#/dateien', 'reminderId': 'frist-1'}}})
        page.wait_for_function("location.hash === '#/dateien'", timeout=5000)
        check('tapping notification opens route', True)
        lst = page.evaluate("import('/js/platform.js').then(m => m.listReminders().map(x => x.id))")
        check('tapped reminder removed from list', lst == [1234567], str(lst))
        page.evaluate("import('/js/platform.js').then(m => m.cancelNotification(1234567))")
        page.wait_for_timeout(200)
        c = calls(page, 'LocalNotifications', 'cancel')[-1]['opts']
        check('cancelNotification → LocalNotifications.cancel', c == {'notifications': [{'id': 1234567}]}, json.dumps(c))
        due = page.evaluate("""import('/js/platform.js').then(m => { localStorage.setItem('fale-reminders', JSON.stringify([{id: 'a', at: Date.now() - 1000, title: 'fällig'}, {id: 'b', at: Date.now() + 1e6, title: 'später'}])); return m.dueReminders().map(x => x.id).concat(m.listReminders().map(x => x.id)); })""")
        check('dueReminders returns + removes due ones', due == ['a', 'b'], str(due))
    step('notifications on native', notifications)

    def haptics_theme():
        page.evaluate("import('/js/platform.js').then(m => { m.haptic('success'); m.haptic('light'); m.haptic('unknown'); })")
        page.wait_for_timeout(200)
        hp = [(c['method'], c['opts']) for c in calls(page, 'Haptics')]
        check('haptic → Haptics plugin', hp[:3] == [('notification', {'type': 'SUCCESS'}), ('impact', {'style': 'LIGHT'}), ('impact', {'style': 'LIGHT'})], str(hp))
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(300)
        page.locator('.topbar [data-action="toggle-theme"]').click()
        page.wait_for_function("window.__calls.filter(c => c.method === 'setBarColors').some(c => c.opts.dark === true)", timeout=5000)
        b = [c for c in calls(page, 'FaleIncoming', 'setBarColors') if c['opts']['dark']][-1]['opts']
        check('dark theme → dark bars with page bg colour', b['color'].upper() == '#0E0D23', json.dumps(b))
        page.locator('.topbar [data-action="toggle-theme"]').click()
        page.wait_for_function("(() => { const b = window.__calls.filter(c => c.method === 'setBarColors'); return b[b.length - 1].opts.dark === false; })()", timeout=5000)
        check('back to light bars', True)
    step('haptics + status bar', haptics_theme)

    def back_button():
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(300)
        page.evaluate(f"location.hash = '#/werkzeug/komprimieren?doc={ids['bericht']}'")
        page.wait_for_selector('[data-run]', timeout=15000)
        fire(page, 'App:backButton', {'canGoBack': True})
        page.wait_for_function("location.hash === '#/start'", timeout=5000)
        check('back from tool → previous route (#/start)', True)
        check('tool screen closed', page.locator('#tool-screen').is_hidden())
        # menu
        page.locator('.fab').click()
        page.wait_for_selector('.menu-layer')
        fire(page, 'App:backButton', {'canGoBack': True})
        page.wait_for_timeout(200)
        check('back closes menu first', page.locator('.menu-layer').count() == 0 and page.evaluate('location.hash') == '#/start')
        # dialog
        page.evaluate("import('/js/ui.js').then(m => { window.__dlg = m.confirmDialog('Test', 'Wirklich?'); })")
        page.wait_for_selector('dialog[open]')
        fire(page, 'App:backButton', {'canGoBack': True})
        page.wait_for_timeout(300)
        check('back closes dialog (resolves as cancel)', page.locator('dialog[open]').count() == 0 and page.evaluate('window.__dlg') is False)
        # legal page dialog
        page.evaluate("import('/js/platform.js').then(m => { m.openLegalPage('datenschutz.html'); })")
        page.wait_for_selector('dialog[open] .legal-page', timeout=5000)
        t = page.locator('dialog[open]').inner_text()
        check('openLegalPage shows privacy text in-app', 'Datenschutzerklärung' in t and 'Deine Dateien bleiben auf deinem Gerät' in t and 'Zurück zu FaLe PDF' not in t)
        fire(page, 'App:backButton', {'canGoBack': True})
        page.wait_for_timeout(300)
        check('back closes legal dialog', page.locator('dialog[open]').count() == 0)
        # custom interception
        page.evaluate("window.__intercept = e => e.preventDefault(); window.addEventListener('fale:back', window.__intercept, { once: true })")
        n_exit = len(calls(page, 'App', 'exitApp'))
        fire(page, 'App:backButton', {'canGoBack': True})
        page.wait_for_timeout(200)
        check("'fale:back' preventDefault intercepts", len(calls(page, 'App', 'exitApp')) == n_exit)
        # no web history but deep route → go to start
        page.evaluate("history.replaceState(null, '', '#/dateien'); window.dispatchEvent(new HashChangeEvent('hashchange'))")
        page.wait_for_timeout(300)
        fire(page, 'App:backButton', {'canGoBack': False})
        page.wait_for_function("location.hash === '#/start'", timeout=5000)
        check('canGoBack=false on sub page → start', True)
        fire(page, 'App:backButton', {'canGoBack': False})
        page.wait_for_timeout(200)
        check('back on start → App.exitApp', len(calls(page, 'App', 'exitApp')) == n_exit + 1)
    step('back button', back_button)

    real_errors = [e for e in errors if 'AbortError' not in e]
    check('no page errors (native mock)', not real_errors, '; '.join(real_errors)[:500])
    browser.close()


def native_raw(p):
    """Bare native bridge (Capacitor.nativePromise/nativeCallback, no @capacitor/core)."""
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE')
    ctx.add_init_script(MOCK_RAW)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero', timeout=15000)
    page.wait_for_timeout(500)

    def run():
        cs = page.evaluate('window.__calls')
        evs = {(c['plugin'], c['opts'].get('eventName')) for c in cs if c['method'] == 'addListener'}
        check('raw bridge: listeners via nativeCallback', ('App', 'backButton') in evs and ('FaleIncoming', 'filesReady') in evs and ('LocalNotifications', 'localNotificationActionPerformed') in evs, str(evs))
        check('raw bridge: takePending via nativePromise', any(c['plugin'] == 'FaleIncoming' and c['method'] == 'takePending' for c in cs))
        r = page.evaluate("import('/js/platform.js').then(m => m.saveFile(new Uint8Array([37, 80, 68, 70]), 'a.pdf', 'application/pdf'))")
        cs = page.evaluate('window.__calls')
        seq = [(c['plugin'], c['method'], c['opts'].get('path'), c['opts'].get('directory')) for c in cs if c['plugin'] == 'Filesystem']
        check('raw bridge: saveFile → stat + writeFile', seq == [('Filesystem', 'stat', 'FaLe PDF/a.pdf', 'DOCUMENTS'), ('Filesystem', 'writeFile', 'FaLe PDF/a.pdf', 'DOCUMENTS')] and r['ok'], str(seq))
        page.evaluate("location.hash = '#/werkzeuge'")
        page.wait_for_timeout(300)
        page.evaluate("window.__cbs['App:backButton']({ canGoBack: true })")
        page.wait_for_function("location.hash === '#/start'", timeout=5000)
        check('raw bridge: back button callback navigates', True)
        page.evaluate("window.__cbs['App:backButton']({ canGoBack: true })")
        page.wait_for_timeout(200)
        check('raw bridge: exitApp via nativePromise', any(c['plugin'] == 'App' and c['method'] == 'exitApp' for c in page.evaluate('window.__calls')))
    step('raw bridge', run)
    check('no page errors (raw bridge)', not errors, '; '.join(errors)[:400])
    browser.close()


def web(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True, locale='de-DE')
    ctx.grant_permissions(['notifications'], origin=URL.rstrip('/'))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: (errors.append(str(e)), print('    pageerror(web)', page.url, (e.stack or '')[:900])))
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')

    def run():
        check('web: isNative() false', page.evaluate("import('/js/platform.js').then(m => m.isNative())") is False)
        check('web: no is-native class', not page.evaluate("document.documentElement.classList.contains('is-native')"))
        page.set_input_files('#pdf-input', [os.path.join(TD, 'bericht.pdf')])
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
        did = next(x['id'] for x in docs(page) if x['name'] == 'bericht.pdf')
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(400)
        page.set_input_files('#pdf-input', [os.path.join(TD, 'unkomprimiert.pdf')])
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
        uid = next(x['id'] for x in docs(page) if x['name'] == 'unkomprimiert.pdf')
        page.wait_for_timeout(1500)
        page.evaluate(f"location.hash = '#/werkzeug/komprimieren?doc={uid}'")
        page.wait_for_selector('[data-run]')
        page.locator('[data-run]').click()
        page.wait_for_selector('.result-card', timeout=30000)
        with page.expect_download() as d:
            page.locator('.result-card [data-r="dl"]').last.click()
        path = os.path.join(SP, 'out_native_web.pdf')
        d.value.save_as(path)
        check('web: download still works (compress)', open(path, 'rb').read(5) == b'%PDF-' and d.value.suggested_filename.endswith('.pdf'), d.value.suggested_filename)
        check('web: no "Gespeichert in" toast', page.locator('.toast', has_text='Gespeichert in').count() == 0)
        has_share = page.evaluate("!!(navigator.canShare && navigator.share)")
        if not has_share:
            with page.expect_download() as d2:
                page.locator('.result-card [data-r="share"]').last.click()
            wait_toast(page, 'Teilen wird hier nicht unterstützt')
            check('web: share falls back to download + hint', d2.value.suggested_filename.endswith('.pdf'))
        else:
            check('web: Web Share available (not exercised headless)', True)
        page.evaluate(f"location.hash = '#/werkzeug/exportieren?doc={did}'")
        page.wait_for_selector('[data-txt]')
        with page.expect_download() as d3:
            page.locator('[data-txt]').click()
        check('web: export text download', d3.value.suggested_filename == 'bericht.txt', d3.value.suggested_filename)
        page.wait_for_function("navigator.serviceWorker.getRegistrations().then(r => r.length > 0)", timeout=10000)
        check('web: service worker still registered', True)
        denied = page.evaluate("""async () => { const m = await import('/js/platform.js'); if (Notification.permission === 'granted') return 'skip';
            const ok = await m.scheduleNotification({ id: 'd1', at: Date.now() + 60000, title: 'X' }); const l = m.listReminders().map(x => x.id); await m.cancelNotification('d1'); return { ok, l }; }""")
        check('web: permission denied → false but stored in-app', denied == 'skip' or denied == {'ok': False, 'l': ['d1']}, json.dumps(denied))
        page.evaluate("() => { Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true }); }")
        r = page.evaluate("""async () => { const m = await import('/js/platform.js'); m.haptic('success');
            const ok = await m.scheduleNotification({ id: 'w1', at: Date.now() + 60000, title: 'Web', route: '#/dateien' });
            return { ok, list: m.listReminders().map(x => x.id), due: m.dueReminders({ remove: false, now: Date.now() + 120000 }).map(x => x.id) }; }""")
        check('web: scheduleNotification (granted) → true + stored', r['ok'] is True and r['list'] == ['w1'] and r['due'] == ['w1'], json.dumps(r))
        page.evaluate("import('/js/platform.js').then(m => m.cancelNotification('w1'))")
        check('web: cancelNotification removes', page.evaluate("import('/js/platform.js').then(m => m.listReminders().length)") == 0)
        ok = page.evaluate("import('/js/platform.js').then(m => m.setStatusBarTheme(true)).then(() => true)")
        check('web: setStatusBarTheme no-op', ok is True)
    step('web behaviour unchanged', run)
    check('no page errors (web)', not errors, '; '.join(errors)[:400])
    browser.close()


# =====================================================================================
# (b) patch script against a fixture Android project
# =====================================================================================
def tree_hash(root):
    h = hashlib.sha256()
    for f in sorted(glob.glob(os.path.join(root, '**', '*'), recursive=True)):
        if os.path.isfile(f):
            h.update(os.path.relpath(f, root).encode())
            h.update(open(f, 'rb').read())
    return h.hexdigest()


def patch_tests():
    base = tempfile.mkdtemp(prefix='fale-android-', dir=SP)
    try:
        andr = os.path.join(base, 'android')
        fixture.make_android(andr)
        env = dict(os.environ)
        env.pop('ANDROID_VERSION_CODE', None)
        r = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr], capture_output=True, text=True, env=env)
        check('patch script runs', r.returncode == 0, r.stderr[-800:])
        print('   ', r.stdout.strip())
        main = os.path.join(andr, 'app/src/main')
        man = open(os.path.join(main, 'AndroidManifest.xml')).read()
        ns = {'android': 'http://schemas.android.com/apk/res/android'}
        A = '{http://schemas.android.com/apk/res/android}'
        root = ET.fromstring(man.encode())
        perms = {e.get(A + 'name'): e.get(A + 'maxSdkVersion') for e in root.findall('uses-permission')}
        check('manifest: CAMERA permission', 'android.permission.CAMERA' in perms)
        feats = {e.get(A + 'name'): e.get(A + 'required') for e in root.findall('uses-feature')}
        check('manifest: camera feature not required', feats.get('android.hardware.camera') == 'false')
        check('manifest: storage perms capped', perms.get('android.permission.WRITE_EXTERNAL_STORAGE') == '29' and perms.get('android.permission.READ_EXTERNAL_STORAGE') == '32')
        check('manifest: notifications + vibrate + internet kept', all(x in perms for x in ['android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE', 'android.permission.INTERNET']))
        app = root.find('application')
        check('manifest: requestLegacyExternalStorage', app.get(A + 'requestLegacyExternalStorage') == 'true')
        act = app.find('activity')
        check('manifest: adjustResize', act.get(A + 'windowSoftInputMode') == 'adjustResize')
        filters = act.findall('intent-filter')
        acts = [f.find('action').get(A + 'name') for f in filters]
        check('manifest: MAIN + VIEW + EDIT + SEND + SEND_MULTIPLE filters', acts == ['android.intent.action.MAIN', 'android.intent.action.VIEW', 'android.intent.action.EDIT', 'android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'], str(acts))
        for f in filters[1:]:
            mts = [d.get(A + 'mimeType') for d in f.findall('data')]
            ok = all(m in mts for m in ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                                        'text/csv', 'text/plain', 'text/markdown', 'image/*'])
            check(f"manifest: MIME types on {f.find('action').get(A + 'name').split('.')[-1]}", ok and f.find('category').get(A + 'name') == 'android.intent.category.DEFAULT', str(mts))
        check('manifest: provider kept (authorities), never exported', app.find('provider') is not None and 'fileprovider' in app.find('provider').get(A + 'authorities') and app.find('provider').get(A + 'exported') == 'false')
        # --- security hardening (docs/SECURITY.md) – intentional changes of the patch output
        check('security: allowBackup=false + fullBackupContent=false', app.get(A + 'allowBackup') == 'false' and app.get(A + 'fullBackupContent') == 'false', str(app.attrib))
        check('security: dataExtractionRules (Android 12+ cloud backup / device transfer)', app.get(A + 'dataExtractionRules') == '@xml/fale_data_extraction_rules')
        check('security: no cleartext traffic + network security config', app.get(A + 'usesCleartextTraffic') == 'false' and app.get(A + 'networkSecurityConfig') == '@xml/fale_network_security_config')
        nsc = ET.parse(os.path.join(main, 'res/xml/fale_network_security_config.xml')).getroot()
        base_cfg = nsc.find('base-config')
        check('security: NSC – cleartext off, release trusts system CAs only, user CAs only in debug',
              base_cfg.get('cleartextTrafficPermitted') == 'false' and [c.get('src') for c in base_cfg.find('trust-anchors')] == ['system']
              and [c.get('src') for c in nsc.find('debug-overrides').find('trust-anchors')] == ['user'])
        der = ET.parse(os.path.join(main, 'res/xml/fale_data_extraction_rules.xml')).getroot()
        doms = lambda tag: sorted(e.get('domain') for e in der.find(tag).findall('exclude'))
        check('security: data extraction rules exclude every domain (cloud + device transfer)', doms('cloud-backup') == doms('device-transfer') == ['database', 'external', 'file', 'root', 'sharedpref'])
        exported = [(e.tag, e.get(A + 'name')) for e in app.iter() if e.get(A + 'exported') == 'true']
        check('security: only MainActivity is exported', exported == [('activity', '.MainActivity')], str(exported))
        g = open(os.path.join(andr, 'app/build.gradle')).read()
        _v = json.load(open(os.path.join(APP, 'package.json')))['version']; _maj, _min, _pat = map(int, _v.split('.'))
        check(f'gradle: versionCode/versionName from package.json ({_v})', f'versionCode {_maj*10000+_min*100+_pat}' in g and f'versionName "{_v}"' in g)
        check('gradle: applicationId', 'applicationId "dev.fale.pdf"' in g)
        si = g.index('signingConfigs {'); bt = g.index('buildTypes {')
        check('gradle: signingConfigs before buildTypes, env based', si < bt and "System.getenv('FALE_KEYSTORE_FILE')" in g and "keyAlias System.getenv('FALE_KEY_ALIAS')" in g)
        rel = g[g.index('release {', bt):]
        check('gradle: release uses signing config when env set', rel.index('signingConfig signingConfigs.release') < rel.index('minifyEnabled'))
        check('gradle: braces balanced', g.count('{') == g.count('}'))
        v = open(os.path.join(andr, 'variables.gradle')).read()
        check('variables: SDK 36 kept', 'compileSdkVersion = 36' in v and 'targetSdkVersion = 36' in v)
        java_dir = os.path.join(main, 'java/dev/fale/pdf')
        ma = open(os.path.join(java_dir, 'MainActivity.java')).read()
        check('MainActivity registers FaleIncomingPlugin before super.onCreate', ma.index('registerPlugin(FaleIncomingPlugin.class)') < ma.index('super.onCreate(savedInstanceState)'))
        pl = open(os.path.join(java_dir, 'FaleIncomingPlugin.java')).read()
        check('plugin: name FaleIncoming + methods', '@CapacitorPlugin(name = "FaleIncoming")' in pl and all(f'public void {m}(PluginCall call)' in pl for m in ['takePending', 'readFile', 'release', 'setBarColors']))
        check('plugin: EDIT intent + write-back to the original (token, write probe, truncating stream, cache-only source)', 'Intent.ACTION_EDIT.equals(action)' in pl and 'public void writeBack(PluginCall call)' in pl and 'openFileDescriptor(uri, "rw")' in pl and 'openOutputStream(uri, "wt")' in pl and 'new File(getContext().getCacheDir(), "writeback")' in pl and 'call.reject("readonly", "readonly")' in pl)
        check('plugin: handles cold start + onNewIntent + 100 MB guard', 'handleIntent(getActivity().getIntent())' in pl and 'protected void handleOnNewIntent(Intent intent)' in pl and '100L * 1024L * 1024L' in pl)
        check('security: plugin setSecure toggles FLAG_SECURE', 'public void setSecure(PluginCall call)' in pl and 'addFlags(WindowManager.LayoutParams.FLAG_SECURE)' in pl and 'clearFlags(WindowManager.LayoutParams.FLAG_SECURE)' in pl)
        check('security: incoming intents – max files, own-data URIs refused', 'MAX_FILES = 50' in pl and 'refusedUri(uri)' in pl and 'getApplicationInfo().dataDir' in pl and 'auth.startsWith(pkg + ".")' in pl)
        check('security: MainActivity hardens the WebView (no file/content access, no release debugging)', all(x in ma for x in ['setAllowFileAccess(false)', 'setAllowContentAccess(false)', 'setAllowFileAccessFromFileURLs(false)', 'setAllowUniversalAccessFromFileURLs(false)', 'FLAG_DEBUGGABLE', 'setWebContentsDebuggingEnabled(false)', 'MIXED_CONTENT_NEVER_ALLOW']) and ma.index('super.onCreate(savedInstanceState)') < ma.index('hardenWebView();'))
        # compile against stubs
        stubs = fixture.make_stubs(os.path.join(base, 'stubs'))
        outd = os.path.join(base, 'classes')
        os.makedirs(outd)
        jc = subprocess.run(['javac', '-Xlint:-options', '-d', outd, *stubs, os.path.join(java_dir, 'MainActivity.java'), os.path.join(java_dir, 'FaleIncomingPlugin.java'), os.path.join(java_dir, 'FalePrintPlugin.java')], capture_output=True, text=True)
        check('generated Java compiles (javac + API stubs)', jc.returncode == 0, (jc.stdout + jc.stderr)[-1500:])
        # regex in cleanName really strips path chars
        if jc.returncode == 0:
            probe = os.path.join(base, 'probe')
            os.makedirs(probe)
            with open(os.path.join(probe, 'Probe.java'), 'w') as f:
                f.write('''public class Probe { public static void main(String[] a) throws Exception {
                  java.lang.reflect.Method m = dev.fale.pdf.FaleIncomingPlugin.class.getDeclaredMethod("cleanName", String.class); m.setAccessible(true);
                  System.out.println(m.invoke(null, "a/b\\\\c:d*e?f\\"g<h>i|j\\u0001k.pdf")); System.out.println(m.invoke(null, (Object) null)); } }''')
            pc = subprocess.run(['javac', '-cp', outd, '-d', probe, os.path.join(probe, 'Probe.java')], capture_output=True, text=True)
            pr = subprocess.run(['java', '-cp', f'{outd}:{probe}', 'Probe'], capture_output=True, text=True)
            lines = pr.stdout.strip().splitlines()
            check('plugin cleanName strips unsafe chars', pc.returncode == 0 and lines == ['a b c d e f g h i j k.pdf', 'Datei'], (pc.stderr + pr.stderr)[-500:] + str(lines))
        # resources
        res = os.path.join(main, 'res')
        bad = []
        for f in glob.glob(os.path.join(res, '**', '*.xml'), recursive=True):
            try:
                ET.parse(f)
            except ET.ParseError as e:
                bad.append(f'{f}: {e}')
        check('all resource XML well-formed', not bad, '; '.join(bad))
        st = ET.parse(os.path.join(res, 'values/styles.xml')).getroot()
        names = [s.get('name') for s in st.findall('style')]
        check('styles keep Capacitor theme names', names == ['AppTheme', 'AppTheme.NoActionBar', 'AppTheme.NoActionBarLaunch'], str(names))
        col = {c.get('name'): c.text for c in ET.parse(os.path.join(res, 'values/fale_colors.xml')).getroot().findall('color')}
        coln = {c.get('name'): c.text for c in ET.parse(os.path.join(res, 'values-night/fale_colors.xml')).getroot().findall('color')}
        check('theme colours light #F2F3F9 / dark #0E0D23', col['fale_bg'] == '#F2F3F9' and coln['fale_bg'] == '#0E0D23')
        check('Capacitor splash PNGs removed, splash.xml present', not glob.glob(os.path.join(res, 'drawable*/splash.png')) and os.path.exists(os.path.join(res, 'drawable/splash.xml')))
        from PIL import Image
        sizes_ok = True
        info = []
        for d, f in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
            for n, base_dp in [('ic_launcher', 48), ('ic_launcher_round', 48), ('ic_launcher_foreground', 108), ('ic_launcher_background', 108), ('ic_launcher_monochrome', 108)]:
                im = Image.open(os.path.join(res, f'mipmap-{d}', n + '.png'))
                im.load()
                if im.size != (round(base_dp * f),) * 2 or im.mode != 'RGBA':
                    sizes_ok = False
                    info.append(f'{d}/{n} {im.size} {im.mode}')
            ni = Image.open(os.path.join(res, f'drawable-{d}', 'ic_stat_fale.png'))
            px = list(ni.get_flattened_data() if hasattr(ni, 'get_flattened_data') else ni.getdata())
            if ni.size != (round(24 * f),) * 2 or any(p[:3] != (255, 255, 255) for p in px) or not any(p[3] > 200 for p in px) or px[0][3] != 0:
                sizes_ok = False
                info.append(f'stat {d}')
        check('launcher/adaptive/notification icons: sizes, RGBA, white notif icon', sizes_ok, '; '.join(info))
        fg = Image.open(os.path.join(res, 'mipmap-xxxhdpi/ic_launcher_foreground.png'))
        check('adaptive foreground: transparent margin, opaque centre', fg.getpixel((2, 2))[3] == 0 and fg.getpixel((216, 216))[3] == 255)
        rd = Image.open(os.path.join(res, 'mipmap-xxxhdpi/ic_launcher_round.png'))
        check('round icon: transparent corners', rd.getpixel((0, 0))[3] == 0 and rd.getpixel((96, 96))[3] == 255)
        ad = open(os.path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml')).read()
        check('adaptive icon xml has monochrome layer', '@mipmap/ic_launcher_monochrome' in ad and '@mipmap/ic_launcher_background' in ad)
        Image.open(os.path.join(res, 'mipmap-xxxhdpi/ic_launcher.png')).save(os.path.join(SP, 'native_icon_preview.png'))
        # idempotency + determinism
        h1 = tree_hash(andr)
        r2 = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr], capture_output=True, text=True, env=env)
        check('second run succeeds', r2.returncode == 0, r2.stderr[-400:])
        check('patch is idempotent (byte-identical tree)', tree_hash(andr) == h1)
        andr2 = os.path.join(base, 'android2')
        fixture.make_android(andr2)
        subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr2], capture_output=True, text=True, env=env)
        check('patch is deterministic (fresh project → same tree)', tree_hash(andr2) == h1)
        # env overrides + Capacitor 7 template
        andr3 = os.path.join(base, 'android3')
        fixture.make_android(andr3, cap7=True)
        env3 = dict(env, ANDROID_VERSION_CODE='4711', ANDROID_VERSION_NAME='2.0.0-beta')
        r3 = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr3], capture_output=True, text=True, env=env3)
        g3 = open(os.path.join(andr3, 'app/build.gradle')).read()
        v3 = open(os.path.join(andr3, 'variables.gradle')).read()
        m3 = open(os.path.join(andr3, 'app/src/main/AndroidManifest.xml')).read()
        check('env overrides versionCode/versionName', r3.returncode == 0 and 'versionCode 4711' in g3 and 'versionName "2.0.0-beta"' in g3, r3.stderr[-300:])
        check('Cap 7 template: SDK bumped to 36, density added', 'compileSdkVersion = 36' in v3 and 'targetSdkVersion = 36' in v3 and 'minSdkVersion = 23' in v3 and 'navigation|density"' in m3)
        # version code scheme
        vc = subprocess.run(['node', '--input-type=module', '-e', f"import('{APP}/scripts/cap-patch-android.mjs').then(m => console.log([m.versionCodeOf('2.0.0'), m.versionCodeOf('2.13.7'), m.versionCodeOf('10.2.3')].join(',')))"], capture_output=True, text=True)
        check('versionCode = major*10000+minor*100+patch', vc.stdout.strip() == '20000,21307,100203', vc.stdout + vc.stderr)
        print('    manifest excerpt:\n' + '\n'.join('      ' + l for l in man.splitlines()[-24:]))
    finally:
        shutil.rmtree(base, ignore_errors=True)


# =====================================================================================
# (c) static checks + native build target
# =====================================================================================
def static_checks():
    import yaml
    wf = yaml.safe_load(open(os.path.join(APP, '.github/workflows/android.yml')))
    steps = wf['jobs']['build']['steps']
    names = [s.get('name', '') for s in steps]
    runs = '\n'.join(s.get('run', '') for s in steps)
    uses = [s.get('uses', '') for s in steps if s.get('uses')]
    trig = wf.get(True) or wf.get('on')
    check('workflow: triggers main, tags v*, dispatch', trig['push']['branches'] == ['main'] and trig['push']['tags'] == ['v*'] and 'workflow_dispatch' in trig)
    check('workflow: node 22 / temurin 21 / Android SDK', any(u.startswith('actions/setup-node') for u in uses) and any('sdkmanager' in (st.get('run') or '') for st in steps)
          and any(s.get('with', {}).get('node-version') == 22 for s in steps) and any(s.get('with', {}).get('java-version') == 21 and s['with'].get('distribution') == 'temurin' for s in steps))
    order = ['npm ci', 'vercel-build.mjs --native', 'npx cap add android', 'npx cap sync android', 'cap-patch-android.mjs', 'assembleDebug', 'bundleRelease assembleRelease']
    pos = [runs.find(o) for o in order]
    check('workflow: build order', all(p >= 0 for p in pos) and pos == sorted(pos), str(pos))
    sec = json.dumps(wf)
    check('workflow: 4 signing secrets used', all(s in sec for s in ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']))
    check('workflow: artifacts + release on tags', any(u.startswith('actions/upload-artifact') for u in uses) and any(u.startswith('softprops/action-gh-release') and s.get('if', '').startswith("startsWith(github.ref, 'refs/tags/v')") for s in steps for u in [s.get('uses', '')]))
    for f in ['scripts/cap-patch-android.mjs', 'scripts/cap-png.mjs', 'scripts/vercel-build.mjs', 'js/platform.js', 'js/ui.js', 'js/app.js']:
        r = subprocess.run(['node', '--check', os.path.join(APP, f)], capture_output=True, text=True)
        check(f'node --check {f}', r.returncode == 0, r.stderr[-300:])
    cfg = json.load(open(os.path.join(APP, 'capacitor.config.json')))
    check('capacitor.config: appId/appName/webDir/scheme', cfg['appId'] == 'dev.fale.pdf' and cfg['appName'] == 'FaLe PDF' and cfg['webDir'] == 'dist' and cfg['server']['androidScheme'] == 'https')
    pkg = json.load(open(os.path.join(APP, 'package.json')))
    check('package.json: dependencies unchanged', pkg['dependencies'] == {'pdfjs-dist': '6.2.108', 'pdf-lib': '1.17.1', 'jszip': '3.10.1', 'docx': '9.7.1', 'pptxgenjs': '4.0.1'})
    dd = pkg['devDependencies']
    check('package.json: capacitor devDependencies', all(k in dd for k in ['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/filesystem', '@capacitor/share', '@capacitor/app', '@capacitor/local-notifications', '@capacitor/haptics']))
    gi = open(os.path.join(APP, '.gitignore')).read()
    check('.gitignore: android/, node_modules/, keystores; vendor not ignored', 'android/' in gi and 'node_modules/' in gi and '*.jks' in gi and 'vendor' not in gi)
    # store texts within limits
    import re
    for lang in ['de', 'en']:
        t = open(os.path.join(APP, f'store/listing-{lang}.md')).read()
        blocks = re.findall(r'```\n(.*?)\n```', t, re.S)
        title, short, full = blocks[0], blocks[1], blocks[2]
        check(f'listing-{lang}: title ≤30, short ≤80, full ≤4000', len(title) <= 30 and len(short) <= 80 and len(full) <= 4000, f'{len(title)}/{len(short)}/{len(full)}')
        bad = [w for w in ['Adobe', 'Acrobat', 'WPS', 'Microsoft', 'Word', 'Excel', 'PowerPoint', 'Google Docs'] if re.search(r'\b' + w + r'\b', title + short + full)]
        check(f'listing-{lang}: no third-party trademarks', not bad, str(bad))
    for f in ['datenschutz.html', 'impressum.html']:
        h = open(os.path.join(APP, f)).read()
        check(f'{f}: has <main> and placeholders', re.search(r'<main[ >]', h) is not None and '[' in h and 'mark class="ph"' in h)


def native_build():
    env = dict(os.environ, FALE_NODE_MODULES=NM)
    dist = os.path.join(APP, 'dist')
    try:
        r = subprocess.run(['node', 'scripts/vercel-build.mjs', '--native'], cwd=APP, capture_output=True, text=True, env=env)
        check('native build runs', r.returncode == 0, r.stderr[-500:])
        ix = open(os.path.join(dist, 'index.html')).read()
        check('native build: viewport-fit removed', 'viewport-fit' not in ix and 'width=device-width, initial-scale=1"' in ix)
        check('native build: no vercel.json, no android/store/config', not any(os.path.exists(os.path.join(dist, x)) for x in ['vercel.json', 'android', 'store', 'capacitor.config.json', 'README.md']))
        check('native build: legal pages + platform.js included', all(os.path.exists(os.path.join(dist, x)) for x in ['datenschutz.html', 'impressum.html', 'js/platform.js']))
    finally:
        r = subprocess.run(['node', 'scripts/vercel-build.mjs'], cwd=APP, capture_output=True, text=True, env=env)
        check('web build runs (dist restored)', r.returncode == 0, r.stderr[-500:])
        ix = open(os.path.join(dist, 'app', 'index.html')).read()   # web: the app lives at /app/, / is its start page
        sw = open(os.path.join(dist, 'sw.js')).read()
        check('web build: start page at /, app at /app/', 'landing.js' in open(os.path.join(dist, 'index.html')).read() and 'id="view-start"' in ix or 'view-start' in ix)
        check('web build: viewport-fit kept, vercel.json written, sw precaches legal + platform', 'viewport-fit=cover' in ix and os.path.exists(os.path.join(dist, 'vercel.json'))
              and '"./datenschutz.html"' in sw and '"./js/platform.js"' in sw and 'capacitor.config.json' not in sw)


if __name__ == '__main__':
    from playwright.sync_api import sync_playwright
    if ONLY in ('all', 'static'):
        step('static', static_checks)
    if ONLY in ('all', 'patch'):
        step('patch', patch_tests)
    if ONLY in ('all', 'build'):
        step('build', native_build)
    if ONLY in ('all', 'browser', 'native', 'raw', 'web'):
        with sync_playwright() as p:
            if ONLY in ('all', 'browser', 'native'):
                step('native', lambda: native_plugins(p))
            if ONLY in ('all', 'browser', 'raw'):
                step('raw', lambda: native_raw(p))
            if ONLY in ('all', 'browser', 'web'):
                step('web', lambda: web(p))
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} passed')
    for n, c, i in results:
        if not c:
            print('  FAILED:', n, i[:300])
    sys.exit(0 if ok == len(results) else 1)

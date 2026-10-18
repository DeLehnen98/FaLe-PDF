"""„Im Original speichern“ – edits replace the original file (review complaint: highlights/edits end up in a copy).

Browser (real FileSystemFileHandles from the origin-private file system, same API as files opened with the
installed web app or the desktop file picker):
- PDF tool result (compress): „Original ersetzen“ only when the source has an origin, confirm dialog, the
  original file then holds exactly the new version, the library keeps both
- origin survives a reload (handle in IndexedDB); a different file type is never offered
- office editor (docx): save → toast „Auch Original ersetzen“ → original replaced; the next save writes
  automatically („Gespeichert – auch in …“); menu entry „Im Original speichern“
- files without origin: no button
Android app (mocked Capacitor bridge): file opened with „Bearbeiten mit“ (writable) → writeBack(token, path)
with the bytes staged in the cache; read-only grant → no button. English strings. No freeze.

Run: python3 test_original_save.py   (static server: python3 -m http.server 8797 --bind 127.0.0.1 in /home/claude/FalePDF)
"""
import base64, os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:8797/')
TD = '/home/claude/FalePDF/tests/base/testdata'
OD = '/home/claude/FalePDF/tests/base/officedata'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_original')
os.makedirs(OUT, exist_ok=True)
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


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


# put a file into the origin-private file system and import it like the desktop file picker would
IMPORT_OPFS = """async ([name, data, type]) => {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(Uint8Array.from(atob(data), c => c.charCodeAt(0))); await w.close();
  const { tagFile } = await import('./js/origin.js');
  const f = tagFile(await fh.getFile(), { type: 'web', handle: fh, name });
  const lib = await import('./js/library.js');
  const [d] = await lib.importFiles([f], { any: true, source: 'Gerät' });
  return d.id;
}"""
OPFS_BYTES = """async name => { const root = await navigator.storage.getDirectory(); const f = await (await root.getFileHandle(name)).getFile(); return f.size + ':' + await crypto.subtle.digest('SHA-256', await f.arrayBuffer()).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')); }"""
LIB_BYTES = """async id => { const db = await import('./js/db.js'); const b = await db.getFile(id); return b.size + ':' + await crypto.subtle.digest('SHA-256', await b.arrayBuffer()).then(x => [...new Uint8Array(x)].map(v => v.toString(16).padStart(2, '0')).join('')); }"""

NATIVE = r"""
window.__fi = { calls: [], fsWrites: [] };
const F = window.__fi;
const listeners = {};
const FaleIncoming = {
  takePending: async () => { const p = F.pending || []; F.pending = []; return { action: 'VIEW', files: p, skipped: [] }; },
  readFile: async o => ({ data: F.data[o.path] }),
  release: async () => {},
  writeBack: async o => { F.calls.push(['writeBack', o.token, o.path]); if (!F.writable) { const e = new Error('readonly'); e.code = 'readonly'; throw e; } return { ok: true }; },
  setBarColors: async () => {}, setSecure: async () => {},
  addListener: async (n, cb) => { listeners[n] = cb; return { remove() {} }; },
};
F.fire = () => listeners.filesReady && listeners.filesReady({ count: 1 });
const Filesystem = {
  writeFile: async o => { F.fsWrites.push(['write', o.path, o.directory, o.data.length]); return { uri: 'file:///cache/' + o.path }; },
  appendFile: async o => { F.fsWrites.push(['append', o.path, o.directory, o.data.length]); },
  stat: async () => { throw new Error('nope'); },
};
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', convertFileSrc: p => 'http://invalid.invalid' + p, Plugins: { FaleIncoming, Filesystem, AdMob: { initialize: async () => {}, addListener: async () => ({ remove() {} }) } } };
"""


def errors_of(page):
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and 'invalid.invalid' not in m.text and errs.append(m.text))
    return errs


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='de-DE')
        ctx.add_init_script("localStorage.setItem('fale-onboarded', '1');")
        page = ctx.new_page(); errs = errors_of(page)
        page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero')
        page.evaluate("""() => { window.__long = 0; try { new PerformanceObserver(l => l.getEntries().forEach(e => { window.__long = Math.max(window.__long, e.duration); })).observe({ type: 'longtask', buffered: true }); } catch {} }""")
        st = {}

        def pdf_tool():
            st['pdf'] = page.evaluate(IMPORT_OPFS, ['vertrag.pdf', b64(os.path.join(TD, 'unkomprimiert.pdf')), 'application/pdf'])
            before = page.evaluate(OPFS_BYTES, 'vertrag.pdf')
            page.goto(URL + f"#/werkzeug/komprimieren?doc={st['pdf']}"); page.wait_for_selector('[data-run]', timeout=10000)
            page.locator('[data-run]').click()
            page.wait_for_selector('.result-card [data-r="original"]', timeout=30000)
            check('PDF tool: „Original ersetzen“ offered', 'Original ersetzen' in page.locator('.result-card [data-r="original"]').inner_text())
            page.screenshot(path=os.path.join(OUT, 'result_card.png'))
            page.locator('.result-card [data-r="original"]').click()
            page.wait_for_selector('dialog.dlg', timeout=5000)
            dlg = page.locator('dialog.dlg').inner_text()
            check('confirm names the file and keeps both versions', '„vertrag.pdf“ überschreiben?' in dlg and 'beide Fassungen' in dlg, dlg)
            page.locator('dialog.dlg button.btn-primary, dialog.dlg button[value="ok"]').last.click()
            page.wait_for_function("() => (document.querySelector('.result-card [data-r=\"original\"]') || {}).innerText?.includes('ersetzt')", timeout=10000)
            res_id = page.evaluate("() => location.hash") and page.evaluate("async () => (await (await import('./js/db.js')).listFiles()).find(d => d.name.includes('(komprimiert)')).id")
            after = page.evaluate(OPFS_BYTES, 'vertrag.pdf')
            check('original file now holds the compressed version', after == page.evaluate(LIB_BYTES, res_id) and after != before, f'{before} → {after}')
            check('library keeps the old version', page.evaluate(LIB_BYTES, st['pdf']).split(':')[1] == before.split(':')[1])
            check('toast confirms', 'aktualisiert' in page.locator('#toasts').inner_text())
        step('pdf tool', pdf_tool)

        def picker():
            # „Datei öffnen“ on desktop browsers: showOpenFilePicker keeps the handle (mocked to return an OPFS handle)
            page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero')
            page.evaluate("""async data => {
              localStorage.setItem('fale-fsa-force', '1');
              const root = await navigator.storage.getDirectory();
              const fh = await root.getFileHandle('gewaehlt.pdf', { create: true });
              const w = await fh.createWritable(); await w.write(Uint8Array.from(atob(data), c => c.charCodeAt(0))); await w.close();
              window.__pickerOpts = null;
              window.showOpenFilePicker = async o => { window.__pickerOpts = o; return [fh]; };
            }""", b64(os.path.join(TD, 'unkomprimiert.pdf')))
            page.locator('#view-start [data-action="open-file"]').first.click()
            page.wait_for_function("() => location.hash.startsWith('#/ansicht/')", timeout=15000)
            did = page.evaluate("() => location.hash.split('/')[2].split('?')[0]")
            info = page.evaluate("async id => (await import('./js/origin.js')).originFor(id, '.pdf')", did)
            opts = page.evaluate('window.__pickerOpts')
            check('desktop picker: handle kept for „Datei öffnen“', info and info['name'] == 'gewaehlt.pdf' and info['where'] == 'browser', info)
            check('desktop picker: multiple + accept types incl. PDF/DOCX', opts and opts['multiple'] and '.pdf' in str(opts['types']) and '.docx' in str(opts['types']), opts)
            page.evaluate("localStorage.removeItem('fale-fsa-force')")
        step('picker', picker)

        def persisted_and_mismatch():
            page.goto(URL + '#/start'); page.reload(); page.wait_for_selector('#view-start .hero')
            r = page.evaluate("async id => { const O = await import('./js/origin.js'); return [await O.originFor(id, '.pdf'), await O.originFor(id, '.docx')]; }", st['pdf'])
            check('origin survives a reload (handle in IndexedDB)', r[0] and r[0]['name'] == 'vertrag.pdf' and r[0]['where'] == 'browser', r)
            check('other file type never offered', r[1] is None, r)
            # a document without origin: no button
            other = page.evaluate("async data => { const lib = await import('./js/library.js'); const b = Uint8Array.from(atob(data), c => c.charCodeAt(0)); const [d] = await lib.importFiles([new File([b], 'ohne.pdf', { type: 'application/pdf' })]); return d.id; }", b64(os.path.join(TD, 'unkomprimiert.pdf')))
            page.goto(URL + f"#/werkzeug/komprimieren?doc={other}"); page.wait_for_selector('[data-run]')
            page.locator('[data-run]').click(); page.wait_for_selector('.result-card', timeout=30000); page.wait_for_timeout(600)
            check('no origin → no „Original ersetzen“', page.locator('.result-card [data-r="original"]').count() == 0)
        step('persisted + mismatch', persisted_and_mismatch)

        def office():
            st['doc'] = page.evaluate(IMPORT_OPFS, ['brief.docx', b64(os.path.join(OD, 'bericht.docx')), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
            page.goto(URL + f"#/bearbeiten/{st['doc']}"); page.wait_for_selector('.doc-page[contenteditable]', timeout=15000); page.wait_for_timeout(800)
            page.locator('[data-office-more]').click(); page.wait_for_selector('.menu', timeout=3000)
            check('editor menu: „Im Original speichern“', 'Im Original speichern („brief.docx“)' in page.locator('.menu').inner_text())
            page.keyboard.press('Escape')
            page.locator('.doc-page[contenteditable]').click(); page.keyboard.press('Control+End'); page.keyboard.type(' Ergänzung eins.')
            page.locator('[data-office-save]').click()
            btn = page.locator('.toast .toast-btn', has_text='Auch Original ersetzen')
            btn.wait_for(timeout=8000)
            btn.click()
            page.wait_for_selector('dialog.dlg', timeout=5000)
            page.locator('dialog.dlg button.btn-primary').last.click()
            page.wait_for_function("() => document.querySelector('#toasts').innerText.includes('aktualisiert')", timeout=10000)
            check('docx original replaced after save', page.evaluate(OPFS_BYTES, 'brief.docx') == page.evaluate(LIB_BYTES, st['doc']))
            page.locator('.doc-page[contenteditable]').click(); page.keyboard.press('Control+End'); page.keyboard.type(' Ergänzung zwei.')
            page.locator('[data-office-save]').click()
            page.wait_for_function("() => document.querySelector('#toasts').innerText.includes('Gespeichert – auch in')", timeout=10000)
            check('next save writes the original automatically', page.evaluate(OPFS_BYTES, 'brief.docx') == page.evaluate(LIB_BYTES, st['doc']))
            txt = page.evaluate("async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('brief.docx')).getFile()).size")
            check('original non-empty docx', txt > 1000, txt)
            page.screenshot(path=os.path.join(OUT, 'editor_saved.png'))
        step('office', office)
        check('browser: no page errors', not errs, errs[:3])
        check('browser: no freeze (long task < 600 ms)', page.evaluate('window.__long || 0') < 600, page.evaluate('window.__long || 0'))
        ctx.close()

        # ------------------------------------------------ English
        ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='en-US')
        ctx.add_init_script("localStorage.setItem('fale-onboarded', '1');")
        page = ctx.new_page()
        page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero')

        def english():
            pid = page.evaluate(IMPORT_OPFS, ['contract.pdf', b64(os.path.join(TD, 'unkomprimiert.pdf')), 'application/pdf'])
            page.goto(URL + f"#/werkzeug/komprimieren?doc={pid}"); page.wait_for_selector('[data-run]')
            page.locator('[data-run]').click(); page.wait_for_selector('.result-card [data-r="original"]', timeout=30000)
            page.wait_for_timeout(300)
            check('English: „Replace original“', 'Replace original' in page.locator('.result-card [data-r="original"]').inner_text(), page.locator('.result-card [data-r="original"]').inner_text())
            page.locator('.result-card [data-r="original"]').click(); page.wait_for_selector('dialog.dlg')
            page.wait_for_timeout(300)
            d = page.locator('dialog.dlg').inner_text()
            check('English confirm', 'Overwrite “contract.pdf”?' in d and 'Both versions' in d, d)
            page.keyboard.press('Escape')
        step('english', english)
        ctx.close()

        # ------------------------------------------------ Android (mocked bridge)
        for writable in (True, False):
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', is_mobile=True, has_touch=True)
            ctx.add_init_script(NATIVE)
            ctx.add_init_script("localStorage.setItem('fale-onboarded', '1');")
            page = ctx.new_page(); errs = errors_of(page)
            page.goto(URL + '#/start'); page.wait_for_selector('#view-start .hero'); page.wait_for_timeout(500)

            def native():
                page.evaluate("""([data, w]) => { window.__fi.writable = w; window.__fi.data = { '/cache/incoming/1-scan.pdf': data };
                  window.__fi.pending = [{ name: 'scan.pdf', mimeType: 'application/pdf', size: 1, path: '/cache/incoming/1-scan.pdf', origin: 'tok-123', writable: w }]; window.__fi.fire(); }""", [b64(os.path.join(TD, 'unkomprimiert.pdf')), writable])
                page.wait_for_function("() => location.hash.startsWith('#/ansicht/')", timeout=15000)
                did = page.evaluate("() => location.hash.split('/')[2].split('?')[0]")
                info = page.evaluate("async id => (await import('./js/origin.js')).originFor(id, '.pdf')", did)
                if not writable:
                    check('Android read-only grant: no write-back offered', info is None, info)
                    return
                check('Android „Bearbeiten mit“: origin known', info and info['where'] == 'app' and info['name'] == 'scan.pdf', info)
                page.goto(URL + f"#/werkzeug/komprimieren?doc={did}"); page.wait_for_selector('[data-run]')
                page.locator('[data-run]').click(); page.wait_for_selector('.result-card [data-r="original"]', timeout=30000)
                page.locator('.result-card [data-r="original"]').click(); page.wait_for_selector('dialog.dlg')
                page.locator('dialog.dlg button.btn-primary').last.click()
                page.wait_for_function("() => window.__fi.calls.length > 0", timeout=10000)
                c = page.evaluate('window.__fi.calls'); w = page.evaluate('window.__fi.fsWrites')
                check('writeBack(token, cache path) after staging the bytes', c[0] == ['writeBack', 'tok-123', 'writeback/tok-123.pdf'] and w and w[0][1] == 'writeback/tok-123.pdf' and w[0][2] == 'CACHE', f'{c} {w}')
                page.wait_for_function("() => document.querySelector('#toasts').innerText.includes('aktualisiert')", timeout=5000)
                page.screenshot(path=os.path.join(OUT, 'android_result.png'))
            step(f'android writable={writable}', native)
            check(f'android writable={writable}: no page errors', not errs, errs[:3])
            ctx.close()
        browser.close()

    ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
    print(f'\n{ok} passed, {len(bad)} failed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

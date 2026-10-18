"""FaleNetwork web tools inside the app (js/webtools/, wt-app/<lang>/<id>.html in a same-origin frame).

- tool list: the web tools the app does not have natively appear in the groups + own sections, no twin of a
  native tool, search also finds keywords; clicking a card opens #/web/<id>
- library file → tool (?doc=) → run → „Speichern“ puts the result into the app's library (toast „Öffnen“)
- several results → „Alle speichern“; „Aus meinen Dateien“ picks from the library; formats the library can't hold
  (ZIP, SVG …) are saved to the device; file-less tools (calculators) load without a picker
- links: to another tool → stays in the app (#/web/<id>); external → „Externen Link öffnen?“; „Weiter mit“ adds no
  history entry; theme follows the app; English pages in English; no page errors, no horizontal scroll
- Android app (mocked Capacitor): share → system share sheet with the file; ZIP → saved into Documents
- web build (dist): vendor paths re-based onto /vendor/, no 404 for the tool code, a PDF tool runs from dist
Run: python3 test_webtools_app.py   (servers: node tests/suites/sec/csp_server.mjs 9411 /home/claude/FalePDF and
     node tests/suites/sec/csp_server.mjs 9412 /home/claude/FalePDF/dist after FALE_MINIFY=0 node scripts/vercel-build.mjs)
"""
import os, re, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9411/')
DIST_URL = os.environ.get('DIST_URL', 'http://127.0.0.1:9412/')
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


NATIVE = r"""
window.__n = { share: [], fs: [] };
const N = window.__n;
const Filesystem = {
  writeFile: async o => { N.fs.push(['write', o.path, o.directory]); return { uri: 'file:///cache/' + o.path }; },
  appendFile: async o => { N.fs.push(['append', o.path, o.directory]); },
  stat: async () => { throw new Error('nope'); },
  getUri: async o => ({ uri: 'file:///cache/' + o.path }),
  deleteFile: async () => {}, mkdir: async () => {},
};
const Share = { share: async o => { N.share.push(o); return {}; } };
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', convertFileSrc: p => p,
  Plugins: { Filesystem, Share, FaleIncoming: { takePending: async () => ({ files: [] }), addListener: async () => ({ remove() {} }), setBarColors: async () => {}, setSecure: async () => {} },
    NativePurchases: {}, AdMob: { initialize: async () => {} } } };
"""


def ctx_for(browser, locale='de-DE', native=False, theme=None, w=390):
    ctx = browser.new_context(viewport={'width': w, 'height': 844}, locale=locale, is_mobile=w < 600, has_touch=w < 600)
    if native:
        ctx.add_init_script(NATIVE)
    ctx.add_init_script("localStorage.setItem('fale-onboarded', '1');" + (f"localStorage.setItem('fale-theme', '{theme}');" if theme else ''))
    return ctx


def watch(page):
    errs = []
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errs.append(m.text[:300]))
    return errs


def doc_id(page, name):
    return page.evaluate(f"async () => ((await (await import('./js/db.js')).listDocs()).find(d => d.name === '{name}') || {{}}).id || null")


def import_pdf(page, name):
    page.set_input_files('#pdf-input', os.path.join(TD, name))
    for _ in range(60):   # (wait_for_function with an async predicate would pass at once – poll instead)
        did = doc_id(page, name)
        if did:
            return did
        page.wait_for_timeout(250)
    raise RuntimeError(name + ' not imported')


def wait_docs(page, n, timeout=15):
    for _ in range(int(timeout * 4)):
        if doc_count(page) == n:
            return True
        page.wait_for_timeout(250)
    return False


def doc_count(page):
    return page.evaluate("async () => (await (await import('./js/db.js')).listDocs()).length")


def frame(page):
    page.wait_for_selector('iframe.wt-host-frame', timeout=10000)
    fr = page.frame_locator('iframe.wt-host-frame')
    fr.locator('#wt-app').wait_for(timeout=15000)
    return fr


def frame_obj(page):
    return next(f for f in page.frames if '/wt-app/' in f.url)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = ctx_for(browser)
        page = ctx.new_page()
        errs = watch(page)
        page.goto(URL + '#/werkzeuge'); page.wait_for_selector('#view-werkzeuge .tool-card'); page.wait_for_timeout(1500)

        def tool_list():
            ids = page.evaluate("Array.from(document.querySelectorAll('a.tool-card[data-tool^=\"web-\"]')).map(a => a.dataset.tool.slice(4))")
            twins = page.evaluate("async () => [...(await import('./js/webtools/list.js')).NATIVE_TWINS]")
            check('web tools listed in the app (≥ 40)', len(ids) >= 40, len(ids))
            check('no twin of a native app tool listed', not (set(ids) & set(twins)), set(ids) & set(twins))
            check('screen recorder not offered (no screen capture in the web view)', 'screen-recorder' not in ids)
            for want in ('overlay-pdf', 'n-up', 'booklet', 'remove-blank-pages', 'repair-pdf', 'grayscale-pdf', 'pdf-to-markdown', 'edit-metadata', 'flatten-pdf', 'remove-background', 'invoice-generator', 'girocode'):
                check(f'listed: {want}', want in ids)
            titles = page.locator('#view-werkzeuge .section-title').all_inner_texts()
            check('own sections „Bilder & Fotos“ + „Rechner & Text“', 'Bilder & Fotos' in titles and 'Rechner & Text' in titles, titles)
            check('everyday tools in „Alltag & Organisation“', page.locator('.alltag-grid a[data-tool="web-receipt"]').count() == 1)
            page.fill('#tool-search', 'briefpapier'); page.wait_for_timeout(300)
            vis = page.evaluate("Array.from(document.querySelectorAll('#view-werkzeuge .tool-card')).filter(c => !c.hidden).map(c => c.dataset.tool)")
            check('search „briefpapier“ finds the letterhead tool', 'web-overlay-pdf' in vis, vis)
            page.fill('#tool-search', ''); page.wait_for_timeout(200)
            page.locator('a.tool-card[data-tool="web-grayscale-pdf"]').click()
            page.wait_for_function("() => location.hash === '#/web/grayscale-pdf'")
            fr = frame(page)
            check('card opens the tool (header title, frame with picker)', page.locator('.screen-title').inner_text() == 'PDF in Graustufen' and fr.locator('[data-wt-input]').count() == 1)
            check('„Aus meinen Dateien“ next to the picker', fr.locator('[data-wt-library]').count() == 1)
            check('no site header/footer/SEO texts in the frame', fr.locator('header.site-head, footer.site-foot, .wt-info').count() == 0)
        step('tool list', tool_list)

        def run_and_save():
            did = import_pdf(page, 'bericht.pdf')
            page.goto(URL + f'#/web/n-up?doc={did}')
            fr = frame(page)
            fr.locator('.wt-file').first.wait_for(timeout=10000)
            check('library file handed to the tool (?doc=)', fr.locator('#wt-app').get_attribute('data-state') == 'files')
            fr.locator('.wt-btn-primary.wt-btn-lg').click()
            fr.locator('.wt-output').first.wait_for(timeout=30000)
            check('result button says „Speichern“ in the app', fr.locator('.wt-output .wt-btn-primary').first.inner_text().strip() == 'Speichern')
            n0 = doc_count(page)
            fr.locator('.wt-output .wt-btn-primary').first.click()
            check('library +1', wait_docs(page, n0 + 1), doc_count(page))
            t = page.locator('#toasts').inner_text()
            check('result saved into the library + toast with „Öffnen“', 'in deinen Dateien gespeichert' in t and 'Öffnen' in t, t)
            new = page.evaluate("async () => (await (await import('./js/db.js')).listDocs()).find(d => /pro Blatt/.test(d.name))")
            check('saved result is a real PDF entry (pages counted)', new and new['pages'] and new['pages'] >= 1, new)
            page.locator('#toasts .toast-btn').first.click()
            page.wait_for_function("() => location.hash.startsWith('#/ansicht/')", timeout=8000)
            check('„Öffnen“ opens the result in the viewer', True)
        step('run + save into library', run_and_save)

        def several():
            did = doc_id(page, 'bericht.pdf')
            page.goto(URL + f'#/web/split-pdf?doc={did}')
            fr = frame(page)
            fr.locator('.wt-file').first.wait_for(timeout=10000)
            fr.locator('label.wt-radio:has(input[value="every"])').click()   # every 2 pages → 3 files
            fr.locator('.wt-btn-primary.wt-btn-lg').click()
            fr.locator('.wt-output').first.wait_for(timeout=30000)
            outs = fr.locator('.wt-output').count()
            n0 = doc_count(page)
            if outs > 1:
                fr.locator('.wt-btn-primary.wt-btn-lg').click()  # sticky bar: „Alle speichern“
                check(f'„Alle speichern“ puts all {outs} results into the library', wait_docs(page, n0 + outs), (n0, outs, doc_count(page)))
                check('toast „N Dateien in deinen Dateien gespeichert“', f'{outs} Dateien in deinen Dateien gespeichert' in page.locator('#toasts').inner_text())
            else:
                check('split produced several files', False, outs)
        step('several results', several)

        def library_chip():
            page.goto(URL + '#/web/remove-blank-pages')
            fr = frame(page)
            fr.locator('[data-wt-library]').click()
            page.wait_for_selector('dialog.dlg .pick-item', timeout=8000)
            names = page.locator('dialog.dlg .pick-item .doc-name').all_inner_texts()
            check('library picker lists PDFs', any(n.endswith('.pdf') for n in names), names)
            page.locator('dialog.dlg .pick-item').first.click()
            page.locator('dialog.dlg button.btn-primary').click()
            fr.locator('.wt-file').first.wait_for(timeout=10000)
            check('picked library file arrives in the tool', fr.locator('.wt-file').count() == 1)
        step('„Aus meinen Dateien“', library_chip)

        def doc_menu():
            page.goto(URL + '#/dateien'); page.wait_for_selector('#view-dateien .more-btn', timeout=10000)
            row = page.locator('#view-dateien .doc-row:has-text("bericht.pdf"), #view-dateien [data-id]:has-text("bericht.pdf")').first
            (row.locator('.more-btn') if row.count() else page.locator('#view-dateien .more-btn').first).click()
            page.locator('.menu-item:has-text("Mehr Werkzeuge")').click()
            page.wait_for_selector('dialog.dlg a.tool-card', timeout=5000)
            ids = page.evaluate("Array.from(document.querySelectorAll('dialog.dlg a.tool-card')).map(a => a.dataset.tool)")
            check('document menu „Mehr Werkzeuge …“ lists PDF web tools only', 'web-overlay-pdf' in ids and 'web-vat-calculator' not in ids and 'web-remove-background' not in ids, ids[:8])
            page.fill('dialog.dlg [data-q]', 'broschüre'); page.wait_for_timeout(200)
            vis = page.evaluate("Array.from(document.querySelectorAll('dialog.dlg a.tool-card')).filter(a => !a.hidden).map(a => a.dataset.tool)")
            check('search in the chooser', vis == ['web-booklet'], vis)
            page.locator('dialog.dlg a.tool-card[data-tool="web-booklet"]').click()
            page.wait_for_function("() => location.hash.startsWith('#/web/booklet?doc=')", timeout=5000)
            fr = frame(page)
            fr.locator('.wt-file').first.wait_for(timeout=10000)
            check('chosen tool opens with the file', page.locator('dialog.dlg').count() == 0)
        step('document menu', doc_menu)

        def nofile_tool():
            page.goto(URL + '#/web/vat-calculator')
            fr = frame(page)
            page.wait_for_timeout(1200)
            check('calculator: no picker, no library chip', fr.locator('[data-wt-pick]').is_hidden() and fr.locator('[data-wt-library]').count() == 0)
            check('calculator UI rendered', fr.locator('input').count() >= 2)
        step('file-less tool', nofile_tool)

        def links():
            page.goto(URL + '#/web/booklet')
            frame(page)
            f = frame_obj(page)
            h0 = page.evaluate('history.length')
            f.evaluate("() => { const a = document.createElement('a'); a.href = '/werkzeuge/pdf-unterschreiben/'; a.textContent = 'x'; a.id = 'l1'; document.body.append(a); }")
            f.click('#l1')
            page.wait_for_function("() => location.hash === '#/web/sign-pdf'", timeout=8000)
            check('link to another tool stays in the app (#/web/sign-pdf)', True)
            frame(page)
            f = frame_obj(page)
            f.evaluate("() => { const a = document.createElement('a'); a.href = 'https://example.org/x'; a.textContent = 'x'; a.id = 'l2'; document.body.append(a); }")
            f.click('#l2')
            page.wait_for_selector('dialog.dlg', timeout=5000)
            check('external link asks first („Externen Link öffnen?“)', 'Externen Link' in page.locator('dialog.dlg').inner_text())
            page.locator('dialog.dlg button').first.click()
            check('frame did not navigate away', '/wt-app/' in frame_obj(page).url)
        step('links', links)

        def continue_with():
            did = doc_id(page, 'bericht.pdf')
            page.goto(URL + f'#/web/grayscale-pdf?doc={did}')
            fr = frame(page)
            fr.locator('.wt-file').first.wait_for(timeout=10000)
            fr.locator('.wt-btn-primary.wt-btn-lg').click()
            fr.locator('.wt-output').first.wait_for(timeout=30000)
            nxt = fr.locator('.wt-next-chip').first
            want = nxt.inner_text().strip()
            h0 = page.evaluate('history.length')
            nxt.click()
            page.wait_for_function("() => [...document.querySelectorAll('iframe.wt-host-frame')].some(f => !f.contentWindow.location.pathname.endsWith('/grayscale-pdf.html'))", timeout=10000)
            page.wait_for_timeout(1200)
            check('„Weiter mit“ opens the next tool in the frame', True)
            check('header follows the next tool', page.locator('.screen-title').inner_text() == want, (want, page.locator('.screen-title').inner_text()))
            check('no extra history entry (back button leaves the tool)', page.evaluate('history.length') == h0, (h0, page.evaluate('history.length')))
            fr2 = page.frame_locator('iframe.wt-host-frame')
            fr2.locator('.wt-file').first.wait_for(timeout=10000)
            check('result handed on to the next tool', fr2.locator('.wt-file').count() >= 1)
        step('Weiter mit', continue_with)

        def layout():
            page.goto(URL + '#/web/overlay-pdf')
            frame(page)
            f = frame_obj(page)
            check('frame: no horizontal scroll at 390 px', f.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'))
            check('frame page errors: none', not errs, errs[:4])
        step('layout', layout)
        ctx.close()

        def dark_english():
            c2 = ctx_for(browser, locale='en-GB', theme='dark')
            pg = c2.new_page()
            e2 = watch(pg)
            pg.goto(URL + '#/werkzeuge'); pg.wait_for_selector('a.tool-card[data-tool="web-n-up"]', timeout=10000)
            check('English tool list shows English names', 'Multiple pages per sheet' in pg.locator('a.tool-card[data-tool="web-n-up"]').inner_text() or 'per sheet' in pg.locator('a.tool-card[data-tool="web-n-up"]').inner_text(), pg.locator('a.tool-card[data-tool="web-n-up"]').inner_text())
            pg.goto(URL + '#/web/n-up')
            frame(pg)
            f = next(x for x in pg.frames if '/wt-app/' in x.url)
            check('English page in the frame', '/wt-app/en/n-up.html' in f.url and f.evaluate('document.documentElement.lang') == 'en')
            check('frame follows the app theme (dark)', f.evaluate('document.documentElement.dataset.theme') == 'dark')
            check('„From my files“ chip in English', 'From my files' in pg.frame_locator('iframe.wt-host-frame').locator('[data-wt-library]').inner_text())
            check('English: no page errors', not e2, e2[:3])
            c2.close()
        step('dark + English', dark_english)

        def native():
            c3 = ctx_for(browser, native=True)
            pg = c3.new_page()
            e3 = watch(pg)
            pg.goto(URL + '#/start'); pg.wait_for_timeout(1500)
            did = pg.evaluate("""async () => { const lib = await import('./js/library.js'); const b = await (await fetch('./tests/base/testdata/bericht.pdf')).blob();
                return (await lib.importFiles([new File([b], 'bericht.pdf', { type: 'application/pdf' })]))[0].id; }""")
            pg.goto(URL + f'#/web/split-pdf?doc={did}')
            fr = frame(pg)
            fr.locator('.wt-file').first.wait_for(timeout=10000)
            fr.locator('label.wt-radio:has(input[value="every"])').click()
            fr.locator('.wt-btn-primary.wt-btn-lg').click()
            fr.locator('.wt-output').first.wait_for(timeout=30000)
            fr.locator('.wt-output .wt-btn-quiet').first.click()   # „Teilen“ on the first result
            pg.wait_for_function('() => window.__n.share.length > 0', timeout=8000)
            s = pg.evaluate('window.__n.share[0]')
            check('Android: share → system share sheet with the file', s and s['files'] and s['files'][0].startswith('file:///cache/share/'), s)
            # a format the library can't hold → Documents
            r = pg.evaluate("""async () => { await window.__faleWtHost.save([{ blob: new Blob(['PK\\x03\\x04'], { type: 'application/zip' }), name: 'Teile.zip' }]); return window.__n.fs; }""")
            check('Android: ZIP result saved into Documents', any(x[2] == 'DOCUMENTS' and x[1].endswith('Teile.zip') for x in r), r)
            check('Android: no page errors', not e3, e3[:3])
            c3.close()
        step('Android (mocked)', native)

        def dist():
            c4 = ctx_for(browser)
            pg = c4.new_page()
            e4 = watch(pg)
            missing = []
            pg.on('response', lambda r: r.status == 404 and missing.append(r.url))
            pg.goto(DIST_URL + '#/werkzeuge'); pg.wait_for_selector('#view-werkzeuge .tool-card', timeout=15000)
            did = import_pdf(pg, 'bericht.pdf')
            pg.goto(DIST_URL + f'#/web/pdf-to-markdown?doc={did}')
            fr = frame(pg)
            fr.locator('.wt-file').first.wait_for(timeout=10000)
            for _ in range(40):   # the import toast lies over the frame's action bar for a few seconds
                if not pg.evaluate("document.querySelectorAll('#toasts .toast').length"):
                    break
                pg.wait_for_timeout(250)
            fr.locator('.wt-btn-primary.wt-btn-lg').click()
            fr.locator('.wt-output').first.wait_for(timeout=30000)
            check('dist: PDF → Markdown runs (pdf.js from /vendor/)', True)
            check('dist: no 404 (tool code, vendor, font)', not missing, missing[:5])
            check('dist: no page errors', not e4, e4[:3])
            c4.close()
        if os.path.isdir('/home/claude/FalePDF/dist/wt-app'):
            step('web build (dist)', dist)
        browser.close()
    ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
    print(f'\n{ok} passed, {len(bad)} failed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

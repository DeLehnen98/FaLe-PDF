"""FaLe PDF on a computer (installed web app or browser window): what desktop PDF programs do.
- tabs: every document opened in this session gets a tab above the page (wide screens only); a click switches
  (fast, the reading position stays), × or the middle mouse button closes, closing the open tab moves to the next
  one, closing the last one goes back home; a deleted document loses its tab; phones never show tabs
- Ctrl+O opens the file dialog on the start page and in the viewer (not while a dialog is open)
- company settings (js/policy.js, Managed Configuration API of force-installed web apps): cloudAi/post/cloudShare
  false → switched off and cannot be switched on, the „Ich“ screen says so; no policy any more → everything back
- no console errors, no horizontal scroll
Run: node tests/suites/sec/csp_server.mjs 9202 <repo> ; python3 tests/suites/test_desktop.py
"""
import base64, json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['purge/rl_std.pdf', 'purge/lo.pdf', 'lotse/wohngeld.pdf']
results = []


def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not info else f'  [{str(info)[:300]}]'))


def poll(page, js, ms=10000, every=60):
    """Poll a JS predicate from Python (the app's CSP forbids the string evaluation of wait_for_function)."""
    end = time.time() + ms / 1000
    while time.time() < end:
        try:
            if page.evaluate(js):
                return True
        except Exception:
            pass
        time.sleep(every / 1000)
    raise TimeoutError(js[:120])


def chooser_on_ctrl_o(page):
    try:
        with page.expect_file_chooser(timeout=4000) as fc:
            page.keyboard.press('Control+o')
        return fc.value is not None
    except Exception:
        return False


def tabs(page):
    return page.evaluate("[...document.querySelectorAll('#viewer .v-tabs .v-tab')].map(t => ({ name: t.querySelector('.v-tab-go').textContent, on: t.classList.contains('on') }))")


def tabs_visible(page):
    return page.evaluate("(() => { const b = document.querySelector('#viewer .v-tabs'); return !!b && !b.hidden && b.offsetHeight > 0; })()")


def wait_doc(page, doc_id):
    # the document's own tab is marked (set while it opens) and its pages are drawn
    poll(page, f"location.hash.includes({json.dumps(doc_id)}) && (JSON.parse(sessionStorage.getItem('fale-tabs') || '[]').some(t => t.id === {json.dumps(doc_id)})) && document.querySelector('#viewer [data-v=loading]').hidden && !!document.querySelector('#viewer:not([hidden]) .pdfViewer .page canvas') && document.title.startsWith(JSON.parse(sessionStorage.getItem('fale-tabs')).find(t => t.id === {json.dumps(doc_id)}).name)", 15000)


def main():
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1366, 'height': 768}, locale='de-DE')
        ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}")
        page = ctx.new_page()
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_selector('#view-start .hero', timeout=30000)
        ids = []
        for f in FILES:
            b = base64.b64encode(open(os.path.join(HERE, f), 'rb').read()).decode()
            ids.append(page.evaluate("""async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
              const lib = await import('./js/library.js'); return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }""", [b, os.path.basename(f)]))

        # one document: no tab bar (nothing to switch)
        page.evaluate(f"location.hash = '#/ansicht/{ids[0]}'")
        wait_doc(page, ids[0])
        check('one open document: no tab bar', not tabs_visible(page))
        page.evaluate(f"location.hash = '#/ansicht/{ids[1]}'")
        wait_doc(page, ids[1])
        page.evaluate(f"location.hash = '#/ansicht/{ids[2]}'")
        wait_doc(page, ids[2])
        t = tabs(page)
        check('three documents: three tabs, the open one marked', tabs_visible(page) and len(t) == 3 and [x['on'] for x in t] == [False, False, True], t)
        check('tab names without .pdf', [x['name'] for x in t] == ['rl_std', 'lo', 'wohngeld'], t)
        h = page.evaluate("document.querySelector('#viewer .v-tabs').offsetHeight")
        check('tab bar is one slim row (≤ 50 px)', 20 < h <= 50, h)

        # reading position survives switching
        page.evaluate("document.querySelector('#viewer [data-v=pagenum]').value")
        page.click('#viewer .v-tab:nth-child(2) .v-tab-go')
        t0 = time.time()
        wait_doc(page, ids[1])
        dt = time.time() - t0
        check(f'switching tabs is quick ({dt:.2f} s < 1.5 s)', dt < 1.5, dt)
        check('switched tab is marked', [x['on'] for x in tabs(page)] == [False, True, False], tabs(page))
        pages0 = page.evaluate("+document.querySelector('#viewer [data-v=pagecount]').textContent")
        if pages0 > 1:
            page.evaluate("document.querySelector('#viewer [data-v=next]').click()")
            page.wait_for_timeout(900)
            page.click('#viewer .v-tab:nth-child(1) .v-tab-go'); wait_doc(page, ids[0])
            page.click('#viewer .v-tab:nth-child(2) .v-tab-go'); wait_doc(page, ids[1])
            page.wait_for_timeout(600)
            pn = page.evaluate("document.querySelector('#viewer [data-v=pagenum]').value")
            check('reading position kept when coming back to a tab', pn == '2', pn)

        # middle click closes a tab that is not open
        page.click('#viewer .v-tab:nth-child(1) .v-tab-go', button='middle')
        page.wait_for_timeout(300)
        t = tabs(page)
        check('middle click closes that tab, the open document stays', [x['name'] for x in t] == ['lo', 'wohngeld'] and t[0]['on'] and ids[1] in page.evaluate('location.hash'), t)
        # × on the open tab → the next one opens
        page.click('#viewer .v-tab.on .v-tab-x')
        wait_doc(page, ids[2])
        t = tabs(page)
        check('× on the open tab opens the next document; one left → no bar', len(t) == 1 and not tabs_visible(page), t)

        # Ctrl+O in the viewer and on the start page
        page.click('#viewer [data-v=container]', position={'x': 20, 'y': 20})
        check('Ctrl+O in the viewer opens the file dialog', chooser_on_ctrl_o(page))
        page.evaluate("location.hash = '#/'")
        poll(page, "document.querySelector('#viewer').hidden && !!document.querySelector('#view-start .hero')")
        page.wait_for_timeout(300)
        st = page.evaluate("({ dlg: !!document.querySelector('dialog[open]'), active: document.activeElement && document.activeElement.tagName })")
        check('Ctrl+O on the start page opens the file dialog', chooser_on_ctrl_o(page), st)

        # a deleted document loses its tab
        page.evaluate(f"location.hash = '#/ansicht/{ids[0]}'"); wait_doc(page, ids[0])
        page.evaluate(f"import('./js/db.js').then(m => m.deleteDoc({json.dumps(ids[1])}))")
        page.evaluate(f"location.hash = '#/ansicht/{ids[1]}'")
        page.wait_for_timeout(1500)
        names = page.evaluate("JSON.parse(sessionStorage.getItem('fale-tabs') || '[]').map(t => t.name)")
        check('deleted document: its tab is gone', 'lo.pdf' not in names, names)

        over = page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
        check('desktop: no horizontal scroll', not over)
        page.screenshot(path=os.path.join(HERE, 'out_desktop_tabs.png'))

        # phone: never tabs
        ph = br.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True, locale='de-DE')
        ph.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
        pp = ph.new_page()
        pp.on('pageerror', lambda e: errors.append(str(e)))
        pp.goto(URL); pp.wait_for_selector('#view-start .hero', timeout=30000)
        pids = []
        for f in FILES[:2]:
            b = base64.b64encode(open(os.path.join(HERE, f), 'rb').read()).decode()
            pids.append(pp.evaluate("""async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
              const lib = await import('./js/library.js'); return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }""", [b, os.path.basename(f)]))
        for i in pids:
            pp.evaluate(f"location.hash = '#/ansicht/{i}'"); wait_doc(pp, i)
        check('phone: no tab bar', not tabs_visible(pp))
        ph.close()

        # company settings via the Managed Configuration API (mocked: real policies need a managed browser)
        for cfg in ({'cloudAi': False, 'post': False, 'cloudShare': False}, {}):
            mc = br.new_context(viewport={'width': 1366, 'height': 768}, locale='de-DE')
            mc.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}"
                               + "Object.defineProperty(Navigator.prototype, 'managed', { configurable: true, get() { return { getManagedConfiguration: async keys => JSON.parse(%s), addEventListener() {} }; } });" % json.dumps(json.dumps(cfg)))
            if not cfg:  # a PC that was managed before: the stored settings must go away
                mc.add_init_script("try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('fale-policy', JSON.stringify({ cloudAi: false })); } } catch (e) {}")
            mp = mc.new_page()
            mp.on('pageerror', lambda e: errors.append(str(e)))
            mp.goto(URL); mp.wait_for_selector('#view-start .hero', timeout=30000)
            poll(mp, "localStorage.getItem('fale-policy') !== null" if cfg else "localStorage.getItem('fale-policy') === null", 5000)
            r = mp.evaluate("""async () => {
              const P = await import('./js/policy.js'), H = await import('./js/ai/hidden.js'), C = await import('./js/ai/client.js'), Po = await import('./js/post/api.js'), S = await import('./js/share/api.js');
              C.setCloudDisabled(false);
              let share = 'ok'; try { await S.shareConfig({ force: true }); } catch (e) { share = e.userMessage || String(e); }
              const cfg = await Po.postConfig({ force: true }).catch(() => ({ enabled: 'error' }));
              return { policy: P.policy(), aiHidden: H.aiHidden(), cloudOff: C.cloudDisabled(), postKnown: Po.postKnown(), postEnabled: cfg.enabled, share }; }""")
            mp.evaluate("location.hash = '#/einstellungen'")
            mp.wait_for_timeout(900)
            card = mp.evaluate("(() => { const c = document.querySelector('.policy-card'); return c ? c.textContent.replace(/\\s+/g, ' ') : ''; })()")
            if cfg:
                check('company settings: stored on the device', r['policy'] == {'cloudAi': False, 'post': False, 'cloudShare': False}, r)
                check('company settings: Cloud-KI hidden and stays off (cannot be switched on)', r['aiHidden'] and r['cloudOff'], r)
                check('company settings: Brief per Post / Fax off', r['postKnown'] is False and r['postEnabled'] is False, r)
                check('company settings: sharing over the internet refused with a clear message', 'Firma' in r['share'], r['share'])
                check('„Ich“ screen: „Von deiner Firma eingestellt“ with the three switched-off parts', 'Von deiner Firma eingestellt' in card and 'Cloud-KI' in card and 'Post' in card and 'Teilen' in card, card)
                mp.evaluate("location.hash = '#/ki/einstellungen'")
                mp.wait_for_timeout(900)
                t = mp.evaluate("document.querySelector('#tool-screen') && !document.querySelector('#tool-screen').hidden ? document.querySelector('#tool-screen').textContent : ''")
                check('KI settings: only the note, no switch to turn it on', 'von deiner Firma' in t.lower() or 'Von deiner Firma' in t, t[:200])
            else:
                check('no company settings any more: everything is back (stored settings removed)', r['policy'] is None and not r['aiHidden'] and not r['cloudOff'] and not card, r)
            mc.close()

        check('no console errors', not errors, errors[:5])
        br.close()
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

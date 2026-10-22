"""Werbebanner der Android-App (js/banner.js) – mit nachgebautem AdMob-Plugin im Browser.
- auf den Hauptseiten genau ein Banner unten (ADAPTIVE_BANNER, BOTTOM_CENTER, Test-ID), darüber der Streifen „Anzeige“;
  die App rückt nach oben: Navigation, Plus-Knopf und Meldungen liegen über dem Banner, nichts wird verdeckt
- weg in Dokumenten, Werkzeugen, Dialogen, Menüs und beim Tippen (Tastatur) – danach wieder da
- keine Banner: mit FaLe Pro, vor der Einführung, in der Web-Version, in der iPhone-App, wenn keine Anzeige kommt
- keine Konsolenfehler
Run: node tests/suites/sec/csp_server.mjs 9202 <repo> ; python3 tests/suites/test_banner.py
"""
import base64, json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
HERE = os.path.dirname(os.path.abspath(__file__))
results = []


def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not info else f'  [{str(info)[:300]}]'))


def poll(page, js, ms=8000):
    end = time.time() + ms / 1000
    while time.time() < end:
        try:
            if page.evaluate(js):
                return True
        except Exception:
            pass
        time.sleep(0.06)
    return False


MOCK = """
window.__ad = { calls: [], listeners: {}, fail: %(fail)s };
const admob = {
  initialize: async () => {}, requestConsentInfo: async () => ({ status: 'OBTAINED', canRequestAds: true, isConsentFormAvailable: false }),
  showConsentForm: async () => ({ status: 'OBTAINED', canRequestAds: true }),
  addListener(ev, cb) { (window.__ad.listeners[ev] = window.__ad.listeners[ev] || []).push(cb); return Promise.resolve({ remove() {} }); },
  async showBanner(o) { window.__ad.calls.push(['show', o]); setTimeout(() => (window.__ad.listeners[window.__ad.fail ? 'bannerAdFailedToLoad' : 'bannerAdSizeChanged'] || []).forEach(f => f(window.__ad.fail ? { code: 3 } : { width: 360, height: 50 })), 30); },
  async hideBanner() { window.__ad.calls.push(['hide']); }, async resumeBanner() { window.__ad.calls.push(['resume']); },
  async removeBanner() { window.__ad.calls.push(['remove']); },
};
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => '%(platform)s', convertFileSrc: x => x, Plugins: { AdMob: admob } };
try { localStorage.setItem('fale-onboarded', '%(onboarded)s'); %(extra)s } catch (e) {}
"""


def ctx_page(br, platform='android', onboarded='1', extra='', fail='false', native=True, size=(360, 740)):
    ctx = br.new_context(viewport={'width': size[0], 'height': size[1]}, is_mobile=size[0] < 700, has_touch=size[0] < 700, locale='de-DE')
    if native:
        ctx.add_init_script(MOCK % {'platform': platform, 'onboarded': onboarded, 'extra': extra, 'fail': fail})
    else:
        ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL)
    page.wait_for_selector('#app', timeout=30000)
    page.wait_for_timeout(2500)
    return ctx, page, errs


calls = lambda p: p.evaluate("(window.__ad || { calls: [] }).calls.map(c => c[0])")
has_ad = lambda p: p.evaluate("document.documentElement.classList.contains('has-ad')")


def geometry(page):
    return page.evaluate("""(() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height, vis: getComputedStyle(e).display !== 'none' }; };
      return { vh: innerHeight, slot: r('.ad-slot'), nav: r('.bottom-nav'), fab: r('.fab'), main: r('#main'), label: (document.querySelector('.ad-slot span') || {}).textContent };
    })()""")


def main():
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx, page, errs = ctx_page(br)
        ok = poll(page, "document.documentElement.classList.contains('has-ad')", 8000)
        c = page.evaluate("window.__ad.calls")
        check('Start: one banner requested (adaptive, bottom, test unit)', ok and len([x for x in c if x[0] == 'show']) == 1 and c[0][1]['adSize'] == 'ADAPTIVE_BANNER' and c[0][1]['position'] == 'BOTTOM_CENTER' and c[0][1]['adId'].startswith('ca-app-pub-3940256099942544/'), c)
        g = geometry(page)
        check('space for the banner + „Anzeige“ strip (50 + 18 px) at the bottom', g['slot']['vis'] and abs(g['slot']['h'] - 68) <= 1 and abs(g['slot']['bottom'] - g['vh']) <= 1 and g['label'] == 'Anzeige', g)
        check('navigation sits fully above the strip (not next to the banner)', g['nav']['bottom'] <= g['slot']['top'] + 0.5, g)
        check('content area ends above the navigation – nothing covered', g['main']['bottom'] <= g['nav']['top'] + 0.5, g)
        check('„+“ button above the strip', g['fab']['bottom'] <= g['slot']['top'] - 8 if g['fab'] and g['fab']['vis'] else True, g)

        for name, hsh in (('Dateien', '#/dateien'), ('Werkzeuge', '#/werkzeuge'), ('Ich', '#/einstellungen')):
            page.evaluate(f"location.hash = '{hsh}'")
            page.wait_for_timeout(600)
            check(f'{name}: banner stays', has_ad(page))

        # a document: no banner
        b = base64.b64encode(open(os.path.join(HERE, 'purge/rl_std.pdf'), 'rb').read()).decode()
        doc = page.evaluate("""async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const lib = await import('./js/library.js'); return (await lib.importPdf(bin, { name: 'brief.pdf', source: 'Test', silent: true })).id; }""", b)
        page.evaluate(f"location.hash = '#/ansicht/{doc}'")
        poll(page, "!document.querySelector('#viewer').hidden", 8000)
        hid = poll(page, "!document.documentElement.classList.contains('has-ad')", 3000)
        check('document open: banner hidden', hid and calls(page)[-1] == 'hide', calls(page))
        page.evaluate("location.hash = '#/start'")
        back = poll(page, "document.documentElement.classList.contains('has-ad')", 4000)
        check('back on Start: banner shown again (resume, not a second banner)', back and calls(page)[-1] == 'resume' and calls(page).count('show') == 1, calls(page))

        # a tool screen
        page.evaluate("location.hash = '#/werkzeug/zusammenfuegen'")
        poll(page, "!document.querySelector('#tool-screen').hidden", 8000)
        check('tool open: banner hidden', poll(page, "!document.documentElement.classList.contains('has-ad')", 3000))
        page.evaluate("location.hash = '#/start'")
        poll(page, "document.documentElement.classList.contains('has-ad')", 4000)

        # a dialog
        page.evaluate("import('./js/ui.js').then(m => { window.__dlg = m.confirmDialog('Test', 'Frage?'); })")
        poll(page, "!!document.querySelector('dialog[open]')", 3000)
        check('dialog open: banner hidden', poll(page, "!document.documentElement.classList.contains('has-ad')", 3000))
        page.keyboard.press('Escape')
        check('dialog closed: banner back', poll(page, "document.documentElement.classList.contains('has-ad')", 4000))

        # typing (keyboard)
        page.evaluate("location.hash = '#/dateien'")
        page.wait_for_timeout(500)
        inp = page.locator('#view-dateien input').first
        if inp.count():
            inp.focus()
            check('typing in a field: banner hidden (keyboard)', poll(page, "!document.documentElement.classList.contains('has-ad')", 3000))
            page.evaluate("document.activeElement.blur()")
            check('done typing: banner back', poll(page, "document.documentElement.classList.contains('has-ad')", 4000))
        check('no console errors (Android)', not errs, errs[:4])
        page.screenshot(path=os.path.join(HERE, 'out_banner_start.png'))
        ctx.close()

        # Einfache Ansicht: still with the strip, nothing covered
        ctx, page, errs = ctx_page(br, extra="localStorage.setItem('fale-simple', '1');")
        poll(page, "document.documentElement.classList.contains('has-ad')", 8000)
        g = geometry(page)
        check('Einfache Ansicht: navigation above the strip', has_ad(page) and g['nav']['bottom'] <= g['slot']['top'] + 0.5, g)
        ctx.close()

        # no banners
        ctx, page, errs = ctx_page(br, extra="localStorage.setItem('fale-plus-info', JSON.stringify({ product: 'fale_plus_lifetime', lifetime: true }));")
        page.wait_for_timeout(1500)
        check('FaLe Pro: no banner at all', 'show' not in calls(page) and not has_ad(page), calls(page))
        ctx.close()
        ctx, page, errs = ctx_page(br, extra="localStorage.setItem('fale-plus-info', JSON.stringify({ product: 'fale_plus_monthly', expiresAt: '2020-01-01T00:00:00Z' }));")
        check('Plus expired: banner again', poll(page, "document.documentElement.classList.contains('has-ad')", 8000))
        ctx.close()
        ctx, page, errs = ctx_page(br, onboarded='0')
        page.wait_for_timeout(1500)
        check('first start (introduction): no banner', 'show' not in calls(page), calls(page))
        ctx.close()
        ctx, page, errs = ctx_page(br, platform='ios')
        page.wait_for_timeout(1500)
        check('iPhone app: no banner', 'show' not in calls(page) and not has_ad(page), calls(page))
        ctx.close()
        ctx, page, errs = ctx_page(br, native=False)
        g = geometry(page)
        check('web version: no banner, no strip', not has_ad(page) and not g['slot']['vis'], g)
        check('no console errors (web)', not errs, errs[:4])
        ctx.close()
        ctx, page, errs = ctx_page(br, fail='true')
        page.wait_for_timeout(1500)
        g = geometry(page)
        check('no ad available: no empty strip, layout as without ads', not has_ad(page) and not g['slot']['vis'] and 'remove' in calls(page), (calls(page), g))
        ctx.close()

        # tablet / wide layout
        ctx, page, errs = ctx_page(br, size=(1024, 768))
        poll(page, "document.documentElement.classList.contains('has-ad')", 8000)
        g = geometry(page)
        check('tablet: app ends above the strip', has_ad(page) and g['main']['bottom'] <= g['slot']['top'] + 0.5, g)
        ctx.close()
        br.close()
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

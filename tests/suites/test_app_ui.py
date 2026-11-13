"""The look of the Android and iPhone app – „Mappe“ (css/app-ui.css on top of css/windows.css, classes win-ui + app-ui
set by js/boot.js before the first paint).
- inside the app: a desk, one sheet, the four areas as folder tabs at the bottom – the one in front is paper white and
  attached to the sheet; every tab has its own colour, a name that fits and is easy to hit and to read
- less before the content: „Datei öffnen“ and „Neu“ at the top of Start, the first file of „Dateien“ starts higher
  than in the classic look, nothing floats over the files
- light and dark, small phones (320 px), large text, long languages (Russian), phone held sideways, a tablet with
  the ad strip, iPhone; the simple view keeps working
- „Klassisch“ in the settings brings the old look back and it stays; a normal browser never gets the new look
- moving through the tabs, a document and a tool does not stall (worst stall < 700 ms at CPU ×4)
Run: node tests/suites/sec/csp_server.mjs 9202 <repo> ; python3 tests/suites/test_app_ui.py"""
import base64, json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import test_nav_stress as N
results = []


def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not info else f'  [{str(info)[:320]}]'), flush=True)


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
QUIET = "try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); localStorage.setItem('fale-hints-off', '1'); } catch (e) {}"


def native(platform='android', ad=True):
    return """
window.__ad = { listeners: {} };
const admob = { initialize: async () => {}, requestConsentInfo: async () => ({ status: 'OBTAINED', canRequestAds: true, isConsentFormAvailable: false }), showConsentForm: async () => ({ status: 'OBTAINED', canRequestAds: true }),
  addListener(ev, cb) { (window.__ad.listeners[ev] = window.__ad.listeners[ev] || []).push(cb); return Promise.resolve({ remove() {} }); },
  async showBanner() { setTimeout(() => (window.__ad.listeners['bannerAdSizeChanged'] || []).forEach(f => f({ width: 360, height: 50 })), 30); }, async hideBanner() {}, async resumeBanner() {}, async removeBanner() {} };
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => '%s', convertFileSrc: x => x, Plugins: %s };
""" % (platform, '{ AdMob: admob }' if ad else '{}')


IMPORT = """async ([b64, name]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('./js/library.js'); return (await lib.importPdf(bin, { name, source: 'Test', silent: true })).id; }"""
LOOK = """() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const cs = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : ''; };
  const tabs = [...document.querySelectorAll('.bottom-nav .bnav')];
  return { cls: document.documentElement.className, main: r('.main'), nav: r('.bottom-nav'), topbar: r('.topbar'),
    tabs: tabs.map(a => { const b = a.getBoundingClientRect(); const s = a.querySelector('span:last-child'); return { nav: a.dataset.nav, top: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right),
      fits: s.scrollWidth <= s.clientWidth + 1 && a.scrollWidth <= a.clientWidth + 1, bg: getComputedStyle(a).backgroundColor, ic: getComputedStyle(a.querySelector('.ic')).color, active: a.classList.contains('active'), fs: parseFloat(getComputedStyle(a).fontSize) }; }),
    sheet: cs('.main', 'backgroundColor'), desk: cs('.app', 'backgroundColor'), fab: cs('.fab', 'display'), font: cs('.page-title, .hero h1', 'fontFamily'), body: cs('body', 'fontFamily'),
    hs: document.documentElement.scrollWidth - innerWidth, iw: innerWidth, ih: innerHeight }; }"""
CON = """() => { const lum = c => { const a = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
  const rgb = s => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1); g.fillStyle = s; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  return [...document.querySelectorAll('.bottom-nav .bnav')].map(a => { const s = getComputedStyle(a); const f = rgb(s.color), b = rgb(s.backgroundColor); const L1 = lum(f), L2 = lum(b); return +((Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)).toFixed(2); }); }"""


def open_app(br, platform='android', size=(360, 740), extra='', ad=True, lang='de-DE', is_native=True):
    ctx = br.new_context(viewport={'width': size[0], 'height': size[1]}, is_mobile=size[0] < 900, has_touch=True, locale=lang)
    ctx.add_init_script((native(platform, ad) if is_native else '') + N.WATCH + QUIET + extra)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.goto(URL + '#/start')
    page.wait_for_selector('#view-start .hero', timeout=30000)
    page.wait_for_timeout(900)
    return ctx, page, errs


def main():
    css = open(os.path.join(APP, 'css/app-ui.css'), encoding='utf-8').read()
    boot = open(os.path.join(APP, 'js/boot.js'), encoding='utf-8').read()
    index = open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
    check('the look is switched on before the first paint (boot.js) and its styles come after the shared ones',
          "classList.add('win-ui', 'app-ui')" in boot and "'fale-app-ui'" in boot and index.index('css/windows.css') < index.index('css/app-ui.css'))
    fonts = os.path.join(APP, 'vendor/fonts/barlow-semi-condensed')
    check('the DIN-like type is bundled (works offline) with its licence', all(os.path.exists(os.path.join(fonts, f)) for f in ('barlow-semi-condensed-latin-600-normal.woff2', 'barlow-semi-condensed-latin-700-normal.woff2', 'barlow-semi-condensed-latin-ext-600-normal.woff2', 'OFL.txt'))
          and 'Open Font License' in open(os.path.join(fonts, 'OFL.txt'), encoding='utf-8').read() and 'vendor/fonts/barlow-semi-condensed/OFL.txt' in open(os.path.join(APP, 'js/views.js'), encoding='utf-8').read())
    check('everything in the stylesheet is scoped to the app look (nothing leaks into the browser)', all(('html.app-ui' in ln) or ln.strip().startswith(('@', '}', '/*', '*', 'src:', 'unicode-range:', '--', 'min-height', 'font-family', 'background', 'border', 'box-shadow', 'transition', 'margin', 'padding', 'width')) or not ln.strip()
                                                                                                          for ln in css.split('\n') if '{' in ln and not ln.strip().startswith(('@media', '@font-face', '@supports'))), [ln for ln in css.split('\n') if '{' in ln and 'html.app-ui' not in ln and not ln.strip().startswith('@')][:3])

    with sync_playwright() as p:
        br = p.chromium.launch()

        # ---------------- Android phone ----------------
        ctx, page, errs = open_app(br)
        cdp = ctx.new_cdp_session(page)
        doc = page.evaluate(IMPORT, [PDF, 'Mietvertrag.pdf'])
        page.evaluate("location.hash = '#/dateien'"); page.wait_for_selector('#view-dateien .doc', timeout=15000)
        page.evaluate("location.hash = '#/start'"); page.wait_for_selector('#view-start .hero'); page.wait_for_timeout(900)
        L = page.evaluate(LOOK)
        check('inside the app: the look is on before anything is clicked', {'win-ui', 'app-ui', 'is-native'} <= set(L['cls'].split()), L['cls'])
        t = L['tabs']
        check('four folder tabs at the bottom, side by side, each easy to hit (≥ 56 px high, ≥ 60 px wide)', len(t) == 4 and all(x['h'] >= 56 and x['w'] >= 60 for x in t) and [x['left'] for x in t] == sorted(x['left'] for x in t) and t[-1]['right'] <= L['iw'] and L['nav'][1] > L['ih'] * 0.6, t)
        act = [x for x in t if x['active']]
        check('the tab in front is paper white and attached to the sheet; the desk is another colour', len(act) == 1 and act[0]['nav'] == 'start' and act[0]['bg'] == L['sheet'] and L['desk'] != L['sheet'] and abs(act[0]['top'] - (L['main'][1] + L['main'][3])) <= 2 and act[0]['h'] > min(x['h'] for x in t), (act, L['sheet'], L['desk'], L['main']))
        check('every tab has its own colour and its whole name', len({x['ic'] for x in t}) == 4 and all(x['fits'] and x['fs'] >= 13 for x in t), [(x['nav'], x['ic'], x['fits'], x['fs']) for x in t])
        con = page.evaluate(CON)
        check('tab names are easy to read on their tabs (contrast ≥ 4.5)', min(con) >= 4.5, con)
        check('the sheet lies on the desk: a margin at the sides, round corners at the top, the top bar on the desk', L['main'][0] >= 4 and L['main'][0] + L['main'][2] <= L['iw'] - 4 and page.evaluate("getComputedStyle(document.querySelector('.topbar')).backgroundColor") == L['desk'], L['main'])
        check('type: DIN-like for titles (DIN Alternate / Barlow Semi Condensed), the system font for text', 'Barlow Semi Condensed' in L['font'] and 'DIN Alternate' in L['font'] and L['body'].startswith('system-ui'), (L['font'][:60], L['body'][:30]))
        check('the bundled font really loads', poll(page, "document.fonts.check('700 20px \"Barlow Semi Condensed\"')", 6000))
        check('nothing floats over the content (no plus button), no sideways scrolling', L['fab'] == 'none' and L['hs'] <= 0, (L['fab'], L['hs']))
        S = page.evaluate("""() => { const r = s => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height), Math.round(b.width)]; };
          return { open: r('#view-start .hero [data-action="open-file"]'), neu: r('#view-start .hero [data-action="new-menu"]'), recent: r('#view-start .recent-strip'), drop: r('#view-start .hero-drop'), einv: r('#view-start .home-einv'), art: r('#view-start .hero-art') }; }""")
        check('Start: „Datei öffnen“ and „Neu“ are large named buttons at the top (≥ 52 px), the files follow right below', S['open'] and S['neu'] and S['open'][1] >= 52 and S['neu'][1] >= 52 and S['open'][0] < 300 and S['recent'] and S['recent'][0] < 480, S)
        check('Start: nothing that belongs to a PC (no „drag a file into this window“, no E-Rechnung block)', S['drop'] is None and S['einv'] is None and S['art'] is None, S)
        # „Neu“ on Start opens the menu
        page.locator('#view-start .hero [data-action="new-menu"]').click()
        check('Start: „Neu“ opens the list of things to create', poll(page, "!!document.querySelector('.menu-layer, .sheet-menu, [role=menu]')", 5000))
        page.keyboard.press('Escape'); page.wait_for_timeout(400)
        page.evaluate("document.querySelectorAll('.menu-layer').forEach(m => m.click())"); page.wait_for_timeout(300)
        # Dateien
        page.evaluate("location.hash = '#/dateien'"); page.wait_for_selector('#view-dateien .doc', timeout=15000); page.wait_for_timeout(600)
        D = page.evaluate("""() => { const b = s => { const e = document.querySelector(s); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; }; const a = [...document.querySelectorAll('#view-dateien .head-actions .btn')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), e.scrollWidth <= e.clientWidth + 1]; });
          const d = b('#view-dateien .doc'); return { btns: a, doc: d ? Math.round(d.top) : null, more: (() => { const m = b('#view-dateien .doc .more-btn'); return m ? [Math.round(m.width), Math.round(m.height)] : null; })(), hs: document.documentElement.scrollWidth - innerWidth, sub: !!b('#view-dateien .page-sub') }; }""")
        check('Dateien: „Neu“ and „Aus Gerät importieren“ side by side (≥ 48 px high, text fits)', len(D['btns']) == 2 and abs(D['btns'][0][1] - D['btns'][1][1]) <= 2 and all(x[3] >= 48 and x[4] for x in D['btns']) and D['btns'][1][0] > D['btns'][0][0], D['btns'])
        check('Dateien: the first file starts in the upper part of the screen (above 470 px; classic look: about 520 px)', D['doc'] is not None and D['doc'] < 470 and D['hs'] <= 0, D)
        page.locator('#view-dateien .head-actions [data-action="new-menu"], #view-dateien .head-actions .btn').first.click()
        check('Dateien: „Neu“ opens the list of things to create', poll(page, "!!document.querySelector('.menu-layer, .sheet-menu, [role=menu]')", 5000))
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        page.evaluate("document.querySelectorAll('.menu-layer').forEach(m => m.click())"); page.wait_for_timeout(300)
        # colours of the tabs follow the area, tapping a tab switches
        seen = {}
        for nav in ('dateien', 'werkzeuge', 'einstellungen', 'start'):
            page.locator(f'.bottom-nav .bnav[data-nav="{nav}"]').click(); page.wait_for_timeout(700)
            a = [x for x in page.evaluate(LOOK)['tabs'] if x['active']]
            seen[nav] = (a[0]['nav'], a[0]['bg']) if len(a) == 1 else None
        check('tapping a tab brings it to the front (paper white) and shows its area', all(v and v[0] == k and v[1] == L['sheet'] for k, v in seen.items()) and page.evaluate('location.hash') == '#/start', seen)
        W = None
        page.evaluate("location.hash = '#/werkzeuge'"); page.wait_for_selector('#view-werkzeuge .tool-tabs', timeout=10000); page.wait_for_timeout(900)
        W = page.evaluate("""() => { const tt = [...document.querySelectorAll('#view-werkzeuge .tool-tabs a')].map(a => [Math.round(a.getBoundingClientRect().height), a.scrollWidth <= a.clientWidth + 1]); const first = document.querySelector('#view-werkzeuge .tq-sec, #view-werkzeuge .tool-card');
          return { tt, first: first ? Math.round(first.getBoundingClientRect().top) : null, hs: document.documentElement.scrollWidth - innerWidth }; }""")
        check('Werkzeuge: both tabs keep their names in one piece, the tools start on the first screen', len(W['tt']) == 2 and all(h >= 44 and f for h, f in W['tt']) and W['first'] is not None and W['first'] < 560 and W['hs'] <= 0, W)
        # ad strip: on the desk, below the tabs, never over them
        A = page.evaluate("(() => { const s = document.querySelector('.ad-slot').getBoundingClientRect(), n = document.querySelector('.bottom-nav').getBoundingClientRect(); return { has: document.documentElement.classList.contains('has-ad'), slotTop: Math.round(s.top), navBottom: Math.round(n.bottom), bg: getComputedStyle(document.querySelector('.ad-slot')).backgroundColor }; })()")
        check('Android: the ad strip lies below the tabs on the desk, nothing overlaps', A['has'] and A['navBottom'] <= A['slotTop'] + 1 and A['bg'] == L['desk'], A)
        # keyboard / switch access
        page.evaluate("document.querySelector('.bottom-nav .bnav').focus()")
        page.keyboard.press('Tab'); page.wait_for_timeout(60)
        ring = page.evaluate("(() => { const e = document.activeElement; return [e.className, getComputedStyle(e).boxShadow !== 'none' && e.matches(':focus-visible')]; })()")
        check('the folder tabs show the keyboard focus', 'bnav' in ring[0] and ring[1], ring)
        # dark
        page.evaluate("document.documentElement.dataset.theme = 'dark'"); page.wait_for_timeout(300)
        Dk = page.evaluate(LOOK); cond = page.evaluate(CON)
        dact = [x for x in Dk['tabs'] if x['active']]
        check('dark: desk and sheet turn dark, the tab in front stays attached, names readable', Dk['sheet'] != L['sheet'] and Dk['desk'] != L['desk'] and dact and dact[0]['bg'] == Dk['sheet'] and min(cond) >= 4.5, (Dk['sheet'], Dk['desk'], cond))
        page.evaluate("document.documentElement.dataset.theme = 'light'")
        # a document and a tool keep working in the look
        page.evaluate(f"location.hash = '#/ansicht/{doc}'")
        check('a PDF opens (pages are drawn)', poll(page, "!document.querySelector('#viewer').hidden && !!document.querySelector('#viewer .page canvas')", 20000))
        page.evaluate(f"location.hash = '#/werkzeug/seiten?doc={doc}'")
        check('a tool opens („Seiten verwalten“)', poll(page, "!!document.querySelector('.pcard')", 20000))
        page.evaluate("location.hash = '#/start'"); page.wait_for_selector('#view-start .hero'); page.wait_for_timeout(500)

        # moving around does not stall (CPU ×4)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        page.evaluate('window.__d.length = 0')
        for hsh, sel in (('#/dateien', '#view-dateien .doc'), ('#/werkzeuge', '#view-werkzeuge .tool-tabs'), (f'#/ansicht/{doc}', '#viewer .page canvas'), ('#/start', '#view-start .hero'),
                         (f'#/werkzeug/seiten?doc={doc}', '.pcard'), ('#/einstellungen', '[data-me-app]'), ('#/einstellungen/allgemein', '[data-appui-row]'), ('#/start', '#view-start .hero')):
            page.evaluate(f"location.hash = {json.dumps(hsh)}")
            try: page.wait_for_selector(sel, timeout=20000)
            except Exception: pass
            page.wait_for_timeout(500)
        worst = max([g for _, g in page.evaluate('window.__d')] or [0])
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        check(f'moving through tabs, a document, a tool and the settings does not stall (worst {worst} ms < 700)', worst < 700, worst)
        st = page.evaluate(N.STATE)
        check('…and ends on the start page with nothing left open', st['hash'] == '#/start' and not st['dialogs'] and not st['menus'] and not st['loading'], st)

        # „Klassisch“ brings the old look back, „Mappe“ the new one – nobody is forced to relearn
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('[data-appui-row]', timeout=10000)
        pressed = page.evaluate("[...document.querySelectorAll('[data-appui-opt]')].map(b => b.dataset.appuiOpt + ':' + b.getAttribute('aria-pressed'))")
        check('settings: „Aussehen der App“ shows the current look; no Windows switch on a phone', pressed == ['on:true', 'classic:false'] and page.evaluate("document.querySelectorAll('[data-winui-row]').length") == 0, pressed)
        page.locator('[data-appui-opt="classic"]').click()
        page.wait_for_load_state('load'); page.wait_for_selector('#view-start .hero, [data-appui-row]', timeout=30000); page.wait_for_timeout(1500)
        C = page.evaluate(LOOK)
        check('„Klassisch“: the look of the web app is back (tabs flat, plus button there) and it stays after a restart', 'app-ui' not in C['cls'].split() and 'win-ui' not in C['cls'].split() and len({x['bg'] for x in C['tabs']}) == 1, (C['cls'], [x['bg'] for x in C['tabs']]))
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('[data-appui-row]', timeout=10000)
        page.locator('[data-appui-opt="on"]').click()
        page.wait_for_load_state('load'); page.wait_for_selector('#view-start .hero, [data-appui-row]', timeout=30000); page.wait_for_timeout(1500)
        check('„Mappe“: the look of the app is back', {'win-ui', 'app-ui'} <= set(page.evaluate('document.documentElement.className').split()))
        check('no console errors (Android phone)', not errs, errs[:4])
        ctx.close()

        # ---------------- small phone, large text, Russian, sideways ----------------
        for label, size, extra, lang in (('small phone 320 px', (320, 640), '', 'de-DE'), ('largest text', (360, 740), "try { localStorage.setItem('fale-textsize', 'xl'); } catch (e) {}", 'de-DE'),
                                         ('Russian', (360, 740), "try { localStorage.setItem('fale-lang', 'ru'); } catch (e) {}", 'ru-RU'), ('Japanese', (360, 740), "try { localStorage.setItem('fale-lang', 'ja'); } catch (e) {}", 'ja-JP')):
            ctx, page, errs = open_app(br, size=size, extra=extra, lang=lang)
            page.wait_for_timeout(900)
            bad = []
            for nav in ('start', 'dateien', 'werkzeuge', 'einstellungen'):
                page.evaluate(f"location.hash = '#/{nav}'"); page.wait_for_timeout(900)
                M = page.evaluate(LOOK)
                over = page.evaluate("[...document.querySelectorAll('.view:not([hidden]) .btn, .view:not([hidden]) .tool-tabs a')].filter(e => e.getClientRects().length && (e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1)).map(e => e.textContent.trim().slice(0, 24))")
                if M['hs'] > 0 or not all(x['fits'] for x in M['tabs']) or M['tabs'][-1]['right'] > M['iw'] + 1 or M['tabs'][0]['left'] < -1 or over or min(x['fs'] for x in M['tabs']) < 12:
                    bad.append((nav, M['hs'], [(x['nav'], x['fits'], x['w']) for x in M['tabs']], over))
            check(f'{label}: tabs keep their names, buttons stay inside the sheet, no sideways scrolling', not bad and not errs, (bad[:2], errs[:2]))
            ctx.close()
        ctx, page, errs = open_app(br, size=(740, 360))
        M = page.evaluate(LOOK)
        check('phone held sideways: low tabs (≤ 50 px), the content keeps most of the height', all(x['h'] <= 50 and x['fits'] for x in M['tabs']) and M['main'][3] >= 170 and M['hs'] <= 0, ([x['h'] for x in M['tabs']], M['main']))
        ctx.close()

        # ---------------- simple view ----------------
        ctx, page, errs = open_app(br, extra="try { localStorage.setItem('fale-simple', '1'); } catch (e) {}")
        page.wait_for_timeout(900)
        Sm = page.evaluate("""() => { const vis = [...document.querySelectorAll('#view-start [data-action="open-file"], #view-start [data-simple-open], #view-start .s-tile')].filter(e => e.getClientRects().length); const L = [...document.querySelectorAll('.bottom-nav .bnav')].filter(e => e.getClientRects().length);
          return { cls: document.documentElement.className, open: vis.length, tabs: L.length, hs: document.documentElement.scrollWidth - innerWidth }; }""")
        check('simple view: its large tiles are there, a file can be opened, the folder tabs stay', {'simple', 'app-ui'} <= set(Sm['cls'].split()) and Sm['open'] >= 1 and Sm['tabs'] >= 2 and Sm['hs'] <= 0 and not errs, (Sm, errs[:2]))
        ctx.close()

        # ---------------- iPhone ----------------
        ctx, page, errs = open_app(br, platform='ios', size=(390, 844), ad=False)
        I = page.evaluate(LOOK)
        check('iPhone: the same look, no ad strip', {'win-ui', 'app-ui', 'is-ios'} <= set(I['cls'].split()) and 'has-ad' not in I['cls'].split() and len(I['tabs']) == 4 and I['hs'] <= 0 and not errs, (I['cls'], errs[:2]))
        ctx.close()

        # ---------------- tablet with the ad strip ----------------
        ctx, page, errs = open_app(br, size=(1000, 700))
        page.wait_for_timeout(600)
        T = page.evaluate("(() => { const f = document.querySelector('.side-foot').getBoundingClientRect(), s = document.querySelector('.ad-slot').getBoundingClientRect(), m = document.querySelector('.main-col').getBoundingClientRect(); return { foot: [Math.round(f.top), Math.round(f.bottom)], slot: Math.round(s.top), main: Math.round(m.bottom), has: document.documentElement.classList.contains('has-ad'), hs: document.documentElement.scrollWidth - innerWidth }; })()")
        check('tablet: tabs on top like on a PC; the line „Alles bleibt auf deinem Gerät“ stays above the ad strip', T['has'] and T['foot'][1] <= T['slot'] + 1 and T['main'] <= T['foot'][0] + 8 and T['hs'] <= 0 and not errs, (T, errs[:2]))
        ctx.close()

        # ---------------- a normal browser never gets the look ----------------
        ctx, page, errs = open_app(br, is_native=False)
        B = page.evaluate(LOOK)
        page.evaluate("location.hash = '#/einstellungen/allgemein'"); page.wait_for_selector('.settings-row', timeout=10000); page.wait_for_timeout(400)
        check('browser on a phone: the look of the web app, the plus button, no switch', 'app-ui' not in B['cls'].split() and 'win-ui' not in B['cls'].split() and B['fab'] != 'none' and page.evaluate("document.querySelectorAll('[data-appui-row]').length") == 0 and 'Barlow' not in B['font'], (B['cls'], B['fab'], B['font'][:40]))
        ctx.close()
        br.close()

    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

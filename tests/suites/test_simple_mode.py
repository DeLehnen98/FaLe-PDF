"""„Einfache Ansicht“ (simple mode) test for FaLe PDF (js/simple.js, js/views.js, css/theme-2026.css).

For phone (390×844) and desktop (1280×860), German and English, light and dark:
- hint card on the start screen switches the mode on; persists after reload; „Alle Funktionen zeigen“ and the
  switch in Ich › Einstellungen switch it off again
- start screen: 8 large tiles, each one works (route / file chooser / menu), keyboard reachable,
  touch targets ≥ 48 px, text contrast ≥ 4.5:1; AI / sharing / assistant sections hidden
- Werkzeuge: short list first, „Alle Werkzeuge anzeigen“ shows every tool incl. the web tools without leaving
  simple mode; search finds rare tools („Serienbrief“/„Mail merge“, „PDF/A“) and AI features
- the user's own „KI ausblenden“ setting (fale-ai-hidden) is never changed
- no page/console errors, no horizontal overflow at 360 px, no long task > 200 ms while switching
- screenshots (start/tools in both modes) into out_simple/
- „Schriftgröße“ (Normal / Groß / Sehr groß, fale-textsize): set in Ich › Einstellungen, applied before the first
  render, persists; no horizontal overflow at 360 × 640 in every size × simple/full × light/dark on start, Werkzeuge,
  Dateien, Ich, tool screens (with and without a document), the PDF viewer and the onboarding; no long task
  > 200 ms while switching; the PDF page canvas stays sharp and a signature lands where it was tapped (Sehr groß)
- plain words in simple mode (tool titles/intros, „PDF verkleinern“ choices, where the file is after saving,
  download hint), labelled back button, simple „Neu erstellen“ menu, no floating „+“
- AI menu entries (viewer „KI-Assistent“, writer „KI-Schreibhilfe“) hidden in simple mode, back in normal mode,
  fale-ai-hidden untouched

Run: python3 test_simple_mode.py   (server: node tests/suites/sec/csp_server.mjs 9431 /home/claude/FalePDF)
     SIMPLE_URL=http://127.0.0.1:9431/ (default)
     python3 test_simple_mode.py textsize   – only the text-size / plain-words / AI part
"""
import json, os, shutil, sys, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, 'out_simple')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('SIMPLE_URL', 'http://127.0.0.1:9431/')
TD = '/home/claude/FalePDF/tests/base/testdata'
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'

results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:400], flush=True)
        traceback.print_exc()


def poll(page, js, timeout=8000, every=80):
    """Poll a (sync) JS predicate from Python – page.wait_for_function with async predicates passes immediately."""
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if page.evaluate(js):
                return True
        except Exception:
            pass
        page.wait_for_timeout(every)
    return False


INIT = """
(() => {
  try {
    localStorage.setItem('fale-onboarded', '1');
    localStorage.setItem('fale-lang', %(lang)s);
    localStorage.setItem('fale-theme', %(theme)s);
    if (%(aihidden)s) localStorage.setItem('fale-ai-hidden', '1');
  } catch (e) {}
  window.__lt = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
})();
"""

VISIBLE = "el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'"

JS_VIS = """sel => { const els = [...document.querySelectorAll(sel)]; return els.filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length).length; }"""

# elements inside the active view that stick out to the right (ignores content of horizontal scrollers)
JS_OVERFLOW = """() => {
  const vw = window.innerWidth, out = [];
  const view = [...document.querySelectorAll('.view')].find(v => !v.hidden);
  if (!view) return ['no view'];
  const clipped = el => { for (let p = el.parentElement; p && p !== view; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of view.querySelectorAll('*')) {
    if (!(el.offsetWidth || el.offsetHeight)) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && !clipped(el)) out.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.right));
    if (out.length > 6) break;
  }
  const doc = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  if (doc > 0) out.push('document +' + doc);
  return out;
}"""

# elements anywhere on the page (tool screen, viewer, onboarding …) that stick out to the right
JS_OVERFLOW_ALL = """() => {
  const vw = innerWidth, out = [];
  const clipped = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { if (p.getBoundingClientRect().right <= vw + 1) return true; } } return false; };
  for (const el of document.body.querySelectorAll('*')) {
    if (!(el.offsetWidth || el.offsetHeight) || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && !clipped(el)) out.push((typeof el.className === 'string' ? el.className : el.tagName) + ' ' + Math.round(r.right) + ' ' + (el.textContent || '').trim().slice(0, 24));
    if (out.length > 6) break;
  }
  const doc = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  if (doc > 0) out.push('document +' + doc);
  return out;
}"""

# WCAG contrast of an element's text against the first opaque background behind it
JS_CONTRAST = """el => {
  const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const fg = parse(getComputedStyle(el).color);
  let bg = null;
  const hex = v => { v = v.trim().replace('#', ''); return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 }; };
  for (let p = el; p; p = p.parentElement) {
    const cs = getComputedStyle(p), c = parse(cs.backgroundColor);
    if (c && c.a > 0.9) { bg = c; break; }
    if (p.classList.contains('btn-primary') && /gradient/.test(cs.backgroundImage)) { bg = hex(getComputedStyle(document.documentElement).getPropertyValue('--primary')); break; } // gradient of --primary
  }
  if (!bg) bg = { r: 255, g: 255, b: 255 };
  const a = lum(fg), b = lum(bg);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}"""

TILE_ROUTES = {
    'scannen': '#/werkzeug/scannen', 'unterschreiben': '#/werkzeug/unterschreiben', 'zusammenfuegen': '#/werkzeug/zusammenfuegen',
    'komprimieren': '#/werkzeug/komprimieren', 'pdf-word': '#/werkzeug/pdf-word',
}


def hash_of(page):
    return page.evaluate('location.hash')


def go(page, h, sel=None):
    page.wait_for_timeout(250)  # let the previous route settle (two hash changes within ~10 ms race in app.js office routes)
    page.evaluate(f"location.hash = {json.dumps(h)}")
    if sel:
        poll(page, f"(() => {{ const e = document.querySelector({json.dumps(sel)}); return !!e && !!(e.offsetWidth || e.offsetHeight); }})()", 8000)
    page.wait_for_timeout(250)


def responsive(page):
    t0 = time.time()
    page.evaluate('1')
    return time.time() - t0 < 2


def lt_reset(page):
    page.evaluate('window.__lt = []')


def lt_max(page):
    page.wait_for_timeout(400)
    return max(page.evaluate('window.__lt') or [0])


def run_combo(b, vw, vh, lang, theme):
    tag = f"{'phone' if vw < 900 else 'desk'}-{lang}-{theme}"
    aihidden = vw >= 900 and theme == 'dark'  # one set of combos where the user hid the AI on purpose
    ctx = b.new_context(viewport={'width': vw, 'height': vh}, locale='de-DE' if lang == 'de' else 'en-US',
                        color_scheme=theme, device_scale_factor=1, has_touch=vw < 900)
    ctx.add_init_script(INIT % {'lang': json.dumps(lang), 'theme': json.dumps(theme), 'aihidden': 'true' if aihidden else 'false'})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    page.on('console', lambda m: m.type == 'error' and errors.append(f'[console] {m.text}'))
    page.goto(URL + '#/start')
    poll(page, "document.documentElement.classList.contains('ready') && !!document.querySelector('#view-start .tabs')", 15000)
    page.wait_for_timeout(600)
    ai_before = page.evaluate("localStorage.getItem('fale-ai-hidden')")
    T = (lambda de, en: de if lang == 'de' else en)

    # ---------------- normal mode → hint card → simple mode
    def s_hint():
        check(f'{tag}: starts in normal mode', not page.evaluate("document.documentElement.classList.contains('simple')"))
        check(f'{tag}: hint card visible', page.is_visible('[data-simple-hint]'))
        check(f'{tag}: normal start shows the quick tools', page.evaluate(JS_VIS, '#view-start .tiles .tile') >= 8)
        check(f'{tag}: hint button text translated', page.inner_text('[data-simple-on]').strip() == T('Einfache Ansicht einschalten', 'Turn on simple view'),
              page.inner_text('[data-simple-on]'))
        for sel in ['[data-simple-on]', '[data-simple-hint-close]']:
            bb = page.locator(sel).bounding_box()
            check(f'{tag}: hint {sel} ≥ 48 px', bb and bb['height'] >= 47.5 and bb['width'] >= 47.5, json.dumps(bb))
        page.screenshot(path=os.path.join(OUT, f'{tag}_start_normal.png'))
        go(page, '#/werkzeuge', '#view-werkzeuge .tool-card')
        poll(page, "document.querySelectorAll('#view-werkzeuge a[href^=\"#/web/\"]').length > 20", 10000)
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, f'{tag}_tools_normal.png'))
        go(page, '#/start', '[data-simple-on]')
        lt_reset(page)
        page.click('[data-simple-on]')
        check(f'{tag}: switched on from the hint', poll(page, "document.documentElement.classList.contains('simple')", 3000))
        check(f'{tag}: no long task > 200 ms while switching on', lt_max(page) <= 200, str(page.evaluate('window.__lt')))
        check(f'{tag}: stored on the device', page.evaluate("localStorage.getItem('fale-simple')") == '1')
        check(f'{tag}: hint gone', not page.is_visible('[data-simple-hint]'))
    step(f'{tag} hint', s_hint)

    # ---------------- start screen in simple mode
    def s_start():
        page.reload()
        poll(page, "document.documentElement.classList.contains('ready') && !!document.querySelector('[data-simple-home] .s-tile')", 15000)
        page.wait_for_timeout(500)
        check(f'{tag}: persists after reload', page.evaluate("document.documentElement.classList.contains('simple')"))
        check(f'{tag}: 8 large tiles', page.evaluate(JS_VIS, '[data-simple-home] .s-tile') == 8, str(page.evaluate(JS_VIS, '[data-simple-home] .s-tile')))
        for sel in ['#view-start .create-row', '#view-start .tiles', '#view-start .quick-chips', '#view-start [data-ai-start]', '#view-start [data-share-start]',
                    '#view-start [data-smart-start]', '#view-start .home-more', '#view-start .hero-actions', '#view-start [data-home="tools"]']:
            check(f'{tag}: hidden in simple mode {sel}', page.evaluate(JS_VIS, sel) == 0)
        check(f'{tag}: file list still there', page.is_visible('#view-start .tabs') and page.is_visible('#view-start [data-list]'))
        if vw < 900:
            check(f'{tag}: bottom navigation visible', page.is_visible('.bottom-nav'))
        sizes = page.evaluate("[...document.querySelectorAll('[data-simple-home] .s-tile, [data-simple-off], [data-simple-tools]')].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.simple || e.textContent.trim().slice(0, 20), Math.round(r.width), Math.round(r.height)]; })")
        small = [s for s in sizes if s[1] < 48 or s[2] < 48]
        check(f'{tag}: start touch targets ≥ 48 px', not small, json.dumps(small))
        low = []
        for el in page.query_selector_all('[data-simple-home] .s-tile strong, [data-simple-home] .s-tile-text span, [data-simple-home] .section-title, [data-simple-off], [data-simple-tools]'):
            c = el.evaluate(JS_CONTRAST)
            if c < 4.5:
                low.append([el.inner_text()[:30], c])
        check(f'{tag}: start text contrast ≥ 4.5', not low, json.dumps(low))
        labels = page.evaluate("[...document.querySelectorAll('[data-simple-home] .s-tile strong')].map(e => e.textContent.trim())")
        want = T('Datei öffnen', 'Open file')
        check(f'{tag}: tile labels in the UI language', labels and labels[0] == want, json.dumps(labels))
        page.screenshot(path=os.path.join(OUT, f'{tag}_start_simple.png'))
    step(f'{tag} start', s_start)

    def s_tiles():
        for sid, route in TILE_ROUTES.items():
            go(page, '#/start', f'[data-simple="{sid}"]')
            page.click(f'[data-simple="{sid}"]')
            ok = poll(page, f"location.hash.split('?')[0] === {json.dumps(route)}", 5000)
            opened = poll(page, "!document.querySelector('#tool-screen').hidden && document.querySelector('#tool-screen').textContent.length > 20", 6000)
            check(f'{tag}: tile {sid} → {route}', ok and opened and responsive(page), hash_of(page))
        # open file → system picker
        go(page, '#/start', '[data-simple="open"]')
        try:
            with page.expect_file_chooser(timeout=5000) as fc:
                page.click('[data-simple="open"]')
            check(f'{tag}: tile open → file chooser', fc.value is not None)
        except Exception as e:
            check(f'{tag}: tile open → file chooser', False, str(e)[:120])
        # convert menu
        go(page, '#/start', '[data-simple="umwandeln"]')
        page.click('[data-simple="umwandeln"]')
        poll(page, "document.querySelectorAll('.menu-layer .menu-item').length >= 5", 3000)
        items = page.evaluate("[...document.querySelectorAll('.menu-layer .menu-item')].map(e => e.textContent.trim())")
        check(f'{tag}: convert menu has 5 entries', len(items) == 5, json.dumps(items))
        page.locator('.menu-layer .menu-item').nth(1).click()
        check(f'{tag}: convert → Word zu PDF', poll(page, "location.hash === '#/werkzeug/word-pdf'", 5000), hash_of(page))
        go(page, '#/start', '[data-simple="umwandeln"]')
        page.click('[data-simple="umwandeln"]')
        poll(page, "document.querySelectorAll('.menu-layer .menu-item').length >= 5", 3000)
        page.locator('.menu-layer .menu-item').nth(0).click()
        check(f'{tag}: convert → Fotos zu PDF', poll(page, "location.hash === '#/werkzeug/bilder'", 5000), hash_of(page))
        # new menu
        go(page, '#/start', '[data-simple="neu"]')
        page.click('[data-simple="neu"]')
        poll(page, "document.querySelectorAll('.menu-layer .menu-item').length >= 3", 3000)
        page.locator('.menu-layer .menu-item').nth(0).click()
        check(f'{tag}: new → document templates', poll(page, "location.hash === '#/vorlagen/dokument'", 5000), hash_of(page))
        go(page, '#/start', '[data-simple="neu"]')
        page.click('[data-simple="neu"]')
        poll(page, "document.querySelectorAll('.menu-layer .menu-item').length >= 3", 3000)
        page.keyboard.press('Escape')
        check(f'{tag}: menu closes with Escape', poll(page, "!document.querySelector('.menu-layer')", 2000))
        # keyboard: Tab to the scan tile, Enter opens it
        go(page, '#/start', '[data-simple="scannen"]')
        page.evaluate("document.querySelector('#main').focus()")
        reached = False
        for _ in range(60):
            page.keyboard.press('Tab')
            if page.evaluate("document.activeElement && document.activeElement.dataset.simple === 'scannen'"):
                reached = True
                break
        ring = page.evaluate("getComputedStyle(document.activeElement).boxShadow") if reached else ''
        check(f'{tag}: scan tile reachable with Tab (with focus ring)', reached and ring and ring != 'none', ring[:60])
        if reached:
            page.keyboard.press('Enter')
            check(f'{tag}: Enter on the tile opens the scanner', poll(page, "location.hash === '#/werkzeug/scannen'", 5000), hash_of(page))
        # „Alle Werkzeuge“ link
        go(page, '#/start', '[data-simple-tools]')
        page.click('[data-simple-tools]')
        check(f'{tag}: „Alle Werkzeuge“ → #/werkzeuge', poll(page, "location.hash === '#/werkzeuge'", 5000))
    step(f'{tag} tiles', s_tiles)

    # ---------------- Werkzeuge in simple mode
    def s_tools():
        go(page, '#/werkzeuge', '[data-simple-tools] .tool-card')
        poll(page, "document.querySelectorAll('#view-werkzeuge a[href^=\"#/web/\"]').length > 20", 10000)
        page.wait_for_timeout(300)
        vis_sections = page.evaluate("[...document.querySelectorAll('#view-werkzeuge .tool-section, #view-werkzeuge .simple-sec')].filter(s => s.offsetHeight).map(s => s.dataset.section)")
        check(f'{tag}: tools – only the short list is shown', vis_sections == ['simple'], json.dumps(vis_sections))
        n_short = page.evaluate(JS_VIS, '#view-werkzeuge .tool-card')
        check(f'{tag}: tools – 10 essential tools', n_short == 10, str(n_short))
        check(f'{tag}: tools – AI section hidden', page.evaluate(JS_VIS, '#view-werkzeuge [data-section="ki"]') == 0)
        btn = page.locator('[data-simple-all]')
        check(f'{tag}: „Alle Werkzeuge anzeigen“ visible', btn.is_visible() and T('Alle Werkzeuge anzeigen', 'Show all tools') in btn.inner_text(), btn.inner_text())
        bb = btn.bounding_box()
        check(f'{tag}: expand button ≥ 48 px', bb and bb['height'] >= 48, json.dumps(bb))
        check(f'{tag}: expand button contrast ≥ 4.5', page.locator('[data-simple-all-label]').evaluate(JS_CONTRAST) >= 4.5, str(page.locator('[data-simple-all-label]').evaluate(JS_CONTRAST)))
        small = page.evaluate("[...document.querySelectorAll('[data-simple-tools] .tool-card')].filter(e => e.getBoundingClientRect().height < 48).length")
        check(f'{tag}: short list touch targets ≥ 48 px', small == 0)
        page.screenshot(path=os.path.join(OUT, f'{tag}_tools_simple.png'))
        lt_reset(page)
        btn.click()
        page.wait_for_timeout(200)
        check(f'{tag}: no long task > 200 ms while expanding', lt_max(page) <= 200, str(page.evaluate('window.__lt')))
        total = page.evaluate(JS_VIS, '#view-werkzeuge .tool-card')
        web = page.evaluate(JS_VIS, '#view-werkzeuge a.tool-card[href^="#/web/"]')
        web_all = page.evaluate("document.querySelectorAll('#view-werkzeuge a.tool-card[href^=\"#/web/\"]').length")
        check(f'{tag}: expanded – all tools incl. web tools', total >= 80 and web == web_all and web >= 40, f'{total} cards, {web}/{web_all} web')
        check(f'{tag}: expanded – still simple mode', page.evaluate("document.documentElement.classList.contains('simple')"))
        check(f'{tag}: expanded – aria-expanded', btn.get_attribute('aria-expanded') == 'true')
        check(f'{tag}: expanded – AI section still hidden', page.evaluate(JS_VIS, '#view-werkzeuge [data-section="ki"]') == 0)
        page.evaluate("document.querySelector('#main').scrollTop = 900")
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(OUT, f'{tag}_tools_simple_all.png'))
        page.evaluate("document.querySelector('#main').scrollTop = 0")
        btn.click()
        page.wait_for_timeout(200)
        check(f'{tag}: collapse again', page.evaluate(JS_VIS, '#view-werkzeuge .tool-card') == 10 and btn.get_attribute('aria-expanded') == 'false')
        # search finds everything (collapsed list)
        for q, needle in [(T('Serienbrief', 'Mail merge'), T('Serienbrief', 'Mail merge')), ('PDF/A', 'PDF/A')]:
            page.fill('#tool-search', q)
            ok = poll(page, f"[...document.querySelectorAll('#view-werkzeuge .tool-card')].some(c => c.offsetHeight && c.textContent.includes({json.dumps(needle)}))", 4000)
            short_hidden = page.evaluate(JS_VIS, '[data-simple-tools]') == 0
            check(f'{tag}: search finds „{q}“', ok and short_hidden)
        if not aihidden:
            q = T('Zusammenfassen', 'Summarize')
            page.fill('#tool-search', q)
            ok = poll(page, "document.querySelectorAll('#view-werkzeuge [data-section=\"ki\"] .tool-card').length > 0 && [...document.querySelectorAll('#view-werkzeuge [data-section=\"ki\"] .tool-card')].some(c => c.offsetHeight)", 4000)
            check(f'{tag}: search finds the AI feature „{q}“', ok)
        else:
            page.fill('#tool-search', T('Zusammenfassen', 'Summarize'))
            page.wait_for_timeout(400)
            check(f'{tag}: user-hidden AI stays hidden in search', page.evaluate(JS_VIS, '#view-werkzeuge [data-section="ki"] .tool-card') == 0)
        page.fill('#tool-search', '')
        page.wait_for_timeout(400)
        check(f'{tag}: cleared search → short list again', page.evaluate(JS_VIS, '#view-werkzeuge .tool-card') == 10)
        # a card from the short list works
        page.click('[data-simple-tools] .tool-card[data-tool="zusammenfuegen"]')
        check(f'{tag}: short-list card opens its tool', poll(page, "location.hash === '#/werkzeug/zusammenfuegen'", 5000))
    step(f'{tag} tools', s_tools)

    # ---------------- files, settings, overflow at 360
    def s_other():
        go(page, '#/dateien', '#view-dateien [data-files]')
        check(f'{tag}: files view usable', page.is_visible('#view-dateien [data-files]') and page.is_visible('#files-search'))
        if vw < 900:
            page.click('.bottom-nav [data-nav="start"]')
            check(f'{tag}: bottom nav → start', poll(page, "location.hash === '#/start'", 4000))
            page.click('.bottom-nav [data-nav="werkzeuge"]')
            check(f'{tag}: bottom nav → tools', poll(page, "location.hash === '#/werkzeuge'", 4000))
        go(page, '#/einstellungen', '[data-simple-toggle]')
        check(f'{tag}: settings switch checked', page.is_checked('[data-simple-toggle]'))
        check(f'{tag}: settings AI status card hidden in simple mode', page.evaluate(JS_VIS, '#view-einstellungen [data-ai-me]') == 0)
        if vw < 900:
            page.set_viewport_size({'width': 360, 'height': 780})
            over = {}
            for r, sel in [('#/start', '[data-simple-home] .s-tile'), ('#/werkzeuge', '[data-simple-tools] .tool-card'), ('#/dateien', '#view-dateien [data-files]'), ('#/einstellungen', '[data-simple-toggle]')]:
                go(page, r, sel)
                o = page.evaluate(JS_OVERFLOW)
                if o:
                    over[r] = o
            go(page, '#/werkzeuge', '[data-simple-all]')
            page.click('[data-simple-all]')
            page.wait_for_timeout(300)
            o = page.evaluate(JS_OVERFLOW)
            if o:
                over['#/werkzeuge (alle)'] = o
            page.click('[data-simple-all]')
            check(f'{tag}: no horizontal overflow at 360 px', not over, json.dumps(over)[:400])
            page.screenshot(path=os.path.join(OUT, f'{tag}_360_tools.png'))
            go(page, '#/start', '[data-simple-home] .s-tile')
            page.screenshot(path=os.path.join(OUT, f'{tag}_360_start.png'))
            page.set_viewport_size({'width': vw, 'height': vh})
        # off via the settings switch
        go(page, '#/einstellungen', '[data-simple-toggle]')
        lt_reset(page)
        page.locator('[data-simple-row] .switch').click()
        check(f'{tag}: switched off in settings', poll(page, "!document.documentElement.classList.contains('simple')", 3000))
        check(f'{tag}: no long task > 200 ms while switching off', lt_max(page) <= 200, str(page.evaluate('window.__lt')))
        check(f'{tag}: setting removed from storage', page.evaluate("localStorage.getItem('fale-simple')") is None)
        go(page, '#/start', '#view-start .tiles .tile')
        check(f'{tag}: normal start again', page.evaluate(JS_VIS, '#view-start .tiles .tile') >= 8 and page.evaluate(JS_VIS, '[data-simple-home]') == 0)
        check(f'{tag}: hint stays away after a decision', not page.is_visible('[data-simple-hint]'))
        go(page, '#/werkzeuge', '#view-werkzeuge .tool-card')
        check(f'{tag}: normal tools list again', page.evaluate(JS_VIS, '[data-simple-tools]') == 0 and page.evaluate(JS_VIS, '#view-werkzeuge .tool-card') >= 80)
        # on again via settings, off via „Alle Funktionen zeigen“
        go(page, '#/einstellungen', '[data-simple-toggle]')
        page.locator('[data-simple-row] .switch').click()
        check(f'{tag}: on again in settings', poll(page, "document.documentElement.classList.contains('simple')", 3000))
        go(page, '#/start', '[data-simple-off]')
        lt_reset(page)
        page.click('[data-simple-off]')
        check(f'{tag}: „Alle Funktionen zeigen“ switches off', poll(page, "!document.documentElement.classList.contains('simple')", 3000))
        check(f'{tag}: no long task > 200 ms (Alle Funktionen zeigen)', lt_max(page) <= 200, str(page.evaluate('window.__lt')))
        page.reload()
        poll(page, "document.documentElement.classList.contains('ready')", 15000)
        page.wait_for_timeout(400)
        check(f'{tag}: off persists after reload', not page.evaluate("document.documentElement.classList.contains('simple')"))
        check(f'{tag}: user AI setting untouched', page.evaluate("localStorage.getItem('fale-ai-hidden')") == ai_before, f'{ai_before}')
        if aihidden:
            check(f'{tag}: user-hidden AI still hidden on start', page.evaluate(JS_VIS, '#view-start [data-ai-start] .ai-start-card') == 0)
        else:
            check(f'{tag}: AI card back on the normal start', poll(page, "!!document.querySelector('#view-start [data-ai-start] .ai-start-card') && document.querySelector('#view-start [data-ai-start]').offsetHeight > 0", 4000))
    step(f'{tag} other', s_other)

    check(f'{tag}: no page/console errors', not errors, json.dumps(errors)[:500])
    ctx.close()


# =====================================================================================================
# „Schriftgröße“, plain words, AI menus (js/simple.js, js/ai/hidden.js)
# =====================================================================================================
TS_INIT = """
(() => {
  try {  // only on the first load of the tab – settings changed by the test survive a reload
    if (!sessionStorage.getItem('__tsinit')) {
      sessionStorage.setItem('__tsinit', '1');
      localStorage.setItem('fale-onboarded', '1');
      localStorage.setItem('fale-lang', %(lang)s);
      localStorage.setItem('fale-theme', %(theme)s);
      if (%(simple)s) localStorage.setItem('fale-simple', '1'); else localStorage.removeItem('fale-simple');
      if (%(ts)s !== 'normal') localStorage.setItem('fale-textsize', %(ts)s); else localStorage.removeItem('fale-textsize');
    }
  } catch (e) {}
  window.__lt = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  // class list of <html> at the moment the start view gets its first content (= before the first render)
  window.__tsFirst = null;
  new MutationObserver((m, o) => { const v = document.getElementById('view-start'); if (v && v.childElementCount) { window.__tsFirst = document.documentElement.className; o.disconnect(); } })
    .observe(document, { childList: true, subtree: true });
})();
"""
TS_FS = {'normal': 16, 'l': 18.4, 'xl': 20.8}


def ts_context(b, lang='de', theme='light', simple=True, ts='normal', vw=360, vh=640):
    ctx = b.new_context(viewport={'width': vw, 'height': vh}, locale='de-DE' if lang == 'de' else 'en-US', color_scheme=theme,
                        device_scale_factor=2, has_touch=True, accept_downloads=True)
    init = TS_INIT % {'lang': json.dumps(lang), 'theme': json.dumps(theme), 'simple': 'true' if simple else 'false', 'ts': json.dumps(ts)}
    ctx.add_init_script(init)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    page.on('console', lambda m: m.type == 'error' and errors.append(f'[console] {m.text}'))
    page.goto(URL + '#/start')
    poll(page, "document.documentElement.classList.contains('ready') && !!document.querySelector('#view-start .tabs')", 15000)
    page.wait_for_timeout(500)
    return ctx, page, errors


def import_pdf(page, name):
    page.set_input_files('#pdf-input', [os.path.join(TD, name)])
    poll(page, "!!document.querySelector('#viewer:not([hidden]) canvas, #viewer:not([hidden]) .page')", 10000)
    page.wait_for_timeout(1200)
    return page.evaluate(f"import('./js/db.js').then(m => m.listDocs()).then(d => (d.find(x => x.name === {json.dumps(name)}) || d[0]).id)")


def menu_labels(page):
    poll(page, "document.querySelectorAll('.menu-layer .menu-item').length > 0", 3000)
    return page.evaluate("[...document.querySelectorAll('.menu-layer .menu-item')].map(e => e.textContent.trim())")


def ts_settings(b):
    tag = 'textsize settings'
    ctx, page, errors = ts_context(b, simple=False, vw=390, vh=844)
    go(page, '#/einstellungen', '[data-textsize-row]')
    btns = page.locator('[data-textsize-row] [data-ts-opt]')
    check(f'{tag}: three choices', btns.count() == 3 and page.locator('[data-textsize-row] [data-ts-opt="normal"]').get_attribute('aria-pressed') == 'true')
    small = page.evaluate("[...document.querySelectorAll('[data-textsize-row] [data-ts-opt]')].map(e => e.getBoundingClientRect()).filter(r => r.width < 48 || r.height < 48).length")
    check(f'{tag}: buttons ≥ 48 px', small == 0)
    check(f'{tag}: normal root size 16 px', page.evaluate("parseFloat(getComputedStyle(document.documentElement).fontSize)") == 16)
    for ts, cls in [('l', 'ts-l'), ('xl', 'ts-xl')]:
        lt_reset(page)
        page.click(f'[data-textsize-row] [data-ts-opt="{ts}"]')
        ok = poll(page, f"document.documentElement.classList.contains('{cls}')", 2000)
        fs = page.evaluate("parseFloat(getComputedStyle(document.documentElement).fontSize)")
        check(f'{tag}: {ts} applied at once ({fs} px)', ok and abs(fs - TS_FS[ts]) < 0.2 and page.evaluate("localStorage.getItem('fale-textsize')") == ts)
        check(f'{tag}: {ts} no long task > 200 ms', lt_max(page) <= 200, str(page.evaluate('window.__lt')))
        check(f'{tag}: {ts} pressed state', page.locator(f'[data-textsize-row] [data-ts-opt="{ts}"]').get_attribute('aria-pressed') == 'true')
    page.screenshot(path=os.path.join(OUT, 'ts_settings_xl.png'))
    page.reload()
    poll(page, "document.documentElement.classList.contains('ready')", 15000)
    page.wait_for_timeout(500)
    check(f'{tag}: persists after reload', page.evaluate("document.documentElement.classList.contains('ts-xl')"))
    go(page, '#/start', '#view-start .tabs')
    first = page.evaluate('window.__tsFirst')
    check(f'{tag}: applied before the first render', first is not None and 'ts-xl' in first, str(first))
    # switching on the biggest view (all tools, simple mode expanded) stays smooth
    page.evaluate("import('./js/simple.js').then(m => m.setSimple(true))")
    go(page, '#/werkzeuge', '[data-simple-all]')
    page.click('[data-simple-all]')
    page.wait_for_timeout(400)
    for ts in ['normal', 'xl', 'l']:
        lt_reset(page)
        page.evaluate(f"import('./js/simple.js').then(m => m.setTextSize('{ts}'))")
        page.wait_for_timeout(150)
        check(f'{tag}: Werkzeuge (all) → {ts} without long task > 200 ms', lt_max(page) <= 200 and responsive(page), str(page.evaluate('window.__lt')))
    page.click('[data-simple-all]')
    page.evaluate("import('./js/simple.js').then(m => m.setSimple(false))")
    go(page, '#/einstellungen', '[data-textsize-row]')
    page.click('[data-textsize-row] [data-ts-opt="normal"]')
    check(f'{tag}: back to normal', poll(page, "!document.documentElement.classList.contains('ts-l') && !document.documentElement.classList.contains('ts-xl')", 2000)
          and page.evaluate("localStorage.getItem('fale-textsize')") is None)
    check(f'{tag}: no page/console errors', not errors, json.dumps(errors)[:400])
    ctx.close()


TS_ROUTES = ['#/start', '#/werkzeuge', '#/dateien', '#/einstellungen', '#/werkzeug/komprimieren', '#/werkzeug/zusammenfuegen',
             '#/werkzeug/bilder', '#/werkzeug/scannen', '#/werkzeug/word-pdf']
TS_DOC_ROUTES = ['#/werkzeug/unterschreiben?doc={id}', '#/werkzeug/komprimieren?doc={id}', '#/werkzeug/pdf-word?doc={id}']


def ts_matrix(b):
    for theme in ['light', 'dark']:
        for simple in [True, False]:
            for ts in ['normal', 'l', 'xl']:
                tag = f"360 {theme} {'simple' if simple else 'full'} {ts}"
                ctx, page, errors = ts_context(b, theme=theme, simple=simple, ts=ts)

                def run():
                    fs = page.evaluate("parseFloat(getComputedStyle(document.documentElement).fontSize)")
                    check(f'{tag}: root size', abs(fs - TS_FS[ts]) < 0.2, str(fs))
                    over = {}
                    doc = import_pdf(page, 'formular.pdf')
                    o = page.evaluate(JS_OVERFLOW_ALL)
                    if o:
                        over['viewer'] = o
                    shot_it = theme == 'light' and ts == 'xl'
                    if shot_it:
                        page.screenshot(path=os.path.join(OUT, f"ts_{'simple' if simple else 'full'}_{ts}_viewer.png"))
                    for r in TS_ROUTES + [x.format(id=doc) for x in TS_DOC_ROUTES]:
                        page.wait_for_timeout(200)
                        page.evaluate(f"location.hash = {json.dumps(r)}")
                        page.wait_for_timeout(1300)
                        o = page.evaluate(JS_OVERFLOW_ALL)
                        if o:
                            over[r] = o
                        if shot_it:
                            page.screenshot(path=os.path.join(OUT, f"ts_{'simple' if simple else 'full'}_{ts}_{r.split('?')[0].replace('#/', '').replace('/', '_')}{'_doc' if '?doc' in r else ''}.png"))
                    # onboarding step 3 (view + text size)
                    go(page, '#/start', '#view-start .tabs')
                    page.evaluate("import('./js/extras/onboarding.js').then(m => m.showOnboarding())")
                    page.wait_for_selector('.onboard [data-next]')
                    page.click('.onboard [data-next]')
                    page.click('.onboard [data-next]')
                    page.click('.onboard [data-next]')
                    page.wait_for_timeout(400)
                    o = page.evaluate(JS_OVERFLOW_ALL)
                    if o:
                        over['onboarding'] = o
                    nb = page.locator('.onboard [data-next]').bounding_box()
                    check(f'{tag}: onboarding buttons stay on screen', nb and nb['y'] + nb['height'] <= 640 and nb['height'] >= 44, json.dumps(nb))
                    page.evaluate("(() => { const c = document.querySelector('.ob-card'); c.scrollTop = c.scrollHeight; })()")  # the user scrolls down
                    page.wait_for_timeout(200)
                    sz = page.locator('.ob-size [data-ts-opt="xl"]').bounding_box()
                    check(f'{tag}: onboarding size choice reachable', sz and sz['height'] >= 44 and sz['y'] + sz['height'] <= nb['y'] + 2, json.dumps(sz))
                    if theme == 'light':
                        page.screenshot(path=os.path.join(OUT, f"ts_{'simple' if simple else 'full'}_{ts}_onboarding.png"))
                    page.click('.onboard [data-skip]')
                    page.wait_for_timeout(300)
                    check(f'{tag}: no horizontal overflow (13 screens + viewer + onboarding)', not over, json.dumps(over)[:500])
                    check(f'{tag}: no page/console errors', not errors, json.dumps(errors)[:400])
                step(tag, run)
                ctx.close()


def sign_at(b, ts):
    """Place a signature at a tapped point; returns (canvas ratio, page css width, item centre − tap)."""
    ctx, page, errors = ts_context(b, simple=True, ts=ts)
    doc = import_pdf(page, 'formular.pdf')
    go(page, f'#/werkzeug/unterschreiben?doc={doc}')
    page.wait_for_selector('.sign-page canvas', timeout=15000)
    page.wait_for_timeout(600)
    # the form panel (bottom sheet on phones) must not cover the page: close it when it is open
    if page.evaluate("(() => { const b = document.querySelector('.form-panel [data-close]'); if (!b || !b.offsetWidth) return false; const r = b.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })()"):
        page.locator('.form-panel [data-close]').tap()
        page.wait_for_timeout(300)
    canvas = page.evaluate("(() => { const c = document.querySelector('.sign-page canvas'); const r = c.getBoundingClientRect(); return [c.width / r.width, r.width]; })()")
    page.locator('[data-mode="sign"]').tap()
    page.wait_for_selector('dialog .sig-pad')
    pad = page.locator('dialog .sig-pad').bounding_box()
    page.mouse.move(pad['x'] + 20, pad['y'] + pad['height'] * 0.6)
    page.mouse.down()
    for i in range(1, 30):
        page.mouse.move(pad['x'] + 20 + i * 8, pad['y'] + pad['height'] * 0.6 - 30 * ((i % 6) / 6.0))
    page.mouse.up()
    page.locator('dialog .btn-primary').tap()
    page.wait_for_timeout(300)
    bx = page.locator('.sign-page').first.bounding_box()
    tx, ty = bx['x'] + bx['width'] * 0.5, max(bx['y'], 120) + 60
    page.mouse.click(tx, ty)
    page.wait_for_selector('.s-item.s-image', timeout=5000)
    page.wait_for_timeout(300)
    ib = page.locator('.s-item.s-image').bounding_box()
    off = (ib['x'] + ib['width'] / 2 - tx, ib['y'] + ib['height'] / 2 - ty)
    rel = ((tx - bx['x']) / bx['width'], (ty - bx['y']) / bx['height'])
    page.screenshot(path=os.path.join(OUT, f'ts_sign_{ts}.png'))
    page.locator('[data-save]').tap()
    page.wait_for_selector('.result-card', timeout=20000)
    page.wait_for_timeout(500)
    where = page.evaluate("(() => { const n = document.querySelector('.result-card .simple-where'); return n && n.offsetHeight ? n.textContent : ''; })()")
    page.screenshot(path=os.path.join(OUT, f'ts_sign_{ts}_saved.png'))
    ctx.close()
    return canvas, off, rel, where, errors


def ts_signature(b):
    tag = 'signature'
    n_canvas, n_off, n_rel, _, e1 = sign_at(b, 'normal')
    x_canvas, x_off, x_rel, where, e2 = sign_at(b, 'xl')
    check(f'{tag}: page canvas equally sharp in Sehr groß', abs(n_canvas[0] - x_canvas[0]) < 0.02 and x_canvas[0] >= 1.9, f'{n_canvas} / {x_canvas}')
    check(f'{tag}: page shown at the same width in Sehr groß', abs(n_canvas[1] - x_canvas[1]) < 2, f'{n_canvas[1]} / {x_canvas[1]}')
    check(f'{tag}: signature centred on the tapped point (normal)', abs(n_off[0]) < 3 and abs(n_off[1]) < 3, str(n_off))
    check(f'{tag}: signature centred on the tapped point (Sehr groß)', abs(x_off[0]) < 3 and abs(x_off[1]) < 3, str(x_off))
    check(f'{tag}: saved – result says where the file is', 'Dateien' in where, where[:120])
    check(f'{tag}: no page/console errors', not e1 and not e2, json.dumps(e1 + e2)[:400])


def ts_words_ai(b):
    for lang in ['de', 'en']:
        tag = f'plain words {lang}'
        ctx, page, errors = ts_context(b, lang=lang, simple=True, ts='l', vw=390, vh=844)
        T = (lambda de, en: de if lang == 'de' else en)
        tr = lambda s: page.evaluate(f"import('./js/i18n/index.js').then(m => m.t({json.dumps(s)}))")

        def run():
            check(f'{tag}: no floating „+“ in simple mode', page.evaluate(JS_VIS, '.fab') == 0)
            page.click('[data-simple="neu"]')
            labels = menu_labels(page)
            check(f'{tag}: „Neu erstellen“ – 4 plain entries', len(labels) == 4 and labels[0] == tr('Text-Dokument (z. B. ein Brief)'), json.dumps(labels, ensure_ascii=False))
            page.keyboard.press('Escape')
            page.wait_for_timeout(200)
            page.click('[data-simple="umwandeln"]')
            labels = menu_labels(page)
            check(f'{tag}: convert menu in plain words', labels[1] == tr('Word-Dokument zu PDF'), json.dumps(labels, ensure_ascii=False))
            page.keyboard.press('Escape')
            doc = import_pdf(page, 'unkomprimiert.pdf')
            # viewer: no AI entry in the menu
            page.click('#viewer [data-v="more"]')
            labels = menu_labels(page)
            check(f'{tag}: viewer menu without „KI-Assistent“', labels and not any(T('KI-Assistent', 'AI assistant') in l for l in labels), json.dumps(labels, ensure_ascii=False)[:300])
            page.keyboard.press('Escape')
            # PDF verkleinern
            go(page, '#/werkzeug/komprimieren', '#tool-screen .card.intro')
            poll(page, f"document.querySelector('#tool-screen .screen-title').textContent === {json.dumps(tr('PDF verkleinern'))}", 3000)
            check(f'{tag}: title „PDF verkleinern“', page.inner_text('#tool-screen .screen-title').strip() == tr('PDF verkleinern'), page.inner_text('#tool-screen .screen-title'))
            intro = page.inner_text('#tool-screen .card.intro p')
            check(f'{tag}: chooser in plain words', intro.strip() == tr('Tippe unten auf eine deiner Dateien – oder hol eine PDF mit „Vom Gerät öffnen“ von deinem Gerät.'), intro[:100])
            bb = page.locator('#tool-screen [data-back]').bounding_box()
            after = page.evaluate("getComputedStyle(document.querySelector('#tool-screen [data-back]'), '::after').content")
            check(f'{tag}: back button with a word, ≥ 48 px', bb['width'] >= 80 and bb['height'] >= 48 and T('Zurück', 'Back') in after, f'{bb} {after}')
            small = page.evaluate("[...document.querySelectorAll('#tool-screen .screen-body .btn, #tool-screen .screen-body .doc-open')].filter(e => e.offsetHeight && e.getBoundingClientRect().height < 48).map(e => e.textContent.trim().slice(0, 20))")
            check(f'{tag}: first-screen buttons ≥ 48 px', not small, json.dumps(small, ensure_ascii=False))
            page.screenshot(path=os.path.join(OUT, f'words_{lang}_compress_chooser.png'))
            page.locator('#tool-screen .doc-open').first.click()
            page.wait_for_selector('#tool-screen .radio-card')
            page.wait_for_timeout(400)
            cards = page.evaluate("[...document.querySelectorAll('#tool-screen .radio-card strong')].map(e => e.textContent.trim())")
            check(f'{tag}: choices „Bilder verkleinern“ / „Etwas kleiner“ / „Viel kleiner“', cards == [tr('Bilder verkleinern'), tr('Etwas kleiner'), tr('Viel kleiner')], json.dumps(cards, ensure_ascii=False))
            check(f'{tag}: run button in plain words', tr('Jetzt verkleinern') in page.inner_text('#tool-screen [data-run]'))
            page.locator('#tool-screen .radio-card').nth(2).click()
            page.wait_for_timeout(200)
            check(f'{tag}: quality / dpi hidden in simple mode', page.evaluate(JS_VIS, '#tool-screen [data-strong] .field') == 0 and page.evaluate(JS_VIS, '#tool-screen [data-strong] .notice') == 1)
            page.locator('#tool-screen .radio-card').nth(1).click()
            page.screenshot(path=os.path.join(OUT, f'words_{lang}_compress.png'))
            page.click('#tool-screen [data-run]')
            page.wait_for_selector('#tool-screen .result-card', timeout=20000)
            page.wait_for_timeout(400)
            where = page.inner_text('#tool-screen .result-card .simple-where')
            check(f'{tag}: result says where the file is', T('„Dateien“', '“Files”') in where and 'Downloads' in where, where[:160])
            small = page.evaluate("[...document.querySelectorAll('#tool-screen .result-card .btn')].filter(e => e.getBoundingClientRect().height < 48).length")
            check(f'{tag}: result buttons ≥ 48 px', small == 0)
            with page.expect_download(timeout=8000):
                page.click('#tool-screen .result-card [data-r="dl"]')
            ok = poll(page, f"[...document.querySelectorAll('#toasts .toast')].some(t => t.textContent.includes({json.dumps(T('Ordner „Downloads“', '“Downloads” folder'))}))", 3000)
            check(f'{tag}: download → toast names the Downloads folder', ok, page.evaluate("[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent)"))
            page.screenshot(path=os.path.join(OUT, f'words_{lang}_compress_done.png'))
            # leave the tool via the labelled back button
            page.click('#tool-screen [data-back]')
            check(f'{tag}: back closes the tool', poll(page, "document.querySelector('#tool-screen').hidden", 4000))
            if lang == 'de':
                # writer: no AI entry in simple mode
                go(page, '#/neu/dokument', '.doc-page')
                page.wait_for_selector('.doc-page')
                page.click('[data-office-more]')
                labels = menu_labels(page)
                check(f'{tag}: writer menu without „KI-Schreibhilfe“', labels and not any('KI-Schreibhilfe' in l for l in labels), json.dumps(labels, ensure_ascii=False)[:300])
                page.keyboard.press('Escape')
                check(f'{tag}: user AI setting untouched', page.evaluate("localStorage.getItem('fale-ai-hidden')") is None)
            check(f'{tag}: no page/console errors', not errors, json.dumps(errors)[:400])
        step(tag, run)
        ctx.close()

    # normal mode: the AI entries and the original names are back
    tag = 'normal mode'
    ctx, page, errors = ts_context(b, simple=False, ts='normal', vw=390, vh=844)

    def run2():
        doc = import_pdf(page, 'unkomprimiert.pdf')
        page.click('#viewer [data-v="more"]')
        labels = menu_labels(page)
        check(f'{tag}: viewer menu offers „KI-Assistent“', any('KI-Assistent' in l for l in labels), json.dumps(labels, ensure_ascii=False)[:300])
        page.keyboard.press('Escape')
        go(page, f'#/werkzeug/komprimieren?doc={doc}', '#tool-screen .radio-card')
        page.wait_for_timeout(500)
        check(f'{tag}: original title „Komprimieren“', page.inner_text('#tool-screen .screen-title').strip() == 'Komprimieren')
        check(f'{tag}: original choices', page.evaluate("[...document.querySelectorAll('#tool-screen .radio-card strong')].map(e => e.textContent.trim())") == ['Bilder verkleinern', 'Verlustfrei', 'Stark'])
        check(f'{tag}: back button icon only', page.locator('#tool-screen [data-back]').bounding_box()['width'] <= 48)
        page.click('#tool-screen [data-back]')
        poll(page, "document.querySelector('#tool-screen').hidden", 4000)
        go(page, '#/neu/dokument', '.doc-page')
        page.wait_for_selector('.doc-page')
        page.click('[data-office-more]')
        labels = menu_labels(page)
        check(f'{tag}: writer menu offers „KI-Schreibhilfe“', any('KI-Schreibhilfe' in l for l in labels), json.dumps(labels, ensure_ascii=False)[:300])
        page.keyboard.press('Escape')
        check(f'{tag}: no page/console errors', not errors, json.dumps(errors)[:400])
    step(tag, run2)
    ctx.close()


def run_textsize(b):
    step('textsize settings', lambda: ts_settings(b))
    step('plain words + AI', lambda: ts_words_ai(b))
    step('signature', lambda: ts_signature(b))
    step('textsize matrix', lambda: ts_matrix(b))


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        if ONLY in ('all', 'mode'):
            for vw, vh in [(390, 844), (1280, 860)]:
                for lang in ['de', 'en']:
                    for theme in ['light', 'dark']:
                        step(f'combo {vw} {lang} {theme}', lambda: run_combo(b, vw, vh, lang, theme))
        if ONLY in ('all', 'textsize'):
            run_textsize(b)
        b.close()
    fails = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(fails)}/{len(results)} passed')
    for f in fails:
        print('  FAIL', f[0], f[2])
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()

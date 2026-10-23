"""Werkzeuge: finding a tool without scrolling through 100 cards (js/views.js buildQuick/buildAreas/applyArea).
- „Häufig gebraucht“ (8 tiles) and „Alle Bereiche“ (one tile per area with its count) on top
- area chips stay on top (sticky); a chip / area tile shows only that area, „Alle“ shows everything again
- „Zuletzt benutzt“ appears after a tool was opened (newest first, max. 4), on this device only
- search still looks through everything (also the KI tools), whatever area is chosen
- every tool keeps exactly one card (tiles only point to the cards); phone: nothing sticks out, tiles ≥ 44 px
- KI-Werkzeuge page: grouped (Verstehen, Schreiben & Antworten …), no area chips there; simple view: no extra rows
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import os, sys, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_tools_find')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []
INIT = "try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); } catch (e) {}"


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


VISIBLE_SECTIONS = "[...document.querySelectorAll('#view-werkzeuge .tool-section')].filter(s => s.offsetParent).map(s => s.dataset.section)"


def page_for(browser, w, h, label, extra=''):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, locale='de-DE')
    ctx.add_init_script(INIT + extra)
    pg = ctx.new_page()
    pg.on('console', lambda m: problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    pg.goto(URL + '#/werkzeuge')
    pg.wait_for_selector('#view-werkzeuge .area-tile', timeout=20000)
    pg.wait_for_function("() => document.querySelectorAll('#view-werkzeuge .area-tile').length >= 10", timeout=15000)
    pg.wait_for_timeout(400)
    return ctx, pg


def run(p):
    browser = p.chromium.launch()
    ctx, pg = page_for(browser, 390, 844, 'phone')

    def overview():
        pop = pg.locator('[data-popular] .tq')
        check('„Häufig gebraucht“: 8 tiles, first „Ausfüllen & unterschreiben“', pop.count() == 8 and 'unterschreiben' in pop.first.inner_text(), pop.all_inner_texts())
        check('no „Zuletzt benutzt“ before any tool was used', pg.locator('[data-recent]').is_hidden())
        areas = pg.locator('.area-tile')
        texts = areas.all_inner_texts()
        check('„Alle Bereiche“: one tile per area with its number of tools', areas.count() >= 10 and all('Werkzeug' in t for t in texts) and any('Konvertieren' in t for t in texts), texts[:4])
        chips = pg.locator('.tc-chip')
        check('area chips: „Alle“ first and pressed, one chip per area', chips.first.inner_text() == 'Alle' and chips.first.get_attribute('aria-pressed') == 'true' and chips.count() == areas.count() + 1)
        n = pg.evaluate("document.querySelectorAll('#view-werkzeuge [data-tool]').length")
        u = pg.evaluate("new Set([...document.querySelectorAll('#view-werkzeuge .tool-section:not([data-section=\"simple\"]) [data-tool]')].map(e => e.dataset.tool)).size")
        check('every tool keeps exactly one card (tiles are no extra cards)', pg.locator('#view-werkzeuge .tq[data-tool], #view-werkzeuge .area-tile[data-tool]').count() == 0 and u > 90, (n, u))
        small = pg.evaluate("[...document.querySelectorAll('#view-werkzeuge .tq, #view-werkzeuge .area-tile, #view-werkzeuge .tc-chip')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).length")
        check('phone: tiles and chips are big enough to tap', small == 0, small)
        wide = pg.evaluate("document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth")
        check('phone: nothing sticks out on the right', not wide)
        pg.screenshot(path=os.path.join(OUT, 'phone_overview.png'))
    step('overview', overview)

    def areas():
        pg.locator('.area-tile[data-area="konvertieren"]').click()
        pg.wait_for_timeout(400)
        vis = pg.evaluate(VISIBLE_SECTIONS)
        check('area tile „Konvertieren“: only that area is shown', vis == ['konvertieren'], vis)
        check('chip „Konvertieren“ pressed, overview hidden', pg.locator('.tc-chip[data-area="konvertieren"]').get_attribute('aria-pressed') == 'true' and pg.locator('[data-overview]').is_hidden())
        title_y = pg.locator('.tool-section[data-section="konvertieren"] .section-title').bounding_box()['y']
        bar = pg.locator('[data-toolbar]').bounding_box()
        check('the area starts right under the search bar (title visible)', bar['y'] + bar['height'] - 2 <= title_y < bar['y'] + bar['height'] + 60, (bar, title_y))
        pg.screenshot(path=os.path.join(OUT, 'phone_area.png'))
        pg.evaluate("document.querySelector('#main').scrollTop = 900")
        pg.wait_for_timeout(200)
        top = pg.locator('[data-toolbar]').bounding_box()['y']
        main_top = pg.evaluate("document.querySelector('#main').getBoundingClientRect().top")
        check('search + chips stay on top while scrolling (sticky)', abs(top - main_top) < 3, (top, main_top))
        pg.locator('.tc-chip[data-area="scannen"]').click()
        pg.wait_for_timeout(300)
        check('chip „Scannen“ switches the area', pg.evaluate(VISIBLE_SECTIONS) == ['scannen'])
        pg.locator('.tc-chip[data-area="all"]').click()
        pg.wait_for_timeout(300)
        vis = pg.evaluate(VISIBLE_SECTIONS)
        check('„Alle“ shows every area and the overview again', len(vis) >= 10 and pg.locator('[data-overview]').is_visible(), vis)
    step('areas', areas)

    def search():
        pg.locator('.tc-chip[data-area="sicherheit"]').click()
        pg.wait_for_timeout(300)
        pg.fill('#tool-search', 'word')
        pg.wait_for_timeout(400)
        vis = pg.evaluate(VISIBLE_SECTIONS)
        check('search looks through all areas even when one was chosen', 'konvertieren' in vis and 'sicherheit' not in vis and pg.locator('[data-overview]').is_hidden(), vis)
        check('search: „Alle“ chip shows that everything is searched', pg.locator('.tc-chip[data-area="all"]').get_attribute('aria-pressed') == 'true')
        pg.fill('#tool-search', 'Brief einfach')
        pg.wait_for_timeout(400)
        check('search finds the new KI tool from the Werkzeuge page', pg.locator('[data-ai-section] [data-tool="ai-erklaeren"]').is_visible())
        pg.fill('#tool-search', '')
        pg.dispatch_event('#tool-search', 'input')
        pg.wait_for_timeout(300)
        check('search cleared: back to the chosen area', pg.evaluate(VISIBLE_SECTIONS) == ['sicherheit'], pg.evaluate(VISIBLE_SECTIONS))
        pg.locator('.tc-chip[data-area="all"]').click()
    step('search', search)

    def recent():
        for tid in ('komprimieren', 'passwort'):
            pg.evaluate("location.hash = '#/werkzeuge'")
            pg.wait_for_timeout(300)
            pg.locator('.tc-chip[data-area="all"]').click()
            pg.locator(f'.tool-section [data-tool="{tid}"]').click()
            pg.wait_for_function("() => location.hash.startsWith('#/werkzeug/')", timeout=5000)
            pg.wait_for_timeout(300)
        pg.go_back(); pg.wait_for_timeout(300)
        pg.evaluate("location.hash = '#/werkzeuge'")
        pg.wait_for_timeout(500)
        rec = pg.locator('[data-recent] .tq')
        check('„Zuletzt benutzt“: newest first', rec.count() == 2 and 'Passwort' in rec.nth(0).inner_text() and 'Komprimieren' in rec.nth(1).inner_text(), rec.all_inner_texts())
        pg.locator('[data-popular] .tq[data-tq="zusammenfuegen"]').click()
        pg.wait_for_function("() => location.hash === '#/werkzeug/zusammenfuegen'", timeout=5000)
        check('a „Häufig gebraucht“ tile opens its tool', True)
        pg.evaluate("location.hash = '#/werkzeuge'")
        pg.wait_for_timeout(500)
        check('…and counts as used', 'Zusammenfügen' in pg.locator('[data-recent] .tq').first.inner_text())
        pg.locator('[data-recent] .tq').nth(1).click()
        pg.wait_for_function("() => location.hash === '#/werkzeug/passwort'", timeout=5000)
        check('a „Zuletzt benutzt“ tile opens its tool', True)
        pg.evaluate("location.hash = '#/werkzeuge'")
        pg.wait_for_timeout(400)
        for i in range(6):
            pg.evaluate(f"(async () => (await import('./js/tools/recent.js')).noteTool('t{i}'))()")
        pg.evaluate("localStorage.setItem('fale-tools-recent', JSON.stringify(['seiten', 'scannen', 'unterschreiben', 'bilder', 'komprimieren', 'kein-werkzeug-<b>']))")
        pg.reload(); pg.wait_for_selector('.area-tile'); pg.wait_for_timeout(500)
        rec = pg.locator('[data-recent] .tq')
        check('„Zuletzt benutzt“: at most 4 tiles, unknown ids ignored', rec.count() == 4 and '<b>' not in pg.locator('[data-recent]').inner_html(), rec.all_inner_texts())
        pg.screenshot(path=os.path.join(OUT, 'phone_recent.png'))
    step('recently used', recent)

    def ki_tab():
        pg.locator('[data-tab-link="ki"]').click()
        pg.wait_for_timeout(500)
        check('KI tab: no area chips and no overview', pg.locator('.tool-cats').is_hidden() and pg.locator('[data-overview]').is_hidden())
        groups = pg.locator('[data-ai-section] .ai-group-title').all_inner_texts()
        check('KI tab: tools grouped by what you want to do', groups[:2] == ['Verstehen', 'Schreiben & Antworten'] and len(groups) == 5, groups)
        first = pg.locator('[data-ai-section] .ai-group').first.locator('.tool-card h3').all_inner_texts()
        check('KI tab: „Brief einfach erklärt“ comes first', first and first[0] == 'Brief einfach erklärt', first)
        pg.screenshot(path=os.path.join(OUT, 'phone_ki.png'))
        pg.locator('[data-tab-link="tools"]').click()
    step('KI tab', ki_tab)
    ctx.close()

    def desktop():
        c, d = page_for(browser, 1280, 860, 'desktop')
        chips_h = d.locator('.tool-cats').bounding_box()['height']
        check('desktop: chips wrap instead of scrolling sideways', d.evaluate("getComputedStyle(document.querySelector('.tool-cats')).flexWrap") == 'wrap' and chips_h < 140, chips_h)
        check('desktop: 4 tiles per row', len({round(b['y']) for b in [d.locator('[data-popular] .tq').nth(i).bounding_box() for i in range(4)]}) == 1)
        d.screenshot(path=os.path.join(OUT, 'desktop_overview.png'))
        c.close()
    step('desktop', desktop)

    def simple():
        c = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE')
        c.add_init_script(INIT + "try { localStorage.setItem('fale-simple', '1'); } catch (e) {}")
        s = c.new_page(); s.goto(URL + '#/werkzeuge'); s.wait_for_selector('[data-simple-tools] .tool-card'); s.wait_for_timeout(600)
        check('simple view: the short list stays first, no extra rows', s.locator('[data-overview]').is_hidden() and s.locator('.tool-cats').is_hidden() and s.locator('[data-simple-tools]').is_visible())
        s.locator('[data-simple-all]').click(); s.wait_for_timeout(400)
        check('simple view „Alle Werkzeuge anzeigen“: areas available, no duplicate „Häufig gebraucht“', s.locator('.tool-cats').is_visible() and s.locator('[data-popular]').is_hidden())
        # the KI page in the simple view (bug: it showed no tools at all)
        s.locator('[data-tab-link="ki"]').click(); s.wait_for_timeout(600)
        n = s.evaluate("[...document.querySelectorAll('#view-werkzeuge [data-section=\"ki\"] .tool-card')].filter(e => e.offsetHeight).length")
        check('simple view: the KI page shows all KI tools', n == 14, n)
        s.goto(URL + '#/werkzeuge/ki'); s.reload(); s.wait_for_selector('[data-section="ki"] .tool-card', timeout=15000); s.wait_for_timeout(600)
        n = s.evaluate("[...document.querySelectorAll('#view-werkzeuge [data-section=\"ki\"] .tool-card')].filter(e => e.offsetHeight).length")
        check('simple view: KI page opened directly (start card / link) shows the tools', n == 14 and s.locator('[data-simple-tools]').is_hidden(), n)
        s.screenshot(path=os.path.join(OUT, 'phone_simple_ki.png'))
        c.close()
    step('simple view', simple)

    def dark():
        c = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE', color_scheme='dark')
        c.add_init_script(INIT + "try { localStorage.setItem('fale-theme', 'dark'); } catch (e) {}")
        d = c.new_page(); d.goto(URL + '#/werkzeuge'); d.wait_for_selector('.area-tile'); d.wait_for_timeout(600)
        bg = d.evaluate("getComputedStyle(document.querySelector('.tq')).backgroundColor")
        check('dark: tiles use the dark surface', bg not in ('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'), bg)
        d.screenshot(path=os.path.join(OUT, 'phone_dark.png'))
        c.close()
    step('dark', dark)
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:400])
    sys.exit(1 if bad else 0)

"""Rein – raus – ins Nächste: every option of the app is opened and left again like a person does it (back arrow,
tab bar), on a slow phone (CPU ×4). Nothing may freeze, hang open or throw, and the app must not get heavier the
longer it is used.
- all main pages, viewer, every PDF tool (without and with a document), extras, KI screens, Teilen, all editors,
  templates, every FaleNetwork web tool: worst main-thread stall < LIMIT, „Zurück“ closes the screen, no dialog/menu
  left over, no page error
- memory: opening + leaving the Excel editor (3000 rows) and the Word editor again and again must not pile up
  (heap after GC grows < 300 KB per open; before the fix: +1.9 MB per Excel open)
- fast tapping through 40 options without waiting: the last one is shown, „Zurück“ walks back without loops, the tab
  bar answers right away
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import base64, io, json, os, random, time, traceback
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_nav_stress')
os.makedirs(OUT, exist_ok=True)
LIMIT = 700  # ms, worst single stall at CPU ×4 (same bar as test_tools_lag)
LEAK_KB = 300
results, problems = [], []
INIT = "try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-install-hint', '1'); localStorage.setItem('fale-hints-off', '1'); } catch (e) {}"
WATCH = """window.__d = []; (function () { let last = performance.now(); setInterval(() => { const n = performance.now(); const g = n - last - 50; if (g > 80) window.__d.push([Math.round(n), Math.round(g)]); last = n; }, 50); })();"""
IMPORT = """async ([b64, name, mime]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const { importFiles } = await import('./js/library.js'); const [d] = await importFiles([new File([u], name, { type: mime })], { source: 'Gerät', any: true, quiet: true }); return d.id; }"""
STATE = """() => { const scr = [...document.querySelectorAll('.screen')].filter(s => !s.hidden); const v = document.getElementById('viewer');
  const vis = e => e && !e.hidden && e.getClientRects().length > 0;
  return { hash: location.hash, screens: scr.length, viewer: !!(v && !v.hidden), dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.textContent.trim().slice(0, 50)),
    menus: document.querySelectorAll('.menu-layer').length, loading: [...document.querySelectorAll('.v-loading')].filter(vis).length,
    failed: [...document.querySelectorAll('.screen:not([hidden]) .empty h3')].map(h => h.textContent).filter(t => /nicht geklappt/.test(t)).join(' ') }; }"""
MIME = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'txt': 'text/plain'}


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:500]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def files():
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    import docx, openpyxl
    f = {}
    f['pdf'] = os.path.join(OUT, 'vertrag.pdf')
    if not os.path.exists(f['pdf']):
        c = canvas.Canvas(f['pdf'], pagesize=A4)
        for p in range(40):
            for i, y in enumerate(range(800, 60, -18)):
                c.drawString(60, y, f'Seite {p + 1}, Zeile {i}: Der Mieter zahlt monatlich, Kündigungsfrist drei Monate.')
            c.showPage()
        c.save()
    f['docx'] = os.path.join(OUT, 'bericht.docx')
    if not os.path.exists(f['docx']):
        D = docx.Document()
        for i in range(40):
            D.add_heading('Kapitel %d' % i, 1)
            for j in range(8):
                D.add_paragraph('Dies ist ein Absatz mit etwas Text für den Test. ' * 6)
        D.save(f['docx'])
    f['xlsx'] = os.path.join(OUT, 'tabelle.xlsx')
    if not os.path.exists(f['xlsx']):
        wb = openpyxl.Workbook(); ws = wb.active
        ws.append(['Datum', 'Artikel', 'Menge', 'Preis', 'Summe'])
        for r in range(2, 3002):
            ws.append([f'2026-01-{(r % 28) + 1:02d}', f'Artikel {r}', r % 17 + 1, round(1.5 + r % 40 * 0.75, 2), f'=C{r}*D{r}'])
        wb.save(f['xlsx'])
    f['txt'] = os.path.join(OUT, 'notiz.txt')
    open(f['txt'], 'w', encoding='utf-8').write('Zeile mit Text äöü Kündigungsfrist drei Monate\n' * 400)
    return f


def new_page(browser):
    c = browser.new_context(viewport={'width': 412, 'height': 900}, locale='de-DE', device_scale_factor=2.6, is_mobile=True, has_touch=True)
    c.add_init_script(INIT + WATCH)
    pg = c.new_page()
    pg.on('pageerror', lambda e: problems.append(f'[pageerror] {pg.url[-50:]} {str(e)[:200]}'))
    pg.on('console', lambda m: problems.append(f'[console] {pg.url[-50:]} {m.text[:200]}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.goto(URL + '#/start'); pg.wait_for_selector('#view-start'); pg.wait_for_timeout(1200)
    return c, pg


def leave(pg, st):
    if st['dialogs']:
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    if st['viewer'] and pg.locator('#viewer [data-v="back"]').is_visible():
        pg.locator('#viewer [data-v="back"]').click(); return
    btn = pg.locator('.screen:not([hidden]) .screen-head [data-back]')
    if btn.count() and btn.first.is_visible():
        btn.first.click(); return
    pg.locator('.bnav[data-nav="start"]').first.click()


def run(p):
    F = files()
    browser = p.chromium.launch()
    c, pg = new_page(browser)
    ids = {k: pg.evaluate(IMPORT, [base64.b64encode(open(v, 'rb').read()).decode(), os.path.basename(v), MIME[k]]) for k, v in F.items()}
    pdf = ids['pdf']
    tools = pg.evaluate("async () => (await import('./js/tools/index.js')).TOOLS.filter(t => !t.soon).map(t => ({ id: t.id, needsDoc: !!t.needsDoc, viewer: !!t.viewer }))")
    extras = pg.evaluate("async () => (await import('./js/extras/routes.js')).EXTRA_ROUTES")
    webtools = pg.evaluate("async () => (await import('./js/webtools/list.js')).listedWebTools().map(t => t.id)")
    R = [('Start', '#/start'), ('Dateien', '#/dateien'), ('Werkzeuge', '#/werkzeuge'), ('KI-Werkzeuge', '#/werkzeuge/ki'), ('Suche', '#/suche'),
         ('Ich', '#/einstellungen'), ('Einstellungen', '#/einstellungen/allgemein'), ('Speicher', '#/einstellungen/speicher'), ('Viewer', f'#/ansicht/{pdf}')]
    for t in tools:
        if t['needsDoc'] and not t['viewer']: R.append((f"{t['id']} (Auswahl)", f"#/werkzeug/{t['id']}"))
        R.append((t['id'], f"#/werkzeug/{t['id']}" + (f'?doc={pdf}' if t['needsDoc'] or t['viewer'] else '')))
    R += [(f'Extra {x}', f'#/{x}') for x in extras]
    R += [(f'KI {k or "Übersicht"}', f'#/ki/{k}' if k else '#/ki') for k in ['', 'chat', 'erklaeren', 'vergleichen', 'verbessern', 'antwort', 'zusammenfassen', 'uebersetzen', 'folien', 'lernkarten', 'brief', 'bild', 'einstellungen']]
    R += [('Teilen', '#/teilen'), ('Sicher teilen', f'#/teilen/link?doc={pdf}'), ('Unterschrift anfordern', f'#/teilen/unterschrift?doc={pdf}'), ('Geräte verbinden', '#/verbinden')]
    R += [('Word-Editor', f"#/bearbeiten/{ids['docx']}"), ('Excel-Editor', f"#/bearbeiten/{ids['xlsx']}"), ('Text-Editor', f"#/bearbeiten/{ids['txt']}"),
          ('Neues Dokument', '#/neu/dokument'), ('Neue Tabelle', '#/neu/tabelle'), ('Neue Präsentation', '#/neu/praesentation'), ('Vorlagen', '#/vorlagen')]
    R += [(f'Web {w}', f'#/web/{w}') for w in webtools]
    pg.wait_for_timeout(10000)  # background indexing of the imported files settles
    cdp = c.new_cdp_session(pg)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})

    def every_option():
        bad_stall, bad_stuck, opened_n = [], [], 0
        for label, hsh in R:
            e0 = len(problems)
            t0 = pg.evaluate('performance.now()')
            pg.evaluate(f'location.hash = {json.dumps(hsh)}')
            for i in range(80):
                pg.wait_for_timeout(100)
                st = pg.evaluate(STATE)
                if not st['loading'] and i >= 4: opened_n += 1; break
            pg.wait_for_timeout(600)
            st = pg.evaluate(STATE)
            if st['failed']: bad_stuck.append(f'{label}: {st["failed"]}')
            leave(pg, st)
            pg.wait_for_timeout(800)
            st2 = pg.evaluate(STATE)
            if st2['dialogs']:  # leave guard of an editor: „Verwerfen“ like a person who did not change anything
                b = pg.locator('dialog[open] button', has_text='Verwerfen')
                if b.count(): b.first.click()
                else: pg.keyboard.press('Escape')
                pg.wait_for_timeout(500); st2 = pg.evaluate(STATE)
            stall = max([x[1] for x in pg.evaluate('window.__d') if x[0] > t0] or [0])
            if stall >= LIMIT: bad_stall.append((label, stall))
            stuck = [k for k in ('screens', 'viewer', 'menus', 'dialogs', 'loading') if st2[k]]
            if stuck:
                bad_stuck.append(f'{label}: {stuck}')
                pg.keyboard.press('Escape'); pg.evaluate("location.hash = '#/start'"); pg.wait_for_timeout(600)
            if problems[e0:]: bad_stuck.append(f'{label}: {problems[e0:][0]}')
        check(f'{len(R)} options opened one after another (phone, CPU ×4)', opened_n == len(R), opened_n)
        check(f'no option freezes the app (every stall < {LIMIT} ms)', not bad_stall, bad_stall)
        check('„Zurück“ leaves every option, nothing hangs open, no errors', not bad_stuck, bad_stuck[:6])
    step('every option in and out', every_option)

    def memory():
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        cdp.send('HeapProfiler.enable')
        def heap():
            for _ in range(2): cdp.send('HeapProfiler.collectGarbage'); pg.wait_for_timeout(200)
            return cdp.send('Runtime.getHeapUsage')['usedSize'] / 1024
        for label, hsh in (('Excel-Editor (3000 Zeilen)', f"#/bearbeiten/{ids['xlsx']}"), ('Word-Editor', f"#/bearbeiten/{ids['docx']}"), ('Viewer', f'#/ansicht/{pdf}')):
            hs = []
            for i in range(10):
                pg.evaluate(f'location.hash = {json.dumps(hsh)}'); pg.wait_for_timeout(1500)
                pg.evaluate("location.hash = '#/start'"); pg.wait_for_timeout(600)
                if i in (1, 9): hs.append(heap())
            per = (hs[1] - hs[0]) / 8
            check(f'memory: {label} opened + left 10× – nothing piles up ({per:+.0f} KB per open < {LEAK_KB})', per < LEAK_KB, round(per))
    step('memory', memory)

    def fast():
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        random.seed(5)
        pool = [r for r in R if not r[1].startswith('#/web/')]
        seq = random.sample(pool, 40)
        e0 = len(problems)
        for _, hsh in seq:
            pg.evaluate(f'location.hash = {json.dumps(hsh)}'); pg.wait_for_timeout(120)
        pg.wait_for_timeout(3500)
        st = pg.evaluate(STATE)
        check('fast tapping through 40 options: the last one is shown', st['hash'] == seq[-1][1], (st['hash'], seq[-1][1]))
        seen, steps = [], 0
        while steps < 60:
            st = pg.evaluate(STATE)
            if not st['screens'] and not st['viewer']: break
            h1 = st['hash']
            leave(pg, st)
            for _ in range(40):
                pg.wait_for_timeout(100)
                if pg.evaluate('location.hash') != h1: break
            g = pg.locator('dialog[open] button', has_text='Verwerfen')
            if g.count(): g.first.click(); pg.wait_for_timeout(300)
            seen.append(pg.evaluate('location.hash')); steps += 1
        check(f'„Zurück“ walks back to a main page without loops ({steps} steps)', steps < 60 and len(seen) == len(set(seen)), seen[-5:])
        t = time.time()
        pg.locator('.bnav[data-nav="dateien"]').click()
        pg.wait_for_selector('#view-dateien:not([hidden])', timeout=8000)
        ms = round((time.time() - t) * 1000)
        check(f'then the tab bar answers right away ({ms} ms < 1500)', ms < 1500, ms)
        check('fast tapping: no errors', not problems[e0:], problems[e0:][:3])
    step('fast tapping', fast)
    c.close()
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} passed')
    for n, c, i in results:
        if not c:
            print('  FAIL', n, i[:300])

"""Stress test with large PDFs: nothing may freeze (main thread blocked) or hang.

Fixtures (make_big_data.py, generated): bigdata/big_text.pdf (600 text pages), bigdata/big_scan.pdf (60 scan pages, 80 MB).
Measured with a long-task observer (every main-thread block ≥ 50 ms) – in a phone-sized window with 4× slower CPU:
- import of both files
- viewer: first page, jump to page 437, search for a word on page 437, thumbnails, outline
- tools: compress the scan, page overview (Seiten verwalten) of the 600-page file, merge both files
Limits: no single block over LIMIT_MS, every step finishes within its time budget, no page errors.
Run: python3 test_big.py   (server: python3 -m http.server 8798 --bind 127.0.0.1 in the repo; URL via BIG_URL)
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('BIG_URL', 'http://127.0.0.1:8798/')
TD = os.path.join(HERE, 'bigdata')
OUT = os.path.join(HERE, 'out_big')
os.makedirs(OUT, exist_ok=True)
LIMIT_MS = int(os.environ.get('BIG_LIMIT_MS', '1500'))
results, report = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


INIT = """try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-simple-hint', 'hidden'); } catch (e) {}
window.__lt = [];
try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); } catch (e) {}"""

DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, size: d.size, pages: d.pages}))); });
  db.close(); return res; }"""


def step(pg, name, fn, budget_s):
    """Run fn, then report the longest main-thread block that happened during it."""
    pg.evaluate('window.__lt = []')
    t = time.time()
    ok, err = True, ''
    try:
        fn()
    except Exception as e:  # a timeout = the step hung
        ok, err = False, str(e).split('\n')[0][:200]
    dt = time.time() - t
    lt = pg.evaluate('window.__lt')
    worst = max([d for _, d in lt], default=0)
    total = sum(d for _, d in lt)
    report.append({'step': name, 'seconds': round(dt, 1), 'longest_block_ms': worst, 'blocked_total_ms': total, 'ok': ok, 'error': err})
    print(f'   {name}: {dt:.1f} s, longest block {worst} ms, blocked {total} ms', flush=True)
    check(f'{name}: finishes (≤ {budget_s} s)', ok and dt <= budget_s, err or round(dt, 1))
    check(f'{name}: no freeze over {LIMIT_MS} ms', worst <= LIMIT_MS, worst)


def doc(pg, name):
    return next((d for d in pg.evaluate(DOCS_JS) if d['name'] == name), None)


def run(p):
    subprocess.run([sys.executable, os.path.join(HERE, 'make_big_data.py')], check=True, capture_output=True)
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 412, 'height': 900}, is_mobile=True, has_touch=True, locale='de-DE')
    c.add_init_script(INIT)
    pg = c.new_page()
    cdp = c.new_cdp_session(pg)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=30000)
    pg.wait_for_timeout(1500)

    def imp():
        pg.set_input_files('#pdf-input', [os.path.join(TD, 'big_text.pdf'), os.path.join(TD, 'big_scan.pdf')])
        for _ in range(600):
            if doc(pg, 'big_text.pdf') and doc(pg, 'big_scan.pdf'):
                return
            pg.wait_for_timeout(250)
        raise TimeoutError('import did not finish')
    step(pg, 'import 2 large files (81 MB)', imp, 120)
    dt_, ds_ = doc(pg, 'big_text.pdf'), doc(pg, 'big_scan.pdf')
    check('import: page counts known', dt_ and dt_['pages'] == 600 and ds_ and ds_['pages'] == 60, [dt_, ds_])

    # ---- viewer, 600 text pages
    def open_text():
        pg.goto(URL + f'#/ansicht/{dt_["id"]}')
        pg.wait_for_selector('#viewer .page[data-page-number="1"] canvas', timeout=60000)
    step(pg, 'viewer: open 600-page file', open_text, 30)

    def jump():
        inp = pg.locator('#viewer [data-v="pagenum"]')
        inp.fill('437')
        inp.press('Enter')
        pg.wait_for_selector('#viewer .page[data-page-number="437"] canvas', timeout=60000)
    step(pg, 'viewer: jump to page 437', jump, 20)

    def search():
        pg.keyboard.press('Control+f')
        if not pg.locator('#viewer [data-v="findinput"]').is_visible():
            pg.locator('#viewer [data-v="find"]').first.click()
        pg.locator('#viewer [data-v="findinput"]').fill('Zauberwürfel')
        pg.locator('#viewer [data-v="findinput"]').press('Enter')
        pg.wait_for_function("() => /1\\s*(von|of)\\s*1/.test((document.querySelector('#viewer [data-v=\"findcount\"]') || {}).textContent || '')", timeout=120000)
    step(pg, 'viewer: search the whole file (600 pages)', search, 90)
    pg.screenshot(path=os.path.join(OUT, 'search.png'))

    def thumbs():
        btn = pg.locator('#viewer [data-v="panel"]')
        if btn.count() and btn.is_visible():
            btn.click()
        else:
            pg.locator('#viewer [data-v="more"]').click()
            pg.get_by_text('Seitenübersicht').first.click()
        pg.wait_for_selector('#viewer [data-v="thumbs"] img, #viewer [data-v="thumbs"] canvas', timeout=60000)
        pg.wait_for_timeout(1500)
    step(pg, 'viewer: page thumbnails', thumbs, 30)
    pg.keyboard.press('Escape')

    # ---- viewer, 80 MB scan
    def open_scan():
        pg.goto(URL + f'#/ansicht/{ds_["id"]}')
        pg.wait_for_selector('#viewer .page[data-page-number="1"] canvas', timeout=90000)
        pg.wait_for_timeout(2500)
    step(pg, 'viewer: open 80 MB scan', open_scan, 40)

    def scroll_scan():
        for i in range(8):
            pg.mouse.wheel(0, 2500)
            pg.wait_for_timeout(350)
        pg.wait_for_timeout(1500)
    step(pg, 'viewer: scroll through the scan', scroll_scan, 30)

    # ---- tools
    def compress():
        pg.goto(URL + f'#/werkzeug/komprimieren?doc={ds_["id"]}')
        pg.wait_for_selector('.screen-foot [data-run]', timeout=30000)
        pg.wait_for_timeout(800)
        mode = pg.evaluate("() => (document.querySelector('input[name=mode]:checked') || {}).value")
        check('compress: scan file → "Bilder verkleinern" preselected', mode == 'images', mode)
        pg.locator('.screen-foot [data-run]').click()
        pg.wait_for_selector('[data-out] .result-card', timeout=400000)
    step(pg, 'compress 80 MB scan (shrink images)', compress, 300)
    small = next((d for d in pg.evaluate(DOCS_JS) if d['name'].startswith('big_scan (komprimiert)')), None)
    check('compress: result is much smaller (≤ 70 %)', small and small['size'] <= ds_['size'] * 0.7, [small, ds_['size']])
    if small:
        def open_small():
            pg.goto(URL + f'#/ansicht/{small["id"]}')
            pg.wait_for_selector('#viewer .page[data-page-number="1"] canvas', timeout=60000)
        step(pg, 'viewer: open the compressed scan', open_small, 30)
        check('compress: still 60 pages', small['pages'] == 60, small)

    def organize():
        pg.goto(URL + f'#/werkzeug/seiten?doc={dt_["id"]}')
        pg.wait_for_selector('.pcard', timeout=60000)
        pg.wait_for_timeout(2000)
        pg.mouse.wheel(0, 6000)
        pg.wait_for_timeout(1500)
    step(pg, 'page overview of 600 pages', organize, 45)
    pg.screenshot(path=os.path.join(OUT, 'organize.png'))

    def select_one():
        pg.locator('.pcard .pcard-thumb').nth(3).click()
        pg.wait_for_function("() => document.querySelectorAll('.pcard.selected').length === 1", timeout=10000)
        pg.wait_for_timeout(300)
    step(pg, 'select one page among 600 (no rebuild)', select_one, 10)
    # the tap itself (handler time) – before, every tap rebuilt all 600 cards (≈ 1 s on a phone)
    ms = pg.evaluate("() => { const b = document.querySelectorAll('.pcard .pcard-thumb')[5]; const t = performance.now(); b.click(); return Math.round(performance.now() - t); }")
    check('select one page: the tap is handled at once (≤ 60 ms with 4× slower CPU)', ms <= 60, ms)

    def merge():
        pg.goto(URL + f'#/werkzeug/zusammenfuegen?doc={dt_["id"]}')
        pg.locator('[data-add]').click(timeout=30000)
        pg.locator(f'dialog .pick-item:has(input[value="{ds_["id"]}"])').click(timeout=20000)
        pg.locator('dialog .btn-primary').click()
        btn = pg.locator('.screen-foot [data-merge]')
        btn.wait_for(timeout=30000)
        pg.wait_for_function("() => { const b = document.querySelector('.screen-foot [data-merge]'); return b && !b.disabled; }", timeout=30000)
        btn.click()
        pg.wait_for_selector('[data-result] .result-card', timeout=400000)
    step(pg, 'merge 600 + 60 pages', merge, 420)
    merged = next((d for d in pg.evaluate(DOCS_JS) if d['pages'] == 660), None)
    check('merge: one file with 660 pages', merged, [d['name'] for d in pg.evaluate(DOCS_JS)])

    check('no page errors', not errs, errs[:4])
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1, ensure_ascii=False)
    b.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], str(r[2])[:400])
    sys.exit(1 if bad else 0)

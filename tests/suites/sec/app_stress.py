"""Freeze/hang sweep for the FaLe PDF app with big files (fixtures of tests/suites/webtools/stress_make_fixtures.py):
import, viewer (scroll through 300 pages, side panel with thumbnails, search), and every tool that works on a
document (open it with the big file; tools with a single obvious action button run it). Measures the longest
main-thread freeze (50 ms heartbeat) per step and reports hangs (no reaction within the limit).
  python3 app_stress.py [--phone] [--limit-ms 2000] [tool-id …]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pplus_common import URL, ensure_server, launch, context, docs, goto

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'webtools', 'fixtures')
PHONE = '--phone' in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit-ms') + 1]) if '--limit-ms' in sys.argv else 2000
ONLY = [a for a in sys.argv[1:] if not a.startswith('--') and not a.isdigit()]
FREEZE = """
window.__fz = { max: 0 };
(() => { let last = performance.now();
  const beat = () => { const now = performance.now(); const gap = now - last - 50; if (now > 1500 && gap > window.__fz.max) window.__fz.max = Math.round(gap); last = now; setTimeout(beat, 50); };
  setTimeout(beat, 50); })();
try { localStorage.setItem('fale-onboarding-done', '1'); } catch (e) {}
"""
TOOLS = ['unterschreiben', 'kommentieren', 'seiten', 'komprimieren', 'exportieren', 'vorlesen', 'passwort', 'schwaerzen', 'bearbeiten',
         'wasserzeichen', 'seitenzahlen', 'kopfzeile', 'extrahieren', 'pdf-word', 'pdf-powerpoint', 'lesemodus', 'formular-erstellen',
         'zuschneiden', 'lesezeichen', 'durchsuchbar', 'pdf-excel']
rows = []

def fz(page):
    try: return page.evaluate('window.__fz.max')
    except Exception: return None

def reset(page):
    try: page.evaluate('window.__fz.max = 0')
    except Exception: pass

def record(step, page, t0, status='ok'):
    r = {'step': step, 'ms': int((time.time() - t0) * 1000), 'freeze': fz(page), 'status': status}
    rows.append(r)
    flag = 'FREEZE' if (r['freeze'] or 0) > LIMIT else ('HANG' if 'HANG' in status else '')
    print(f"{flag:6} {step:44} {r['ms']:7} ms  freeze {r['freeze']} ms  {status}", flush=True)

def alive(page, timeout=20000):
    """The page reacts again: a trivial evaluate returns."""
    page.wait_for_function('() => true', timeout=timeout)

ensure_server()
with sync_playwright() as p:
    browser = launch(p)
    ctx = context(browser, phone=PHONE)
    ctx.add_init_script(FREEZE)
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_selector('html.ready', timeout=30000)
    page.wait_for_timeout(800)
    ids = {}
    for name in ['stress_300p.pdf', 'stress_photos.pdf']:
        reset(page); t0 = time.time()
        page.set_input_files('#pdf-input', [os.path.join(FIX, name)])
        try:
            page.wait_for_function(f"location.hash.startsWith('#/ansicht/')", timeout=120000)
            page.wait_for_function("document.querySelector('[data-v=loading]') && document.querySelector('[data-v=loading]').hidden", timeout=120000)
            record(f'import + open {name}', page, t0)
        except Exception as e:
            record(f'import + open {name}', page, t0, f'HANG: {str(e)[:80]}')
        page.wait_for_timeout(500)
        ids[name] = next((d['id'] for d in docs(page) if d['name'] == name), None)

    # viewer: fast scroll through all 300 pages, thumbnails panel, search
    reset(page); t0 = time.time()
    goto(page, f"#/ansicht/{ids['stress_300p.pdf']}", '[data-v=container]')
    for k in range(40):
        page.evaluate("k => { const c = document.querySelector('[data-v=container]'); c.scrollTop = c.scrollHeight * k / 40; }", k + 1)
        page.wait_for_timeout(60)
    page.wait_for_timeout(1500)
    record('viewer: scroll through 300 pages', page, t0)
    reset(page); t0 = time.time()
    page.locator('[data-v=panel]').click()
    page.wait_for_timeout(3000)
    page.evaluate("() => { const b = document.querySelector('[data-v=panelbody]'); if (b) b.scrollTop = b.scrollHeight; }")
    page.wait_for_timeout(2000)
    record('viewer: thumbnails panel (300)', page, t0)
    page.locator('[data-v=panel]').click()
    page.wait_for_timeout(400)
    reset(page); t0 = time.time()
    if page.locator('[data-v=findbar]').is_hidden():
        page.locator('[data-v=find]').click()
    page.fill('[data-v=findinput]', 'Zeile 47')
    try:
        page.wait_for_function("() => /von 300/.test(document.querySelector('[data-v=findcount]')?.textContent || '')", timeout=120000)
        record('viewer: search in 300 pages', page, t0, 'ok: ' + page.locator('[data-v=findcount]').inner_text())
    except Exception:
        record('viewer: search in 300 pages', page, t0, 'HANG (no hit count in 120 s)')
    page.keyboard.press('Escape')

    # tools
    for tid in TOOLS:
        if ONLY and tid not in ONLY: continue
        for name in ['stress_300p.pdf', 'stress_photos.pdf']:
            goto(page, '#/werkzeuge')
            page.wait_for_timeout(300)
            reset(page); t0 = time.time()
            try:
                page.evaluate(f"location.hash = '#/werkzeug/{tid}?doc={ids[name]}'")
                page.wait_for_timeout(4000)
                alive(page)
                record(f'tool {tid} open ({name})', page, t0)
            except Exception as e:
                record(f'tool {tid} open ({name})', page, t0, f'HANG: {str(e)[:80]}')
                continue
            # main action: the primary button in the screen footer, when there is exactly one enabled
            btn = page.locator('.screen:not([hidden]) .screen-foot .btn-primary:visible, .screen-foot:visible .btn-primary:visible')
            if btn.count() != 1 or btn.first.is_disabled():
                continue
            label = btn.first.inner_text().strip()[:30]
            reset(page); t0 = time.time()
            try:
                btn.first.click()
                page.wait_for_function("""() => document.querySelector('.result-card') || [...document.querySelectorAll('#toasts .toast')].some(t => /error|fehl|nicht/i.test(t.className + t.textContent))
                  || document.querySelector('dialog[open]')""", timeout=300000)
                st = 'ok' if page.locator('.result-card').count() else ('dialog' if page.locator('dialog[open]').count() else 'toast: ' + page.locator('#toasts').inner_text()[:80])
                record(f'tool {tid} run "{label}" ({name})', page, t0, st)
                if page.locator('dialog[open]').count(): page.keyboard.press('Escape')
            except Exception as e:
                record(f'tool {tid} run "{label}" ({name})', page, t0, f'HANG (no result in 300 s)')
    browser.close()

bad = [r for r in rows if (r['freeze'] or 0) > LIMIT or 'HANG' in r['status']]
json.dump(rows, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app_stress_report.json'), 'w'), indent=1)
print(f'\n{len(rows)} steps · {len(bad)} with a freeze > {LIMIT} ms or a hang')
for r in sorted(bad, key=lambda r: -(r['freeze'] or 0)):
    print(f"  {r['step']:44} freeze {r['freeze']} ms · {r['status']}")

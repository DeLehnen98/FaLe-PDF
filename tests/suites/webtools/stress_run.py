"""Freeze/hang sweep over every tool with big inputs (fixtures from stress_make_fixtures.py).

For each tool: open the page, add a big file, wait until it is prepared, run the tool (when it can run without
further input) and measure
  - load / run time (hang = no result or error within the limit),
  - the longest main-thread freeze (50 ms heartbeat, see wtlib.INIT) while preparing and while running.
Prints a table (worst first) and writes stress_report.json.  Usage:
  python3 stress_run.py [tool-id …] [--phone] [--limit-ms 2000]
"""
import json, sys, time
from pathlib import Path
from wtlib import Suite, FIX, HERE

SPECS = HERE.parents[2] / 'network' / 'tools' / 'webtools' / 'specs'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
PHONE = '--phone' in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit-ms') + 1]) if '--limit-ms' in sys.argv else 2000
RUN_TIMEOUT = 300000
SKIP = {'heic-to-jpg', 'heic-to-pdf', 'heic-to-png', 'pdf-viewer'}   # no HEIC stress input; the viewer has no run step           # no HEIC stress input

def inputs_for(spec):
    acc = ' '.join(spec.get('accepts') or []).lower()
    multi = spec.get('multiple')
    if not acc or spec.get('minFiles') == 0 and not acc:
        return []
    runs = []
    if 'pdf' in acc:
        runs.append(['stress_300p.pdf', 'stress_photos.pdf'] if multi else ['stress_300p.pdf'])
        if not multi: runs.append(['stress_photos.pdf'])
    elif ('png' in acc and 'jp' not in acc and 'image/*' not in acc):
        runs.append(['stress_big.png'])
    elif any(k in acc for k in ('image/', '.jpg', '.jpeg', 'jpeg')):
        runs.append(['stress_big.jpg']); runs.append(['stress_12mp.jpg'])
    elif 'text/plain' in acc or '.txt' in acc:
        runs.append(['stress_long.txt'])
    return runs

# stage tools: what a user does before pressing the button (these steps can be heavy themselves)
PREP = {
  'create-pdf-form': [("[data-detect]", "/erkannt|Keine Felder|detected|No fields/")],
  'edit-bookmarks': [("[data-headings]", "/erkannt|Keine Überschriften|found|No headings/")],
  'sign-pdf': [(".sec-chip:has-text('Datum')", None)],
}

def prep(page, tid):
    worst = 0
    for sel, done in PREP.get(tid, []):
        reset_freeze(page)
        page.locator(sel).first.click()
        if done:
            page.wait_for_function(f"() => {done}.test(document.querySelector('.sec-status')?.textContent || '')", timeout=RUN_TIMEOUT)
        else:
            page.wait_for_timeout(500)
        worst = max(worst, freeze(page) or 0)
    return worst

def freeze(page):
    try: return page.evaluate('window.__wt.freeze.max')
    except Exception: return None

def reset_freeze(page):
    try: page.evaluate('window.__wt.freeze.max = 0')
    except Exception: pass

rows = []
specs = sorted(SPECS.glob('*.json'))
with Suite('stress') as s:
    ctx = s.context('phone' if PHONE else 'desktop', 'de')
    for sp in specs:
        spec = json.loads(sp.read_text('utf-8'))
        tid = spec['id']
        if args and tid not in args: continue
        if tid in SKIP: continue
        for files in inputs_for(spec):
            row = {'tool': tid, 'input': '+'.join(files), 'load_ms': None, 'load_freeze': None, 'run_ms': None, 'run_freeze': None, 'status': ''}
            page = s.open(ctx, f"/werkzeuge/{spec['de']['slug']}/")
            try:
                t0 = time.time()
                s.pick(page, *files)
                try:
                    s.wait_ready(page, len(files), timeout=120000)
                except Exception:
                    row['status'] = 'HANG while preparing (>120 s)'
                row['load_ms'] = int((time.time() - t0) * 1000)
                page.wait_for_timeout(800)  # stage tools render previews after the cards
                row['load_freeze'] = freeze(page)
                if not row['status'] and tid in PREP:
                    t2 = time.time()
                    try:
                        row['prep_freeze'] = prep(page, tid)
                        row['prep_ms'] = int((time.time() - t2) * 1000)
                    except Exception as e:
                        row['status'] = f'HANG/failed in preparation step: {str(e)[:100]}'
                if not row['status']:
                    btn = s.primary(page)
                    if btn.is_disabled():
                        row['status'] = 'needs more input (button disabled)'
                    else:
                        reset_freeze(page)
                        t1 = time.time()
                        btn.click()
                        try:
                            page.wait_for_function("""() => {
                              const vis = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
                              if (vis(document.querySelector('.wt-result')) || vis(document.querySelector('.wt-error'))) return true;
                              if ([...document.querySelectorAll('.sec-status')].some(st => !st.hidden && (st.dataset.kind === 'error' || /zuerst|first/i.test(st.textContent)))) return true;
                              // the button bar's own hint ("Markiere zuerst …")
                              return [...document.querySelectorAll('[role=alert]:not(.wt-error)')].some(a => a.textContent.trim());
                            }""", timeout=RUN_TIMEOUT)
                            row['run_ms'] = int((time.time() - t1) * 1000)
                            row['run_freeze'] = freeze(page)
                            if page.locator('.wt-result:not([hidden])').count(): row['status'] = 'ok'
                            elif page.locator('.wt-error:not([hidden])').count(): row['status'] = 'error: ' + page.locator('.wt-error').inner_text()[:120].replace('\n', ' ')
                            else:
                                hint = page.evaluate("() => [...document.querySelectorAll('[role=alert]:not(.wt-error)')].map(a => a.textContent.trim()).filter(Boolean)[0] || ''")
                                if not hint: hint = page.evaluate("() => [...document.querySelectorAll('.sec-status')].filter(s => !s.hidden).map(s => s.textContent.trim())[0] || ''")
                                row['status'] = 'needs more input: ' + hint[:80]
                        except Exception:
                            row['run_ms'] = int((time.time() - t1) * 1000)
                            row['run_freeze'] = freeze(page)
                            row['status'] = f'HANG while running (>{RUN_TIMEOUT // 1000} s)'
            except Exception as e:
                row['status'] = 'exception: ' + str(e)[:160]
            finally:
                try: page.close()
                except Exception: pass
            worst = max(row['load_freeze'] or 0, row['run_freeze'] or 0, row.get('prep_freeze') or 0)
            row['worst'] = worst
            rows.append(row)
            flag = 'FREEZE' if worst > LIMIT else ('HANG' if 'HANG' in row['status'] else '')
            print(f"{flag:6} {tid:22} {row['input'][:34]:34} load {row['load_ms']}ms/{row['load_freeze']}ms{f"  prep {row.get('prep_ms')}ms/{row.get('prep_freeze')}ms" if 'prep_ms' in row else ''}  run {row['run_ms']}ms/{row['run_freeze']}ms  {row['status']}", flush=True)
    s.fails.clear()  # this is a report, console errors of big inputs are listed per row
(HERE / 'stress_report.json').write_text(json.dumps(sorted(rows, key=lambda r: -r['worst']), indent=1, ensure_ascii=False))
bad = [r for r in rows if r['worst'] > LIMIT or 'HANG' in r['status']]
print(f'\n{len(rows)} runs · {len(bad)} with a freeze > {LIMIT} ms or a hang')
for r in sorted(bad, key=lambda r: -r['worst']):
    print(f"  {r['tool']:22} {r['input'][:30]:30} worst freeze {r['worst']} ms · {r['status']}")

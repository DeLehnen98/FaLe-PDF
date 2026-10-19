"""Gesamt-Check: every screen and every tool of FaLe PDF on a small phone (360 × 780) with a 4× slower CPU.

For each route (main views, extras/assistants, office, sharing, AI, the viewer and all tools – with a document where
the tool needs one, otherwise with a fitting file put into its file field):
- the screen opens (no "Das hat nicht geklappt"), no page/console errors
- no freeze: longest main-thread gap (50 ms heartbeat) ≤ LIMIT_MS while opening and while running
- no horizontal page overflow, no element sticking out on the right (outside scroll areas)
- no "undefined" / "NaN" / "[object …]" / "null" in visible text, no clipped button labels
- simple view: no technical words (OCR, XFA, DPI, SVG, vCard …) – security terms like AES-256 are allowed
- tools with an obvious main button: pressing it (default options) leads somewhere within 90 s (result, dialog,
  message, download, file picker, next step) – i.e. nothing hangs
Report: out_check_all/report.json + a list of problems at the end. Screenshots of every screen in out_check_all/.
Run: python3 test_check_all.py [route-filter …]   (server: python3 -m http.server 8798 --bind 127.0.0.1 in the repo)
"""
import json, os, re, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('CHECK_URL', 'http://127.0.0.1:8798/')
TD = '/home/claude/FalePDF/tests/base/testdata'
OD = '/home/claude/FalePDF/tests/base/officedata'
OUT = os.path.join(HERE, 'out_check_all')
os.makedirs(OUT, exist_ok=True)
LIMIT_MS = int(os.environ.get('CHECK_LIMIT_MS', '1500'))
ONLY = [a for a in sys.argv[1:] if not a.startswith('-')]
results, report = [], []

INIT = """try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-simple-hint', 'hidden'); localStorage.setItem('fale-onboarding-done', '1'); } catch (e) {}
window.__fz = { max: 0 };
(() => { let last = performance.now(); const beat = () => { const now = performance.now(); const gap = now - last - 50; if (gap > window.__fz.max) window.__fz.max = Math.round(gap); last = now; setTimeout(beat, 50); }; setTimeout(beat, 50); })();"""

AUDIT = r"""() => {
  const vw = document.documentElement.clientWidth;
  const vis = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const root = document.querySelector('.screen:not([hidden]) .screen-body, .screen:not([hidden])') || document.querySelector('#viewer:not([hidden])') || document.querySelector('main') || document.body;
  const scroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; } return false; };
  const out = { overflow: document.documentElement.scrollWidth - vw, sticking: [], bad: [], clipped: [], error: !!document.querySelector('.screen:not([hidden]) .empty h3') && /nicht geklappt/.test(document.querySelector('.screen:not([hidden]) .empty h3').textContent) };
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 && !scroller(el) && out.sticking.length < 5) out.sticking.push((el.className && el.className.baseVal === undefined ? String(el.className) : el.tagName).slice(0, 60) + ' ' + Math.round(r.right));
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const t = n.nodeValue; if (!t || !/\b(undefined|NaN|null)\b|\[object /.test(t)) continue;
    const el = n.parentElement; if (!el || !vis(el) || el.closest('textarea, input, pre, code, .ocr-text, .xfaLayer, .ed-page, .doc-body, [contenteditable]')) continue;
    if (out.bad.length < 5) out.bad.push(t.trim().slice(0, 80));
  }
  for (const b of root.querySelectorAll('button, .btn, a.btn')) {
    if (!vis(b)) continue;
    const s = getComputedStyle(b);
    if (b.scrollWidth > b.clientWidth + 2 && s.textOverflow !== 'ellipsis' && !/(auto|scroll)/.test(s.overflowX) && out.clipped.length < 5) out.clipped.push((b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 40));
  }
  if (document.documentElement.classList.contains('simple')) {
    // technical words a beginner does not know (simple view only)
    const J = /\b(OCR|XFA|PDF\/A|DPI|dpi|SVG|vCard|\.vcf|Metadaten|Metadata|Layer|Rendering|Cache|Worker|Bitrate|JPEG-Qualität|Komprimierungsgrad|Encoding|Codec)\b/;
    out.jargon = [];
    const w2 = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w2.nextNode());) { const m = J.exec(n.nodeValue || ''); const el = n.parentElement; if (m && el && vis(el) && !el.closest('textarea, input, .doc-name, .ocr-text, .license-list, [data-ocr-row]') && out.jargon.length < 6 && !out.jargon.includes(m[1])) out.jargon.push(m[1] + ': ' + n.nodeValue.trim().slice(0, 60)); }
  }
  return out;
}"""

DOCS = """async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const res = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name}))); });
  db.close(); return res; }"""


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    if not cond:
        print('FAIL ' + name + (f'  [{str(info)[:300]}]' if info else ''), flush=True)


def file_for(accept):
    a = (accept or '').lower()
    if 'pdf' in a or not a:
        return os.path.join(TD, 'bericht.pdf')
    if 'image' in a or 'jpg' in a or 'png' in a:
        return os.path.join(TD, 'foto.jpg')
    if 'docx' in a or 'word' in a or '.txt' in a or 'markdown' in a:
        return os.path.join(OD, 'bericht.docx') if 'docx' in a else os.path.join(OD, 'notiz.txt')
    if 'xlsx' in a or 'csv' in a or 'sheet' in a:
        return os.path.join(OD, 'umsatz.xlsx')
    if 'pptx' in a or 'presentation' in a:
        return os.path.join(OD, 'praesentation.pptx')
    return os.path.join(TD, 'bericht.pdf')


def routes(doc_id):
    tools = []
    src = open('/home/claude/FalePDF/js/tools/index.js', encoding='utf-8').read()
    for m in re.finditer(r"\{ id: '([a-z0-9-]+)'[^\n]*", src):
        tid, line = m.group(1), m.group(0)
        if f"id: '{tid}'" in line and 'group:' in line and tid not in [t[0] for t in tools]:
            tools.append((tid, 'needsDoc: true' in line))
    r = [('start', '#/start'), ('dateien', '#/dateien'), ('werkzeuge', '#/werkzeuge'), ('suche', '#/suche?q=Bericht'), ('einstellungen', '#/einstellungen'),
         ('viewer', f'#/ansicht/{doc_id}')]
    for x in ['profil', 'fristen', 'tresor', 'papierkorb', 'duplikate', 'schreiben', 'gliederung', 'konto', 'briefkasten', 'gedaechtnis', 'steuer', 'familie']:
        r.append((x, f'#/{x}'))
    r += [('neu-dokument', '#/neu/dokument'), ('neu-tabelle', '#/neu/tabelle'), ('neu-praesentation', '#/neu/praesentation'), ('vorlagen', '#/vorlagen'),
          ('teilen', '#/teilen'), ('verbinden', '#/verbinden'), ('ki', '#/ki')]
    for tid, needs in tools:
        r.append((f'tool:{tid}', f'#/werkzeug/{tid}' + (f'?doc={doc_id}' if needs else '')))
    return r


def gap(pg):
    try:
        return pg.evaluate('window.__fz.max')
    except Exception:
        return None


VARIANTS = [  # name, browser language, settings, run the main buttons too
    ('de', 'de-DE', {}, True),
    ('gross-einfach', 'de-DE', {'fale-textsize': 'xl', 'fale-simple': '1'}, False),
    ('en-dunkel', 'en-GB', {'fale-theme': 'dark'}, False),
    ('ru', 'ru-RU', {}, False),
]
WANT = os.environ.get('CHECK_VARIANTS', 'de,gross-einfach,en-dunkel,ru').split(',')


def run(p):
    b = p.chromium.launch()
    for v in VARIANTS:
        if v[0] in WANT:
            run_variant(b, *v)
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1, ensure_ascii=False)
    b.close()


def run_variant(b, vname, loc, settings, actions):
    c = b.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True, device_scale_factor=2, locale=loc, accept_downloads=True)
    c.add_init_script(INIT + ''.join(f"try {{ localStorage.setItem('{k}', '{v}'); }} catch (e) {{}}" for k, v in settings.items()))
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append('page: ' + str(e)[:200]))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and 'favicon' not in m.text and errs.append('console: ' + m.text[:200]))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=30000)
    pg.set_input_files('#pdf-input', [os.path.join(TD, 'bericht.pdf')])
    for _ in range(60):
        d = next((x for x in pg.evaluate(DOCS) if x['name'] == 'bericht.pdf'), None)
        if d:
            break
        pg.wait_for_timeout(250)
    cdp = c.new_cdp_session(pg)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    for name, h in routes(d['id']):
        if ONLY and not any(o in name for o in ONLY):
            continue
        errs.clear()
        row = {'variant': vname, 'route': name, 'hash': h}
        try:
            pg.goto(URL + '#/start')
            pg.wait_for_timeout(400)
            pg.evaluate('window.__fz.max = 0')
            t0 = time.time()
            pg.goto(URL + h)
            pg.wait_for_timeout(2500)
            row['open_s'] = round(time.time() - t0, 1)
            row['open_gap'] = gap(pg)
            a = pg.evaluate(AUDIT)
            if name == 'viewer':  # also the side panel (pages / outline / bookmarks)
                try:
                    pg.locator('#viewer [data-v="panel"]').click()
                    pg.wait_for_timeout(1000)
                    a2 = pg.evaluate(AUDIT)
                    for k in ('sticking', 'bad', 'clipped'):
                        a[k] = a[k] + [x for x in a2[k] if x not in a[k]]
                    pg.screenshot(path=os.path.join(OUT, vname + '_viewer_panel.png'))
                    pg.keyboard.press('Escape')
                except Exception as e:
                    row['panel_err'] = str(e)[:120]
            row.update({k: a.get(k) for k in ('overflow', 'sticking', 'bad', 'clipped', 'error', 'jargon')})
            pg.screenshot(path=os.path.join(OUT, vname + '_' + re.sub(r'[^a-z0-9-]', '_', name) + '.png'))
            # the main action (tools only): put a file in if the tool asks for one, then press the primary button
            if actions and name.startswith('tool:'):
                if '?doc=' not in h:
                    # tools without a document: the first button that opens a file picker gets a fitting file
                    cands = pg.locator('.screen:not([hidden]) .screen-body button:visible, .screen:not([hidden]) .screen-body label:visible')
                    tried = 0
                    for i in range(min(cands.count(), 14)):
                        el = cands.nth(i)
                        txt = (el.inner_text() or '').strip()
                        if not re.search(r'(Datei|Album|Bild|Foto|wählen|auswählen|hinzufügen|öffnen|PDF|Word|Excel|PowerPoint|Text)', txt, re.I) or re.search(r'Kamera|aufnehmen|scannen', txt, re.I):
                            continue
                        tried += 1
                        try:
                            with pg.expect_file_chooser(timeout=2000) as fc:
                                el.click()
                            acc = fc.value.element.get_attribute('accept') or ''
                            f = file_for(acc)
                            files = [f, os.path.join(TD, 'anhang.pdf') if f.endswith('.pdf') else f] if fc.value.is_multiple() else [f]
                            fc.value.set_files(files)
                            row['file'] = ', '.join(os.path.basename(x) for x in files) + f' ({txt[:24]})'
                            pg.wait_for_timeout(3000)
                            # a second picker (e.g. compare: old + new version)
                            more = pg.locator('.screen:not([hidden]) .screen-body button:visible:has-text("wählen"), .screen:not([hidden]) .screen-body button:visible:has-text("Neue Version")')
                            if name == 'tool:vergleichen' and more.count():
                                try:
                                    with pg.expect_file_chooser(timeout=2000) as fc2:
                                        more.first.click()
                                    fc2.value.set_files(os.path.join(TD, 'anhang.pdf'))
                                    pg.wait_for_timeout(2500)
                                except Exception:
                                    pass
                            break
                        except Exception:
                            pg.keyboard.press('Escape')
                            if tried >= 3:
                                break
                btn = pg.locator('.screen:not([hidden]) .screen-foot .btn-primary:visible')
                if btn.count() and btn.first.is_enabled():
                    row['action'] = btn.first.inner_text().strip()[:40]
                    pg.evaluate('window.__fz.max = 0')
                    before = pg.url
                    SIG = "() => { const b = document.querySelector('.screen:not([hidden]) .screen-body'); return b ? b.querySelectorAll('*').length + ':' + b.innerText.length : ''; }"
                    sig0 = pg.evaluate(SIG)
                    t1 = time.time()
                    outcome = None
                    try:
                        with pg.expect_file_chooser(timeout=1500) as fc:
                            btn.first.click()
                        fc.value.set_files(os.path.join(TD, 'bericht.pdf'))
                        outcome = 'file picker'
                    except Exception:
                        pass
                    waited = 0
                    for _ in range(180):
                        if outcome and outcome != 'file picker':
                            break
                        st = pg.evaluate("""() => document.querySelector('.result-card') ? 'result' : document.querySelector('dialog[open]') ? 'dialog'
                          : document.querySelector('.toast-error') ? 'error message' : null""")
                        busy = pg.evaluate("() => !!document.querySelector('.ocr-panel, .toast-progress, [aria-busy=true]')")
                        if st:
                            outcome = st
                            break
                        if pg.url != before:
                            outcome = 'next screen'
                            break
                        if not busy and waited >= 8 and pg.evaluate(SIG) != sig0:
                            outcome = 'screen updated'
                            break
                        if not busy and waited >= 40 and pg.locator('.toast:not(.toast-progress)').count():
                            outcome = 'message: ' + pg.locator('.toast:not(.toast-progress)').last.inner_text()[:80]
                            break
                        waited += 1
                        pg.wait_for_timeout(500)
                    if outcome == 'dialog':
                        row['dialog'] = pg.locator('dialog[open]').first.inner_text()[:120].replace('\n', ' | ')
                    if outcome == 'error message':
                        row['message'] = pg.locator('.toast-error').first.inner_text()[:160]
                    row['action_outcome'] = outcome or 'NOTHING (hang?)'
                    row['action_s'] = round(time.time() - t1, 1)
                    row['action_gap'] = gap(pg)
                    pg.screenshot(path=os.path.join(OUT, vname + '_' + re.sub(r'[^a-z0-9-]', '_', name) + '_after.png'))
                    pg.keyboard.press('Escape')
                    pg.wait_for_timeout(300)
        except Exception as e:
            row['exception'] = str(e).split('\n')[0][:200]
        row['errors'] = list(errs)
        report.append(row)
        problems = []
        if row.get('exception'): problems.append('exception: ' + row['exception'])
        if row.get('error'): problems.append('screen shows "Das hat nicht geklappt"')
        if (row.get('open_gap') or 0) > LIMIT_MS: problems.append(f"freeze while opening {row['open_gap']} ms")
        if (row.get('action_gap') or 0) > LIMIT_MS: problems.append(f"freeze while running {row['action_gap']} ms")
        if row.get('action_outcome', '').startswith('NOTHING'): problems.append('main button: no reaction in 90 s')
        if (row.get('overflow') or 0) > 1: problems.append(f"page {row['overflow']} px too wide")
        if row.get('sticking'): problems.append('sticks out: ' + '; '.join(row['sticking']))
        if row.get('bad'): problems.append('odd text: ' + '; '.join(row['bad']))
        if row.get('clipped'): problems.append('clipped buttons: ' + '; '.join(row['clipped']))
        if row['errors']: problems.append('errors: ' + ' || '.join(row['errors'][:3]))
        if row.get('jargon'): problems.append('technical words in the simple view: ' + '; '.join(row['jargon']))
        row['problems'] = problems
        check(f'{vname} {name}: ok', not problems, ' / '.join(problems))
        print(f"   {name:28} open {row.get('open_s')} s gap {row.get('open_gap')} ms" + (f" | {row.get('action')!r} → {row.get('action_outcome')} in {row.get('action_s')} s, gap {row.get('action_gap')} ms" if row.get('action') else ''), flush=True)
    c.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], str(r[2])[:500])
    sys.exit(1 if bad else 0)

"""Vorlagen-Archiv, arc2 sections: Excel-/Tabellen-Vorlagen, Briefvorlagen, Lebenslauf-Design-Galerie.

- generator: idempotent, every page has one h1, canonical, hreflang (pairs only), description, no inline style/script, size
- spreadsheets: index search + filter (DE/EN × phone/desktop), detail page live grid, editing recalculates, drop-down
  editor, XLSX + CSV download; EVERY template's XLSX recalculated in LibreOffice headless and compared with the engine
- letters: every page → "Vorlage verwenden" → the tool opens prefilled → PDF with the expected text; the cancellation
  example text on the page equals the tool's own letter text; remembered sender kept; EN GDPR letters
- CV designs: gallery DE/EN, every design opens the CV builder with that design → PDF (ATS without images, academic
  with publications, school leaver with education first); matching cover letter
- app: #/neu/tabelle?vorlage=<new template> opens in the FaLe PDF app (served from the repo root)
Screenshots → shots/arc2_*.png. Port: WT_PORT (default 8710); app server on 8871."""
import datetime
import warnings
warnings.filterwarnings("ignore")
import json
import re
import subprocess
import sys
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from wtlib import Suite, ORIGIN, PORT, OUT
import arc2_lo

ROOT = Path('/home/claude/FalePDF')
NET = ROOT / 'network'
V = NET / 'tools/vorlagen'
TABS = {json.loads(f.read_text())['id']: json.loads(f.read_text()) for f in sorted((V / 'tabellen').glob('*.json'))}
BRIEFS = {json.loads(f.read_text())['id']: json.loads(f.read_text()) for f in sorted((V / 'briefe').glob('*.json'))}
DESIGNS = {json.loads(f.read_text())['id']: json.loads(f.read_text()) for f in sorted((V / 'designs').glob('*.json'))}
SPECS = {json.loads(f.read_text())['id']: json.loads(f.read_text()) for f in (NET / 'tools/webtools/specs').glob('*.json')}
BASE = 'https://fale.network'
QUICK = '--quick' in sys.argv


def tool(tid, lang='de'):
    return ('/werkzeuge/' if lang == 'de' else '/en/tools/') + SPECS[tid][lang]['slug'] + '/'


class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.ld = []; s._ld = False; s.links = set(); s.alts = {}; s.canon = None; s.h1 = 0; s.meta = {}

    def handle_starttag(s, t, a):
        a = dict(a)
        if t == 'script' and a.get('type') == 'application/ld+json': s._ld = True
        if t == 'link' and a.get('rel') == 'canonical': s.canon = a['href']
        if t == 'link' and a.get('rel') == 'alternate' and a.get('hreflang'): s.alts[a['hreflang']] = a['href']
        if t == 'meta' and (a.get('name') or a.get('property')): s.meta[a.get('name') or a.get('property')] = a.get('content')
        if t in ('a', 'link') and a.get('href'): s.links.add(a['href'])
        if t in ('img', 'script') and a.get('src'): s.links.add(a['src'])
        if t == 'h1': s.h1 += 1

    def handle_data(s, d):
        if s._ld: s.ld.append(d)

    def handle_endtag(s, t):
        if t == 'script': s._ld = False


def get(path):
    try:
        with urllib.request.urlopen(ORIGIN + path) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''


def pdftext(p):
    return ' '.join(subprocess.run(['pdftotext', str(p), '-'], capture_output=True, text=True).stdout.split())


def norm(t):
    return re.sub(r'\s+', ' ', t).strip()


ENGINE = """() => {
  const h = document.querySelector('[data-arc2-sheet]').arc2;
  const wb = h.wb();
  const col = c => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const out = {};
  for (const sh of wb.sheets) {
    const m = {};
    for (const [k, cell] of sh.cells) if (cell.f) { const v = cell.cv; m[col(k % 16384) + (Math.floor(k / 16384) + 1)] = v && typeof v === 'object' ? ('#ERR ' + (v.code || '')) : v; }
    out[sh.name] = m;
  }
  return out;
}"""
EPOCH = datetime.datetime(1899, 12, 30)


def lo_num(v):
    if isinstance(v, datetime.datetime):
        return (v - EPOCH).total_seconds() / 86400
    if isinstance(v, datetime.time):
        return (v.hour * 3600 + v.minute * 60 + v.second) / 86400
    if isinstance(v, datetime.date):
        return (datetime.datetime(v.year, v.month, v.day) - EPOCH).days
    return v


def same(a, b):
    if a in ('', None) and b in ('', None):
        return True
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= max(1e-6, abs(b) * 1e-9) or abs(a - b) < 0.0051 and abs(b) > 1
    return str(a) == str(b)


with Suite('arc2-sections') as s:
    s.expect(len(TABS) >= 38, f'{len(TABS)} spreadsheet pages')
    s.expect(len(BRIEFS) >= 35, f'{len(BRIEFS)} letter pages')
    s.expect(len(DESIGNS) == 10, f'{len(DESIGNS)} CV designs')
    # ---------------------------------------------------------------- unit test of the template data (node)
    r = subprocess.run(['node', 'arc2_sheet_units.mjs'], capture_output=True, text=True)
    s.expect(r.returncode == 0, 'arc2_sheet_units.mjs: ' + r.stdout[-600:])

    # ---------------------------------------------------------------- generator idempotent
    dirs = [NET / 'vorlagen/tabellen', NET / 'vorlagen/briefe', NET / 'vorlagen/lebenslauf-designs', NET / 'en/templates/spreadsheets', NET / 'en/templates/letters', NET / 'en/templates/cv-designs']
    snap = lambda: {p: p.read_bytes() for d in dirs for p in d.rglob('*') if p.is_file()}
    subprocess.run(['python3', 'network/tools/vorlagen/build.py', '--lax'], cwd=ROOT, capture_output=True)
    a = snap()
    subprocess.run(['python3', 'network/tools/vorlagen/build.py', '--lax'], cwd=ROOT, capture_output=True)
    s.expect(a == snap(), 'arc2 pages not idempotent')

    # ---------------------------------------------------------------- static checks
    sm = get('/sitemap.xml')[1].decode()
    locs = [x for x in re.findall(r'<loc>' + re.escape(BASE) + r'([^<]*)</loc>', sm) if re.match(r'^/(vorlagen/(tabellen|briefe|lebenslauf-designs)|en/templates/(spreadsheets|letters|cv-designs))/', x)]
    expect_n = 2 + 2 * len(TABS) + 1 + len(BRIEFS) + sum(1 for b in BRIEFS.values() if 'en' in b) + (1 if any('en' in b for b in BRIEFS.values()) else 0) + 2
    s.expect(len(locs) == expect_n, f'sitemap: {len(locs)} arc2 URLs, expected {expect_n}')
    links, types = set(), set()
    for path in locs:
        st, raw = get(path)
        if not s.expect(st == 200, f'{path}: {st}'): continue
        html = raw.decode()
        p = P(); p.feed(html)
        s.expect(p.h1 == 1, f'{path}: {p.h1} h1')
        s.expect(p.canon == BASE + path, f'{path}: canonical')
        s.expect('x-default' in p.alts and BASE + path in p.alts.values(), f'{path}: hreflang {p.alts}')
        s.expect(not re.search(r'\sstyle\s*=', html) and '<style' not in html, f'{path}: inline style')
        s.expect(not re.search(r'<script(?![^>]*(src=|type="application/ld\+json"|type="application/json"))', html), f'{path}: inline script')
        s.expect(len(raw) < 90_000, f'{path}: {len(raw)} bytes')
        s.expect(110 <= len(p.meta.get('description') or '') <= 200, f'{path}: description length')
        for blk in p.ld:
            o = json.loads(blk); types.add(o.get('@type'))
        links |= {u.split('#')[0] for u in p.links if u.startswith('/')}
    s.expect({'CollectionPage', 'CreativeWork', 'FAQPage', 'BreadcrumbList'} <= types, f'JSON-LD {types}')
    bad = [u for u in sorted(links) if u and get(u.split('?')[0])[0] != 200]
    s.expect(not bad, f'broken links {bad[:8]}')
    # hreflang only for real pairs: a DE-only letter must not point to EN
    p = P(); p.feed(get('/vorlagen/briefe/kuendigung-handyvertrag/')[1].decode())
    s.expect(set(p.alts) == {'de', 'x-default'}, f'DE-only letter hreflang {p.alts}')
    p = P(); p.feed(get('/vorlagen/briefe/dsgvo-auskunft/')[1].decode())
    s.expect(p.alts.get('en') == BASE + '/en/templates/letters/gdpr-subject-access-request/', f'GDPR pair {p.alts}')
    idx = json.loads(get('/vorlagen/data/index.json')[1])['ids']
    s.expect(all(f'brief-{b}' in idx for b in BRIEFS) and all(f'design-{d}' in idx and f'en-design-{d}' in idx for d in DESIGNS), 'prefill ids in index.json')
    hub = get('/vorlagen/')[1].decode()
    s.expect('/vorlagen/tabellen/' in hub and '/vorlagen/briefe/' in hub and '/vorlagen/lebenslauf-designs/' in hub, 'hub links to the new sections')

    # ---------------------------------------------------------------- spreadsheets: index + detail, all variants
    for v in s.variants():
        de = v.lang == 'de'
        page = s.open(v, '/vorlagen/tabellen/' if de else '/en/templates/spreadsheets/')
        vis = lambda: page.locator('.vl-card:visible').count()
        s.expect(vis() == len(TABS), f'{v}: {vis()} spreadsheet cards')
        page.fill('#vl-q', 'schicht' if de else 'shift')
        page.wait_for_timeout(200)
        s.expect(page.locator('.vl-card:visible a[href*="schichtplan"], .vl-card:visible a[href*="shift-schedule"]').count() == 1, f'{v}: search finds the shift plan')
        page.fill('#vl-q', '')
        page.click('[data-vl-field="verein"]')
        s.expect(vis() == sum(1 for t in TABS.values() if t['cat'] == 'Verein'), f'{v}: category filter')
        page.click('[data-vl-field=""]')
        s.check_page(page)
        if v.device == 'phone': s.shot(page, f'arc2_tab_index_{v.lang}_phone')
        page.close()
        # detail page: schichtplan
        page = s.open(v, '/vorlagen/tabellen/schichtplan/' if de else '/en/templates/spreadsheets/shift-schedule/')
        page.wait_for_selector('[data-arc2-sheet][data-ready]', timeout=20000)
        s.expect(page.locator('[data-arc2-actions]').is_visible(), f'{v}: download buttons visible')
        val = lambda a: page.evaluate(f"() => document.querySelector('[data-arc2-sheet]').arc2.values('{a}')")
        s.expect(val('I6') == 37.5, f'{v}: initial hours {val("I6")}')
        page.locator('.arc2-table td[data-r="5"][data-c="1"]').click()          # B6 (drop-down: F/S/N/U/K/X)
        s.expect(page.locator('#arc2-sel').is_visible(), f'{v}: drop-down editor for a list cell')
        page.select_option('#arc2-sel', 'X')
        page.wait_for_timeout(150)
        s.expect(val('I6') == 30 and val('B17') == 1, f'{v}: edit recalculates ({val("I6")}, {val("B17")})')
        s.expect(page.locator('.arc2-table td[data-r="16"][data-c="1"]').evaluate('e => getComputedStyle(e).backgroundColor') != 'rgb(255, 255, 255)', f'{v}: understaffing turns red')
        page.locator('.arc2-table td[data-r="5"][data-c="8"]').click()           # I6 formula → read-only explanation
        s.expect('ZÄHLENWENN' in page.locator('.arc2-fx').inner_text(), f'{v}: formula shown in German')
        s.check_page(page)
        if v.device == 'phone':
            s.shot(page, f'arc2_tab_schicht_{v.lang}_phone')
            s.shot(page, f'arc2_tab_schicht_{v.lang}_phone_grid', top='#vorschau')
            if de:
                page.emulate_media(color_scheme='dark'); s.shot(page, 'arc2_tab_schicht_de_phone_dark', top='#vorschau'); page.emulate_media(color_scheme='light')
        if v.device == 'desktop':
            x = s.download_click(page, '[data-arc2-xlsx]')
            vals = arc2_lo.values(arc2_lo.recalc(x, OUT / f'arc2-edit-{v.lang}'))
            s.expect(vals['Schichtplan'].get('B6') == 'X' and vals['Schichtplan'].get('I6') == 30, f'{v}: edited XLSX recalculated by LibreOffice: {vals["Schichtplan"].get("I6")}')
            c = s.download_click(page, '[data-arc2-csv]')
            txt = c.read_text(encoding='utf-8-sig')
            s.expect('Anna Beispiel;X;F' in txt and ';30' in txt, f'{v}: CSV content {txt[:200]!r}')
        page.close()

    # ---------------------------------------------------------------- every template: XLSX → LibreOffice recalculation = engine
    ctx = s.context('desktop', 'de')
    checked = 0
    for tid, t in ([] if '--no-lo' in sys.argv else list(TABS.items())[:6] if QUICK else TABS.items()):
        page = s.open(ctx, f'/vorlagen/tabellen/{t["slug"]}/')
        try:
            page.wait_for_selector('[data-arc2-sheet][data-ready]', timeout=20000)
        except Exception:
            s.fails.append(f'{tid}: grid not ready'); page.close(); continue
        eng = page.evaluate(ENGINE)
        x = s.download_click(page, '[data-arc2-xlsx]')
        s.expect(x.name == f'{TABS[tid]["name"].replace("/", "-")}.xlsx' or x.suffix == '.xlsx', f'{tid}: file name {x.name}')
        try:
            lo = arc2_lo.values(arc2_lo.recalc(x, OUT / f'arc2-lo-{tid}'))
        except Exception as e:
            s.fails.append(f'{tid}: LibreOffice {e}'); page.close(); continue
        diffs = []
        n = 0
        for sheet, cells in eng.items():
            for addr, ev in cells.items():
                if isinstance(ev, str) and ev.startswith('#ERR'):
                    diffs.append(f'{sheet}!{addr} engine error {ev}'); continue
                lv = lo_num(lo.get(sheet, {}).get(addr))
                if isinstance(lv, str) and lv.startswith('#'):
                    diffs.append(f'{sheet}!{addr} LO error {lv}'); continue
                n += 1
                if not same(lv, ev) and not (ev in ('', None) and lv == 0):
                    diffs.append(f'{sheet}!{addr} engine={ev!r} LO={lv!r}')
        s.expect(not diffs, f'{tid}: {len(diffs)} differences engine vs LibreOffice: {diffs[:5]}')
        s.expect(n > 0, f'{tid}: no formulas compared')
        checked += n
        page.close()
    s.notes.append(f'{checked} formula results compared with LibreOffice')

    # ---------------------------------------------------------------- letters: page → tool prefilled → PDF
    ctx = s.context('desktop', 'de')
    for bid, b in (list(BRIEFS.items())[:5] if QUICK else BRIEFS.items()):
        page = s.open(ctx, f'/vorlagen/briefe/{b.get("slug", bid)}/')
        paper = page.locator('#muster-text')
        page_text = norm(paper.inner_text()) if paper.count() else ''
        with page.expect_navigation():
            page.locator('.vl-hero a.btn-primary').click()
        page.wait_for_selector('.arc-vl-note', timeout=15000)
        page.wait_for_timeout(300)
        s.expect(b['name'] in page.locator('.arc-vl-note').inner_text(), f'{bid}: notice names the template')
        f = b['fields']
        if b['tool'] == 'cancellation-letter':
            s.expect(page.locator('#img-lt-type').input_value() == f['type'], f'{bid}: contract type')
            pre = norm(page.locator('.img-lt-preview').inner_text())
            body = re.sub(r'\d{2}\.\d{2}\.\d{4}', 'TT.MM.JJJJ', pre)
            ptxt = page_text
            for para in re.findall(r'(hiermit kündige.*?Mit freundlichen Grüßen)', ptxt):
                s.expect(para in body, f'{bid}: page example ≠ tool text\n  page: {para[:160]}\n  tool: {body[:400]}')
        elif b['tool'] == 'din-letter':
            s.expect(page.locator('#tpl-subject').input_value() == b['letter']['subject'], f'{bid}: subject prefilled')
            s.expect(page.locator('#tpl-body').input_value().startswith(b['letter']['body'][0][:40]), f'{bid}: body prefilled')
        elif b['tool'] == 'power-of-attorney':
            s.expect(page.locator('#tpl-aName').input_value() == f['aName'], f'{bid}: agent prefilled')
        elif b['tool'] == 'leave-request':
            s.expect(page.locator('#tpl-name').input_value() == f['name'], f'{bid}: name prefilled')
            # a period is needed for a meaningful form – enter one
            page.locator('[id^="tpl-from"]').first.fill('2027-03-01'); page.locator('[id^="tpl-to"]').first.fill('2027-03-05')
        elif b['tool'] == 'receipt':
            s.expect(page.locator('#tpl-purpose').input_value() == f['purpose'], f'{bid}: purpose prefilled')
        elif b['tool'] == 'withdrawal-letter':
            s.expect(page.locator('#tpl-orderNo').input_value() == f['orderNo'], f'{bid}: order no prefilled')
        elif b['tool'] == 'payment-reminder':
            s.expect('480' in page.locator('.tpl-entries').inner_text() or page.locator('input[value="480,00"]').count() >= 1, f'{bid}: invoice amount prefilled')
            page.locator('[id^="tpl-date"]').first.fill('2026-08-01') if page.locator('[id^="tpl-date"]').count() else None
        out = s.run_and_download(page)
        if out:
            t = pdftext(out)
            want = {'cancellation-letter': 'Kündigung', 'din-letter': b.get('letter', {}).get('subject', '')[:30], 'power-of-attorney': f.get('aName', ''), 'leave-request': f.get('name', ''),
                    'receipt': 'dreihundertfünfzig', 'withdrawal-letter': f.get('orderNo', ''), 'payment-reminder': 'RE-2026-118'}[b['tool']]
            s.expect(norm(want) in t, f'{bid}: PDF text lacks {want!r}: {t[:200]}')
        s.check_page(page)
        page.close()
    # phone: two letters with screenshots, remembered sender kept
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/vorlagen/briefe/')
    s.expect(page.locator('.vl-card:visible').count() == len(BRIEFS), 'letter index: all cards')
    page.fill('#vl-q', 'kita')
    page.wait_for_timeout(200)
    s.expect(1 <= page.locator('.vl-card:visible').count() <= 4, 'letter search "kita"')
    s.check_page(page); s.shot(page, 'arc2_brief_index_de_phone'); page.close()
    page = s.open(ctx, '/vorlagen/briefe/kuendigung-arbeitsvertrag/')
    s.expect(page.locator('.arc2-warn-strong').count() == 1, 'Schriftform warning on the employment cancellation')
    s.check_page(page); s.shot(page, 'arc2_brief_arbeitsvertrag_de_phone', full=True); page.close()
    page = s.open(ctx, tool('din-letter'))
    page.check('#tpl-remember'); page.fill('#tpl-sName', 'Echte Absenderin'); page.wait_for_timeout(300); page.close()
    page = s.open(ctx, tool('din-letter') + '?vorlage=brief-maengelanzeige-wohnung')
    page.wait_for_selector('.arc-vl-note')
    s.expect(page.locator('#tpl-sName').input_value() == 'Echte Absenderin', 'remembered sender kept')
    s.expect(page.locator('#tpl-rName').input_value() == BRIEFS['maengelanzeige-wohnung']['to']['org'], 'recipient prefilled')
    s.check_page(page); s.shot(page, 'arc2_brief_tool_prefilled_de_phone'); page.close()
    page = s.open(ctx, tool('din-letter') + '?vorlage=brief-gibt-es-nicht')
    page.wait_for_timeout(1200)
    s.expect(page.locator('.tpl-note:has-text("nicht geladen")').count() == 1, 'unknown letter → friendly message')
    page.close()
    page = s.open(ctx, tool('cancellation-letter') + '?vorlage=brief-dsgvo-auskunft')   # template of another tool
    page.wait_for_timeout(1200)
    s.expect(page.locator('.tpl-note:has-text("nicht geladen")').count() == 1 and page.locator('.arc-vl-note').count() == 0, 'letter for another tool ignored')
    page.close()
    # EN GDPR letter
    ctx = s.context('phone', 'en')
    page = s.open(ctx, '/en/templates/letters/gdpr-erasure-request/')
    with page.expect_navigation():
        page.locator('.vl-hero a.btn-primary').click()
    page.wait_for_selector('.arc-vl-note')
    s.expect('Article 17' in page.locator('#tpl-body').input_value(), 'EN erasure letter prefilled')
    out = s.run_and_download(page)
    if out: s.expect('Article 17 GDPR' in pdftext(out), 'EN erasure PDF')
    s.check_page(page); s.shot(page, 'arc2_brief_gdpr_en_phone'); page.close()

    # ---------------------------------------------------------------- CV designs
    for v in s.variants(devices=('phone',)):
        de = v.lang == 'de'
        page = s.open(v, '/vorlagen/lebenslauf-designs/' if de else '/en/templates/cv-designs/')
        s.expect(page.locator('.arc2-design').count() == 10, f'{v}: 10 designs')
        page.locator('.arc2-design img').last.scroll_into_view_if_needed()
        page.wait_for_function("() => [...document.querySelectorAll('.arc2-design img')].every(i => i.complete && i.naturalWidth > 0)", timeout=15000)
        s.check_page(page); s.shot(page, f'arc2_designs_{v.lang}_phone')
        page.close()
    ctx = s.context('desktop', 'de')
    for did, d in DESIGNS.items():
        for lang in (('de', 'en') if did in ('ats', 'academic') else ('de',)):
            c = ctx if lang == 'de' else s.context('desktop', 'en')
            page = s.open(c, '/vorlagen/lebenslauf-designs/' if lang == 'de' else '/en/templates/cv-designs/')
            with page.expect_navigation():
                page.locator(f'#design-{did} .btn-primary').click()
            page.wait_for_selector('.arc-vl-note')
            s.expect(page.locator(f'input[name="tpl-design"][value="{did}"]').is_checked(), f'{did}/{lang}: design selected in the builder')
            page.wait_for_function("() => { const p = document.querySelector('.tpl-pv'); return p && p.dataset.state === 'ready' && p.querySelector('canvas'); }", timeout=30000)
            if did == 'creative' and lang == 'de': s.shot(page, 'arc2_cv_creative_de_desktop')
            out = s.run_and_download(page)
            if out:
                t = pdftext(out)
                cv = d[lang]['cv']
                s.expect(cv['name'] in t and cv['exp'][0][2] in t, f'{did}/{lang}: CV text {t[:160]}')
                imgs = subprocess.run(['pdfimages', '-list', str(out)], capture_output=True, text=True).stdout.strip().splitlines()[2:]
                s.expect((len(imgs) == 0) if did == 'ats' else (len(imgs) >= 1), f'{did}/{lang}: {len(imgs)} images in the PDF')
                if did == 'academic': s.expect(('PUBLIKATIONEN' if lang == 'de' else 'PUBLICATIONS') in t.upper() and 'Bodenfeuchte' in t or 'Soil moisture' in t, f'academic/{lang}: publications section')
                if did == 'school': s.expect(t.find('Schulbildung') < t.find('Praktika'), 'school: education first')
                s.expect(s.pdf_pages(out) <= 2, f'{did}/{lang}: {s.pdf_pages(out)} pages')
            page.close()
    page = s.open(ctx, '/vorlagen/lebenslauf-designs/')
    with page.expect_navigation():
        page.locator('#design-elegant .btn-quiet').click()
    page.wait_for_selector('.arc-vl-note')
    s.expect(page.locator('input[name="tpl-design"][value="elegant"]').is_checked(), 'cover letter opens in the elegant design')
    out = s.run_and_download(page)
    if out: s.expect('Clara Okafor' in pdftext(out) and s.pdf_pages(out) == 1, 'elegant cover letter PDF')
    page.close()

    # ---------------------------------------------------------------- 360 px
    ctx = s.context('phone', 'de', viewport={'width': 360, 'height': 780})
    for path in ['/vorlagen/', '/vorlagen/tabellen/', '/vorlagen/tabellen/kassenbuch/', '/vorlagen/briefe/', '/vorlagen/briefe/widerspruch-bescheid/', '/vorlagen/lebenslauf-designs/', '/en/templates/spreadsheets/break-even-calculator/']:
        page = s.open(ctx, path)
        page.wait_for_timeout(600)
        s.check_page(page)
        if path.endswith('kassenbuch/'): s.shot(page, 'arc2_tab_kassenbuch_de_360')
        page.close()

    # ---------------------------------------------------------------- the app opens the new templates
    app_port = 8871  # arc2 port range
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(app_port), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1)
        actx = s.browser.new_context(viewport={'width': 1280, 'height': 860})
        actx.add_init_script("try { localStorage.setItem('fale-lang', 'de'); localStorage.setItem('fale-onboarded', '1'); } catch {}")
        page = actx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)[:200]))
        for tid, a1 in (('schichtplan', 'Schichtplan'), ('break-even', 'Break-even-Rechner'), ('mitgliederliste', 'Mitgliederliste')):
            page.goto(f'http://127.0.0.1:{app_port}/#/neu/tabelle?vorlage={tid}')
            try:
                page.wait_for_selector('.sheet-app', timeout=20000)
                page.wait_for_timeout(800)
                txt = page.locator('.sh-body [data-cell="A1"], .sh-frozen [data-cell="A1"]').first.inner_text()
                s.expect(txt.strip() == a1, f'app: {tid} opens ({txt!r})')
            except Exception as e:
                s.fails.append(f'app: {tid} did not open: {e!r}'[:300])
        s.shot(page, 'arc2_app_mitgliederliste')
        s.expect(not errs, f'app errors {errs[:3]}')
        actx.close()
    finally:
        srv.kill()

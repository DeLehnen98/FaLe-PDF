"""Vorlagen-Archiv (arc): hub/section/job/guide pages DE+EN × phone/desktop, search + filters, JSON-LD, SEO tags,
hreflang only for real pairs, no 404 links, "Vorlage verwenden" → CV builder / cover letter prefilled → correct PDF,
saved CV draft is never overwritten silently, remembered sender kept, 360 px, page weight, CSP, screenshots."""
import json
import re
import subprocess
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from wtlib import Suite, ORIGIN

NET = Path('/home/claude/FalePDF/network')
DATA = NET / 'tools/vorlagen/data'
BASE = 'https://fale.network'
JOBS = {}
for f in sorted(DATA.glob('*/*.json')):
    if f.parent.name != 'ratgeber':
        d = json.loads(f.read_text(encoding='utf-8'))
        JOBS[d['id']] = d


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


def open_page(s, ctx, path, dialogs=None):
    """Like Suite.open, but registers a dialog handler before navigation (confirm when a draft exists)."""
    page = ctx.new_page()
    tag = path
    page.on('console', lambda m: m.type == 'error' and s.fails.append(f'console error on {tag}: {m.text[:300]}'))
    page.on('pageerror', lambda e: s.fails.append(f'page error on {tag}: {str(e)[:300]}'))
    page.on('request', lambda r: (r.url.startswith(ORIGIN) or r.url.startswith(('blob:', 'data:'))) or s.fails.append(f'foreign request {r.url[:120]}'))
    if dialogs is not None:
        def on_dialog(d):
            dialogs.append(d.message)
            d.accept() if dialogs and dialogs[0] == 'ACCEPT' else d.dismiss()
        page.on('dialog', on_dialog)
    page.goto(ORIGIN + path)
    page.wait_for_function("() => document.documentElement.classList.contains('wt-js')", timeout=15000)
    page._wt_tag = tag
    return page


with Suite('arc-vorlagen') as s:
    s.expect(len(JOBS) >= 80, f'{len(JOBS)} jobs')
    en_jobs = [j for j in JOBS.values() if 'en' in j]
    s.expect(len(en_jobs) >= 12, f'{len(en_jobs)} EN jobs')

    # ---------------------------------------------------------------- generator: strict + idempotent
    r = subprocess.run(['python3', 'network/tools/vorlagen/build.py'], cwd='/home/claude/FalePDF', capture_output=True, text=True)
    s.expect(r.returncode == 0, 'vorlagen build (strict) failed: ' + r.stderr[-500:])
    snap = {p: p.read_bytes() for p in (NET / 'vorlagen').rglob('*') if p.is_file()}
    subprocess.run(['python3', 'network/tools/vorlagen/build.py'], cwd='/home/claude/FalePDF', capture_output=True)
    snap2 = {p: p.read_bytes() for p in (NET / 'vorlagen').rglob('*') if p.is_file()}
    s.expect(snap == snap2, 'vorlagen build is not idempotent')

    # ---------------------------------------------------------------- static checks on every generated page
    sm = get('/sitemap.xml')[1].decode()
    locs = re.findall(r'<loc>' + re.escape(BASE) + r'(/vorlagen/[^<]*|/en/templates/[^<]*)</loc>', sm)
    s.expect(len(locs) >= len(JOBS) + len(en_jobs) + 4, f'sitemap has {len(locs)} archive URLs')
    s.expect(sm.count('hreflang="x-default"') == sm.count('<url>'), 'sitemap: every URL has an x-default alternate')
    links, ld_types = set(), set()
    for path in locs:
        st, raw = get(path)
        if not s.expect(st == 200, f'{path}: status {st}'): continue
        html = raw.decode()
        p = P(); p.feed(html)
        s.expect(p.h1 == 1, f'{path}: {p.h1} h1')
        s.expect(p.canon == BASE + path, f'{path}: canonical {p.canon}')
        s.expect(p.alts.get('x-default') and (p.alts.get('de') == BASE + path or p.alts.get('en') == BASE + path), f'{path}: hreflang {p.alts}')
        for blk in p.ld:
            try:
                o = json.loads(blk); ld_types.add(o.get('@type'))
            except Exception as e:
                s.fails.append(f'{path}: bad JSON-LD {e}')
            s.expect('aggregateRating' not in blk and '"review' not in blk, f'{path}: ratings in JSON-LD')
        s.expect(not re.search(r'\sstyle\s*=', html) and '<style' not in html, f'{path}: inline style')
        s.expect(not re.search(r'<script(?![^>]*(src=|type="application/ld\+json"|type="application/json"))', html), f'{path}: inline script')
        # the job directories list every job on one page (complete without JS): fixed part + a per-card budget
        cap = {'/vorlagen/bewerbung/': max(160_000, 50_000 + 750 * len(JOBS)), '/en/templates/': max(160_000, 50_000 + 750 * len(en_jobs))}.get(path, 90_000)
        s.expect(len(raw) < cap, f'{path}: HTML {len(raw)} bytes (cap {cap})')
        for k in ('description', 'og:title', 'og:image', 'twitter:card'):
            s.expect(p.meta.get(k), f'{path}: meta {k}')
        links |= {u for u in p.links if u.startswith('/')}
    s.expect({'BreadcrumbList', 'CreativeWork', 'HowTo', 'FAQPage', 'CollectionPage', 'Article'} <= ld_types, f'JSON-LD types {ld_types}')
    # hreflang only for real pairs
    for j in JOBS.values():
        p = P(); p.feed(get(f'/vorlagen/bewerbung/{j["id"]}/')[1].decode())
        if 'en' in j:
            s.expect(p.alts.get('en') == f'{BASE}/en/templates/{j["en"]["slug"]}/', f'{j["id"]}: EN alternate')
        else:
            s.expect(set(p.alts) == {'de', 'x-default'}, f'{j["id"]}: hreflang must only name DE {p.alts}')
    bad = []
    for u in sorted(links):
        path = u.split('#')[0]
        if not path or path.startswith('/.well-known'): continue
        st, _ = get(path)
        if st != 200: bad.append(f'{u} → {st}')
    s.expect(not bad, f'broken links: {bad[:10]}')
    s.notes.append(f'{len(locs)} archive pages, {len(links)} internal links checked')
    s.expect('/vorlagen/' in get('/sw.js')[1].decode(), 'service worker does not cover /vorlagen/')
    # prefill data shape
    for j in JOBS.values():
        st, raw = get(f'/vorlagen/data/{j["id"]}.json')
        d = json.loads(raw)
        s.expect(d['cv']['name'] == j['cv']['name'] and len(d['letters']) == len(j['letters']) and d['cv']['photo'].endswith('.png'), f'{j["id"]}: prefill data')

    # ---------------------------------------------------------------- pages in the browser
    for v in s.variants():
        de = v.lang == 'de'
        hub = '/vorlagen/' if de else '/en/templates/'
        page = s.open(v, hub)
        s.check_page(page)
        if v.device == 'phone': s.shot(page, f'arc_hub_{v.lang}_phone')
        page.close()
        # directory: search + filters
        page = s.open(v, '/vorlagen/bewerbung/' if de else '/en/templates/')
        vis = lambda: page.locator('.vl-card:visible').count()
        total = page.locator('.vl-card').count()
        s.expect(total == (len(JOBS) if de else len(en_jobs)), f'{v}: {total} cards listed')
        if de:   # Berufsfelder start collapsed (simple first screen) – nothing but the field rows is visible
            s.expect(vis() == 0 and page.locator('details[data-vl-group] > summary:visible').count() >= 10, f'{v}: fields collapsed initially ({vis()} visible)')
        page.fill('#vl-q', 'lkw' if de else 'truck')
        page.wait_for_timeout(200)
        s.expect(1 <= vis() <= 3 and page.locator('.vl-card:visible a[href*="lkw-fahrer"], .vl-card:visible a[href*="hgv-driver"]').count() == 1, f'{v}: search finds the truck driver')
        s.expect(page.locator('[data-vl-count]').inner_text().strip() != '', f'{v}: hit count')
        page.fill('#vl-q', 'xyzqwv')
        page.wait_for_timeout(200)
        s.expect(vis() == 0 and page.locator('[data-vl-nohits]').is_visible(), f'{v}: no-hits message')
        page.fill('#vl-q', '')
        if de:
            page.fill('#vl-q', 'küche')
            page.wait_for_timeout(200)
            s.expect(page.locator('.vl-card:visible a[href*="kuechenhilfe"]').count() == 1, f'{v}: umlaut search')
            page.fill('#vl-q', '')
            page.wait_for_timeout(200)
            s.expect(vis() == 0, f'{v}: fields collapse again after clearing the search ({vis()})')
            page.click('#feld-pflege > summary')
            n_pflege = sum(1 for j in JOBS.values() if j['field'] == 'pflege')
            s.expect(vis() == n_pflege, f'{v}: Berufsfeld opened {vis()} vs {n_pflege}')
            page.click('#feld-pflege > summary')
            page.click('[data-vl-level="minijob"]')
            n_mini = sum(1 for j in JOBS.values() if any(L['level'] == 'minijob' for L in j['letters']))
            s.expect(vis() == n_mini, f'{v}: Situation filter {vis()} vs {n_mini}')
            s.expect('situation=minijob' in page.url, f'{v}: filter in URL')
            if v.device == 'phone': s.shot(page, 'arc_section_de_phone_filtered')
            page.click('[data-vl-level=""]')
            s.expect(vis() == 0, f'{v}: fields collapse again after clearing the filter ({vis()})')
        s.check_page(page)
        page.close()
        # job page
        jp = '/vorlagen/bewerbung/pflegefachkraft/' if de else '/en/templates/nurse/'
        page = s.open(v, jp)
        n_l = len(JOBS['pflegefachkraft']['letters'] if de else JOBS['pflegefachkraft']['en']['letters'])
        s.expect(page.locator('details.vl-letter').count() == n_l, f'{v}: {n_l} letters')
        s.expect(page.locator('details.vl-letter[open]').count() == 1, f'{v}: first letter open')
        s.expect(page.locator('[data-vl-copy]:visible').count() >= 1, f'{v}: copy button')
        page.locator('.vl-cv-thumb img').scroll_into_view_if_needed()
        page.wait_for_function("() => { const i = document.querySelector('.vl-cv-thumb img'); return i && i.complete && i.naturalWidth > 0; }")
        s.check_page(page)
        if v.device == 'phone':
            s.shot(page, f'arc_job_{v.lang}_phone')
            s.shot(page, f'arc_job_{v.lang}_phone_letter', top='#anschreiben')
            s.shot(page, f'arc_job_{v.lang}_phone_cv', top='#lebenslauf')
            if de:
                page.emulate_media(color_scheme='dark'); s.shot(page, 'arc_job_de_phone_dark_letter', top='#anschreiben'); page.emulate_media(color_scheme='light')
        page.close()

    # ---------------------------------------------------------------- weight of a job page (phone, first load)
    ctx = s.context('phone', 'de')
    sizes = []
    page = ctx.new_page()
    page.on('response', lambda r: sizes.append((r.url, len(r.body()) if r.ok and r.request.method == 'GET' else 0)))
    page.goto(ORIGIN + '/vorlagen/bewerbung/koch/')
    page.wait_for_load_state('networkidle')
    total = sum(b for _, b in sizes)
    s.notes.append(f'job page first load (no scroll): {len(sizes)} requests, {total // 1024} KB')
    s.expect(total < 700_000, f'job page weight {total}')
    page.close()

    # ---------------------------------------------------------------- 360 px
    ctx = s.context('phone', 'de', viewport={'width': 360, 'height': 780})
    for path in ['/vorlagen/', '/vorlagen/bewerbung/', '/vorlagen/bewerbung/kaufmann-im-einzelhandel/', '/vorlagen/bewerbung/assistenz-geschaeftsfuehrung/',
                 '/vorlagen/ratgeber/bewerbung-per-e-mail/', '/en/templates/', '/en/templates/software-developer/', '/werkzeuge/lebenslauf-erstellen/?vorlage=elektriker']:
        page = s.open(ctx, path)
        page.wait_for_timeout(500)
        sw = page.evaluate('() => [document.documentElement.scrollWidth, innerWidth]')
        s.expect(sw[0] <= sw[1], f'{path}: horizontal scroll at 360 px {sw}')
        s.check_page(page)
        if 'ratgeber' in path: s.shot(page, 'arc_guide_de_phone_360')
        page.close()

    # ---------------------------------------------------------------- "Vorlage verwenden" → CV builder → PDF
    for v in s.variants():
        de = v.lang == 'de'
        jp = '/vorlagen/bewerbung/pflegefachkraft/' if de else '/en/templates/nurse/'
        page = s.open(v, jp)
        with page.expect_navigation():
            page.locator('.vl-hero a.btn-primary').click()
        page.wait_for_selector('.arc-vl-note')
        cvname = JOBS['pflegefachkraft']['cv']['name'] if de else JOBS['pflegefachkraft']['en']['cv']['name']
        s.expect(page.locator('#tpl-name').input_value() == cvname, f'{v}: CV name prefilled')
        s.expect(page.locator('.tpl-photo:not([hidden])').count() == 1, f'{v}: placeholder photo loaded')
        s.expect(page.locator('#arc-vl-photo').is_visible(), f'{v}: "use your own photo" button')
        page.wait_for_function("() => { const p = document.querySelector('.tpl-pv'); return p && p.dataset.state === 'ready' && p.querySelector('canvas'); }", timeout=30000)
        s.check_page(page)
        if v.device == 'phone' and de: s.shot(page, 'arc_cv_prefilled_de_phone')
        out = s.run_and_download(page)
        if out:
            t = pdftext(out)
            title = JOBS['pflegefachkraft']['cv']['title'] if de else JOBS['pflegefachkraft']['en']['cv']['title']
            s.expect(cvname in t and title in t, f'{v}: CV PDF text: {t[:160]}')
            s.expect('Kastanienweg 7' in t or '7 Chestnut Walk' in t, f'{v}: CV address')
            imgs = subprocess.run(['pdfimages', '-list', str(out)], capture_output=True, text=True).stdout.strip().splitlines()[2:]
            s.expect(len(imgs) >= 1, f'{v}: photo embedded in CV PDF')
        page.close()
        # cover letter, letter 2
        page = s.open(v, jp)
        page.locator('#brief-2 summary').click()
        with page.expect_navigation():
            page.locator('#brief-2 a.btn-primary').click()
        page.wait_for_selector('.arc-vl-note')
        src = JOBS['pflegefachkraft'] if de else JOBS['pflegefachkraft']['en']
        L2 = src['letters'][1]
        s.expect(page.locator('#tpl-position').input_value() == L2['position'], f'{v}: position prefilled')
        s.expect(page.locator('#tpl-sName').input_value() == L2['from'][0], f'{v}: sender prefilled')
        s.expect(page.locator('#tpl-p2').input_value().startswith(L2['body'][1][:30]), f'{v}: paragraph 2 prefilled')
        s.check_page(page)
        if v.device == 'phone' and de: s.shot(page, 'arc_letter_prefilled_de_phone')
        out = s.run_and_download(page)
        if out:
            t = pdftext(out)
            s.expect(L2['from'][0] in t and L2['to']['org'] in t and L2['position'].split(' (')[0] in t, f'{v}: letter PDF text: {t[:200]}')
            s.expect(L2['body'][0][:40].replace('  ', ' ') in t, f'{v}: letter body in PDF')
            s.expect(s.pdf_pages(out) == 1, f'{v}: letter fits on one page')
        page.close()

    # ---------------------------------------------------------------- saved draft is never overwritten silently
    ctx = s.context('phone', 'de')
    page = s.open(ctx, '/werkzeuge/lebenslauf-erstellen/')
    page.locator('#tpl-acc-save summary').click()
    page.check('#tpl-save')
    page.locator('#tpl-acc-person summary').click()
    page.fill('#tpl-name', 'Eigene Person Entwurf')
    page.wait_for_timeout(1200)
    page.close()
    dialogs = []
    page = open_page(s, ctx, '/werkzeuge/lebenslauf-erstellen/?vorlage=koch', dialogs)       # dismiss → draft stays
    page.wait_for_timeout(1500)
    s.expect(len(dialogs) == 1 and 'Eigene Person Entwurf' in dialogs[0], f'confirm shown before replacing a draft: {dialogs}')
    s.expect(page.locator('#tpl-name').input_value() == 'Eigene Person Entwurf', 'dismiss keeps the saved draft')
    page.close()
    dialogs = ['ACCEPT']
    page = open_page(s, ctx, '/werkzeuge/lebenslauf-erstellen/?vorlage=koch', dialogs)       # accept → example, draft untouched
    page.wait_for_selector('.arc-vl-note')
    s.expect(page.locator('#tpl-name').input_value() == JOBS['koch']['cv']['name'], 'accept loads the example')
    s.expect(not page.locator('#tpl-save').is_checked(), 'saving is paused for the example')
    page.locator('#tpl-acc-person summary').click() if page.locator('#tpl-acc-person[open]').count() == 0 else None
    page.fill('#tpl-name', 'Geändertes Beispiel')
    page.wait_for_timeout(1200)
    page.close()
    page = s.open(ctx, '/werkzeuge/lebenslauf-erstellen/')
    page.wait_for_timeout(1500)
    s.expect(page.locator('#tpl-name').input_value() == 'Eigene Person Entwurf', 'saved draft unchanged after editing the example')
    page.close()

    # ---------------------------------------------------------------- remembered sender is kept in the cover letter
    page = s.open(ctx, '/werkzeuge/bewerbung-anschreiben/')
    page.check('#tpl-remember')
    page.fill('#tpl-sName', 'Meine Echte Adresse')
    page.fill('#tpl-sCity', '12345 Echtstadt')
    page.wait_for_timeout(300)
    page.close()
    page = s.open(ctx, '/werkzeuge/bewerbung-anschreiben/?vorlage=koch&brief=1')
    page.wait_for_selector('.arc-vl-note')
    s.expect(page.locator('#tpl-sName').input_value() == 'Meine Echte Adresse', 'remembered sender kept')
    s.expect(page.locator('#tpl-position').input_value() == JOBS['koch']['letters'][0]['position'], 'letter fields still prefilled')
    page.close()

    # ---------------------------------------------------------------- unknown template → friendly message, empty form
    page = s.open(ctx, '/werkzeuge/lebenslauf-erstellen/?vorlage=gibt-es-nicht')
    page.wait_for_timeout(1200)
    s.expect(page.locator('.tpl-note:has-text("nicht geladen")').count() == 1, 'unknown template message')
    page.close()
    page = s.open(ctx, '/werkzeuge/lebenslauf-erstellen/?vorlage=../../etc')
    page.wait_for_timeout(800)
    s.expect(page.locator('.arc-vl-note').count() == 0, 'invalid id ignored')
    page.close()

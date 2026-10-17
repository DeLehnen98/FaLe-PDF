"""Site-level checks: existing pages unchanged except nav/footer/home teaser, SEO tags + JSON-LD on tool pages,
sitemap, vercel.json, generator idempotency, vendor sync, small JS before picking a file, no brand names."""
import hashlib, json, re, subprocess, urllib.request
from pathlib import Path
from html.parser import HTMLParser
from wtlib import Suite, ORIGIN

REPO = Path('/home/claude/FalePDF')
NET = REPO / 'network'
BEFORE = Path(__file__).resolve().parent.parent / 'network_before'
BASE = 'https://fale.network'
TOOLS = {'de': ['/werkzeuge/', '/werkzeuge/pdf-zusammenfuegen/', '/werkzeuge/pdf-komprimieren/', '/werkzeuge/bild-in-pdf/'],
         'en': ['/en/tools/', '/en/tools/merge-pdf/', '/en/tools/compress-pdf/', '/en/tools/jpg-to-pdf/']}
OLD = ['/', '/apps/pdf/', '/apps/clean/', '/konto/', '/datenschutz/', '/impressum/', '/en/', '/en/apps/pdf/', '/en/apps/clean/',
       '/en/account/', '/en/privacy/', '/en/imprint/']

class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.meta = {}; s.links = []; s.alts = {}; s.canon = None; s.ld = []; s._ld = False; s.h1 = 0; s.title = ''; s._t = False; s.lang = None
    def handle_starttag(s, t, a):
        a = dict(a)
        if t == 'html': s.lang = a.get('lang')
        if t == 'title': s._t = True
        if t == 'h1': s.h1 += 1
        if t == 'meta': s.meta[a.get('name') or a.get('property')] = a.get('content')
        if t == 'link' and a.get('rel') == 'canonical': s.canon = a['href']
        if t == 'link' and a.get('rel') == 'alternate' and a.get('hreflang'): s.alts[a['hreflang']] = a['href']
        if t == 'a' and a.get('href'): s.links.append(a['href'])
        if t == 'script' and a.get('type') == 'application/ld+json': s._ld = True
    def handle_data(s, d):
        if s._ld: s.ld.append(d)
        if s._t: s.title += d
    def handle_endtag(s, t):
        if t == 'script': s._ld = False
        if t == 'title': s._t = False

def get(path):
    with urllib.request.urlopen(ORIGIN + path) as r:
        return r.status, r.read().decode()

def tree_hash():
    h = hashlib.sha256()
    for p in sorted(NET.rglob('*')):
        if p.is_file() and '__pycache__' not in p.parts:
            h.update(str(p).encode()); h.update(p.read_bytes())
    return h.hexdigest()

with Suite('site') as s:
    # 1. generators are deterministic and idempotent, vendor copies in sync
    gen = lambda: (subprocess.run(['python3', 'network/tools/build_pages.py'], cwd=REPO, check=True, capture_output=True),
                   subprocess.run(['python3', 'network/tools/webtools/build.py'], cwd=REPO, check=True, capture_output=True))
    gen(); h1 = tree_hash(); gen(); h2 = tree_hash()
    s.expect(h1 == h2, 'generators are not idempotent')
    r = subprocess.run(['node', 'scripts/sync-webtools-vendor.mjs', '--check'], cwd=REPO, capture_output=True, text=True)
    s.expect(r.returncode == 0, 'vendor sync --check: ' + r.stdout + r.stderr)
    s.expect(not list(NET.rglob('__pycache__')), '__pycache__ inside network/')

    # 2. the hand-written pages (home, apps, konto, legal) match the snapshot in ../network_before (refreshed with the simple-pages redesign 2026-10-16 and the
    #    clarity redesign 2026-10: DE|EN switch, 4-item nav, entry cards; support link in menu + footer 2026-10-17; FaLe PDF page as search landing, app links in a new tab 2026-10-17); only the generated tools teaser may differ
    if BEFORE.exists():
        strip = lambda t: re.sub(r'  <section class="section section-tight" id="werkzeuge".*?</section>\n\n', '', t, flags=re.S)
        for old in sorted(BEFORE.rglob('*.html')):
            rel = old.relative_to(BEFORE)
            new = (NET / rel).read_text(encoding='utf-8')
            s.expect(strip(new) == strip(old.read_text(encoding='utf-8')), f'{rel}: changed beyond the tools teaser')
            s.expect('/werkzeuge/' in new or '/en/tools/' in new, f'{rel}: no link to the tools')
    else:
        s.notes.append('no snapshot of the old site – skipped the unchanged-pages check')

    # 3. every page: status, one h1, JSON-LD valid, no ratings, no inline script/style
    for path in OLD + TOOLS['de'] + TOOLS['en']:
        st, html = get(path)
        if not s.expect(st == 200, f'{path}: status {st}'): continue
        p = P(); p.feed(html)
        s.expect(p.h1 == 1, f'{path}: {p.h1} h1')
        for blk in p.ld:
            try:
                json.loads(blk)
            except Exception as e:
                s.fails.append(f'{path}: bad JSON-LD {e}')
            s.expect('aggregateRating' not in blk and '"review' not in blk, f'{path}: ratings/reviews in JSON-LD')
        s.expect(not re.search(r'\sstyle\s*=', html) and '<style' not in html, f'{path}: inline style')
        s.expect(not re.search(r'<script(?![^>]*(src=|type="application/ld\+json"|type="application/json"))', html), f'{path}: inline script')
        s.expect(not re.search(r'\son[a-z]+\s*=\s*"', html), f'{path}: inline handler')
        s.expect('/werkzeuge/' in html or '/en/tools/' in html, f'{path}: nav link to tools missing')

    # 4. tool pages: SEO tags
    titles, descs = set(), set()
    for lang in ('de', 'en'):
        for path in TOOLS[lang]:
            st, html = get(path)
            p = P(); p.feed(html)
            s.expect(p.lang == lang, f'{path}: lang {p.lang}')
            s.expect(p.canon == BASE + path, f'{path}: canonical {p.canon}')
            s.expect(set(p.alts) == {'de', 'en', 'x-default'} and p.alts['x-default'] == p.alts['de'], f'{path}: hreflang {p.alts}')
            s.expect(p.alts[lang] == BASE + path, f'{path}: self hreflang')
            for k in ('description', 'og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:image'):
                s.expect(p.meta.get(k), f'{path}: meta {k} missing')
            s.expect(p.meta.get('og:image', '').endswith(f'og-tools-{lang}.png'), f'{path}: tools OG image')
            s.expect((NET / 'assets/og' / f'og-tools-{lang}.png').exists(), f'og-tools-{lang}.png missing')
            titles.add(p.title); descs.add(p.meta.get('description'))
            types = [json.loads(b).get('@type') for b in p.ld]
            want = ['CollectionPage', 'BreadcrumbList'] if path in ('/werkzeuge/', '/en/tools/') else ['WebApplication', 'HowTo', 'FAQPage', 'BreadcrumbList']
            s.expect(types == want, f'{path}: JSON-LD types {types}')
            if 'WebApplication' in types:
                app = json.loads(p.ld[0])
                s.expect(app['offers']['price'] == '0' and app['operatingSystem'] == 'Any' and app.get('browserRequirements'), f'{path}: WebApplication fields')
            # alternate exists and links back
            other = p.alts['en' if lang == 'de' else 'de'].replace(BASE, '')
            st2, html2 = get(other)
            p2 = P(); p2.feed(html2)
            s.expect(st2 == 200 and p2.alts.get(lang) == BASE + path, f'{path}: alternate {other} does not link back')
    s.expect(len(titles) == 8 and len(descs) == 8, 'titles/descriptions must be unique')

    # 5. sitemap keeps the old URLs and adds the tools with alternates
    st, sm = get('/sitemap.xml')
    import xml.dom.minidom; xml.dom.minidom.parseString(sm)
    for path in OLD + TOOLS['de'] + TOOLS['en']:
        s.expect(f'<loc>{BASE}{path}</loc>' in sm, f'sitemap misses {path}')
    s.expect(sm.count('hreflang="x-default"') == sm.count('<url>'), 'sitemap: every URL has alternates')
    s.expect('/teilen/' not in sm and '/share/' not in sm, 'share landing pages must not be in the sitemap')

    # 6. vercel.json: valid, specific CSP rules after the site-wide rule, no unsafe-*
    vj = json.loads((NET / 'vercel.json').read_text())
    srcs = [h['source'] for h in vj['headers']]
    s.expect(srcs.index('/(.*)') < srcs.index('/werkzeuge/(.*)') and srcs.index('/assets/(.*)') < srcs.index('/assets/wt/vendor/(.*)'), 'header rule order')
    for h in vj['headers']:
        for kv in h['headers']:
            if kv['key'] == 'Content-Security-Policy':
                s.expect("'unsafe-inline'" not in kv['value'] and "'unsafe-eval'" not in kv['value'], f'{h["source"]}: unsafe CSP')
    s.expect('/tools' in (NET / '.vercelignore').read_text() and '\ntools\n' not in (NET / '.vercelignore').read_text(), '.vercelignore must anchor /tools (else /en/tools/ is dropped)')

    # 7. no third-party brand names in tool content
    banned = re.compile(r'\b(adobe|acrobat|wps|ilovepdf|smallpdf|pdf24|sejda|microsoft|foxit)\b', re.I)
    for f in list((NET / 'werkzeuge').rglob('*.html')) + list((NET / 'en/tools').rglob('*.html')) + list((NET / 'tools/webtools/specs').glob('*.json')) + list((NET / 'assets/wt/tools').glob('*.js')):
        m = banned.search(f.read_text(encoding='utf-8'))
        s.expect(not m, f'{f}: brand name {m and m.group(0)}')

    # 8. JS loaded before a file is picked is small (pdf.js / pdf-lib are lazy)
    for path in ('/werkzeuge/pdf-zusammenfuegen/', '/en/tools/compress-pdf/'):
        ctx = s.context('phone', 'de', service_workers='block')
        page = s.open(ctx, path)
        page.wait_for_load_state('networkidle')
        res = page.evaluate("() => performance.getEntriesByType('resource').filter(e => /\\.m?js$/.test(new URL(e.name).pathname)).map(e => [new URL(e.name).pathname, e.decodedBodySize])")
        total = sum(b for _, b in res)
        names = [n for n, _ in res]
        s.expect(not any('pdf.min.mjs' in n or 'pdf-lib' in n or 'pdf.worker' in n for n in names), f'{path}: heavy libs loaded before picking: {names}')
        s.expect(total < 160_000, f'{path}: {total} bytes of JS before picking a file')
        s.notes.append(f'{path}: {len(res)} JS files, {total // 1024} KB uncompressed before picking a file')
        s.check_page(page)

    # 9. all pages at 360 px: no horizontal scroll with the extra nav item; home teaser screenshot
    ctx = s.context('phone', 'de', viewport={'width': 360, 'height': 780})
    for path in OLD + ['/404.html'] + TOOLS['de'] + TOOLS['en']:
        page = s.open(ctx, path, wait_shell=False)
        sw = page.evaluate('() => [document.documentElement.scrollWidth, innerWidth]')
        s.expect(sw[0] <= sw[1], f'{path}: horizontal scroll at 360 px {sw}')
        if path == '/':
            s.shot(page, 'home_phone_tools_teaser', top='#werkzeuge')
        page.close()

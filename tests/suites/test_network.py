"""FaleNetwork site checks. Server: python3 -m http.server 8803 --bind 127.0.0.1 (cwd = network/)."""
import json, re, sys, urllib.request, urllib.error
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright

ORIGIN = 'http://127.0.0.1:8803'
OUT = Path('/home/claude/FalePDF/tests/suites/out_network')
OUT.mkdir(parents=True, exist_ok=True)
VJ = json.loads(Path('/home/claude/FalePDF/network/vercel.json').read_text())
HDRS = {h['key']: h['value'] for h in VJ['headers'][0]['headers']}

PAGES = ['/', '/apps/pdf/', '/apps/clean/', '/konto/', '/datenschutz/', '/impressum/',
         '/en/', '/en/apps/pdf/', '/en/apps/clean/', '/en/account/', '/en/privacy/', '/en/imprint/', '/404.html']
SHOTS = ['/', '/apps/pdf/', '/apps/clean/', '/konto/', '/impressum/', '/en/', '/en/apps/pdf/', '/en/account/', '/404.html']
fails = []
def fail(msg): fails.append(msg); print('FAIL', msg)

def get(path):
    try:
        with urllib.request.urlopen(ORIGIN + path) as r: return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e: return e.code, ''

class P(HTMLParser):
    def __init__(s): super().__init__(); s.links = []; s.ids = set(); s.alts = {}; s.canon = None; s.lang = None; s.imgs = []; s.h1 = 0; s.ld = []; s._ld = False
    def handle_starttag(s, t, a):
        a = dict(a)
        if 'id' in a: s.ids.add(a['id'])
        if t == 'html': s.lang = a.get('lang')
        if t == 'h1': s.h1 += 1
        if t == 'a' and 'href' in a: s.links.append(a['href'])
        if t in ('img', 'script') and 'src' in a: s.links.append(a['src'])
        if t == 'img': s.imgs.append(a)
        if t == 'link':
            if a.get('rel') == 'alternate' and 'hreflang' in a: s.alts[a['hreflang']] = a['href']
            elif a.get('rel') == 'canonical': s.canon = a['href']
            elif 'href' in a: s.links.append(a['href'])
        if t == 'script' and a.get('type') == 'application/ld+json': s._ld = True
    def handle_data(s, d):
        if s._ld: s.ld.append(d)
    def handle_endtag(s, t):
        if t == 'script': s._ld = False

# ---------------- static checks: links, hreflang, ld+json, alts
parsed = {}
for p in PAGES:
    st, html = get(p)
    if st != 200: fail(f'{p} status {st}'); continue
    pr = P(); pr.feed(html); parsed[p] = pr
    if pr.h1 != 1: fail(f'{p}: {pr.h1} h1')
    for img in pr.imgs:
        if 'alt' not in img: fail(f'{p}: img without alt {img.get("src")}')
    for blk in pr.ld:
        try: d = json.loads(blk); assert 'aggregateRating' not in blk and 'review' not in blk.lower()
        except Exception as e: fail(f'{p}: bad JSON-LD {e}')
    if re.search(r'style\s*=\s*"', html) or '<style' in html: fail(f'{p}: inline style (CSP)')
    if re.search(r'<script(?![^>]*(src=|application/ld\+json|application/json))', html): fail(f'{p}: inline script (CSP)')
    if re.search(r'\son[a-z]+\s*=', html): fail(f'{p}: inline handler')

checked = {}
external = set()
for p, pr in parsed.items():
    for href in pr.links:
        u = urlparse(urljoin(ORIGIN + p, href))
        if u.scheme in ('mailto', 'tel'): continue
        if u.netloc != '127.0.0.1:8803': external.add(u.geturl()); continue
        path = u.path or '/'
        if path not in checked: checked[path] = get(path)
        st, body = checked[path]
        if st != 200: fail(f'{p}: broken link {href} -> {st}'); continue
        if u.fragment:
            tp = parsed.get(path)
            if tp is None: tp = P(); tp.feed(body)
            if u.fragment not in tp.ids: fail(f'{p}: missing anchor {href}')

BASE = 'https://fale.network'
for p, pr in parsed.items():
    if p == '/404.html':
        if pr.alts or pr.canon: fail('404 has alternates/canonical')
        continue
    if set(pr.alts) != {'de', 'en', 'x-default'}: fail(f'{p}: hreflang set {pr.alts}'); continue
    if pr.canon != pr.alts[pr.lang]: fail(f'{p}: canonical {pr.canon} != self alt {pr.alts[pr.lang]}')
    if pr.canon != BASE + p: fail(f'{p}: canonical {pr.canon}')
    if pr.alts['x-default'] != pr.alts['de']: fail(f'{p}: x-default')
    for lang in ('de', 'en'):
        other = pr.alts[lang].replace(BASE, '')
        if other not in parsed: fail(f'{p}: alternate {lang} {other} missing'); continue
        if parsed[other].alts != pr.alts: fail(f'{p}: alternates not reciprocal with {other}')
        if parsed[other].lang != lang: fail(f'{other}: lang {parsed[other].lang} != {lang}')

# sitemap & robots
st, sm = get('/sitemap.xml')
locs = re.findall(r'<loc>(.*?)</loc>', sm)
if not set(x for x in PAGES if x != '/404.html') <= set(l.replace(BASE, '') for l in locs) or len(locs) != len(set(locs)): fail(f'sitemap locs {locs}')
for path in ['/robots.txt', '/.well-known/security.txt', '/site.webmanifest', '/favicon.ico', '/favicon.svg']:
    if get(path)[0] != 200: fail(f'missing {path}')
print(f'static: {len(parsed)} pages, {len(checked)} internal targets, external links: {sorted(external)}')

# ---------------- browser checks
def add_headers(route):
    try:
        r = route.fetch()
        h = dict(r.headers); h.update(HDRS)
        h.pop('strict-transport-security', None)
        route.fulfill(response=r, headers=h)
    except Exception:
        route.continue_()

weights = {}
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp_name, vp in (('phone', {'width': 360, 'height': 780}), ('desktop', {'width': 1280, 'height': 900})):
        for scheme in ('light', 'dark'):
            ctx = b.new_context(viewport=vp, color_scheme=scheme, device_scale_factor=2 if vp_name == 'phone' else 1)
            ctx.route(re.compile(r'^http://127\.0\.0\.1:8803/'), add_headers)
            for p in PAGES:
                pg = ctx.new_page()
                errs, ext, sizes = [], [], {}
                pg.on('console', lambda m, errs=errs: errs.append(m.text) if m.type in ('error', 'warning') else None)
                pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
                pg.on('request', lambda r, ext=ext: ext.append(r.url) if not r.url.startswith(ORIGIN) and not r.url.startswith('data:') else None)
                def on_resp(r, sizes=sizes):
                    try: sizes[r.url] = len(r.body())
                    except Exception: pass
                pg.on('response', on_resp)
                pg.goto(ORIGIN + p, wait_until='networkidle')
                if vp_name == 'phone' and scheme == 'light':
                    weights[p] = sum(sizes.values())
                    if weights[p] > 300_000: fail(f'{p}: initial weight {weights[p]}')
                sw = pg.evaluate('document.documentElement.scrollWidth'); iw = pg.evaluate('innerWidth')
                if sw > iw: fail(f'{p} {vp_name}: horizontal overflow {sw}>{iw}')
                wide = pg.evaluate('''() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && getComputedStyle(e).position !== 'absolute' && !e.closest('.nav'); }).slice(0,5).map(e => e.tagName + '.' + e.className)''')
                if wide: fail(f'{p} {vp_name}: elements beyond viewport {wide}')
                if errs: fail(f'{p} {vp_name}/{scheme}: console {errs}')
                if ext: fail(f'{p}: external requests {ext}')
                if p in SHOTS:
                    name = (p.strip('/').replace('/', '_') or 'home').replace('.html', '')
                    pg.screenshot(path=str(OUT / f'{name}-{vp_name}-{scheme}.png'), full_page=True)
                if errs or ext: pass
                pg.close()
            ctx.close()

    # theme toggle + konto config
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='light')
    pg = ctx.new_page(); pg.goto(ORIGIN + '/')
    btn = pg.locator('[data-theme-toggle]')
    assert btn.is_visible(), 'toggle hidden'
    btn.click()
    if pg.evaluate("document.documentElement.dataset.theme") != 'dark': fail('toggle did not set dark')
    pg.reload()
    if pg.evaluate("document.documentElement.dataset.theme") != 'dark': fail('theme not persisted')
    if btn.get_attribute('aria-pressed') != 'true': fail('aria-pressed not true after reload')
    btn.click()
    if pg.evaluate("document.documentElement.hasAttribute('data-theme')"): fail('back to system should clear override')
    pg.goto(ORIGIN + '/konto/')  # the FaLe-Konto sign-in links live on the konto page (home no longer advertises it)
    hrefs = pg.eval_on_selector_all('[data-konto-link]', 'els => els.map(e => e.getAttribute("href"))')
    if not hrefs or any(h != 'https://pdf.fale.network/app/#/konto' for h in hrefs): fail(f'konto links {hrefs}')
    if not pg.locator('[data-konto-signin]').first.is_visible(): fail('sign-in hidden although kontoAvailable=true')
    if pg.locator('[data-konto-soon]').first.is_visible(): fail('coming-soon note visible although the account is live')
    # keyboard: first Tab focuses skip link
    pg.goto(ORIGIN + '/apps/pdf/'); pg.keyboard.press('Tab')
    if pg.evaluate("document.activeElement.className") != 'skip': fail('skip link not first focus')
    # no-JS rendering: toggle stays hidden, content visible
    ctx2 = b.new_context(java_script_enabled=False); p2 = ctx2.new_page(); p2.goto(ORIGIN + '/en/')
    if p2.locator('[data-theme-toggle]').is_visible(): fail('toggle visible without JS')
    b.close()

print('initial weights (bytes, phone):', json.dumps(weights))
print('RESULT:', 'OK' if not fails else f'{len(fails)} failures')
sys.exit(1 if fails else 0)

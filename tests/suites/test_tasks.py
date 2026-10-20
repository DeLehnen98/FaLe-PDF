"""pdf.fale.network task pages ("PDF unterschreiben", "Merge PDF" …) – scripts/build-tasks.mjs, all 16 languages.
- every page (8 tasks × 16 languages) in the web build: title ≤ 70, description, canonical = own URL, 17 hreflang links
  (16 languages + x-default) that point at existing pages, valid JSON-LD (HowTo, FAQPage, BreadcrumbList), the button
  opens the matching app tool, links to the other tasks, no other companies' product names
- phone 360 px: no console errors or CSP violations, no horizontal scroll (German, Japanese, Hindi, Russian)
- the start page of every language links its 8 task pages
- device language: /de/pdf-unterschreiben/ in a Japanese browser goes to /ja/sign-pdf/ (only with the test switch)
- the button really opens the tool in the app (/app/#/werkzeug/unterschreiben → "Dokument wählen")
- sitemap.xml: start pages + all task pages, every <loc> exists in dist
Run: node scripts/vercel-build.mjs && node tests/suites/sec/csp_server.mjs 9412 <repo>/dist
     DIST_URL=http://127.0.0.1:9412 python3 test_tasks.py
"""
import json, os, re, sys
from pathlib import Path
from html.parser import HTMLParser
from playwright.sync_api import sync_playwright

URL = os.environ.get('DIST_URL', 'http://127.0.0.1:9412')
REPO = Path(__file__).resolve().parents[2]
DIST = Path(os.environ.get('FALE_DIST') or REPO / 'dist')
ORIGIN = 'https://pdf.fale.network'
LANGS = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'tr', 'uk', 'ru', 'zh', 'ja', 'ko', 'hi', 'id']
ROUTES = {'sign': 'unterschreiben', 'fill': 'unterschreiben', 'edit': 'bearbeiten', 'merge': 'zusammenfuegen', 'compress': 'komprimieren',
          'scan': 'scannen', 'word': 'pdf-word', 'xfa': 'behoerdenformular'}
BANNED = re.compile(r'\b(adobe|acrobat|wps|ilovepdf|smallpdf|pdf24|sejda|foxit|docusign)\b', re.I)
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    if not cond or os.environ.get('VERBOSE'):
        print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.links = []; self.alts = []; self.canon = None; self.title = ''; self.desc = None; self.ld = []; self._t = False; self._ld = False; self.text = []

    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == 'link' and a.get('rel') == 'alternate' and a.get('hreflang'): self.alts.append((a['hreflang'], a['href']))
        if tag == 'link' and a.get('rel') == 'canonical': self.canon = a['href']
        if tag == 'meta' and a.get('name') == 'description': self.desc = a.get('content')
        if tag == 'a' and a.get('href'): self.links.append(a['href'])
        if tag == 'title': self._t = True
        if tag == 'script' and a.get('type') == 'application/ld+json': self._ld = True; self.ld.append('')

    def handle_endtag(self, tag):
        if tag == 'title': self._t = False
        if tag == 'script': self._ld = False

    def handle_data(self, d):
        if self._t: self.title += d
        elif self._ld: self.ld[-1] += d
        else: self.text.append(d)


def path_exists(u):
    p = u.replace(ORIGIN, '').split('?')[0]
    if p == '/': return (DIST / 'index.html').exists()
    return (DIST / p.strip('/') / 'index.html').exists() if p.endswith('/') else (DIST / p.strip('/')).exists()


def static_checks():
    tasks = {l: json.load(open(REPO / 'site' / 'tasks' / f'{l}.json', encoding='utf-8')) for l in LANGS}
    n = 0
    for l in LANGS:
        for tid, t in tasks[l]['tasks'].items():
            f = DIST / l / t['slug'] / 'index.html'
            if not f.exists():
                check(f'{l}/{tid}: page in dist', False, f); continue
            n += 1
            pg = Page(); pg.feed(f.read_text(encoding='utf-8'))
            url = f'{ORIGIN}/{l}/{t["slug"]}/'
            ok = (0 < len(pg.title) <= 70 and pg.desc and pg.canon == url and len(pg.alts) == 17
                  and all(path_exists(h) for _, h in pg.alts) and dict(pg.alts).get('x-default', '').startswith(ORIGIN + '/en/'))
            check(f'{l}/{tid}: title, description, canonical, 17 hreflang links to existing pages', ok, (pg.title, pg.canon, len(pg.alts)))
            try:
                types = [json.loads(x)['@type'] for x in pg.ld]
            except Exception as e:
                types = [str(e)]
            check(f'{l}/{tid}: JSON-LD HowTo + FAQPage + BreadcrumbList', types == ['HowTo', 'FAQPage', 'BreadcrumbList'], types)
            check(f'{l}/{tid}: button opens the app tool', f'/app/#/werkzeug/{ROUTES[tid]}' in pg.links, pg.links[:6])
            others = [f'/{l}/{x["slug"]}/' for k, x in tasks[l]['tasks'].items() if k != tid]
            check(f'{l}/{tid}: links the other 7 tasks', all(o in pg.links for o in others))
            check(f'{l}/{tid}: no other companies\' product names', not BANNED.search(' '.join(pg.text) + pg.title + (pg.desc or '')))
        home = DIST / ('index.html' if l == 'de' else f'{l}/index.html')
        hp = Page(); hp.feed(home.read_text(encoding='utf-8'))
        check(f'{l}: start page links its 8 task pages', all(f'/{l}/{x["slug"]}/' in hp.links for x in tasks[l]['tasks'].values()))
    check('128 task pages in the build', n == 128, n)
    sm = (DIST / 'sitemap.xml').read_text(encoding='utf-8')
    locs = re.findall(r'<loc>([^<]+)</loc>', sm)
    check('sitemap: 16 start pages + 128 task pages + 2 legal pages', len(locs) == 146, len(locs))
    missing = [u for u in locs if not path_exists(u)]
    check('sitemap: every <loc> exists in the build', not missing, missing[:5])


def browser_checks(p):
    tasks = {l: json.load(open(REPO / 'site' / 'tasks' / f'{l}.json', encoding='utf-8')) for l in LANGS}
    b = p.chromium.launch()
    for l, loc in [('de', 'de-DE'), ('ja', 'ja-JP'), ('hi', 'hi-IN'), ('ru', 'ru-RU')]:
        c = b.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True, locale=loc)
        c.add_init_script("window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));")
        pg = c.new_page(); errs = []
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(str(e)))
        for tid in ['sign', 'xfa', 'scan']:
            slug = tasks[l]['tasks'][tid]['slug']
            pg.goto(f'{URL}/{l}/{slug}/'); pg.wait_for_timeout(700)
            over = pg.evaluate('document.documentElement.scrollWidth')
            check(f'phone {l}/{tid}: no horizontal scroll', over <= 361, over)
            check(f'phone {l}/{tid}: h1 shown', pg.locator('h1').inner_text().strip() == tasks[l]['tasks'][tid]['h1'])
        check(f'phone {l}: no console errors / CSP violations', not errs and not pg.evaluate('window.__csp'), (errs[:3], pg.evaluate('window.__csp')))
        c.close()
    # device language (test switch on): German task page in a Japanese browser → Japanese task page
    c = b.new_context(locale='ja-JP')
    c.add_init_script("try { localStorage.setItem('fale-landing-test-redirect', '1'); } catch (e) {}")
    pg = c.new_page()
    pg.goto(f'{URL}/de/{tasks["de"]["tasks"]["sign"]["slug"]}/'); pg.wait_for_timeout(1200)
    check('Japanese browser on the German page → Japanese page', pg.url.endswith(f'/ja/{tasks["ja"]["tasks"]["sign"]["slug"]}/'), pg.url)
    c.close()
    # the button opens the tool in the app
    c = b.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE')
    c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    pg = c.new_page()
    pg.goto(f'{URL}/de/{tasks["de"]["tasks"]["sign"]["slug"]}/'); pg.wait_for_timeout(600)
    pg.locator('main .hero .btn-main').click()
    pg.wait_for_selector('#tool-screen:not([hidden])', timeout=20000); pg.wait_for_timeout(800)
    check('button → app opens "Ausfüllen & unterschreiben"', '/app/' in pg.url and 'Ausfüllen & unterschreiben' in pg.locator('#tool-screen .screen-title').inner_text(), pg.url)
    c.close(); b.close()


if __name__ == '__main__':
    static_checks()
    with sync_playwright() as p:
        browser_checks(p)
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], r[2][:300])
    sys.exit(1 if bad else 0)

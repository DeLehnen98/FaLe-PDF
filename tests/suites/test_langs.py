"""FaLe PDF in every UI language (js/i18n/<code>.js, built by scripts/i18n-langs.mjs).

For each language that has a dictionary: a browser with that device language opens the app and visits the main
screens, the tools, a tool, the settings, the AI hub and the onboarding (phone, 360 px). Checks:
- html lang and the navigation are in that language (navigation labels = the dictionary's values)
- no German UI text is left: visible texts that are exactly a German source string of the dictionary (and that the
  dictionary translates to something else) count as leftovers – a few are tolerated (content, examples)
- no horizontal overflow at 360 px, no page errors, no failed requests for the dictionary
- dates are shown in the language's format (a reminder date on the start screen if present is not required)
Run: python3 test_langs.py [codes …]   (server: python3 -m http.server 8798 --bind 127.0.0.1 in the repo; URL via LANGS_URL)
"""
import json, os, re, subprocess, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
URL = os.environ.get('LANGS_URL', 'http://127.0.0.1:8798/')
OUT = os.path.join(os.path.dirname(__file__), 'out_langs')
os.makedirs(OUT, exist_ok=True)
LOCALE = {'en': 'en-GB', 'fr': 'fr-FR', 'es': 'es-ES', 'it': 'it-IT', 'pt': 'pt-BR', 'nl': 'nl-NL', 'pl': 'pl-PL', 'tr': 'tr-TR',
          'uk': 'uk-UA', 'ru': 'ru-RU', 'zh': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR', 'hi': 'hi-IN', 'id': 'id-ID'}
results = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:300]}]' if info and not cond else ''), flush=True)


def dictionary(code):
    js = f"import(process.argv[1]).then(m => console.log(JSON.stringify(m.default)))"
    out = subprocess.run(['node', '--no-warnings', '-e', js, os.path.join(ROOT, 'js', 'i18n', f'{code}.js')], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def published():
    src = open(os.path.join(ROOT, 'js', 'i18n', 'index.js'), encoding='utf-8').read()
    m = re.search(r"export const LANGS = \[([^\]]*)\]", src)
    return [c.strip(" '\"") for c in m.group(1).split(',') if c.strip(" '\"") not in ('de', '')]


SCAN = r"""() => {
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const el = n.parentElement;
    if (!el || el.closest('[data-no-i18n], script, style, textarea, .doc-name, .pdfViewer, .lt-paper')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (t.length > 3) out.add(t);
  }
  document.querySelectorAll('[aria-label],[placeholder],[title]').forEach(e => ['aria-label', 'placeholder', 'title'].forEach(a => { const v = e.getAttribute(a); if (v && v.length > 3) out.add(v.trim()); }));
  return [...out];
}"""

ROUTES = ['#/start', '#/dateien', '#/werkzeuge', '#/einstellungen', '#/werkzeug/zusammenfuegen', '#/werkzeug/komprimieren', '#/ki', '#/teilen']


def run(p, code):
    d = dictionary(code)
    german = {k for k, v in d.items() if v and v != k and len(k) > 3 and '{' not in k and not k.startswith('@')}
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 360, 'height': 740}, locale=LOCALE[code], is_mobile=True, has_touch=True)
    c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    pg = c.new_page()
    errs, failed = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('requestfailed', lambda r: failed.append(r.url))
    pg.on('response', lambda r: r.status >= 400 and failed.append(f'{r.status} {r.url}'))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero', timeout=20000)
    pg.wait_for_timeout(800)
    check(f'{code}: html lang', pg.evaluate('document.documentElement.lang') == code, pg.evaluate('document.documentElement.lang'))
    nav = ' | '.join(pg.locator('.bnav').all_inner_texts())
    check(f'{code}: navigation translated', d.get('Werkzeuge', '') in nav and 'Werkzeuge' not in nav, nav.replace('\n', ' | '))
    left = {}
    for r in ROUTES:
        pg.goto(URL + r)
        pg.wait_for_timeout(1100)
        for t in pg.evaluate(SCAN):
            if t in german:
                left.setdefault(t, r)
        over = pg.evaluate('document.documentElement.scrollWidth')
        check(f'{code} {r}: no horizontal overflow at 360 px', over <= 361, over)
        pg.screenshot(path=os.path.join(OUT, f'{code}_{r[2:].replace("/", "_")}.png'))
    # onboarding (incl. the view choice)
    pg.evaluate("import('./js/extras/onboarding.js').then(m => m.showOnboarding())")
    pg.wait_for_selector('.onboard')
    for _ in range(6):
        for t in pg.evaluate(SCAN):
            if t in german:
                left.setdefault(t, 'onboarding')
        pg.screenshot(path=os.path.join(OUT, f'{code}_onboarding_{_}.png'))
        if pg.locator('[data-next]').count():
            pg.locator('[data-next]').click()
            pg.wait_for_timeout(250)
    check(f'{code}: no German UI text left (≤ 3 tolerated)', len(left) <= 3, list(left.items())[:12])
    check(f'{code}: no page errors', not errs, errs[:3])
    check(f'{code}: no failed requests', not [f for f in failed if 'i18n' in f or '/js/' in f], failed[:5])
    b.close()


ENGINE = r"""
const [c, en, pl] = await Promise.all([import(process.argv[1] + '/js/i18n/core.js'), import(process.argv[1] + '/js/i18n/en.js'), import(process.argv[1] + '/js/i18n/pl.js').catch(() => null)]);
const e = c.createTranslator(en.default, { locale: 'en-GB' });
const out = { cells: e.lookup('3 Zellen markiert'), cell: e.lookup('1 Zelle markiert'), dl: e.lookup('5 Downloads'), date: e.lookup('14.10.2026') };
if (pl) { const p = c.createTranslator(pl.default, { locale: 'pl-PL' }); out.pl2 = p.lookup('2 Zellen markiert'); out.pl5 = p.lookup('5 Zellen markiert'); out.pldate = p.lookup('14.10.2026'); }
console.log(JSON.stringify(out));
"""


def engine():
    out = json.loads(subprocess.run(['node', '--no-warnings', '--input-type=module', '-e', ENGINE, ROOT], capture_output=True, text=True, check=True).stdout)
    check('engine: English plural from a German suffix ("3 cells")', out['cells'] == '3 cells selected' and out['cell'] == '1 cell selected' and out['dl'] == '5 downloads', out)
    check('engine: English date format', out['date'] == '14 Oct 2026', out)
    if 'pl2' in out:
        check('engine: Polish plural categories (2 / 5)', out['pl2'] and out['pl5'] and out['pl2'] != out['pl5'] and 'Zell' not in out['pl2'] + out['pl5'], out)
        check('engine: Polish date via Intl', out['pldate'] and '2026' in out['pldate'] and 'Oct' not in out['pldate'], out)


if __name__ == '__main__':
    codes = sys.argv[1:] or published()
    engine()
    with sync_playwright() as p:
        for code in codes:
            if code == 'en':
                continue  # English has its own, deeper suite (test_i18n.py)
            run(p, code)
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    for r in bad:
        print('  FAIL', r[0], str(r[2])[:400])
    sys.exit(1 if bad else 0)

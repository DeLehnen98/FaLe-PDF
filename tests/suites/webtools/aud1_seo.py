"""aud1 SEO/content check for all tool pages + hubs (static HTML, server on WT_PORT)."""
import json, os, re, sys, urllib.request
from html.parser import HTMLParser
from pathlib import Path
PORT = int(os.environ.get('WT_PORT', '8780'))
O = f'http://127.0.0.1:{PORT}'
NET = Path('/home/claude/FalePDF/network')
SPECS = sorted((NET / 'tools/webtools/specs').glob('*.json'))
BAD = re.compile(r'\b(Adobe|Acrobat|WPS|iLovePDF|Smallpdf|PDF24|Sejda|Microsoft|Google|Apple|Dropbox|Canva)\b', re.I)
fails = []
checked = {}


def get(path):
    if path in checked:
        return checked[path]
    try:
        r = urllib.request.urlopen(urllib.request.Request(O + path, method='GET'), timeout=10)
        checked[path] = (r.status, r.read())
    except urllib.error.HTTPError as e:
        checked[path] = (e.code, b'')
    return checked[path]


class P(HTMLParser):
    def __init__(self):
        super().__init__(); self.links = []; self.meta = {}; self.ld = []; self._ld = False; self.title = ''; self._t = False; self.alt = []; self.hreflang = {}; self.canonical = None; self.text = []
    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == 'script' and a.get('type') == 'application/ld+json': self._ld = True; self.ld.append('')
        if tag == 'title': self._t = True
        if tag == 'meta' and (a.get('name') or a.get('property')): self.meta[a.get('name') or a.get('property')] = a.get('content', '')
        if tag == 'link' and a.get('rel') == 'canonical': self.canonical = a.get('href')
        if tag == 'link' and a.get('rel') == 'alternate' and a.get('hreflang'): self.hreflang[a['hreflang']] = a['href']
        for k in ('href', 'src'):
            if a.get(k) and tag in ('a', 'link', 'script', 'img', 'source'): self.links.append(a[k])
        if tag == 'img' and 'alt' not in a: fails.append('img without alt')
    def handle_endtag(self, tag):
        if tag == 'script': self._ld = False
        if tag == 'title': self._t = False
    def handle_data(self, d):
        if self._ld: self.ld[-1] += d
        elif self._t: self.title += d
        else: self.text.append(d)


sitemap = get('/sitemap.xml')[1].decode()
for spec_path in SPECS:
    spec = json.loads(spec_path.read_text())
    for lang in ('de', 'en'):
        L = spec[lang]
        path = f'/werkzeuge/{L["slug"]}/' if lang == 'de' else f'/en/tools/{L["slug"]}/'
        st, body = get(path)
        tag = f'{spec["id"]}/{lang}'
        if st != 200: fails.append(f'{tag}: HTTP {st}'); continue
        p = P(); p.feed(body.decode())
        for i, block in enumerate(p.ld):
            try:
                data = json.loads(block)
                types = [d.get('@type') for d in (data.get('@graph') or [data])]
                if 'FAQPage' in types:
                    faq = next(d for d in (data.get('@graph') or [data]) if d.get('@type') == 'FAQPage')
                    if len(faq['mainEntity']) != len(L['faq']): fails.append(f'{tag}: FAQ JSON-LD count')
            except Exception as e:
                fails.append(f'{tag}: JSON-LD #{i} invalid: {e}')
        if not p.canonical or not p.canonical.endswith(path): fails.append(f'{tag}: canonical {p.canonical}')
        if set(p.hreflang) < {'de', 'en'}: fails.append(f'{tag}: hreflang {p.hreflang}')
        other = spec['en' if lang == 'de' else 'de']['slug']
        if not any(other in v for v in p.hreflang.values()): fails.append(f'{tag}: hreflang pair missing')
        if len(p.title) > 70: fails.append(f'{tag}: title {len(p.title)} chars')
        d = p.meta.get('description', '')
        if not (100 <= len(d) <= 165): fails.append(f'{tag}: meta description {len(d)} chars')
        if path not in sitemap: fails.append(f'{tag}: not in sitemap')
        text = ' '.join(p.text)
        m = BAD.search(json.dumps(L, ensure_ascii=False))
        if m: fails.append(f'{tag}: brand name in spec text: {m.group(0)}')
        if lang == 'de' and re.search(r'\b(Sie|Ihre?|Ihnen)\b', json.dumps(L, ensure_ascii=False)): fails.append(f'{tag}: Sie-form?')
        for href in p.links:
            if href.startswith(('http://', 'https://')):
                if 'falenetwork' not in href and 'fale' not in href: fails.append(f'{tag}: external link {href}')
                continue
            if href.startswith(('#', 'mailto:', 'data:')): continue
            u = href.split('#')[0]
            if not u.startswith('/'): u = path + u
            s2, _ = get(u)
            if s2 != 200: fails.append(f'{tag}: link {href} → {s2}')
for f in fails:
    print(' -', f)
print(f'{len(SPECS)} specs, {len(checked)} URLs checked, {len(fails)} problems')
sys.exit(1 if fails else 0)

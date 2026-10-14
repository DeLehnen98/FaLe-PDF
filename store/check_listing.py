"""Check Google Play listing limits in store/listing-*.md (title ≤ 30, short ≤ 80, full ≤ 4000)."""
import os, re, sys
LIM = [('title', 30), ('short', 80), ('full', 4000)]
HEAD = {'de': ['App-Name', 'Kurzbeschreibung', 'Vollständige Beschreibung'], 'en': ['App name', 'Short description', 'Full description']}
ok = True
for lang in ('de', 'en'):
    md = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f'listing-{lang}.md'), encoding='utf-8').read()
    for (key, lim), head in zip(LIM, HEAD[lang]):
        m = re.search(r'^## ' + re.escape(head) + r'.*?\n```\n(.*?)\n```', md, re.S | re.M)
        if not m: print(lang, key, 'NOT FOUND'); ok = False; continue
        text = m.group(1)
        n = len(text)
        flag = 'OK' if n <= lim else 'TOO LONG'
        ok &= n <= lim
        print(f'{lang} {key:5} {n:5} / {lim}  {flag}')
sys.exit(0 if ok else 1)

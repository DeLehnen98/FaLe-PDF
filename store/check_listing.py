"""Check Google Play listing limits (title ≤ 30, short ≤ 80, full ≤ 4000) in store/listing-de.md, store/listing-en.md
and the translated listings store/listings/<lang>.md (those use the English headings)."""
import glob, os, re, sys
LIM = [('title', 30), ('short', 80), ('full', 4000)]
HEAD = {'de': ['App-Name', 'Kurzbeschreibung', 'Vollständige Beschreibung'], 'en': ['App name', 'Short description', 'Full description']}
ok = True
HERE = os.path.dirname(os.path.abspath(__file__))
FILES = [('de', os.path.join(HERE, 'listing-de.md')), ('en', os.path.join(HERE, 'listing-en.md'))]
FILES += [(os.path.basename(f)[:-3], f) for f in sorted(glob.glob(os.path.join(HERE, 'listings', '*.md')))]
for lang, path in FILES:
    md = open(path, encoding='utf-8').read()
    for (key, lim), head in zip(LIM, HEAD.get(lang, HEAD['en'])):
        m = re.search(r'^## ' + re.escape(head) + r'.*?\n```\n(.*?)\n```', md, re.S | re.M)
        if not m: print(lang, key, 'NOT FOUND'); ok = False; continue
        text = m.group(1)
        n = len(text)
        flag = 'OK' if n <= lim else 'TOO LONG'
        ok &= n <= lim
        print(f'{lang} {key:5} {n:5} / {lim}  {flag}')
sys.exit(0 if ok else 1)

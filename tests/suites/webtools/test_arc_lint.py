"""Vorlagen-Archiv – humanization lint for all example letters (DE + EN) and data sanity.

Flags: clichés and AI tells, adjective chains ("teamfähig, belastbar, flexibel"), overused closing formulas,
long identical word sequences shared by two letters (8-gram overlap), repeated openings, monotonous sentence
lengths, wrong capitalisation after the salutation, du-Form in letters, salary figures, letter length.
Pure Python, no browser. Exit 1 on any finding."""
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path('/home/claude/FalePDF/network/tools/vorlagen/data')

CLICHES_DE = [
    r'hiermit bewerbe ich mich', r'mit großer begeisterung', r'mit großem interesse habe ich', r'in der heutigen schnelllebigen',
    r'leidenschaft', r'spannende herausforderung', r'neue herausforderung', r'ich freue mich darauf, von ihnen zu hören',
    r'über eine einladung zu einem persönlichen gespräch würde ich mich sehr freuen', r'hat mein interesse geweckt',
    r'bin ich die ideale besetzung', r'perfekte(r|n)? kandidat', r'ich bin überzeugt, dass ich', r'wertvoll(en|er|es)? beitrag',
    r'bringe ich alle voraussetzungen', r'teamplayer', r'hochmotiviert', r'dynamisch(en|es|er)? (team|umfeld)', r'synergien',
    r'mein(en|e)? horizont (zu )?erweitern', r'nahtlos', r'in einem sich ständig wandelnden', r'ganzheitlich',
    r'darüber hinaus verfüge ich', r'zudem zeichne ich mich', r'meine stärken liegen in', r'last but not least',
]
CLICHES_EN = [
    r'i am writing to apply', r'i am excited to apply', r'passion(ate)?', r'fast-paced', r'dynamic team', r'team player',
    r'i believe i would be a great fit', r'perfect candidate', r'look forward to hearing from you', r'thrilled', r'synerg',
    r'leverage', r'in today\'s', r'hard-working', r'go-getter', r'think outside the box',
]
CHAIN_WORDS = r'(teamfähig|belastbar|flexibel|zuverlässig|motiviert|kommunikativ|engagiert|lernbereit|zielstrebig|kreativ|hilfsbereit|reliable|motivated|flexible|hard-working|organised|organized)'
CAP_OK = {'Ihre', 'Ihr', 'Ihren', 'Ihrem', 'Ihrer', 'Ihnen', 'Sie'}
LOWER_FUNCTION = {'ich', 'mit', 'über', 'in', 'im', 'als', 'seit', 'nach', 'auf', 'für', 'vor', 'wenn', 'weil', 'dass', 'mein', 'meine', 'meinen', 'unser',
                  'unsere', 'bei', 'zwölf', 'zehn', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'elf', 'zwei', 'eine', 'ein', 'einen', 'wer',
                  'jeden', 'jede', 'letztes', 'achtzehn', 'zwanzig', 'dreihundert', 'früh', 'die', 'der', 'das', 'den', 'zwischen', 'unsere', 'vom', 'am', 'eine'}
DU_RE = re.compile(r'\b(du|dich|dir|dein|deine|deinen|deinem|deiner|euch|euer)\b')

fails = []


def flag(msg):
    fails.append(msg)


def sentences(text):
    return [s for s in re.split(r'(?<=[.!?…])\s+(?=[A-ZÄÖÜ„"0-9])', text.strip()) if s]


def words(text):
    return re.findall(r"[\wäöüß’']+", text.lower())


letters = []   # (key, lang, body list)
jobs = 0
for f in sorted(DATA.glob('*/*.json')):
    if f.parent.name == 'ratgeber':
        continue
    d = json.loads(f.read_text(encoding='utf-8'))
    jobs += 1
    for lang, src in (('de', d), ('en', d.get('en'))):
        if not src:
            continue
        for i, L in enumerate(src['letters']):
            letters.append((f'{d["id"]}/{lang}#{i + 1}', lang, L['body']))
        if src.get('pay') and re.search(r'(\d[\d.,]*\s*(€|euro|eur\b|%))|(€|£|\$)\s*\d', src['pay'], re.I):
            flag(f'{d["id"]}/{lang}: salary hint contains digits – no salary figures')
        for t in src['letters']:
            if re.search(r'(gehaltsvorstellung|gehaltswunsch|verdienen möchte|salary|expected pay)[^.]{0,60}\d', ' '.join(t['body']), re.I):
                flag(f'{d["id"]}/{lang}: salary figure in a letter')

# arc2: letters of the CV design gallery (designs/*.json) and the written letter templates (briefe/*.json, din-letter)
ARC2 = DATA.parent
n_arc2 = 0
for f in sorted((ARC2 / 'designs').glob('*.json')):
    d = json.loads(f.read_text(encoding='utf-8'))
    for lang in ('de', 'en'):
        letters.append((f'design-{d["id"]}/{lang}#1', lang, d[lang]['letter']['body'])); n_arc2 += 1
for f in sorted((ARC2 / 'briefe').glob('*.json')):
    d = json.loads(f.read_text(encoding='utf-8'))
    for lang, src in (('de', d), ('en', d.get('en'))):
        if src and src.get('letter'):
            letters.append((f'brief-{d["id"]}/{lang}#1', lang, src['letter']['body'])); n_arc2 += 1
    for t in [d.get('h1', ''), d.get('lede', '')] + d.get('when', []) + d.get('must', []) + d.get('notes', []) + [x['a'] for x in d.get('faq', [])]:
        low = t.lower()
        for pat in CLICHES_DE:
            if re.search(pat, low):
                flag(f'brief-{d["id"]}: cliché /{pat}/ in page text')
for f in sorted((ARC2 / 'tabellen').glob('*.json')):
    d = json.loads(f.read_text(encoding='utf-8'))
    for t in [d['intro']] + d['uses'] + [c[1] for c in d['cols']] + d.get('tips', []) + [x['a'] for x in d.get('faq', [])]:
        for pat in CLICHES_DE:
            if re.search(pat, t.lower()):
                flag(f'tabelle-{d["id"]}: cliché /{pat}/')
print(f'arc2: {n_arc2} letters (designs + briefe)')
print(f'{jobs} jobs, {len(letters)} letters')
if jobs < 80:
    flag(f'only {jobs} jobs (need ≥ 80)')

phrase_count = Counter()
openings2 = Counter()
openings3 = Counter()
ngram_owner = defaultdict(set)
N = 8
for key, lang, body in letters:
    text = ' '.join(body)
    low = text.lower()
    for pat in (CLICHES_DE if lang == 'de' else CLICHES_EN):
        if re.search(pat, low):
            flag(f'{key}: cliché /{pat}/')
    for s in sentences(text):
        if len(re.findall(CHAIN_WORDS, s.lower())) >= 3:
            flag(f'{key}: adjective chain in “{s[:80]}”')
    if lang == 'de':
        if DU_RE.search(low):
            flag(f'{key}: du-Form in a letter: {DU_RE.search(low).group(0)}')
        first = re.match(r'[„"]?([\wÄÖÜäöüß]+)', body[0]).group(1)
        if first[0].isupper() and first not in CAP_OK and first.lower() in LOWER_FUNCTION:
            flag(f'{key}: first word after the salutation must be lowercase: {first}')
    if not 2 <= len(body) <= 4:
        flag(f'{key}: {len(body)} paragraphs')
    nw = len(words(text))
    if not 45 <= nw <= 330:
        flag(f'{key}: {nw} words (45–330)')
    # sentence length variety
    lens = [len(words(s)) for s in sentences(text)]
    if len(lens) >= 5 and (max(lens) - min(lens) < 8 or statistics.pstdev(lens) < 3):
        flag(f'{key}: monotonous sentence lengths {lens}')
    # closings
    for p in ('freue mich auf ein gespräch', 'freue mich auf ihre rückmeldung', 'freue mich auf ihre antwort', 'über eine einladung',
              'würde mich freuen', 'würde ich mich freuen', 'gern stelle ich mich', 'look forward', 'would welcome'):
        if p in low:
            phrase_count[p] += 1
    w = words(body[0])
    openings2[' '.join(w[:2])] += 1
    openings3[' '.join(w[:3])] += 1
    ws = words(text)
    for j in range(len(ws) - N + 1):
        ngram_owner[' '.join(ws[j:j + N])].add(key.split('#')[0] + '#' + key.split('#')[1])

total = len(letters)
for p, n in phrase_count.items():
    if n > max(6, total * 0.06):
        flag(f'closing formula overused: “{p}” in {n} letters')
for o, n in openings2.items():
    if n > 6:
        flag(f'opening “{o} …” used {n} times')
for o, n in openings3.items():
    if n > 2:
        flag(f'opening “{o} …” used {n} times')
shared = defaultdict(set)
for g, owners in ngram_owner.items():
    if len(owners) > 1:
        shared[tuple(sorted(owners))].add(g)
for owners, grams in shared.items():
    flag(f'{" & ".join(owners)} share {N}+ identical words: “{sorted(grams)[0]}”')

print(f'closings: {dict(phrase_count)}')
print(f'top openings: {openings2.most_common(6)}')
if fails:
    print(f'[FAIL] arc-lint ({len(fails)} findings)')
    for x in fails:
        print('   -', x)
    sys.exit(1)
print('[PASS] arc-lint')

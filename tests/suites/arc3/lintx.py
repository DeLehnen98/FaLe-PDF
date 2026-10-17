import json,re,glob,collections,sys
def words(t): return re.findall(r"[\wäöüß’']+", t.lower())
o2=collections.Counter(); o3=collections.Counter()
for f in glob.glob('/home/claude/FalePDF/network/tools/vorlagen/data/*/*.json'):
    if '/ratgeber/' in f: continue
    d=json.load(open(f))
    for src in (d, d.get('en')):
        if not src: continue
        for L in src['letters']:
            w=words(L['body'][0]); o2[' '.join(w[:2])]+=1; o3[' '.join(w[:3])]+=1
print('2-word >=4:', [(k,v) for k,v in o2.most_common() if v>=4])
print('3-word ==2:', [k for k,v in o3.items() if v>=2])

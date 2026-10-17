import json, pathlib, sys
DATA = pathlib.Path('/home/claude/FalePDF/network/tools/vorlagen/data')
def J(**d):
    p = DATA / d['field'] / (d['id'] + '.json')
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('wrote', p.relative_to(DATA))
def L(label, level, position, to, body, att, frm=None, ref=None):
    d = {'label': label, 'level': level, 'position': position, 'to': to, 'body': body, 'att': att}
    if frm: d['from'] = frm
    if ref: d['ref'] = ref
    return d
def T(org, street, city, sal='none', contact=''):
    d = {'org': org, 'sal': sal, 'street': street, 'city': city}
    if contact: d['contact'] = contact
    return d
def F(q, a): return {'q': q, 'a': a}

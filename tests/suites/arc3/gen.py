"""arc3: compact authoring helpers for Vorlagen-Archiv job files (writes network/tools/vorlagen/data/<field>/<id>.json)."""
import json
from pathlib import Path

DATA = Path('/home/claude/FalePDF/network/tools/vorlagen/data')
WRITTEN = []


def T(org, sal, contact, street, city):
    """Recipient. sal: f|m|n|none; contact = surname (full name for n)."""
    d = {'org': org, 'sal': sal}
    if sal != 'none':
        d['contact'] = contact
    d['street'] = street
    d['city'] = city
    return d


def L(label, level, position, to, body, att, frm=None, ref=None):
    d = {'label': label, 'level': level, 'position': position}
    if ref:
        d['ref'] = ref
    d['to'] = to
    d['body'] = list(body)
    d['att'] = list(att)
    if frm:
        d['from'] = list(frm)
    return d


def row(a, b, role, org='', place='', desc=''):
    return [a, b, role, org, place, desc]


def CV(avatar, design, accent, name, title, street, city, exp, edu, skills, langs, hobbies='', courses=(), web=None):
    d = {'avatar': avatar, 'design': design, 'accent': accent, 'name': name, 'title': title, 'street': street, 'city': city}
    if web:
        d['web'] = web
    d['exp'] = [list(r) for r in exp]
    d['edu'] = [list(r) for r in edu]
    if courses:
        d['courses'] = [list(r) for r in courses]
    d['skills'] = [list(s) for s in skills]
    d['langs'] = [list(s) for s in langs]
    if hobbies:
        d['hobbies'] = hobbies
    return d


def Q(q, a):
    return {'q': q, 'a': a}


def EN(slug, name, search, short, desc, intro, lookFor, letters, cv, do, dont, questions, faq, pay=None):
    d = {'slug': slug, 'name': name, 'search': search, 'short': short, 'desc': desc, 'intro': intro, 'lookFor': lookFor,
         'letters': letters, 'cv': cv, 'do': do, 'dont': dont, 'questions': questions}
    if pay:
        d['pay'] = pay
    d['faq'] = faq
    return d


def J(id, field, name, search, short, desc, intro, lookFor, letters, cv, do, dont, questions, faq, related, pay=None, en=None, popular=False):
    d = {'id': id, 'field': field}
    if popular:
        d['popular'] = True
    d.update({'name': name, 'search': search, 'short': short, 'desc': desc, 'intro': intro, 'lookFor': lookFor, 'letters': letters,
              'cv': cv, 'do': do, 'dont': dont, 'questions': questions})
    if pay:
        d['pay'] = pay
    d['faq'] = faq
    d['related'] = related
    if en:
        d['en'] = en
    probs = []
    if not 110 <= len(desc) <= 180:
        probs.append(f'desc {len(desc)}')
    if en and not 110 <= len(en['desc']) <= 180:
        probs.append(f'en desc {len(en["desc"])}')
    if not 2 <= len(letters) <= 3:
        probs.append('letters')
    for i, x in enumerate(letters):
        if i and 'from' not in x:
            probs.append(f'letter {i + 1} from')
    if len(related) != 4:
        probs.append('related != 4')
    if probs:
        print(f'!! {id}: {probs}')
    p = DATA / field / f'{id}.json'
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    WRITTEN.append(id)
    return d


# common bits
DE = ['Deutsch', 'native']

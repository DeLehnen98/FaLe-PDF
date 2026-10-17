"""ENEX fixtures for test_enex.py (fixtures/enex/): a notebook with formatting, checklist, table, image + PDF
attachment (matched by MD5), encrypted text, duplicate and awkward titles; a second notebook; no ENEX."""
import base64, hashlib, io, os
from PIL import Image
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'enex')
os.makedirs(OUT, exist_ok=True)

def png():
    b = io.BytesIO(); Image.new('RGB', (40, 20), (200, 30, 60)).save(b, 'PNG'); return b.getvalue()
PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
IMG = png()
def res(data, mime, name):
    b64 = base64.encodebytes(data).decode()
    return f'<resource><data encoding="base64">\n{b64}</data><mime>{mime}</mime><resource-attributes><file-name>{name}</file-name></resource-attributes></resource>', hashlib.md5(data).hexdigest()

r_img, h_img = res(IMG, 'image/png', 'rotes Rechteck.png')
r_pdf, h_pdf = res(PDF, 'application/pdf', 'Vertrag.pdf')
ENML1 = f'''<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><h1>Einkauf &amp; Planung</h1><div>Das ist <b>fett</b>, <i>kursiv</i> und <span style="text-decoration: line-through;">durch</span>.&nbsp;Ein <a href="https://fale.network/werkzeuge/">Link</a>.</div><div><en-todo checked="true"/>Milch kaufen</div><div><en-todo checked="false"/>Brot holen</div><ul><li>Punkt eins<ul><li>Unterpunkt</li></ul></li><li>Punkt zwei</li></ul><ol><li>Erstens</li><li>Zweitens</li></ol><table><tr><td>Artikel</td><td>Preis</td></tr><tr><td>Äpfel</td><td>2,49 €</td></tr></table><div><en-media type="image/png" hash="{h_img}"/></div><div><en-media type="application/pdf" hash="{h_pdf}"/></div><div><br/></div><div>Ende mit Sonderzeichen: 5 &lt; 6 &gt; 4 und *Sternchen*</div></en-note>'''
ENML2 = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>Geheim: <en-crypt hint="Hund" cipher="AES" length="128">AbCdEf==</en-crypt></div></en-note>'
ENML3 = '<?xml version="1.0" encoding="UTF-8"?><en-note>Nur Text ohne div.<br/>Zweite Zeile.<pre>code  block\n  eingerückt</pre></en-note>'
def note(title, enml, extra='', tags=(), created='20240115T083000Z'):
    t = ''.join(f'<tag>{x}</tag>' for x in tags)
    return f'<note><title>{title}</title><content><![CDATA[{enml}]]></content><created>{created}</created><updated>20250301T101500Z</updated>{t}<note-attributes><source-url>https://example.com/quelle</source-url></note-attributes>{extra}</note>'
enex1 = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export export-date="20260101T000000Z" application="Notes" version="10">'
    + note('Einkauf &amp; Planung', ENML1, r_img + r_pdf, tags=('Haushalt', 'Liste'))
    + note('Geheimes', ENML2)
    + note('Projekt/Ideen: 2026?', ENML3)
    + note('Projekt/Ideen: 2026?', ENML3)
    + note('', '<?xml version="1.0"?><en-note></en-note>')
    + '</en-export>\n')
open(os.path.join(OUT, 'Haushalt.enex'), 'w', encoding='utf-8').write(enex1)
r_photo, _ = res(png(), 'image/png', 'Strand.png')
r_extra, _ = res(b'Fahrplan', 'text/plain', 'Fahrplan.txt')
# some exporters write a wrong hash: the image must still be found (by order), unreferenced files are listed at the end
fotos = note('Fotos', '<en-note><div>Urlaub</div><en-media type="image/png" hash="00000000000000000000000000000000"/></en-note>', r_photo + r_extra)
enex2 = '<?xml version="1.0" encoding="UTF-8"?>\n<en-export>' + note('Reise', '<en-note><div>Packliste</div></en-note>') + fotos + '</en-export>\n'
open(os.path.join(OUT, 'Reise.enex'), 'w', encoding='utf-8').write(enex2)
open(os.path.join(OUT, 'falsch.enex'), 'w', encoding='utf-8').write('<?xml version="1.0"?><config/>')
open(os.path.join(OUT, 'hashes.txt'), 'w').write(f'{h_img}\n{h_pdf}\n')
print('enex fixtures written')

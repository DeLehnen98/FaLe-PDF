"""Test PDFs with XFA forms (as many authority forms are made) – own, minimal files, no third-party forms.

xfa_pure.pdf    dynamic XFA (NeedsRendering): only readers with an XFA engine show the form; others see
                the usual "Bitte warten … Adobe Reader" placeholder page
xfa_hybrid.pdf  static XFA + normal AcroForm fields with the same names (both are filled; readers that prefer
                the XFA part show the XFA data)
Run: python3 make_xfa_data.py  → tests/suites/xfadata/
"""
import os, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xfadata')
os.makedirs(OUT, exist_ok=True)

TEMPLATE = '''<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
 <subform name="antrag" layout="tb" locale="de_DE" restoreState="auto">
  <pageSet>
   <pageArea name="Seite1" id="Seite1">
    <contentArea x="15mm" y="15mm" w="180mm" h="267mm"/>
    <medium stock="a4" short="210mm" long="297mm"/>
   </pageArea>
  </pageSet>
  <subform name="kopf" w="180mm" layout="tb">
   <draw name="titel" w="180mm" h="12mm">
    <value><text>Antrag auf Testbescheinigung</text></value>
    <font typeface="Helvetica" size="16pt" weight="bold"/>
   </draw>
   <draw name="hinweis" w="180mm" h="10mm">
    <value><text>Bitte alle Pflichtfelder ausfüllen.</text></value>
    <font typeface="Helvetica" size="10pt"/>
   </draw>
  </subform>
  <subform name="person" w="180mm" layout="tb">
   <field name="Nachname" w="120mm" h="10mm">
    <ui><textEdit/></ui>
    <caption reserve="40mm"><value><text>Nachname</text></value></caption>
    <font typeface="Helvetica" size="11pt"/>
    <border><edge/></border>
   </field>
   <field name="Vorname" w="120mm" h="10mm">
    <ui><textEdit/></ui>
    <caption reserve="40mm"><value><text>Vorname</text></value></caption>
    <font typeface="Helvetica" size="11pt"/>
    <border><edge/></border>
   </field>
   <field name="Ort" w="120mm" h="10mm">
    <ui><textEdit/></ui>
    <caption reserve="40mm"><value><text>Wohnort</text></value></caption>
    <font typeface="Helvetica" size="11pt"/>
    <border><edge/></border>
   </field>
   <field name="Staat" w="120mm" h="10mm">
    <ui><choiceList open="onEntry"/></ui>
    <caption reserve="40mm"><value><text>Bundesland</text></value></caption>
    <items><text>Saarland</text><text>Rheinland-Pfalz</text><text>Bayern</text></items>
    <font typeface="Helvetica" size="11pt"/>
   </field>
   <field name="Einverstanden" w="120mm" h="10mm">
    <ui><checkButton shape="square" size="5mm"/></ui>
    <caption reserve="100mm" placement="right"><value><text>Ich bestätige die Angaben</text></value></caption>
    <items><integer>1</integer><integer>0</integer></items>
   </field>
  </subform>
 </subform>
</template>'''

XDP_START = '<?xml version="1.0" encoding="UTF-8"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">'
XDP_END = '</xdp:xdp>'

DATASETS = '''<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><antrag><person><Nachname>Muster</Nachname><Vorname/><Ort/><Staat/><Einverstanden>0</Einverstanden></person></antrag></xfa:data></xfa:datasets>'''


def build(path, objs, root=1):
    out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f'{i} 0 obj\n'.encode() + o + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for o in offs:
        out += f'{o:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root {root} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    open(path, 'wb').write(out)


def stream(data, compress=True):
    raw = data.encode('utf-8') if isinstance(data, str) else data
    if compress:
        z = zlib.compress(raw)
        return f'<< /Length {len(z)} /Filter /FlateDecode >>\nstream\n'.encode() + z + b'\nendstream'
    return f'<< /Length {len(raw)} >>\nstream\n'.encode() + raw + b'\nendstream'


def pure():
    placeholder = ('BT /F1 14 Tf 60 760 Td (Bitte warten ...) Tj 0 -24 Td /F1 10 Tf '
                   '(Wenn diese Nachricht nicht ersetzt wird, unterstuetzt Ihr PDF-Programm dieses Formular nicht.) Tj ET')
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R /NeedsRendering true >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Fields [] /XFA [(xdp:xdp) 9 0 R (template) 7 0 R (datasets) 8 0 R (</xdp:xdp>) 10 0 R] >>',
        stream(placeholder, False),
        stream(TEMPLATE),
        stream(DATASETS),
        stream(XDP_START),
        stream(XDP_END),
    ]
    build(os.path.join(OUT, 'xfa_pure.pdf'), objs)


def hybrid():
    # static XFA (no NeedsRendering) + AcroForm text fields with the XFA names; the AcroForm fields carry their own
    # appearance, the XFA datasets hold the same (old) values
    t = TEMPLATE.replace('layout="tb" locale', 'layout="position" locale')
    ds = DATASETS
    w = lambda name, y, val: (f'<< /Type /Annot /Subtype /Widget /FT /Tx /T (antrag[0].person[0].{name}[0]) /V ({val}) '
                             f'/Rect [170 {y} 450 {y + 22}] /P 3 0 R /F 4 /DA (/Helv 11 Tf 0 g) /MK << /BC [0 0 0] >> >>').encode()
    page = ('BT /F1 16 Tf 50 790 Td (Antrag auf Testbescheinigung) Tj ET '
            'BT /F1 11 Tf 50 736 Td (Nachname) Tj 0 -40 Td (Vorname) Tj 0 -40 Td (Wohnort) Tj ET')
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R /Annots [9 0 R 10 0 R 11 0 R] >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Fields [9 0 R 10 0 R 11 0 R] /XFA [(xdp:xdp) 12 0 R (template) 7 0 R (datasets) 8 0 R (</xdp:xdp>) 13 0 R] /DA (/Helv 11 Tf 0 g) /DR << /Font << /Helv 4 0 R >> >> /NeedAppearances true >>',
        stream(page, False),
        stream(t),
        stream(ds),
        w('Nachname', 730, 'Muster'),
        w('Vorname', 690, ''),
        w('Ort', 650, ''),
        stream(XDP_START),
        stream(XDP_END),
    ]
    build(os.path.join(OUT, 'xfa_hybrid.pdf'), objs)


if __name__ == '__main__':
    pure()
    hybrid()
    print('written:', sorted(os.listdir(OUT)))

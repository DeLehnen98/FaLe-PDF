"""Structural PDF/A level B checks (a local stand-in for veraPDF, which runs in CI: .github/workflows/pdfa.yml).
Covers the rules lib/pdfa-core.js implements: header, no encryption, file ID, XMP with pdfaid and values equal to the
document information, sRGB output intent (ICC v2 for PDF/A-1), embedded fonts, no uncalibrated CMYK, no LZW/JPX,
no JavaScript / forbidden actions / additional actions, annotation types, flags and appearances, embedded files
(only PDF/A-3, labelled), image Interpolate/Alternates/OPI, transfer functions, PDF/A-1: no transparency, no object
streams, CIDSet for CID font subsets, no optional content.

    from pdfa_check import check_pdfa
    problems = check_pdfa('out.pdf', part=2)      # [] when everything passed
"""
import re
import pikepdf

ANNOTS = {'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly',
          'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'Widget', 'PrinterMark', 'TrapNet', 'Watermark', 'Redact'}
ANNOTS_1 = {'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp',
            'Ink', 'Popup', 'Widget', 'PrinterMark', 'TrapNet'}
BAD_ACTIONS = {'Launch', 'Sound', 'Movie', 'ResetForm', 'ImportData', 'Hide', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView', 'JavaScript'}


def _name(v):
    return str(v)[1:] if isinstance(v, pikepdf.Name) else str(v) if v is not None else ''


def _text(v):
    try:
        return str(v)
    except Exception:
        return ''


def check_pdfa(path, part=2):
    p = []
    raw = open(path, 'rb').read()
    if not re.match(rb'%PDF-1\.\d\r?\n%[\x80-\xff]{4}', raw[:20]):
        p.append('header: %PDF-1.n followed by a binary comment')
    if part == 1 and (b'/ObjStm' in raw or re.search(rb'/Type\s*/XRef', raw)):
        p.append('PDF/A-1: object streams / cross-reference streams')
    pdf = pikepdf.open(path)
    tr = pdf.trailer
    if '/Encrypt' in tr:
        p.append('encrypted')
    if '/ID' not in tr or len(tr.ID) != 2:
        p.append('trailer ID missing')
    root = pdf.Root
    # ---- metadata
    md = root.get('/Metadata')
    xmp = ''
    if md is None:
        p.append('XMP metadata missing')
    else:
        if '/Filter' in md:
            p.append('metadata stream is filtered')
        xmp = md.read_bytes().decode('utf-8', 'replace')
        if f'<pdfaid:part>{part}</pdfaid:part>' not in xmp or '<pdfaid:conformance>B</pdfaid:conformance>' not in xmp:
            p.append('XMP: pdfaid part/conformance')
    info = pdf.docinfo
    for key, pat in (('/Title', r'<dc:title><rdf:Alt><rdf:li xml:lang="x-default">(.*?)</rdf:li>'), ('/Producer', r'<pdf:Producer>(.*?)</pdf:Producer>'),
                     ('/Author', r'<dc:creator><rdf:Seq><rdf:li>(.*?)</rdf:li>')):
        if key in info:
            m = re.search(pat, xmp, re.S)
            val = m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>') if m else None
            if val != _text(info[key]):
                p.append(f'Info {key} != XMP ({_text(info[key])!r} vs {val!r})')
    # ---- output intent
    ois = root.get('/OutputIntents')
    if not ois or not any(_name(o.get('/S')) == 'GTS_PDFA1' for o in ois):
        p.append('PDF/A output intent missing')
    else:
        o = [o for o in ois if _name(o.get('/S')) == 'GTS_PDFA1'][0]
        prof = o.get('/DestOutputProfile')
        if prof is None:
            p.append('output intent without profile')
        else:
            b = prof.read_bytes()
            if b[36:40] != b'acsp' or b[16:20] != b'RGB ' or int(prof.get('/N', 0)) != 3:
                p.append('output profile is not an RGB ICC profile')
            if part == 1 and b[8] > 2:
                p.append('PDF/A-1 needs an ICC profile of version 2')
    # ---- catalog
    if '/AA' in root:
        p.append('catalog AA')
    oa = root.get('/OpenAction')
    if isinstance(oa, pikepdf.Dictionary) and _name(oa.get('/S')) in BAD_ACTIONS:
        p.append('OpenAction ' + _name(oa.get('/S')))
    names = root.get('/Names')
    if names is not None and '/JavaScript' in names:
        p.append('JavaScript name tree')
    if names is not None and '/EmbeddedFiles' in names and part != 3:
        p.append('embedded files (only PDF/A-3)')
    if part == 1 and '/OCProperties' in root:
        p.append('PDF/A-1: optional content')
    if part == 3 and names is not None and '/EmbeddedFiles' in names:
        for _, fs in pdf.attachments.items():
            d = fs.obj
            if '/AFRelationship' not in d:
                p.append('PDF/A-3: attachment without AFRelationship')
            st = d.EF.F
            if '/Subtype' not in st:
                p.append('PDF/A-3: attachment without MIME type')
        if '/AF' not in root:
            p.append('PDF/A-3: catalog AF missing')
    acro = root.get('/AcroForm')
    if acro is not None and ('/XFA' in acro or bool(acro.get('/NeedAppearances', False))):
        p.append('form: XFA or NeedAppearances')
    # ---- every object
    seen_js = False
    for obj in pdf.objects:
        if isinstance(obj, pikepdf.Stream):
            d = obj.stream_dict
            f = d.get('/Filter')
            fl = [_name(x) for x in f] if isinstance(f, pikepdf.Array) else [_name(f)] if f is not None else []
            if 'LZWDecode' in fl:
                p.append('LZW filter')
            if 'JPXDecode' in fl:
                p.append('JPEG 2000 image')
            if _name(d.get('/Subtype')) == 'Image':
                if bool(d.get('/Interpolate', False)):
                    p.append('image Interpolate true')
                if '/Alternates' in d or '/OPI' in d:
                    p.append('image Alternates/OPI')
                if _name(d.get('/ColorSpace')) == 'DeviceCMYK':
                    p.append('DeviceCMYK image')
                if part == 1 and '/SMask' in d:
                    p.append('PDF/A-1: image soft mask')
            if _name(d.get('/Subtype')) == 'PS' or '/F' in d:
                p.append('PostScript XObject or external stream')
            continue
        if not isinstance(obj, pikepdf.Dictionary):
            continue
        s = _name(obj.get('/S'))
        if s == 'JavaScript' or '/JS' in obj:
            seen_js = True
        if _name(obj.get('/Type')) == 'ExtGState':
            if '/TR' in obj or '/HTO' in obj or ('/TR2' in obj and _name(obj.TR2) != 'Default'):
                p.append('transfer function / HTO')
            if part == 1 and ('/SMask' in obj and _name(obj.SMask) != 'None' or float(obj.get('/CA', 1)) < 1 or float(obj.get('/ca', 1)) < 1):
                p.append('PDF/A-1: transparency in ExtGState')
        t = _name(obj.get('/Type'))
        if t == 'Font' or _name(obj.get('/Subtype')) in ('Type1', 'TrueType', 'Type0', 'MMType1') and '/BaseFont' in obj:
            sub = _name(obj.get('/Subtype'))
            if sub in ('Type1', 'TrueType', 'MMType1'):
                fd = obj.get('/FontDescriptor')
                if fd is None or not any(k in fd for k in ('/FontFile', '/FontFile2', '/FontFile3')):
                    p.append(f'font not embedded: {_name(obj.get("/BaseFont"))}')
            elif sub == 'Type0':
                cid = obj.DescendantFonts[0]
                fd = cid.get('/FontDescriptor')
                if fd is None or not any(k in fd for k in ('/FontFile', '/FontFile2', '/FontFile3')):
                    p.append(f'CID font not embedded: {_name(obj.get("/BaseFont"))}')
                elif part == 1 and '+' in _name(fd.get('/FontName')) and '/CIDSet' not in fd:
                    p.append(f'PDF/A-1: CIDSet missing ({_name(fd.get("/FontName"))})')
    if seen_js:
        p.append('JavaScript action present')
    # ---- pages
    allowed = ANNOTS_1 if part == 1 else ANNOTS | ({'FileAttachment'} if part == 3 else set())
    for i, page in enumerate(pdf.pages):
        po = page.obj
        if '/AA' in po:
            p.append(f'page {i + 1}: AA')
        if part == 1:
            g = po.get('/Group')
            if g is not None and _name(g.get('/S')) == 'Transparency':
                p.append(f'page {i + 1}: transparency group (PDF/A-1)')
        for a in po.get('/Annots', []):
            st = _name(a.get('/Subtype'))
            if st not in allowed:
                p.append(f'page {i + 1}: annotation {st}')
            f = int(a.get('/F', 0))
            if st != 'Popup' and (not f & 4 or f & (1 | 2 | 32 | 256)):
                p.append(f'page {i + 1}: annotation flags {f} ({st})')
            if '/AA' in a:
                p.append(f'page {i + 1}: annotation AA')
            act = a.get('/A')
            if act is not None and _name(act.get('/S')) in BAD_ACTIONS:
                p.append(f'page {i + 1}: action {_name(act.get("/S"))}')
            if st not in ('Link', 'Popup'):
                ap = a.get('/AP')
                if ap is None or '/N' not in ap:
                    p.append(f'page {i + 1}: {st} without appearance')
        # uncalibrated CMYK in the page content
        try:
            for operands, op in pikepdf.parse_content_stream(page):
                o = str(op)
                if o in ('k', 'K'):
                    p.append(f'page {i + 1}: DeviceCMYK colour operator')
                    break
                if o in ('cs', 'CS') and operands and _name(operands[0]) == 'DeviceCMYK':
                    p.append(f'page {i + 1}: DeviceCMYK colour space')
                    break
        except Exception as e:  # noqa: BLE001
            p.append(f'page {i + 1}: content not parseable ({e})')
    return sorted(set(p))

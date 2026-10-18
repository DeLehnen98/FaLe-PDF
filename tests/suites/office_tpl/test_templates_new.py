"""New office templates: 17 document templates, 8 spreadsheet templates, 6 slide themes, 6 slide layouts and 4 ready-made decks.
Opens the galleries (#/vorlagen, #/vorlagen/dokument, #/vorlagen/tabelle), opens EVERY new template / theme / deck on a phone
(390x844, touch) and on desktop, checks content, timing (< 8 s, no freeze), console/page errors, saving into the library
(db.listDocs) and the exports (docx/xlsx/pptx start with PK, PDF with %PDF; python-docx/openpyxl/python-pptx open them).
Also: every theme x every new layout via the "Neue Folie" menu, theme switch recolours cards, contrast >= 4.5:1, old URLs,
English gallery. Server: APP_URL (default http://127.0.0.1:9421/, e.g. node tests/suites/sec/csp_server.mjs 9421 <root>).
  python3 tests/suites/office_tpl/test_templates_new.py [desktop|phone|en|all]"""
import os, sys, io, json, time, base64, subprocess, tempfile, traceback, zipfile
from playwright.sync_api import sync_playwright

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9421/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
os.makedirs(WORK, exist_ok=True)

NEW_DOCS = ['lebenslauf-kreativ', 'motivationsschreiben', 'reklamation', 'einladung-mitgliederversammlung', 'lieferschein', 'auftragsbestaetigung',
            'deckblatt-abschlussarbeit', 'praktikumsbericht', 'entschuldigung-schule', 'kaufvertrag-gebrauchtwagen', 'wohnungsgeberbestaetigung',
            'quittung', 'vollmacht', 'gutschein', 'glueckwunschkarte', 'packliste', 'aushang-hausmitteilung']
NEW_SHEETS = ['jahreskalender', 'wochenplaner', 'abo-vertraege', 'schuldenabbau', 'rechnung-tabelle', 'reisebudget', 'bewerbungstracker', 'geschenkeliste']
NEW_THEMES = ['mitternacht', 'salbei', 'terrakotta', 'kontrast', 'pflaume', 'ozean']
NEW_LAYOUTS = [('agenda', 'Agenda'), ('section', 'Abschnitt'), ('quote', 'Zitat'), ('kpi', 'Kennzahlen'), ('timeline', 'Zeitleiste'), ('compare', 'Vergleich')]
DECKS = ['projekt', 'referat', 'pitch', 'verein']
# documents whose printed page count is part of the design (cut-out sheets, fold card)
PAGES = {'gutschein': 1, 'quittung': 1, 'glueckwunschkarte': 2, 'lebenslauf-kreativ': 1, 'entschuldigung-schule': 1, 'wohnungsgeberbestaetigung': 1}
OPEN_LIMIT = 8.0

results, problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def attach(page, label):
    def on_console(m):
        if m.type in ('error', 'warning') and not any(x in m.text for x in ('favicon', 'Service Worker', 'SW-Registrierung', 'service worker')):
            problems.append(f'{label} [{m.type}] {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))


def poll(page, js, timeout=OPEN_LIMIT, arg=None):
    """Evaluate js (may return a promise) until it is truthy. Returns (value, seconds) or (None, seconds) on timeout."""
    t0 = time.monotonic()
    while True:
        try:
            v = page.evaluate(js, arg) if arg is not None else page.evaluate(js)
        except Exception:
            v = None
        if v:
            return v, time.monotonic() - t0
        if time.monotonic() - t0 > timeout:
            return None, time.monotonic() - t0
        time.sleep(0.1)


def goto(page, h):
    page.evaluate(f"location.hash = {json.dumps(h)}")


def leave(page):
    goto(page, '#/start')
    page.wait_for_timeout(300)
    dlg = page.locator('dialog[open]', has_text='Änderungen speichern?')
    if dlg.count():
        dlg.locator('button[value="discard"]').click()
        page.wait_for_timeout(300)
    page.locator('.menu-layer').evaluate_all('els => els.forEach(e => e.remove())')


def alive(page):
    """The page still answers quickly (no frozen main thread)."""
    t0 = time.monotonic()
    page.evaluate('1 + 1')
    return time.monotonic() - t0 < 2


def b64bytes(s):
    return base64.b64decode(s)


def pdf_pages(data):
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
        f.write(data)
        path = f.name
    try:
        out = subprocess.run(['pdfinfo', path], capture_output=True, text=True, timeout=60).stdout
        for line in out.splitlines():
            if line.startswith('Pages:'):
                return int(line.split()[1])
        return 0
    finally:
        os.unlink(path)


ENC = "const enc = async b => { const u = b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };"
DOC_EXPORT = "async () => { " + ENC + """ const api = document.querySelector('.writer')._writerApi;
  const docx = await api.serialize('docx'); const { modelToPdf } = await import('./js/office/docpdf.js');
  const pdf = await modelToPdf(api.model(), { title: 'Vorlage', page: api.page(), hf: api.hf() });
  return { docx: await enc(docx), pdf: await enc(pdf) }; }"""
SHEET_EXPORT = "async () => { " + ENC + """ const wb = document.querySelector('.sheet-app')._sheetApi.wb();
  const { writeXlsx } = await import('./js/office/xlsx-write.js'); const { workbookToPdf } = await import('./js/office/sheetpdf.js');
  return { xlsx: await enc(await writeXlsx(wb, { title: 'Vorlage' })), pdf: await enc(await workbookToPdf(wb, { title: 'Vorlage' })) }; }"""
SLIDES_EXPORT = "async () => { " + ENC + """ const pres = document.querySelector('.slides-app')._slidesApi.pres();
  const { presToPptx } = await import('./js/office/pptx-write.js'); const { presToPdf } = await import('./js/office/slide-render.js');
  return { pptx: await enc(await presToPptx(pres, { title: 'Vorlage' })), pdf: await enc(await presToPdf(pres, { title: 'Vorlage' })) }; }"""
# db.listDocs() lists PDFs only – office files are in db.listFiles() (the whole library)
LIST_DOCS = "() => import('./js/db.js').then(m => m.listFiles()).then(l => l.map(d => ({ id: d.id, name: d.name, kind: d.kind })))"


def save_and_find(page, kind, label):
    before = {d['id'] for d in page.evaluate(LIST_DOCS)}
    page.locator('[data-office-save]').first.click()
    got, _ = poll(page, f"() => import('./js/db.js').then(m => m.listFiles()).then(l => l.filter(d => !{json.dumps(sorted(before))}.includes(d.id) && d.kind === {json.dumps(kind)}).map(d => d.name))", 10)
    check(f'{label}: saved into the library', bool(got), got)
    clean, _ = poll(page, "() => !document.querySelector('[data-office-save]').disabled", 5)
    return got


# ---------------------------------------------------------------- unit checks in the page (models, contrast, pptx-safe elements)
UNIT_JS = """async () => {
  const T = await import('./js/office/templates.js'); const S = await import('./js/office/slides.js');
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond'];
  const out = { contrast: [], bad: [], counts: {} };
  for (const t of T.SLIDE_THEMES) {
    for (const [k, col] of [['title', t.title], ['text', t.text], ['strong', t.strong]]) for (const bg of [t.bg, t.panel]) { const c = cr(col, bg); if (c < 4.5) out.contrast.push(`${t.id} ${k} on ${bg}: ${c.toFixed(2)}`); }
    for (const l of T.SLIDE_LAYOUTS) {
      const s = S.makeSlide(l.id, t);
      out.counts[l.id] = s.els.filter(e => e.text).length;
      for (const e of s.els) {
        if (!['shape', 'image'].includes(e.type)) out.bad.push(`${t.id}/${l.id}: type ${e.type}`);
        if (e.type === 'shape' && !SHAPES.includes(e.geom)) out.bad.push(`${t.id}/${l.id}: geom ${e.geom}`);
        if (!(e.x >= -3 && e.y >= -3 && e.x + e.w <= 13.333 + 3 && e.y + e.h <= 7.5 + 3)) out.bad.push(`${t.id}/${l.id}: off-slide ${e.role}`);
        if (e.text) for (const p of e.text.paras) for (const r of p.runs) {
          if (typeof r.text !== 'string' || !r.size || !/^#[0-9A-F]{6}$/i.test(r.color)) out.bad.push(`${t.id}/${l.id}: run ${JSON.stringify(r)}`);
          // text placed on a card or on the background must stay readable
          const onPanel = s.els.some(x => x.role === 'panel' && e.x >= x.x && e.y >= x.y && e.x + e.w <= x.x + x.w + 0.01 && e.y + e.h <= x.y + x.h + 0.01);
          const c = cr(r.color, onPanel ? t.panel : t.bg);
          if (c < 4.5) out.contrast.push(`${t.id}/${l.id} ${e.role} ${c.toFixed(2)}`);
        }
      }
    }
  }
  out.layoutNames = T.SLIDE_LAYOUTS.map(l => l.name);
  out.decks = Object.fromEntries(T.SLIDE_DECKS.map(d => [d.id, { n: T.SLIDE_DECK_CONTENT[d.id].length, layouts: T.SLIDE_DECK_CONTENT[d.id].map(s => s.layout), theme: d.theme, title: d.title, first: T.SLIDE_DECK_CONTENT[d.id][0].title }]));
  out.themes = T.SLIDE_THEMES.map(t => ({ id: t.id, name: t.name, panel: t.panel }));
  const D = await import('./js/office/doc-templates.js');
  out.docs = D.DOC_TEMPLATE_LIST.map(t => ({ id: t.id, title: t.title, cat: t.cat, name: D.buildDocTemplate(t.id).name }));
  out.cats = D.DOC_TEMPLATE_CATS;
  const SH = await import('./js/office/sheet-templates.js');
  out.sheets = SH.SHEET_TEMPLATE_LIST.map(t => ({ id: t.id, title: t.title }));
  return out; }"""

INFO = {}


def unit(page):
    u = page.evaluate(UNIT_JS)
    INFO.update(u)
    check('slide themes: title/text/strong contrast >= 4.5:1 on background and cards', not u['contrast'], u['contrast'][:8])
    check('slide layouts: only shapes/images with pptx-supported geometry, sane positions and runs', not u['bad'], u['bad'][:8])
    for lid, name in NEW_LAYOUTS:
        check(f'layout {lid} has text placeholders', u['counts'].get(lid, 0) >= 2, u['counts'].get(lid))
        check(f'layout "{name}" is in the „Folie hinzufügen“ list', name in u['layoutNames'])
    check('4 ready-made decks', sorted(u['decks']) == sorted(DECKS), list(u['decks']))
    ids = [d['id'] for d in u['docs']]
    check('all new document templates are defined', all(x in ids for x in NEW_DOCS), [x for x in NEW_DOCS if x not in ids])
    check('new category has >= 3 templates', sum(1 for d in u['docs'] if d['cat'] == 'Verträge & Formulare') >= 3)
    check('every template category is listed', all(d['cat'] in u['cats'] for d in u['docs']))
    sids = [s['id'] for s in u['sheets']]
    check('all new spreadsheet templates are defined', all(x in sids for x in NEW_SHEETS), [x for x in NEW_SHEETS if x not in sids])
    themes = [t['id'] for t in u['themes']]
    check('all new themes are defined', all(x in themes for x in NEW_THEMES))
    brands = ['microsoft', 'word', 'excel', 'powerpoint', 'google', 'adobe', 'canva', 'apple', 'acrobat', 'keynote', 'numbers']
    txt = json.dumps([d['title'] for d in u['docs']] + [s['title'] for s in u['sheets']] + [t['name'] for t in u['themes']] + [d['title'] for d in u['decks'].values()]).lower()
    check('no brand names in template titles', not any(f'"{b}' in txt or f' {b} ' in txt for b in brands))


# ---------------------------------------------------------------- galleries
def galleries(page, label, phone=False):
    goto(page, '#/vorlagen')
    got, dt = poll(page, "() => document.querySelectorAll('#tpl-slides ~ .tpl-grid .tpl-card').length || document.querySelectorAll('.tpl-card').length")
    check(f'{label}: #/vorlagen opens ({dt:.1f}s)', got and dt < OPEN_LIMIT)
    hrefs = page.evaluate("[...document.querySelectorAll('.tpl-card')].map(a => a.getAttribute('href'))")
    for d in DECKS:
        check(f'{label}: gallery offers deck {d}', any(f'deck={d}' in h for h in hrefs))
    for t in NEW_THEMES:
        check(f'{label}: gallery offers theme {t}', f'#/neu/praesentation?design={t}' in hrefs)
    for d in NEW_DOCS:
        check(f'{label}: gallery offers document {d}', f'#/neu/dokument?vorlage={d}' in hrefs)
    for s in NEW_SHEETS:
        check(f'{label}: gallery offers spreadsheet {s}', f'#/neu/tabelle?vorlage={s}' in hrefs)
    if phone:
        check(f'{label}: gallery has no horizontal scroll', page.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    # documents
    goto(page, '#/vorlagen/dokument')
    n, dt = poll(page, "() => document.querySelectorAll('.dtp .stp-card').length")
    check(f'{label}: document gallery opens ({dt:.1f}s)', n and dt < OPEN_LIMIT)
    check(f'{label}: document gallery shows every template', n == len(INFO['docs']), (n, len(INFO['docs'])))
    filled = page.evaluate("ids => ids.filter(id => { const el = document.querySelector(`.stp-card[data-id=\"${id}\"] .dtp-page`); return el && el.textContent.trim().length > 20; })", NEW_DOCS)
    check(f'{label}: live previews of the new documents', len(filled) == len(NEW_DOCS), [x for x in NEW_DOCS if x not in filled])
    page.locator('.stp-cats [data-cat="Verträge & Formulare"]').click()
    page.wait_for_timeout(150)
    ids = [x.get_attribute('data-id') for x in page.locator('.stp-card:not([hidden])').all()]
    check(f'{label}: category „Verträge & Formulare“', set(ids) == {'leer', 'kaufvertrag-gebrauchtwagen', 'wohnungsgeberbestaetigung', 'quittung', 'vollmacht'}, ids)
    page.locator('.stp-cats [data-cat="Alle"]').click()
    page.locator('.stp-bar [data-q]').fill('gutschein')
    page.wait_for_timeout(150)
    ids = [x.get_attribute('data-id') for x in page.locator('.stp-card:not([hidden])').all()]
    check(f'{label}: search finds the Gutschein', 'gutschein' in ids, ids)
    page.locator('.stp-bar [data-q]').fill('')
    if phone:
        check(f'{label}: document gallery has no horizontal scroll', page.evaluate("document.scrollingElement.scrollWidth <= innerWidth + 1"))
    # spreadsheets: previews are built one after another – all must finish quickly
    goto(page, '#/vorlagen/tabelle')
    ok, dt = poll(page, "ids => ids.every(id => { const el = document.querySelector(`.stp-card[data-id=\"${id}\"] .stp-prev table`); return el && el.textContent.trim().length > 5; })", 20, NEW_SHEETS)
    check(f'{label}: spreadsheet gallery previews of all new templates ({dt:.1f}s)', ok and dt < 20)
    check(f'{label}: page responsive after the spreadsheet gallery', alive(page))


# ---------------------------------------------------------------- documents
def documents(page, label, exports=True, save=True):
    for tid in NEW_DOCS:
        leave(page)
        goto(page, f'#/neu/dokument?vorlage={tid}')
        n, dt = poll(page, "() => { const p = document.querySelector('.doc-page'); return p && p.textContent.trim().length > 80 ? p.textContent.trim().length : 0; }")
        check(f'{label}: document {tid} opens with content ({dt:.1f}s)', n and dt < OPEN_LIMIT, (n, dt))
        if not n:
            continue
        check(f'{label}: document {tid} responsive', alive(page))
        if exports:
            e = page.evaluate(DOC_EXPORT)
            docx, pdf = b64bytes(e['docx']), b64bytes(e['pdf'])
            check(f'{label}: {tid} DOCX starts with PK', docx[:2] == b'PK')
            check(f'{label}: {tid} PDF starts with %PDF', pdf[:4] == b'%PDF')
            try:
                import docx as pydocx
                d = pydocx.Document(io.BytesIO(docx))
                text = '\n'.join(p.text for p in d.paragraphs) + '\n'.join(c.text for t in d.tables for r in t.rows for c in r.cells)
                check(f'{label}: {tid} DOCX opens in python-docx with text', len(text.strip()) > 50)
            except Exception as ex:
                check(f'{label}: {tid} DOCX opens in python-docx', False, ex)
            if tid in PAGES:
                pc = pdf_pages(pdf)
                check(f'{label}: {tid} PDF has {PAGES[tid]} page(s)', pc == PAGES[tid], pc)
            open(os.path.join(WORK, f'{tid}.docx'), 'wb').write(docx)
            open(os.path.join(WORK, f'{tid}.pdf'), 'wb').write(pdf)
        if save:
            save_and_find(page, 'docx', f'{label}: document {tid}')
    leave(page)


# ---------------------------------------------------------------- spreadsheets
KEY_CELLS = {'jahreskalender': ('A1', 'Jahreskalender'), 'wochenplaner': ('C3', 'KW '), 'abo-vertraege': ('S14', '10'), 'schuldenabbau': ('F13', '26'),
             'rechnung-tabelle': ('G33', '733,61'), 'reisebudget': ('B7', '3'), 'bewerbungstracker': ('N15', '6'), 'geschenkeliste': ('C18', '275,00')}


def sheets(page, label, exports=True, save=True):
    for tid in NEW_SHEETS:
        leave(page)
        goto(page, f'#/neu/tabelle?vorlage={tid}')
        ok, dt = poll(page, "() => { const a = document.querySelector('.sheet-app'); return a && a._sheetApi && document.querySelectorAll('.sheet-app .c').length > 10; }")
        check(f'{label}: spreadsheet {tid} opens ({dt:.1f}s)', ok and dt < OPEN_LIMIT, dt)
        if not ok:
            continue
        cell, want = KEY_CELLS[tid]
        got = page.evaluate(f"() => document.querySelector('.sheet-app')._sheetApi.text({json.dumps(cell)})")
        check(f'{label}: {tid} {cell} shows {want!r}', want in str(got), got)
        errs = page.evaluate("() => { const wb = document.querySelector('.sheet-app')._sheetApi.wb(); let n = 0; for (const sh of wb.sheets) for (const c of sh.cells.values()) { const v = c.f ? c.cv : c.v; if (v && v.code) n++; } return n; }")
        check(f'{label}: {tid} has no formula errors', errs == 0, errs)
        check(f'{label}: spreadsheet {tid} responsive', alive(page))
        if exports:
            e = page.evaluate(SHEET_EXPORT)
            xlsx, pdf = b64bytes(e['xlsx']), b64bytes(e['pdf'])
            check(f'{label}: {tid} XLSX starts with PK', xlsx[:2] == b'PK')
            check(f'{label}: {tid} PDF starts with %PDF', pdf[:4] == b'%PDF')
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(xlsx))
                nf = sum(1 for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith('='))
                check(f'{label}: {tid} XLSX opens in openpyxl with formulas', nf > 0, nf)
            except Exception as ex:
                check(f'{label}: {tid} XLSX opens in openpyxl', False, ex)
            open(os.path.join(WORK, f'{tid}.xlsx'), 'wb').write(xlsx)
        if save:
            save_and_find(page, 'xlsx', f'{label}: spreadsheet {tid}')
    leave(page)


# ---------------------------------------------------------------- presentations
def open_pres(page, h, label):
    leave(page)
    goto(page, h)
    n, dt = poll(page, "() => { const a = document.querySelector('.slides-app'); return a && a._slidesApi && document.querySelector('.slide-stage .slide') ? a._slidesApi.pres().slides.length : 0; }")
    check(f'{label} opens ({dt:.1f}s)', n and dt < OPEN_LIMIT, dt)
    return n


def add_layout(page, name, phone):
    btn = page.locator('.strip-add') if phone else page.locator('.office-toolbar [data-a="add"]')
    btn.first.click()
    item = page.locator('.menu-layer .menu-item', has_text=name).first
    item.wait_for(timeout=3000)
    item.click()
    page.wait_for_timeout(120)


def check_pptx(data, label, n_slides, texts=()):
    check(f'{label}: PPTX starts with PK', data[:2] == b'PK')
    try:
        from pptx import Presentation
        pr = Presentation(io.BytesIO(data))
        check(f'{label}: PPTX opens in python-pptx with {n_slides} slides', len(pr.slides) == n_slides, len(pr.slides))
        alltext = ' '.join(sh.text_frame.text for s in pr.slides for sh in s.shapes if sh.has_text_frame)
        for t in texts:
            check(f'{label}: PPTX contains “{t}”', t in alltext)
    except Exception as ex:
        check(f'{label}: PPTX opens in python-pptx', False, ex)


def presentations(page, label, phone=False, exports=True, save=True):
    names = dict(NEW_LAYOUTS)
    themes = [t['id'] for t in INFO['themes']] if not phone else NEW_THEMES
    for tid in themes:
        n = open_pres(page, f'#/neu/praesentation?design={tid}', f'{label}: theme {tid}')
        if not n:
            continue
        check(f'{label}: theme {tid} applied', page.evaluate("() => document.querySelector('.slides-app')._slidesApi.pres().theme") == tid)
        for lid, name in NEW_LAYOUTS:
            add_layout(page, name, phone)
        info = page.evaluate("() => { const p = document.querySelector('.slides-app')._slidesApi.pres(); return { n: p.slides.length, layouts: p.slides.map(s => s.layout), texts: p.slides.map(s => s.els.filter(e => e.text).length), stage: document.querySelectorAll('.slide-stage .slide .el').length }; }")
        # each new slide is inserted after the current one: title, 6 new layouts, then the original content slide
        check(f'{label}: theme {tid}: all 6 new layouts added via the menu', info['layouts'][1:7] == [l for l, _ in NEW_LAYOUTS], info['layouts'])
        check(f'{label}: theme {tid}: new slides have text placeholders and render', all(x >= 2 for x in info['texts'][1:7]) and info['stage'] > 2, info)
        check(f'{label}: theme {tid} responsive', alive(page))
        if exports:
            e = page.evaluate(SLIDES_EXPORT)
            check_pptx(b64bytes(e['pptx']), f'{label}: theme {tid}', n + 6, ('Agenda', 'Zeitleiste', 'Vergleich'))
            pdf = b64bytes(e['pdf'])
            check(f'{label}: theme {tid} PDF starts with %PDF and has every slide', pdf[:4] == b'%PDF' and pdf_pages(pdf) == n + 6)
        if save:
            save_and_find(page, 'pptx', f'{label}: theme {tid}')
    # theme switch recolours cards and markers of the new layouts
    if open_pres(page, '#/neu/praesentation?design=papier', f'{label}: theme switch base'):
        add_layout(page, 'Kennzahlen', phone)
        page.locator('.office-toolbar [data-a="theme"]').first.click() if not phone else page.evaluate("() => document.querySelector('.office-toolbar [data-a=\"theme\"]').click()")
        page.locator('dialog[open] [data-theme="pflaume"]').click()
        page.wait_for_timeout(250)
        r = page.evaluate("() => { const p = document.querySelector('.slides-app')._slidesApi.pres(); const s = p.slides.find(x => x.layout === 'kpi'); return { theme: p.theme, panels: s.els.filter(e => e.role === 'panel').map(e => e.fill), bg: s.bg.color, nums: s.els.filter(e => e.role === 'num').map(e => e.text.paras[0].runs[0].color) }; }")
        th = next(t for t in INFO['themes'] if t['id'] == 'pflaume')
        check(f'{label}: theme switch recolours cards, numbers and background', r['theme'] == 'pflaume' and r['panels'] and all(x == th['panel'] for x in r['panels']) and r['bg'] == '#2A1636' and all(x == '#FF9EB0' for x in r['nums']), r)
    # ready-made decks
    for d in DECKS:
        deck = INFO['decks'][d]
        n = open_pres(page, f"#/neu/praesentation?design={deck['theme']}&deck={d}", f'{label}: deck {d}')
        if not n:
            continue
        info = page.evaluate("() => { const p = document.querySelector('.slides-app')._slidesApi.pres(); return { n: p.slides.length, theme: p.theme, layouts: p.slides.map(s => s.layout), first: p.slides[0].els.filter(e => e.role === 'title').map(e => e.text.paras.map(q => q.runs.map(r => r.text).join('')).join(' '))[0], notes: p.slides.filter(s => s.notes).length }; }")
        check(f'{label}: deck {d} has all its slides in order', info['n'] == deck['n'] and info['layouts'] == deck['layouts'], info)
        check(f'{label}: deck {d} title slide text', info['first'] == deck['first'], info['first'])
        check(f'{label}: deck {d} theme', info['theme'] == deck['theme'])
        check(f'{label}: deck {d} file name', deck['title'].split(' /')[0].split('/')[0].strip() in page.locator('#tool-screen .screen-head').inner_text(), page.locator('#tool-screen .screen-head').inner_text())
        if exports:
            e = page.evaluate(SLIDES_EXPORT)
            check_pptx(b64bytes(e['pptx']), f'{label}: deck {d}', deck['n'], (deck['first'],))
            pdf = b64bytes(e['pdf'])
            check(f'{label}: deck {d} PDF has every slide', pdf[:4] == b'%PDF' and pdf_pages(pdf) == deck['n'])
            open(os.path.join(WORK, f'deck_{d}.pptx'), 'wb').write(b64bytes(e['pptx']))
        if save:
            got = save_and_find(page, 'pptx', f'{label}: deck {d}')
            check(f'{label}: deck {d} saved under the deck name', bool(got) and any(x.endswith('.pptx') and x.split('.')[0].split()[0] in deck['title'] for x in got), got)
    # a deck in another theme and the old URLs keep working
    n = open_pres(page, '#/neu/praesentation?design=kontrast&deck=pitch', f'{label}: deck in another theme')
    if n:
        check(f'{label}: deck keeps the chosen theme', page.evaluate("() => document.querySelector('.slides-app')._slidesApi.pres().theme") == 'kontrast')
    for h, theme in (('#/neu/praesentation?design=wald', 'wald'), ('#/neu/praesentation', 'indigo'), ('#/neu/praesentation?design=indigo&deck=gibtsnicht', 'indigo')):
        n = open_pres(page, h, f'{label}: old URL {h}')
        check(f'{label}: {h} → title + content slide in {theme}', n == 2 and page.evaluate("() => document.querySelector('.slides-app')._slidesApi.pres().theme") == theme, n)
    leave(page)


# ---------------------------------------------------------------- English
def english(p):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 860}, service_workers='block', locale='en-US')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    attach(page, 'en')
    page.goto(URL)
    page.wait_for_timeout(1200)
    goto(page, '#/vorlagen')
    poll(page, "() => document.querySelectorAll('.tpl-card').length > 20")
    page.wait_for_timeout(500)
    titles = page.evaluate("[...document.querySelectorAll('.tpl-card .tpl-txt strong')].map(x => x.textContent.trim())")
    for t in ('Project presentation', 'Business idea / pitch', 'Club annual report', 'Talk / school presentation', 'Design “Midnight”', 'Design “Ocean”', 'CV – Creative', 'Used car purchase contract (private)', 'Year calendar', 'Debt payoff (snowball / avalanche)', 'Gift list'):
        check(f'en: gallery title “{t}”', t in titles, [x for x in titles if x[:4] == t[:4]][:4])
    descs = page.evaluate("[...document.querySelectorAll('.tpl-card .tpl-txt span')].map(x => x.textContent.trim())")
    check('en: gallery descriptions translated', 'Goals, schedule, key figures and next steps' in descs and not any('Kündigungsfrist' in x for x in descs))
    goto(page, '#/vorlagen/dokument')
    poll(page, "() => document.querySelectorAll('.dtp .stp-card').length > 20")
    page.wait_for_timeout(400)
    chips = page.evaluate("[...document.querySelectorAll('.stp-cats [data-cat]')].map(x => x.textContent.trim())")
    check('en: document category “Contracts & forms”', 'Contracts & forms' in chips, chips)
    titles = page.evaluate("[...document.querySelectorAll('.dtp .stp-card .tpl-txt strong')].map(x => x.textContent.trim())")
    check('en: document gallery titles', all(t in titles for t in ('Greeting card (folded)', 'Delivery note', 'School absence note', 'Packing list')), titles[-20:])
    goto(page, '#/vorlagen/tabelle')
    poll(page, "() => document.querySelectorAll('.stp-card').length > 20")
    page.wait_for_timeout(400)
    titles = page.evaluate("[...document.querySelectorAll('.stp-card .tpl-txt strong')].map(x => x.textContent.trim())")
    check('en: spreadsheet gallery titles', all(t in titles for t in ('Weekly planner', 'Subscription & contract tracker', 'Job application tracker', 'Travel budget', 'Invoice (spreadsheet)')), titles[-10:])
    goto(page, '#/neu/praesentation?design=salbei')
    poll(page, "() => document.querySelector('.slide-stage .slide')")
    page.locator('.office-toolbar [data-a="add"]').first.click()
    page.wait_for_timeout(300)
    items = page.evaluate("[...document.querySelectorAll('.menu-layer .menu-item')].map(x => x.textContent.trim())")
    check('en: “new slide” menu lists the new layouts', all(x in items for x in ('Agenda', 'Section', 'Quote', 'Key figures', 'Timeline', 'Comparison')), items)
    page.keyboard.press('Escape')
    page.locator('.office-toolbar [data-a="theme"]').first.click()
    page.wait_for_timeout(300)
    names = page.evaluate("[...document.querySelectorAll('dialog[open] [data-theme] strong')].map(x => x.textContent.trim())")
    check('en: theme names translated', all(x in names for x in ('Midnight', 'Sage', 'Terracotta', 'Contrast', 'Plum', 'Ocean')), names)
    b.close()


# ---------------------------------------------------------------- runs
def run(p, phone):
    label = 'phone' if phone else 'desktop'
    b = p.chromium.launch()
    if phone:
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, service_workers='block', locale='de-DE')
    else:
        ctx = b.new_context(viewport={'width': 1366, 'height': 860}, service_workers='block', locale='de-DE')
    ctx.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
    page = ctx.new_page()
    page.set_default_timeout(15000)
    attach(page, label)
    page.goto(URL)
    page.wait_for_timeout(1200)
    if not INFO:
        step('unit checks', lambda: unit(page))
    step(f'{label} galleries', lambda: galleries(page, label, phone))
    step(f'{label} documents', lambda: documents(page, label, exports=not phone))
    step(f'{label} spreadsheets', lambda: sheets(page, label, exports=not phone))
    step(f'{label} presentations', lambda: presentations(page, label, phone, exports=not phone))
    if not phone:
        page.screenshot(path=os.path.join(WORK, 'desktop_last.png'))
    b.close()


t_start = time.monotonic()
with sync_playwright() as p:
    if ONLY in ('all', 'desktop'):
        run(p, False)
    if ONLY in ('all', 'phone'):
        run(p, True)
    if ONLY in ('all', 'en'):
        step('english', lambda: english(p))

check('no console errors or page errors', not problems, problems[:10])
passed = sum(1 for r in results if r[1])
print(f'\n==== {passed}/{len(results)} passed · {len(problems)} console problems · {time.monotonic() - t_start:.0f}s ====')
for r in results:
    if not r[1]:
        print('  FAILED:', r[0], '|', str(r[2])[:300])
sys.exit(0 if passed == len(results) else 1)

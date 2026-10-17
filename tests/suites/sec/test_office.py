"""End-to-end tests for the FaLe office features (desktop 1366x860 + phone 390x844, light + dark).
Server: python3 -m http.server 8793 --bind 127.0.0.1 (in /home/claude/FalePDF)."""
import os, sys, io, json, base64, subprocess, traceback, shutil, datetime
import csp_compat  # noqa: F401 – CSP-safe wait_for_function
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SP, 'officedata')
OUT = os.path.join(SP, 'out_office')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('OFFICE_URL', 'http://127.0.0.1:9403/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'

results, console_problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def attach_logging(page, label):
    page.on('console', lambda m: console_problems.append(f'{label} [{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))


FILES_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, kind: d.kind || 'pdf', size: d.size, textReady: d.textReady, pages: d.pages, thumb: !!d.thumb}))); });
  db.close(); return res; }"""

BLOB_JS = """async (id) => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const rec = await new Promise(r => { const t = db.transaction('files'); const g = t.objectStore('files').get(id); g.onsuccess = () => r(g.result); });
  db.close(); if (!rec) return null;
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(rec.blob); }); }"""


def files(page):
    return page.evaluate(FILES_JS)


def by_name(page, name):
    for d in files(page):
        if d['name'] == name:
            return d
    return None


def blob_bytes(page, doc_id):
    b64 = page.evaluate(BLOB_JS, doc_id)
    return base64.b64decode(b64) if b64 else None


def save_blob(page, doc_id, name):
    data = blob_bytes(page, doc_id)
    path = os.path.join(OUT, name)
    with open(path, 'wb') as f:
        f.write(data)
    return path


def pdf_text(path):
    from pypdf import PdfReader
    r = PdfReader(path)
    txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    ok = subprocess.run(['pdfinfo', path], capture_output=True, text=True).returncode == 0
    return len(r.pages), txt, ok


def goto_hash(page, h, wait=500):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(wait)


def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(OUT, f'{name}.png'))


def set_theme(page, t):
    page.evaluate("t => { if (t === 'auto') { localStorage.removeItem('fale-theme'); delete document.documentElement.dataset.theme; } else { localStorage.setItem('fale-theme', t); document.documentElement.dataset.theme = t; } }", t)
    page.wait_for_timeout(150)


def back(page):
    page.locator('#tool-screen .screen-head [data-back]').click()
    page.wait_for_timeout(500)


def handle_leave(page, choice='discard'):
    dlg = page.locator('dialog', has_text='Änderungen speichern?')
    if dlg.count():
        dlg.locator(f'button[value="{choice}"]').click()
        page.wait_for_timeout(400)


def wait_saved(page, timeout=20000):
    page.wait_for_function("document.querySelector('#tool-screen .screen-head .sub') && /Gespeichert/.test(document.querySelector('#tool-screen .screen-head .sub').textContent)", timeout=timeout)


def import_all(page, names):
    with page.expect_file_chooser() as fc:
        page.locator('#view-start .hero [data-action="open-file"]').click()
    fc.value.set_files([os.path.join(TD, n) for n in names])


def export_pdf_via_menu(page, out_name):
    page.locator('[data-office-more]').click()
    page.locator('.menu-item', has_text='Als PDF exportieren').click()
    page.wait_for_selector('dialog .result-mini', timeout=40000)
    with page.expect_download(timeout=20000) as d:
        page.locator('dialog button[value="dl"]').click()
    p = os.path.join(OUT, out_name)
    d.value.save_as(p)
    page.wait_for_timeout(300)
    return p


def sheet_cell(page, addr):
    loc = page.locator(f'.sh-body [data-cell="{addr}"], .sh-frozen [data-cell="{addr}"]')
    return loc.first.inner_text() if loc.count() else ''


def sheet_select(page, addr):
    page.locator('#sh-addr').fill(addr)
    page.locator('#sh-addr').press('Enter')
    page.wait_for_timeout(120)


def sheet_type(page, addr, text):
    sheet_select(page, addr)
    page.keyboard.type(text)
    page.keyboard.press('Enter')
    page.wait_for_timeout(150)


# =====================================================================
def desktop(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True, locale='de-DE')
    page = ctx.new_page()
    attach_logging(page, 'desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')

    def nav():
        check('sidebar: Start/Dateien/Werkzeuge/Suche/Ich', page.locator('.sidebar .nav-link').count() == 5 and 'Ich' in page.locator('.sidebar').inner_text())
        check('sidebar Neu button', page.locator('.sidebar [data-action="new-menu"]').is_visible())
        check('create row has 5 entries', page.locator('.create-row .create-btn').count() == 5)
        check('free card visible', page.locator('[data-free]').is_visible())
        check('tabs Zuletzt/Markiert/Auf diesem Gerät', page.locator('#view-start [data-tab]').count() == 3 and 'Auf diesem Gerät' in page.locator('#view-start .tabs').inner_text())
        check('tool tiles (horizontal)', page.locator('.tiles .tile').count() >= 8)
        shot(page, 'desktop_home_empty_light')
        page.locator('.sidebar [data-action="new-menu"]').click()
        check('Neu menu items', page.locator('.menu-item').count() >= 7 and page.locator('.menu-item', has_text='Neue Tabelle').count() == 1)
        page.keyboard.press('Escape')
        page.locator('[data-free-close]').click()
        check('free card dismissed', page.locator('[data-free]').is_hidden())
    step('navigation', nav)

    def imp():
        import_all(page, ['bericht.docx', 'umsatz.xlsx', 'praesentation.pptx', 'liste.csv', 'notiz.txt', 'readme.md', 'bild.png', 'tabelle.pdf'])
        page.wait_for_function("document.querySelectorAll('#view-start .doc').length >= 8", timeout=30000)
        page.wait_for_function(f"({FILES_JS})().then(d => d.length >= 8 && d.every(x => x.textReady))", timeout=40000)
        fs = files(page)
        kinds = sorted(d['kind'] for d in fs)
        check('8 files imported with kinds', kinds == sorted(['docx', 'xlsx', 'pptx', 'csv', 'txt', 'md', 'image', 'pdf']), str(kinds))
        check('thumbnails for pptx/image/docx/xlsx', all(d['thumb'] for d in fs if d['kind'] in ('pptx', 'image', 'docx', 'xlsx', 'pdf')), str([(d['kind'], d['thumb']) for d in fs]))
        pp = [d for d in fs if d['kind'] == 'pptx'][0]
        check('pptx slide count stored', pp['pages'] == 3, str(pp['pages']))
        page.wait_for_timeout(800)
        meta = page.locator('#view-start .doc', has_text='umsatz.xlsx').locator('.doc-meta').inner_text()
        check('xlsx meta shows sheets', '2 Blätter' in meta, meta)
        shot(page, 'desktop_home_light')
        # unsupported file
        with page.expect_file_chooser() as fc:
            page.locator('#view-start .hero [data-action="open-file"]').click()
        legacy = os.path.join(OUT, 'alt.doc')
        open(legacy, 'wb').write(b'\xd0\xcf\x11\xe0' + b'0' * 100)
        fc.value.set_files([legacy])
        page.locator('.toast', has_text='älteres Office-Format').first.wait_for(timeout=5000)
        check('legacy .doc rejected with German message', True)
    step('import all kinds', imp)

    def files_view():
        goto_hash(page, '#/dateien')
        page.wait_for_selector('#view-dateien .chip')
        check('chips present', page.locator('#view-dateien .chip').count() == 6)
        page.locator('#view-dateien .chip[data-cat="sheet"]').click()
        page.wait_for_timeout(300)
        check('filter Tabellen → 2', page.locator('#view-dateien [data-files] .doc').count() == 2)
        page.locator('#view-dateien .chip[data-cat="slides"]').click()
        page.wait_for_timeout(300)
        check('filter Präsentationen → 1', page.locator('#view-dateien [data-files] .doc').count() == 1)
        page.locator('#view-dateien .chip[data-cat="all"]').click()
        page.locator('#files-search').fill('bericht')
        page.wait_for_timeout(500)
        check('name filter', page.locator('#view-dateien [data-files] .doc').count() == 1)
        page.locator('#files-search').fill('')
        page.wait_for_timeout(400)
        page.locator('#files-sort').select_option('name')
        page.wait_for_timeout(300)
        first = page.locator('#view-dateien [data-files] .doc .doc-name').first.inner_text()
        check('sort by name', first.lower().startswith('b'), first)
        check('cloud explanation', 'Google Drive' in page.locator('.cloud-card').inner_text())
        check('storage card', 'belegt' in page.locator('#view-dateien [data-storage]').inner_text())
        shot(page, 'desktop_files_light')
        # rename via menu keeps extension
        page.locator('#view-dateien .doc', has_text='notiz.txt').locator('.more-btn').click()
        page.locator('.menu-item', has_text='Umbenennen').click()
        page.locator('dialog .input').fill('Einkauf')
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(500)
        check('rename keeps .txt', by_name(page, 'Einkauf.txt') is not None)
    step('files view', files_view)

    def tools_view():
        goto_hash(page, '#/werkzeuge')
        page.wait_for_selector('.tool-section')
        secs = page.locator('#view-werkzeuge .tool-section .section-title').all_inner_texts()
        check('tool sections incl. Office + Konvertieren', 'Office' in secs and any('Konvertieren' in s for s in secs), str(secs))
        check('office cards', page.locator('.office-grid .tool-card').count() == 4)
        for tid in ['pdf-excel', 'word-pdf', 'excel-pdf', 'ppt-pdf', 'text-pdf']:
            check(f'tool card {tid}', page.locator(f'.tool-card[data-tool="{tid}"]').count() == 1)
        shot(page, 'desktop_tools_light')
        page.locator('#tool-search').fill('excel')
        page.wait_for_timeout(400)
        vis = page.locator('#view-werkzeuge .tool-card:visible').count()
        check('tool search filters', 1 <= vis <= 4, str(vis))
        page.locator('#tool-search').fill('')
        page.wait_for_timeout(300)
    step('tools view', tools_view)

    def search():
        goto_hash(page, '#/suche?q=Seepferdchen', 900)
        page.wait_for_selector('.result-group', timeout=8000)
        txt = page.locator('.search-results').inner_text()
        check('global search finds docx + pptx', 'bericht.docx' in txt and 'praesentation.pptx' in txt, txt[:200])
        page.locator('#global-search').fill('Birnen')
        page.wait_for_timeout(700)
        txt = page.locator('.search-results').inner_text()
        check('search finds xlsx cells', 'umsatz.xlsx' in txt and 'Blatt' in txt, txt[:200])
        page.locator('#global-search').fill('Seepferdchen')
        page.wait_for_timeout(700)
        page.locator('.result-group', has_text='bericht.docx').locator('.result-hit').first.click()
        page.wait_for_selector('.doc-page', timeout=15000)
        page.wait_for_timeout(500)
        check('search opens writer with find bar', page.locator('.w-find').is_visible() and '1 von' in page.locator('[data-fcount]').inner_text(), page.locator('[data-fcount]').inner_text())
        back(page)
    step('global search', search)

    ids = {d['name']: d['id'] for d in files(page)}

    # ---------------- Writer ----------------
    def writer():
        goto_hash(page, f"#/bearbeiten/{ids['bericht.docx']}", 300)
        page.wait_for_selector('.doc-page h1', timeout=15000)
        ed = page.locator('.doc-page')
        check('docx heading', ed.locator('h1').first.inner_text() == 'Projektbericht Zitronenfalter')
        check('docx bold/italic/colour runs', ed.locator('strong', has_text='fetter').count() == 1 and ed.locator('em', has_text='kursiver').count() == 1 and 'color' in (ed.locator('span', has_text='roter Farbe').first.get_attribute('style') or ''))
        check('docx centered paragraph', 'center' in (ed.locator('p', has_text='Zentrierter Absatz').get_attribute('style') or ''))
        check('docx bullet list', ed.locator('ul li').count() == 3)
        check('docx numbered list', ed.locator('ol li').count() == 2)
        check('docx table 3x3', ed.locator('table tr').count() == 3 and ed.locator('table td').count() == 9)
        check('docx image', ed.locator('img').count() == 1)
        check('docx page break', ed.locator('hr[data-page-break]').count() == 1)
        check('word count shown', 'Wörter' in page.locator('[data-wordcount]').inner_text())
        shot(page, 'desktop_writer_light')
        # type a new paragraph at the end
        ed.click()
        page.keyboard.press('Control+End')
        page.keyboard.press('Enter')
        page.keyboard.type('Neuer Absatz von FaLe mit Umlauten äöüß und 5 €.')
        # bold the word "Absatz"
        page.evaluate("""() => { const ed = document.querySelector('.doc-page'); const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) { const i = n.nodeValue.indexOf('Absatz von'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 6); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; } } }""")
        page.locator('.office-toolbar [data-cmd="bold"]').click()
        check('subtitle shows unsaved', 'Nicht gespeichert' in page.locator('#tool-screen .screen-head .sub').inner_text())
        # heading via block select
        ed.locator('p', has_text='Zweite Seite mit dem Wort').click()
        page.locator('[data-block]').select_option('h2')
        page.wait_for_timeout(200)
        check('block format → h2', ed.locator('h2', has_text='Zweite Seite').count() == 1)
        # find & replace
        page.keyboard.press('Control+f')
        page.locator('[data-fq]').fill('Zitronenfalter')
        page.wait_for_timeout(300)
        check('find count', '1 von 1' in page.locator('[data-fcount]').inner_text(), page.locator('[data-fcount]').inner_text())
        page.locator('[data-fr]').fill('Schmetterling')
        page.locator('[data-freall]').click()
        page.wait_for_timeout(300)
        check('replace all', 'Schmetterling' in ed.locator('h1').inner_text())
        page.locator('[data-fclose]').click()
        # insert table
        ed.locator('h1').click()
        page.keyboard.press('End')
        page.locator('.office-toolbar [data-table]').click()
        page.locator('dialog [name=rows]').fill('2')
        page.locator('dialog [name=cols]').fill('2')
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(300)
        check('table inserted', ed.locator('table').count() == 2)
        shot(page, 'desktop_writer_edit_light')
        page.locator('[data-office-save]').click()
        wait_saved(page)
        path = save_blob(page, ids['bericht.docx'], 'bericht_saved.docx')
        from docx import Document
        d = Document(path)
        paras = [p.text for p in d.paragraphs]
        styles = [p.style.name for p in d.paragraphs]
        check('saved docx re-opens (python-docx)', len(paras) > 5)
        check('saved docx has replaced heading', any('Projektbericht Schmetterling' == t for t in paras), str(paras[:3]))
        check('saved docx heading style', any(s.startswith('Heading 1') or s == 'Heading1' for s in styles), str(set(styles)))
        check('saved docx new paragraph', any('Neuer Absatz von FaLe mit Umlauten äöüß und 5 €.' in t for t in paras))
        bold_runs = [r.text for p in d.paragraphs for r in p.runs if r.bold]
        check('saved docx bold runs', 'fetter' in bold_runs and 'Absatz' in bold_runs, str(bold_runs))
        red = [r.text for p in d.paragraphs for r in p.runs if r.font.color is not None and r.font.color.rgb is not None and str(r.font.color.rgb) == 'C01010']
        check('saved docx keeps colour', 'roter Farbe' in red, str(red))
        num = [p.text for p in d.paragraphs if p._p.pPr is not None and p._p.pPr.numPr is not None]
        check('saved docx list numbering', all(x in num for x in ['Erster Punkt', 'Schritt zwei']), str(num))
        check('saved docx tables', len(d.tables) == 2 and d.tables[1].cell(1, 0).text == 'Äpfel', str(len(d.tables)))
        check('saved docx image', len(d.inline_shapes) == 1)
        xml = d.element.xml
        check('saved docx page break', 'w:br w:type="page"' in xml)
        check('saved docx centered', any(p.alignment is not None and int(p.alignment) == 1 for p in d.paragraphs))
        # PDF export
        pth = export_pdf_via_menu(page, 'bericht.pdf')
        n, txt, ok = pdf_text(pth)
        check('docx → PDF valid, 2+ pages', ok and n >= 2, str(n))
        check('PDF text incl. umlauts/€/ß', 'Projektbericht Schmetterling' in txt and 'Größe, Übermaß' in txt and '12 € und ß' in txt and 'äöüß' in txt, txt[:300].replace('\n', ' | '))
        check('PDF has list + table text', 'Erster Punkt' in txt and 'Birnen' in txt and '2,49 €' in txt)
        check('PDF page break respected', 'Seepferdchen' in subprocess.run(['pdftotext', '-f', '2', '-l', '2', pth, '-'], capture_output=True, text=True).stdout)
        # txt download
        page.locator('[data-office-more]').click()
        with page.expect_download() as dl:
            page.locator('.menu-item', has_text='Als Text (.txt)').click()
        tp = os.path.join(OUT, 'bericht.txt')
        dl.value.save_as(tp)
        t = open(tp, encoding='utf-8').read()
        check('txt export', 'Projektbericht Schmetterling' in t and '• Erster Punkt' in t and '1. Schritt eins' in t, t[:120])
        back(page)
    step('writer docx round trip', writer)

    def writer_leave_guard():
        goto_hash(page, f"#/bearbeiten/{ids['readme.md']}", 300)
        page.wait_for_selector('.doc-page h1', timeout=15000)
        check('md heading', page.locator('.doc-page h1').inner_text() == 'Überschrift')
        check('md bold + list', page.locator('.doc-page strong').count() >= 1 and page.locator('.doc-page ul li').count() == 2 and page.locator('.doc-page ol li').count() == 2)
        page.locator('.doc-page').click()
        page.keyboard.press('Control+End')
        page.keyboard.type(' ungespeichert')
        back(page)
        check('leave guard dialog', page.locator('dialog', has_text='Änderungen speichern?').count() == 1)
        handle_leave(page, 'cancel')
        check('cancel stays in editor', page.locator('.doc-page').is_visible())
        back(page)
        handle_leave(page, 'save')
        page.wait_for_timeout(800)
        check('save from guard leaves editor', page.locator('#tool-screen').is_hidden())
        data = blob_bytes(page, ids['readme.md']).decode('utf-8')
        check('md saved as markdown', data.startswith('# Überschrift') and '**fetter**' in data and 'ungespeichert' in data, data[:120])
    step('writer md + leave guard', writer_leave_guard)

    def templates():
        goto_hash(page, '#/vorlagen', 600)
        check('templates screen', page.locator('.tpl-card').count() >= 7 + 3 + 4)
        shot(page, 'desktop_templates_light')
        page.locator('.tpl-card[href="#/neu/dokument?vorlage=rechnung"]').click()
        page.wait_for_selector('.doc-page table', timeout=10000)
        check('invoice template', 'Gesamtbetrag' in page.locator('.doc-page').inner_text())
        page.locator('[data-office-save]').click()
        wait_saved(page)
        d = by_name(page, 'Rechnung.docx')
        check('template saved as new file', d is not None)
        from docx import Document
        doc = Document(save_blob(page, d['id'], 'rechnung.docx'))
        check('invoice docx tables', len(doc.tables) >= 3 and 'Beratung (Stunden)' in [c.text for r in doc.tables[2].rows for c in r.cells], str(len(doc.tables)))
        check('hash switched to bearbeiten', '#/bearbeiten/' in page.evaluate('location.hash'))
        pth = export_pdf_via_menu(page, 'rechnung.pdf')
        n, txt, ok = pdf_text(pth)
        check('invoice PDF text', ok and 'Gesamtbetrag' in txt and '749,70 €' in txt, txt[:200].replace('\n', ' | '))
        back(page)
        for tid in ['lebenslauf-klassisch', 'lebenslauf-modern', 'anschreiben', 'brief', 'notizen']:
            goto_hash(page, f'#/neu/dokument?vorlage={tid}', 300)
            page.wait_for_selector('.doc-page h1, .doc-page p', timeout=10000)
            page.wait_for_timeout(300)
            check(f'template {tid} renders', len(page.locator('.doc-page').inner_text()) > 80)
            if tid == 'lebenslauf-modern':
                shot(page, 'desktop_writer_cv_light')
            back(page)
            handle_leave(page)
    step('document templates', templates)

    # ---------------- Spreadsheet ----------------
    def sheet():
        goto_hash(page, f"#/bearbeiten/{ids['umsatz.xlsx']}", 300)
        page.wait_for_selector('.sh-body [data-cell="A1"]', timeout=15000)
        exp = {'D2': '400', 'D4': '-120', 'B6': '3680,5', 'D6': '830,25', 'B7': '1226,833333', 'B8': '2', 'B9': 'Gewinn', 'B10': '15.03.2026', 'B11': '25,6 %', 'B12': 'WAHR', 'F1': 'Zusammengeführt'}
        got = {k: sheet_cell(page, k) for k in exp}
        check('xlsx values + formulas computed', got == exp, str(got))
        sheet_select(page, 'B6')
        check('formula bar shows German formula', page.locator('#sh-input').input_value() == '=SUMME(B2:B4)', page.locator('#sh-input').input_value())
        shot(page, 'desktop_sheet_light')
        # sheet 2 formulas
        page.locator('.sh-tab', has_text='Preise').click()
        page.wait_for_timeout(300)
        exp2 = {'D2': '2,49', 'D3': '7361', 'D4': '5', 'D5': 'Äpfel & Birnen', 'D6': '6,69', 'D7': '4', 'D8': '2,21'}
        got2 = {k: sheet_cell(page, k) for k in exp2}
        check('sheet 2: SVERWEIS/cross-sheet/RUNDEN/VERKETTEN/SUMMEWENN/ANZAHL2', got2 == exp2, str(got2))
        page.locator('.sh-tab', has_text='Umsatz').click()
        page.wait_for_timeout(300)
        # typing German formulas
        sheet_type(page, 'E2', '=SUMME(B2:C2)')
        sheet_type(page, 'E3', '=WENN(B3>1000;"hoch";"niedrig")')
        sheet_type(page, 'E4', '=SVERWEIS("Kirschen";Preise!A2:B4;2;FALSCH)')
        sheet_type(page, 'E5', '=MITTELWERT(B2:B4)+ANZAHL(B2:B4)')
        sheet_type(page, 'E6', '=ZÄHLENWENN(A2:A4;"M*")')
        sheet_type(page, 'E7', '=RUNDEN(10/3;2)')
        sheet_type(page, 'E8', '=ABS(-7,5)*2')
        sheet_type(page, 'E9', '=HEUTE()')
        sheet_type(page, 'E10', '=VERKETTEN("Saldo: ";D6)')
        sheet_type(page, 'E11', '=SUM(B2:B4)/0')
        sheet_type(page, 'E12', '=MAX(B2:B4)-MIN(C2:C4)')
        sheet_type(page, 'A14', '1,5')
        sheet_type(page, 'B14', '=A14*2')
        sheet_type(page, 'C14', '12 %')
        sheet_type(page, 'D14', '24.12.2026')
        got3 = {k: sheet_cell(page, k) for k in ['E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E10', 'E11', 'E12', 'A14', 'B14', 'C14', 'D14']}
        exp3 = {'E2': '2000', 'E3': 'hoch', 'E4': '4,2', 'E5': '1229,833333', 'E6': '1', 'E7': '3,33', 'E8': '15', 'E10': 'Saldo: 830,25', 'E11': '#DIV/0!', 'E12': '700,5', 'A14': '1,5', 'B14': '3', 'C14': '12 %', 'D14': '24.12.2026'}
        check('typed German formulas evaluate', got3 == exp3, str(got3))
        check('HEUTE() is today (serial or date)', sheet_cell(page, 'E9') in (str((datetime.date.today() - datetime.date(1899, 12, 30)).days), datetime.date.today().strftime('%d.%m.%Y')), sheet_cell(page, 'E9'))
        # number format
        sheet_select(page, 'B2')
        page.locator('[data-fmt]').select_option('currency')
        page.wait_for_timeout(200)
        check('currency format', sheet_cell(page, 'B2') == '1.200,00 €', sheet_cell(page, 'B2'))
        sheet_select(page, 'E9')
        page.locator('[data-fmt]').select_option('date')
        page.wait_for_timeout(200)
        check('date format', sheet_cell(page, 'E9') == datetime.date.today().strftime('%d.%m.%Y'), sheet_cell(page, 'E9'))
        # insert a row above row 2 → references shift
        sheet_select(page, 'A2')
        page.locator('[data-a="row-add"]').click()
        page.wait_for_timeout(300)
        sheet_select(page, 'B7')
        check('insert row shifts formulas', page.locator('#sh-input').input_value() == '=SUMME(B3:B5)' and sheet_cell(page, 'B7') == '3680,5', page.locator('#sh-input').input_value())
        page.locator('[data-a="row-del"]').click() if False else None
        sheet_select(page, 'A2')
        page.locator('[data-a="row-del"]').click()
        page.wait_for_timeout(300)
        check('delete row restores', sheet_cell(page, 'B6') == '3680,5' and sheet_cell(page, 'A2') == 'Januar')
        # undo / redo
        sheet_type(page, 'A16', 'weg')
        page.locator('.sh-scroll').focus()
        page.keyboard.press('Control+z')
        page.wait_for_timeout(200)
        check('undo', sheet_cell(page, 'A16') == '')
        page.keyboard.press('Control+y')
        page.wait_for_timeout(200)
        check('redo', sheet_cell(page, 'A16') == 'weg')
        sheet_select(page, 'A16')
        page.keyboard.press('Delete')
        # freeze + bold + fill
        page.locator('[data-a="freeze"]').click()
        page.wait_for_timeout(200)
        check('freeze header row', page.locator('.sh-frozen').is_visible())
        sheet_select(page, 'A13')
        page.keyboard.type('Fett')
        page.keyboard.press('Enter')
        sheet_select(page, 'A13')
        page.locator('[data-a="bold"]').click()
        # sort Preise by price descending
        page.locator('.sh-tab', has_text='Preise').click()
        page.wait_for_timeout(200)
        sheet_select(page, 'B2')
        page.locator('[data-a="sort-desc"]').click()
        page.wait_for_timeout(300)
        check('sort column (header kept)', sheet_cell(page, 'A1') == 'Artikel' and sheet_cell(page, 'A2') == 'Kirschen' and sheet_cell(page, 'A4') == 'Äpfel', sheet_cell(page, 'A2'))
        check('VLOOKUP still right after sort', sheet_cell(page, 'D2') == '2,49')
        # select range → status sum
        page.locator('.sh-tab', has_text='Umsatz').click()
        page.wait_for_timeout(200)
        page.locator('#sh-addr').fill('B2:B4')
        page.locator('#sh-addr').press('Enter')
        page.wait_for_timeout(200)
        check('status bar sum', 'Summe: 3.680,5' in page.locator('.sh-status').inner_text(), page.locator('.sh-status').inner_text())
        shot(page, 'desktop_sheet_edit_light')
        page.locator('[data-office-save]').click()
        wait_saved(page)
        path = save_blob(page, ids['umsatz.xlsx'], 'umsatz_saved.xlsx')
        import openpyxl
        wbf = openpyxl.load_workbook(path)
        wbv = openpyxl.load_workbook(path, data_only=True)
        ws, wv = wbf['Umsatz'], wbv['Umsatz']
        check('openpyxl: formulas kept (English)', ws['B6'].value == '=SUM(B2:B4)' and ws['E3'].value == '=IF(B3>1000,"hoch","niedrig")' and ws['E4'].value == '=VLOOKUP("Kirschen",Preise!A2:B4,2,FALSE)', f"{ws['B6'].value} | {ws['E3'].value} | {ws['E4'].value}")
        check('openpyxl: cached values', wv['B6'].value == 3680.5 and wv['D6'].value == 830.25 and wv['E3'].value == 'hoch' and wv['B9'].value == 'Gewinn' and abs(wv['E4'].value - 4.2) < 1e-9, f"{wv['B6'].value} {wv['D6'].value} {wv['E3'].value}")
        check('openpyxl: number values', wv['A14'].value == 1.5 and abs(wv['C14'].value - 0.12) < 1e-12 and wv['B12'].value is True)
        check('openpyxl: formats', '€' in ws['B2'].number_format and '%' in ws['C14'].number_format and ws['B10'].is_date and ws['D14'].is_date, f"{ws['B2'].number_format} {ws['C14'].number_format}")
        check('openpyxl: bold + fill + merge + freeze', ws['A1'].font.b and ws['A13'].font.b and ws['A1'].fill.fgColor.rgb.endswith('E9E8FB') and 'F1:G1' in [str(m) for m in ws.merged_cells.ranges] and ws.freeze_panes == 'A2', f"{ws['A1'].fill.fgColor.rgb} {ws.freeze_panes}")
        check('openpyxl: sheet 2 sorted', wbf['Preise']['A2'].value == 'Kirschen')
        check('openpyxl: error cell', wv['E11'].value == '#DIV/0!', str(wv['E11'].value))
        # LibreOffice-free sanity: zip integrity
        import zipfile
        with zipfile.ZipFile(path) as z:
            check('xlsx zip valid', z.testzip() is None and '[Content_Types].xml' in z.namelist())
        # CSV download
        page.locator('[data-office-more]').click()
        with page.expect_download() as dl:
            page.locator('.menu-item', has_text='Blatt als CSV').click()
        cp = os.path.join(OUT, 'umsatz.csv')
        dl.value.save_as(cp)
        c = open(cp, encoding='utf-8-sig').read()
        check('CSV export (; + decimal comma)', c.startswith('Monat;Einnahmen;Ausgaben;Saldo') and '1200;800;400' in c and '3680,5' in c, c[:80])
        pth = export_pdf_via_menu(page, 'umsatz.pdf')
        n, txt, ok = pdf_text(pth)
        check('xlsx → PDF with values', ok and n >= 1 and 'Januar' in txt and '1.200,00 €' in txt and 'Gewinn' in txt and 'Zusammengeführt' in txt, txt[:300].replace('\n', ' | '))
        back(page)
    step('spreadsheet xlsx', sheet)

    def csv():
        goto_hash(page, f"#/bearbeiten/{ids['liste.csv']}", 300)
        page.wait_for_selector('.sh-body [data-cell="A1"]', timeout=15000)
        got = {k: sheet_cell(page, k) for k in ['A2', 'B2', 'C2', 'A4', 'B3']}
        check('csv parsed (; + German numbers + dates + quotes)', got == {'A2': 'Müller', 'B2': '1234,5', 'C2': '01.02.2026', 'A4': 'Weiß; Anna', 'B3': '99,9'}, str(got))
        sheet_type(page, 'B5', '=SUMME(B2:B4)')
        check('csv formula', sheet_cell(page, 'B5') == '1346,4', sheet_cell(page, 'B5'))
        page.locator('[data-office-save]').click()
        wait_saved(page)
        data = blob_bytes(page, ids['liste.csv'])
        t = data.decode('utf-8')
        check('csv saved with BOM, ; and quotes', t.startswith('﻿Name;Betrag;Datum') and '"Weiß; Anna"' in t and '1346,4' in t, t[:120])
        # save as xlsx
        page.locator('[data-office-more]').click()
        page.locator('.menu-item', has_text='Als Excel-Tabelle speichern').click()
        page.wait_for_timeout(1500)
        check('csv → xlsx copy saved', by_name(page, 'liste.xlsx') is not None)
        back(page)
    step('csv', csv)

    def new_sheet():
        goto_hash(page, '#/neu/tabelle', 300)
        page.wait_for_selector('.sh-scroll', timeout=10000)
        sheet_type(page, 'A1', 'Posten')
        sheet_type(page, 'B1', 'Betrag')
        sheet_type(page, 'A2', 'Miete')
        sheet_type(page, 'B2', '950')
        sheet_type(page, 'A3', 'Strom')
        sheet_type(page, 'B3', '72,40')
        sheet_select(page, 'B4')
        page.locator('[data-a="sum"]').click()
        page.wait_for_timeout(200)
        check('AutoSumme proposes range', page.locator('.cell-editor').input_value() == '=SUMME(B2:B3)', page.locator('.cell-editor').input_value())
        page.keyboard.press('Enter')
        page.wait_for_timeout(200)
        check('AutoSumme result', sheet_cell(page, 'B4') == '1022,4')
        page.locator('.sh-tabs .add').click()
        page.wait_for_timeout(200)
        sheet_type(page, 'A1', '=Tabelle1!B4*12')
        check('new sheet + cross reference', sheet_cell(page, 'A1') == '12268,8', sheet_cell(page, 'A1'))
        page.locator('[data-office-save]').click()
        wait_saved(page)
        d = by_name(page, 'Neue Tabelle.xlsx')
        import openpyxl
        wb = openpyxl.load_workbook(save_blob(page, d['id'], 'neu.xlsx'))
        check('new xlsx opens in openpyxl', wb.sheetnames == ['Tabelle1', 'Tabelle2'] and wb['Tabelle1']['B4'].value == '=SUM(B2:B3)' and wb['Tabelle2']['A1'].value == '=Tabelle1!B4*12', str(wb.sheetnames))
        back(page)
        goto_hash(page, '#/neu/tabelle?vorlage=haushaltsbuch', 300)
        page.wait_for_selector('.sh-body [data-cell="A1"]', timeout=10000)
        check('sheet template computes', sheet_cell(page, 'D10') != '' and '€' in sheet_cell(page, 'B10'), sheet_cell(page, 'B10'))
        shot(page, 'desktop_sheet_template_light')
        back(page)
        handle_leave(page)
    step('new spreadsheet', new_sheet)

    # ---------------- Slides ----------------
    def slides():
        goto_hash(page, f"#/bearbeiten/{ids['praesentation.pptx']}", 300)
        page.wait_for_selector('.stage-fit .slide', timeout=15000)
        check('pptx 3 slides in strip', page.locator('.strip-item').count() == 3)
        check('pptx title text', 'Quartalsbericht Seepferdchen' in page.locator('.stage-fit .slide').inner_text())
        page.locator('.strip-item').nth(1).locator('.strip-btn').click()
        page.wait_for_timeout(300)
        t = page.locator('.stage-fit .slide').inner_text()
        check('pptx bullets slide', 'Agenda' in t and 'Unterpunkt' in t and page.locator('.stage-fit .sp[data-bullet]').count() >= 4, t[:100])
        page.locator('.strip-item').nth(2).locator('.strip-btn').click()
        page.wait_for_timeout(300)
        check('pptx shapes/picture/background', page.locator('.stage-fit .el-image img').count() == 1 and 'Grüne Box' in page.locator('.stage-fit .slide').inner_text() and 'rgb(255, 246, 240)' in page.locator('.stage-fit .slide').get_attribute('style').replace('#FFF6F0', 'rgb(255, 246, 240)'))
        shot(page, 'desktop_slides_light')
        # edit the title on slide 1
        page.locator('.strip-item').nth(0).locator('.strip-btn').click()
        page.wait_for_timeout(300)
        title_el = page.locator('.stage-fit .el', has_text='Quartalsbericht').first
        title_el.click()
        title_el.click()
        page.wait_for_timeout(200)
        page.keyboard.press('Control+a')
        page.keyboard.type('Jahresbericht 2026')
        page.locator('.slide-stage').click(position={'x': 10, 'y': 10})
        page.wait_for_timeout(300)
        check('inline title edit', 'Jahresbericht 2026' in page.locator('.stage-fit .slide').inner_text())
        # add a slide with layout
        page.locator('[data-a="add"]').click()
        page.locator('.menu-item', has_text='Zwei Spalten').click()
        page.wait_for_timeout(300)
        check('slide added', page.locator('.strip-item').count() == 4)
        # add text box
        page.locator('[data-a="text"]').click()
        page.wait_for_timeout(200)
        page.keyboard.press('Control+a')
        page.keyboard.type('Zusatztext Kolibri')
        page.locator('.slide-stage').click(position={'x': 10, 'y': 10})
        page.wait_for_timeout(300)
        # reorder: move slide 4 up via context menu
        page.locator('.strip-item').nth(3).click(button='right')
        page.locator('.menu-item', has_text='Nach oben').click()
        page.wait_for_timeout(300)
        check('reorder slide', 'Grüne Box' in page.locator('.strip-item').nth(2).inner_text() and 'Agenda' in page.locator('.strip-item').nth(3).inner_text())
        # slideshow
        page.locator('[data-a="show"]').click()
        page.wait_for_selector('.slideshow', timeout=5000)
        page.wait_for_timeout(300)
        shot(page, 'desktop_slideshow')
        c0 = page.locator('.ss-count').inner_text()
        page.keyboard.press('ArrowRight')
        page.wait_for_timeout(200)
        c1 = page.locator('.ss-count').inner_text()
        check('slideshow navigation', c0 != c1 and '/ 4' in c1, f'{c0} -> {c1}')
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        check('slideshow closes', page.locator('.slideshow').count() == 0)
        page.locator('[data-office-save]').click()
        wait_saved(page, 30000)
        from pptx import Presentation
        prs = Presentation(save_blob(page, ids['praesentation.pptx'], 'praesentation_saved.pptx'))
        texts = [' '.join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame) for s in prs.slides]
        check('saved pptx opens (python-pptx), 4 slides', len(prs.slides) == 4, str(len(prs.slides)))
        check('saved pptx texts', 'Jahresbericht 2026' in texts[0] and 'Agenda' in texts[3] and 'Kolibri' in texts[1] and 'Grüne Box' in texts[2], str(texts))
        pics = sum(1 for s in prs.slides for sh in s.shapes if sh.shape_type == 13)
        check('saved pptx picture', pics >= 1)
        pth = export_pdf_via_menu(page, 'praesentation.pdf')
        n, txt, ok = pdf_text(pth)
        check('pptx → PDF one page per slide + text layer', ok and n == 4 and 'Jahresbericht 2026' in txt and 'Agenda' in txt, f'{n} {txt[:120]!r}')
        back(page)
    step('slides pptx', slides)

    def new_slides():
        goto_hash(page, '#/neu/praesentation?design=koralle', 300)
        page.wait_for_selector('.stage-fit .slide', timeout=10000)
        check('new presentation has 2 slides', page.locator('.strip-item').count() == 2)
        shot(page, 'desktop_slides_new_light')
        page.locator('[data-a="theme"]').click()
        page.locator('dialog [data-theme="wald"]').click()
        page.wait_for_timeout(400)
        check('theme switched', '15, 61, 58' in page.locator('.stage-fit .slide').get_attribute('style') or '#0F3D3A' in page.locator('.stage-fit .slide').get_attribute('style').upper())
        page.locator('[data-a="add"]').click()
        page.locator('.menu-item', has_text='Titel + Text').click()
        page.wait_for_timeout(300)
        page.locator('[data-office-save]').click()
        wait_saved(page, 30000)
        d = by_name(page, 'Neue Präsentation.pptx')
        from pptx import Presentation
        prs = Presentation(save_blob(page, d['id'], 'neu.pptx'))
        check('new pptx: 3 slides, 16:9', len(prs.slides) == 3 and abs(prs.slide_width / prs.slide_height - 16 / 9) < 0.01, f'{len(prs.slides)} {prs.slide_width}x{prs.slide_height}')
        check('new pptx: texts', 'Titel der Präsentation' in ' '.join(sh.text_frame.text for sh in prs.slides[0].shapes if sh.has_text_frame))
        shot(page, 'desktop_slides_wald_light')
        back(page)
    step('new presentation', new_slides)

    # ---------------- converters ----------------
    def converters():
        for tid, name, expect in [('word-pdf', 'bericht.docx', 'Projektbericht'), ('excel-pdf', 'umsatz.xlsx', 'Januar'), ('ppt-pdf', 'praesentation.pptx', 'Agenda'), ('text-pdf', 'Einkauf.txt', 'Brötchen für 3,50 €')]:
            doc = by_name(page, name)
            goto_hash(page, f"#/werkzeug/{tid}?doc={doc['id']}", 800)
            page.wait_for_selector('[data-run]', timeout=10000)
            if tid == 'word-pdf':
                shot(page, 'desktop_convert_light')
            page.locator('[data-run]').click()
            page.wait_for_selector('.result-card', timeout=40000)
            with page.expect_download() as dl:
                page.locator('.result-card [data-r="dl"]').click()
            pth = os.path.join(OUT, f'{tid}.pdf')
            dl.value.save_as(pth)
            n, txt, ok = pdf_text(pth)
            check(f'{tid} conversion', ok and expect in txt, txt[:100].replace('\n', ' | '))
        goto_hash(page, '#/werkzeug/text-pdf', 800)
        check('converter lists only matching files', page.locator('[data-lib] .doc').count() == 2, str(page.locator('[data-lib] .doc').count()))
        goto_hash(page, '#/start')
    step('converters', converters)

    def pdf2xlsx():
        doc = by_name(page, 'tabelle.pdf')
        goto_hash(page, f"#/werkzeug/pdf-excel?doc={doc['id']}", 800)
        page.wait_for_selector('.x2-table', timeout=20000)
        shot(page, 'desktop_pdf2xlsx_light')
        prev = page.locator('.x2-table').inner_text()
        check('pdf→excel preview', 'Liegestuhl' in prev and 'Einzelpreis' in prev, prev[:150])
        page.locator('[data-make]').click()
        page.wait_for_selector('dialog .result-mini', timeout=20000)
        page.locator('dialog button[value="open"]').click()
        page.wait_for_selector('.sh-body [data-cell="A1"]', timeout=15000)
        d = by_name(page, 'tabelle.xlsx')
        import openpyxl
        wb = openpyxl.load_workbook(save_blob(page, d['id'], 'tabelle.xlsx'))
        ws = wb.worksheets[0]
        rows = [[c for c in r] for r in ws.iter_rows(values_only=True)]
        flat = [r for r in rows if any(v is not None for v in r)]
        hdr = [r for r in flat if 'Artikel' in r]
        lie = [r for r in flat if 'Liegestuhl' in r]
        check('pdf→excel: header row split into 4 columns', hdr and [v for v in hdr[0] if v is not None] == ['Artikel', 'Menge', 'Einzelpreis', 'Gesamt'], str(hdr))
        check('pdf→excel: numbers parsed (German)', lie and 4 in lie[0] and 1234.5 in lie[0] and 4938 in lie[0], str(lie))
        check('pdf→excel: one sheet per page', len(wb.worksheets) == 2 and wb.worksheets[1].title == 'Seite 2')
        back(page)
    step('pdf to excel', pdf2xlsx)

    def image_view():
        doc = by_name(page, 'bild.png')
        goto_hash(page, f"#/bearbeiten/{doc['id']}", 800)
        page.wait_for_selector('.img-stage img', timeout=10000)
        check('image viewer', page.locator('.img-stage img').is_visible() and page.locator('.screen-foot', has_text='In PDF umwandeln').count() == 1)
        page.locator('.screen-foot button', has_text='In PDF umwandeln').click()
        page.wait_for_selector('.img-card img', timeout=8000)
        check('image handed to Bilder → PDF', page.locator('.img-card').count() == 1)
        goto_hash(page, '#/start')
    step('image', image_view)

    def me_and_dark():
        goto_hash(page, '#/einstellungen')
        page.wait_for_selector('.me-card')
        check('Ich page: licences incl. new libs', all(x in page.locator('.license-list').inner_text() for x in ['JSZip', 'docx', 'PptxGenJS', 'PDF.js', 'pdf-lib']))
        check('Ich page: storage', 'belegt' in page.locator('[data-storage-me]').inner_text())
        shot(page, 'desktop_me_light')
        set_theme(page, 'dark')
        for h, n in [('#/start', 'home'), ('#/dateien', 'files'), ('#/werkzeuge', 'tools'), ('#/einstellungen', 'me'), ('#/vorlagen', 'templates')]:
            goto_hash(page, h, 700)
            shot(page, f'desktop_{n}_dark')
        for name, n in [('bericht.docx', 'writer'), ('umsatz.xlsx', 'sheet'), ('praesentation.pptx', 'slides')]:
            goto_hash(page, f"#/bearbeiten/{by_name(page, name)['id']}", 2500)
            shot(page, f'desktop_{n}_dark')
        set_theme(page, 'auto')
        goto_hash(page, '#/start')
    step('Ich + dark screenshots', me_and_dark)

    def no_network():
        reqs = []
        page.on('request', lambda r: reqs.append(r.url) if not r.url.startswith(URL.rstrip('/')) and not r.url.startswith('data:') and not r.url.startswith('blob:') else None)
        goto_hash(page, f"#/bearbeiten/{ids['bericht.docx']}", 2000)
        back(page)
        check('no external network requests', not reqs, str(reqs[:3]))
    step('no network', no_network)

    browser.close()


# =====================================================================
def phone(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True, locale='de-DE',
                              user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')
    page = ctx.new_page()
    attach_logging(page, 'phone')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')

    def nav():
        labels = page.locator('.bottom-nav .bnav').all_inner_texts()
        check('phone bottom nav Start/Dateien/Werkzeuge/Ich', [l.strip() for l in labels] == ['Start', 'Dateien', 'Werkzeuge', 'Ich'], str(labels))
        check('phone FAB visible', page.locator('.fab').is_visible())
        check('phone top search reachable', page.locator('.topbar [data-nav="suche"]').is_visible() and page.locator('#home-search').is_visible())
        sw = page.evaluate('document.documentElement.scrollWidth')
        check('phone start no horizontal overflow', sw <= 390, str(sw))
        shot(page, 'phone_home_empty_light')
        page.locator('.fab').tap()
        page.wait_for_selector('.menu-layer.as-sheet')
        shot(page, 'phone_fab_menu_light')
        check('FAB opens create/import sheet', page.locator('.menu-layer.as-sheet .menu-item', has_text='Aus Gerät importieren').count() == 1)
        page.locator('.menu-layer.as-sheet').click(position={'x': 10, 'y': 10})
        page.wait_for_timeout(300)
    step('phone nav', nav)

    def imp():
        with page.expect_file_chooser() as fc:
            page.locator('.fab').tap()
            page.locator('.menu-item', has_text='Aus Gerät importieren').tap()
        fc.value.set_files([os.path.join(TD, n) for n in ['bericht.docx', 'umsatz.xlsx', 'praesentation.pptx', 'tabelle.pdf']])
        page.wait_for_function("document.querySelectorAll('#view-start .doc').length >= 4", timeout=30000)
        page.wait_for_function(f"({FILES_JS})().then(d => d.every(x => x.textReady))", timeout=40000)
        page.wait_for_timeout(800)
        shot(page, 'phone_home_light')
        for h, n in [('#/dateien', 'files'), ('#/werkzeuge', 'tools'), ('#/einstellungen', 'me'), ('#/vorlagen', 'templates')]:
            goto_hash(page, h, 700)
            sw = page.evaluate('document.documentElement.scrollWidth')
            check(f'phone {n} no horizontal overflow', sw <= 390, str(sw))
            shot(page, f'phone_{n}_light')
        goto_hash(page, '#/start')
    step('phone import + views', imp)
    ids = {d['name']: d['id'] for d in files(page)}

    def writer():
        goto_hash(page, f"#/bearbeiten/{ids['bericht.docx']}", 300)
        page.wait_for_selector('.doc-page h1', timeout=15000)
        bb = page.locator('.doc-page').bounding_box()
        check('phone writer page fits width', bb['width'] <= 390, str(bb['width']))
        page.locator('.doc-page h1').tap()
        page.keyboard.press('End')
        page.keyboard.type(' Handy')
        check('phone typing', 'Handy' in page.locator('.doc-page h1').inner_text())
        shot(page, 'phone_writer_light')
        page.locator('[data-office-save]').tap()
        wait_saved(page)
        back(page)
    step('phone writer', writer)

    def sheet():
        goto_hash(page, f"#/bearbeiten/{ids['umsatz.xlsx']}", 300)
        page.wait_for_selector('.sh-body [data-cell="A1"]', timeout=15000)
        cell = page.locator('.sh-body [data-cell="B2"]')
        cell.tap()
        page.wait_for_timeout(200)
        check('phone tap selects cell', page.locator('#sh-addr').input_value() == 'B2')
        cell.tap()
        page.wait_for_timeout(300)
        check('second tap edits in place', page.locator('.cell-editor').count() == 1)
        page.keyboard.press('Control+a')
        page.keyboard.type('2000')
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        check('phone edit recalculates', sheet_cell(page, 'B6') == '4480,5', sheet_cell(page, 'B6'))
        shot(page, 'phone_sheet_light')
        back(page)
        handle_leave(page)
    step('phone sheet', sheet)

    def slides():
        goto_hash(page, f"#/bearbeiten/{ids['praesentation.pptx']}", 300)
        page.wait_for_selector('.stage-fit .slide', timeout=15000)
        page.wait_for_timeout(500)
        bb = page.locator('.stage-fit').bounding_box()
        check('phone slide fits', bb['width'] <= 390 and bb['width'] > 300, str(bb['width']))
        shot(page, 'phone_slides_light')
        page.locator('[data-a="show"]').tap()
        page.wait_for_selector('.slideshow')
        page.wait_for_timeout(300)
        page.locator('.ss-stage').tap(position={'x': 300, 'y': 100})
        page.wait_for_timeout(300)
        check('phone tap advances slideshow', page.locator('.ss-count').inner_text().startswith('2'))
        shot(page, 'phone_slideshow')
        page.locator('[data-ss="close"]').tap()
        back(page)
    step('phone slides', slides)

    def dark():
        set_theme(page, 'dark')
        for h, n in [('#/start', 'home'), ('#/dateien', 'files'), ('#/werkzeuge', 'tools'), ('#/einstellungen', 'me')]:
            goto_hash(page, h, 700)
            shot(page, f'phone_{n}_dark')
        for name, n in [('bericht.docx', 'writer'), ('umsatz.xlsx', 'sheet'), ('praesentation.pptx', 'slides')]:
            goto_hash(page, f"#/bearbeiten/{ids[name]}", 2500)
            shot(page, f'phone_{n}_dark')
        goto_hash(page, f"#/werkzeug/pdf-excel?doc={ids['tabelle.pdf']}", 2500)
        shot(page, 'phone_pdf2xlsx_dark')
        set_theme(page, 'auto')
    step('phone dark', dark)
    browser.close()


with sync_playwright() as p:
    if ONLY in ('all', 'desktop'):
        desktop(p)
    if ONLY in ('all', 'phone'):
        phone(p)

print('\n==== SUMMARY ====')
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
for f in fails:
    print('FAILED:', f[0], f[2])
print('\n==== CONSOLE errors/warnings ====')
for c in console_problems:
    print(c)
print(f'{len(console_problems)} console problems')

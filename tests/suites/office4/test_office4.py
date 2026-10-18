"""Office 4 tests – word processor depth: template start screen (25 templates, search, categories, previews, download),
every template → DOCX (python-docx + LibreOffice headless) + own PDF, header/footer zones with fields + first/even pages +
page number format, watermark, endnotes, bookmarks + internal links + cross references, captions + table of figures,
numbered headings, custom styles, table sort/formula/convert, image crop/rotate, section orientation, tab stops with
leaders, drop caps, paste options, floating format bar, focus/reading mode, outline moves, PDF bookmarks/links,
Markdown footnotes; phone 390x844 (touch) UX. Server: OFFICE_URL (default http://127.0.0.1:8880/). Screenshots → shots/."""
import os, sys, json, base64, subprocess, traceback, shutil, zipfile, re, glob
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')
WORK = os.path.join(HERE, 'work_t')
LO_PROFILE = os.path.join(HERE, 'lo_profile')
shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(WORK, exist_ok=True)
URL = os.environ.get('OFFICE_URL', 'http://127.0.0.1:8880/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
results, console_problems = [], []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:800], flush=True)
        traceback.print_exc()


def attach_logging(page, label):
    page.on('console', lambda m: console_problems.append(f'{label} [{m.type}] {m.text}') if m.type in ('error', 'warning') and 'favicon' not in m.text and 'Service Worker' not in m.text and 'SW-Registrierung' not in m.text else None)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))


W = "document.querySelector('.writer')._writerApi"
SEL_JS = """([text, start, len]) => { const ed = document.querySelector('.doc-page'); const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n;
  while ((n = tw.nextNode())) { const i = n.nodeValue.indexOf(text); if (i >= 0) { const r = document.createRange(); r.setStart(n, i + (start || 0)); r.setEnd(n, i + (start || 0) + (len == null ? text.length : len)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); return true; } } return false; }"""
CARET_JS = """([text, end]) => { const ed = document.querySelector('.doc-page'); const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n;
  while ((n = tw.nextNode())) { const i = n.nodeValue.indexOf(text); if (i >= 0) { const r = document.createRange(); r.setStart(n, end ? i + text.length : i); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); return true; } } return false; }"""
EXPORT_JS = """async (what) => { const api = document.querySelector('.writer')._writerApi;
  const enc = a => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  if (what === 'docx') { const b = await api.serialize('docx'); return enc(new Uint8Array(await b.arrayBuffer())); }
  if (what === 'md') { const b = await api.serialize('md'); return await b.text(); }
  const { modelToPdf } = await import('./js/office/docpdf.js');
  return enc(new Uint8Array(await modelToPdf(api.model(), { title: 'Testdokument', page: api.page(), hf: api.hf() }))); }"""
OPEN_DOCX_JS = """async ([b64, name]) => { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const { importFiles } = await import('./js/library.js'); const docs = await importFiles([new File([u8], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })], { source: 'Test', any: true });
  return docs[0].id; }"""


def wsel(page, text, start=0, length=None):
    assert page.evaluate(SEL_JS, [text, start, length]), f'text not found: {text}'
    page.wait_for_timeout(80)


def wcaret(page, text, end=True):
    assert page.evaluate(CARET_JS, [text, end]), f'text not found: {text}'
    page.wait_for_timeout(80)


def goto(page, h, wait=600):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(wait)


def leave(page):
    page.evaluate("location.hash = '#/start'")
    page.wait_for_timeout(350)
    dlg = page.locator('dialog', has_text='Änderungen speichern?')
    if dlg.count():
        dlg.locator('button[value="discard"]').click()
        page.wait_for_timeout(400)


def new_doc(page, tid=None):
    leave(page)
    goto(page, f'#/neu/dokument{"?vorlage=" + tid if tid else ""}', 300)
    page.wait_for_selector('.doc-page', timeout=15000)
    page.wait_for_timeout(500)


def set_html(page, html):
    page.evaluate("h => { const ed = document.querySelector('.doc-page'); ed.innerHTML = h; ed.dispatchEvent(new Event('input', { bubbles: true })); }", html)
    page.wait_for_timeout(450)


def rb(page, tab):
    page.locator(f'.rb-tab[data-rb="{tab}"]').click()
    page.wait_for_timeout(120)


def menu(page, text):
    page.locator('.menu-item', has_text=text).first.click()
    page.wait_for_timeout(250)


def X(page, name):
    return page.locator(f'.office-toolbar:not([hidden]) [data-x="{name}"]').first


def dlg_ok(page):
    page.locator('dialog[open] button[value=ok]').click()
    page.wait_for_timeout(350)


def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(SHOTS, f'{name}.png'))


def export(page, what, name):
    data = page.evaluate(EXPORT_JS, what)
    path = os.path.join(WORK, name)
    if what == 'md':
        open(path, 'w', encoding='utf-8').write(data)
    else:
        open(path, 'wb').write(base64.b64decode(data))
    return path


def zxml(path, part='word/document.xml'):
    with zipfile.ZipFile(path) as z:
        return z.read(part).decode('utf-8') if part in z.namelist() else ''


def lo_convert(paths, fmt='pdf'):
    outdir = os.path.join(WORK, 'lo')
    os.makedirs(outdir, exist_ok=True)
    subprocess.run(['soffice', '--headless', f'-env:UserInstallation=file://{LO_PROFILE}', '--convert-to', fmt, '--outdir', outdir, *paths], capture_output=True, timeout=600)
    return [os.path.join(outdir, os.path.splitext(os.path.basename(p))[0] + '.' + fmt.split(':')[0]) for p in paths]


def pdftext(path, layout=False, first=None, last=None):
    args = ['pdftotext'] + (['-layout'] if layout else []) + (['-f', str(first)] if first else []) + (['-l', str(last)] if last else []) + [path, '-']
    return subprocess.run(args, capture_output=True, text=True).stdout


def pdfpages(path):
    out = subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout
    m = re.search(r'Pages:\s+(\d+)', out)
    return int(m.group(1)) if m else 0


def page_size(path, n):
    out = subprocess.run(['pdfinfo', '-f', str(n), '-l', str(n), path], capture_output=True, text=True).stdout
    m = re.search(r'Page\s+%d size:\s+([\d.]+) x ([\d.]+)' % n, out)
    return (float(m.group(1)), float(m.group(2))) if m else (0, 0)


def reopen(page, path):
    """Import a DOCX file into the app and open it in the writer."""
    b64 = base64.b64encode(open(path, 'rb').read()).decode()
    leave(page)
    did = page.evaluate(OPEN_DOCX_JS, [b64, os.path.basename(path)])
    goto(page, f'#/bearbeiten/{did}', 300)
    page.wait_for_selector('.doc-page', timeout=15000)
    page.wait_for_timeout(900)


LONG = ''.join(f'<p>Absatz {i}: ' + 'Dies ist ein längerer Fülltext für die Seitenaufteilung im Dokument. ' * 6 + '</p>' for i in range(1, 19))


# =====================================================================
def desktop(p):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860}, service_workers='block', locale='de-DE', accept_downloads=True)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=URL.rstrip('/'))
    page = ctx.new_page()
    attach_logging(page, 'desktop')
    page.goto(URL)
    page.wait_for_timeout(1200)
    page.evaluate("localStorage.setItem('fale-w-view', 'page')")

    # ---------------- template start screen ----------------
    def templates():
        goto(page, '#/vorlagen/dokument', 1500)
        n = page.locator('.dtp .stp-card').count()
        total = len(page.evaluate("import('./js/office/doc-templates.js').then(m => m.DOC_TEMPLATE_LIST.map(t => t.id))"))
        check(f'doc template gallery: one card per template ({total})', n == total and total >= 40, n)
        filled = page.evaluate("[...document.querySelectorAll('.dtp-page')].filter(x => x.textContent.trim().length > 5).length")
        check('live previews contain the real template content', filled >= total - 1, filled)
        page.locator('.stp-bar [data-q]').fill('hausarbeit')
        page.wait_for_timeout(200)
        ids = [x.get_attribute('data-id') for x in page.locator('.stp-card:not([hidden])').all()]
        check('search finds the Hausarbeit', 'hausarbeit' in ids and len(ids) <= 3, ids)
        page.locator('.stp-bar [data-q]').fill('')
        page.locator('.stp-cats [data-cat="Briefe"]').click()
        page.wait_for_timeout(200)
        ids = [x.get_attribute('data-id') for x in page.locator('.stp-card:not([hidden])').all()]
        check('category Briefe', set(ids) == {'leer', 'brief', 'brief-privat', 'kuendigung', 'reklamation', 'einladung-mitgliederversammlung'}, ids)
        page.locator('.stp-cats [data-cat="Alle"]').click()
        shot(page, 'desktop_templates')
        with page.expect_download() as dl:
            page.locator('.stp-card[data-id="protokoll"] [data-dl]').click()
        path = os.path.join(WORK, 'dl_protokoll.docx')
        dl.value.save_as(path)
        import docx as pydocx
        d = pydocx.Document(path)
        check('template download: valid .docx with content', any('Tagesordnung' in x.text for x in d.paragraphs), [x.text for x in d.paragraphs][:5])
        page.locator('.stp-card[data-id="hausarbeit"] .stp-open').click()
        page.wait_for_selector('.doc-page', timeout=15000)
        page.wait_for_timeout(1200)
        st = page.evaluate(f"{W}.styles()")
        check('template applies its styles (Times 12 pt, 1,5 lines, numbered headings)', st['normal']['font'] == 'Times New Roman' and st['normal']['size'] == 12 and st['h1'].get('numbered') is True, st['normal'])
        hn = page.evaluate("[...document.querySelectorAll('.doc-page h1, .doc-page h2')].map(h => h.dataset.hnum)")
        check('numbered headings 1, 2, 2.1 …', hn[:4] == ['1', '2', '2.1', '2.2'], hn[:6])
        toc = page.locator('.doc-page [data-toc] .toc-e').all_inner_texts()
        check('TOC lists numbered headings', any(t.startswith('2.1 Zentrale Begriffe') for t in toc), toc[:4])
        hf = page.evaluate(f"{W}.hf()")
        check('template applies header/footer (no number on the title page)', hf and hf.get('firstPage') is False and hf.get('pageNumbers') == 'footer-center', hf)
        check('template name', 'Hausarbeit' in page.locator('#tool-screen .screen-head').inner_text())
        shot(page, 'desktop_hausarbeit')
    step('template start screen', templates)

    # ---------------- every template: DOCX (python-docx + LibreOffice) + own PDF ----------------
    def all_templates():
        ids = page.evaluate("import('./js/office/doc-templates.js').then(m => m.DOC_TEMPLATE_LIST.map(t => t.id))")
        docx_paths, bad = [], []
        import docx as pydocx
        for tid in ids:
            n0 = len(console_problems)
            new_doc(page, tid)
            dp = export(page, 'docx', f'tpl_{tid}.docx')
            pp = export(page, 'pdf', f'tpl_{tid}.pdf')
            try:
                pydocx.Document(dp)
            except Exception as e:
                bad.append(f'{tid}: python-docx {e}')
            if pdfpages(pp) < 1:
                bad.append(f'{tid}: own PDF')
            if len(console_problems) > n0:
                bad.append(f'{tid}: console {console_problems[n0:]}')
            docx_paths.append(dp)
        check(f'{len(ids)} templates export valid DOCX + PDF without console errors', not bad, bad)
        pdfs = lo_convert(docx_paths)
        lo_bad = [os.path.basename(x) for x in pdfs if not os.path.exists(x) or pdfpages(x) < 1]
        check('LibreOffice opens every template DOCX', not lo_bad, lo_bad)
        # page count of own PDF vs LibreOffice stays close
        diffs = []
        for dp, lp in zip(docx_paths, pdfs):
            own = dp.replace('.docx', '.pdf')
            if os.path.exists(lp) and abs(pdfpages(own) - pdfpages(lp)) > 1:
                diffs.append((os.path.basename(dp), pdfpages(own), pdfpages(lp)))
        check('page counts: own PDF vs LibreOffice within ±1', not diffs, diffs)
        t = pdftext(os.path.join(WORK, 'lo', 'tpl_rechnung.pdf'))
        check('LibreOffice shows the invoice formula results', '749,70' in t and '630,00' in t, t[:600])
        t = pdftext(os.path.join(WORK, 'tpl_hausarbeit.pdf'))
        check('own PDF of the Hausarbeit: TOC page numbers + footnotes', re.search(r'2\.1 Zentrale Begriffe \.+\s*3', pdftext(os.path.join(WORK, 'tpl_hausarbeit.pdf'), layout=True)) is not None and 'Vgl. Nachname' in t)
        t = pdftext(os.path.join(WORK, 'lo', 'tpl_hausarbeit.pdf'))
        check('LibreOffice: Hausarbeit TOC field + numbered headings + footnotes', '2.1 Zentrale Begriffe' in t and 'Vgl. Nachname' in t and 'Inhaltsverzeichnis' in t, t[:500])
        w, h = page_size(os.path.join(WORK, 'lo', 'tpl_urkunde.pdf'), 1)
        check('Urkunde is landscape in LibreOffice', w > h, (w, h))
    step('all templates export', all_templates)

    # ---------------- header / footer zones, fields, first/even pages, numbering format ----------------
    def header_footer():
        new_doc(page)
        set_html(page, '<h1>Bericht</h1>' + LONG + LONG)
        page.evaluate(f"{W}.setView('page')")
        page.wait_for_timeout(500)
        rb(page, 'insert')
        X(page, 'ins-hf').click()
        page.wait_for_selector('.hf-dlg')
        dl = page.locator('dialog[open]')
        dl.locator('[data-z="h0"]').fill('Projekt Alpha')
        dl.locator('[data-z="h2"]').click()
        dl.locator('[data-field="{DATUM}"]').click()
        dl.locator('[data-z="f2"]').fill('Seite {SEITE} von {SEITEN}')
        dl.locator('[name=first]').check()
        dl.locator('[data-z="h1"]').fill('Deckblatt')
        dl.locator('[name=even]').check()
        dl.locator('[data-z="h0"]').fill('Gerade Seite')
        dl.locator('[data-z="f0"]').fill('{SEITE}')
        dl.locator('[name=pnStyle]').select_option('I')
        shot(page, 'desktop_hf_dialog')
        dlg_ok(page)
        page.wait_for_timeout(500)
        hf = page.evaluate(f"{W}.hf()")
        check('advanced hf stored (zones, first, even, numbering)', hf.get('zones') and hf['zones']['h'][0] == 'Projekt Alpha' and hf['zones']['h'][2] == '{DATUM}' and hf.get('first') and hf['first']['h'][1] == 'Deckblatt' and hf.get('even') and hf.get('pnStyle') == 'I', hf)
        n = page.locator('.pv-page').count()
        tops = page.locator('.pv-hf.top').all_inner_texts()
        bots = page.locator('.pv-hf.bottom').all_inner_texts()
        check('page view: first page own header (button), even pages "Gerade Seite"', 'Deckblatt' in page.locator('.doc-hf.top').inner_text() and any('Gerade Seite' in t for t in tops) and any('Projekt Alpha' in t for t in tops), tops)
        check('page view: roman page numbers "Seite III von N"', any(f'Seite III von {n}' in t for t in bots) or n < 3, (n, bots))
        shot(page, 'desktop_hf_pages')
        dp = export(page, 'docx', 'hf.docx')
        x = zxml(dp)
        st = zxml(dp, 'word/settings.xml')
        check('docx: titlePg + evenAndOddHeaders + roman page numbers', '<w:titlePg' in x and 'evenAndOddHeaders' in st and 'upperRoman' in x, (('titlePg' in x), ('evenAndOddHeaders' in st), ('upperRoman' in x)))
        hdrs = ' '.join(zxml(dp, n2) for n2 in zipfile.ZipFile(dp).namelist() if re.match(r'word/(header|footer)\d+\.xml', n2))
        check('docx: header zones with tab stops and PAGE/NUMPAGES/DATE fields', 'Projekt Alpha' in hdrs and 'w:val="right"' in hdrs and 'NUMPAGES' in hdrs and 'DATE' in hdrs and 'Gerade Seite' in hdrs and 'Deckblatt' in hdrs)
        lp = lo_convert([dp])[0]
        t1, t2 = pdftext(lp, first=1, last=1), pdftext(lp, first=2, last=2)
        check('LibreOffice: page 1 "Deckblatt", page 2 "Gerade Seite", roman numbers', 'Deckblatt' in t1 and 'Projekt Alpha' not in t1 and 'Gerade Seite' in t2 and re.search(r'\bII\b', t2) is not None, (t1[:200], t2[:200]))
        pp = export(page, 'pdf', 'hf.pdf')
        t1, t2, t3 = pdftext(pp, first=1, last=1), pdftext(pp, first=2, last=2), pdftext(pp, first=3, last=3)
        check('own PDF: first/even/odd headers and "Seite III von N"', 'Deckblatt' in t1 and 'Gerade Seite' in t2 and 'Projekt Alpha' in t3 and re.search(r'Seite III von \d', t3) is not None, (t1[:120], t2[:120], t3[-200:]))
        reopen(page, dp)
        hf2 = page.evaluate(f"{W}.hf()")
        check('re-open: zones, first + even pages, numbering format restored', hf2 and hf2.get('zones') and hf2['zones']['f'][2] == 'Seite {SEITE} von {SEITEN}' and hf2['zones']['h'][2] == '{DATUM}' and hf2.get('first', {}).get('h', [''])[1] == 'Deckblatt' and hf2.get('even', {}).get('h', [''])[0] == 'Gerade Seite' and hf2.get('pnStyle') == 'I', hf2)
        # page numbers menu on a simple document stays in the simple format
        new_doc(page)
        set_html(page, '<p>Kurz.</p>')
        rb(page, 'insert')
        X(page, 'ins-pn').click()
        menu(page, '„Seite X von Y“ unten mittig')
        hf3 = page.evaluate(f"{W}.hf()")
        check('page numbers menu (simple format)', hf3 and hf3.get('pageNumbers') == 'footer-center' and hf3.get('pageFormat') == 'n-of-m', hf3)
    step('header / footer', header_footer)

    # ---------------- watermark ----------------
    def watermark():
        new_doc(page)
        set_html(page, '<h1>Vertrag</h1>' + LONG[:3000])
        rb(page, 'layout')
        X(page, 'watermark').click()
        page.wait_for_selector('.wm-dlg')
        page.locator('dialog[open] [data-wm="ENTWURF"]').click()
        dlg_ok(page)
        page.wait_for_timeout(600)
        check('watermark on every page (page view)', page.locator('.pv-wm').count() == page.locator('.pv-page').count() and page.locator('.pv-wm').count() >= 1 and 'ENTWURF' in page.locator('.pv-wm').first.inner_text())
        shot(page, 'desktop_watermark')
        dp = export(page, 'docx', 'wm.docx')
        hx = ' '.join(zxml(dp, n2) for n2 in zipfile.ZipFile(dp).namelist() if re.match(r'word/header\d+\.xml', n2))
        check('docx: VML watermark in the header', 'v:textpath' in hx and 'string="ENTWURF"' in hx and 'PowerPlusWaterMarkObject' in hx)
        pp = export(page, 'pdf', 'wm.pdf')
        from pypdf import PdfReader
        check('own PDF: diagonal watermark text', 'ENTWURF' in PdfReader(pp).pages[0].extract_text())
        odt = lo_convert([dp], 'odt')[0]
        check('LibreOffice keeps the watermark (header shape)', 'ENTWURF' in zipfile.ZipFile(odt).read('styles.xml').decode('utf-8'))
        reopen(page, dp)
        hf = page.evaluate(f"{W}.hf()")
        check('re-open: watermark restored', hf and hf.get('watermark', {}).get('text') == 'ENTWURF', hf)
    step('watermark', watermark)

    # ---------------- endnotes, bookmarks, links, cross references ----------------
    def references():
        new_doc(page)
        set_html(page, '<h1>Einleitung</h1><p>Erster Satz mit Quelle.</p><h1>Methode</h1><p>Zweiter Satz.</p>' + LONG[:4000] + '<h2>Anhang Daten</h2><p>Tabellen und Rohdaten.</p>')
        page.evaluate(f"{W}.setView('page')")
        wcaret(page, 'mit Quelle')
        rb(page, 'insert')
        X(page, 'ins-endnote').click()
        page.locator('dialog[open] [name=t]').fill('Endnote eins: Müller 2024, S. 3.')
        dlg_ok(page)
        wcaret(page, 'Zweiter Satz')
        X(page, 'ins-endnote').click()
        page.locator('dialog[open] [name=t]').fill('Endnote zwei.')
        dlg_ok(page)
        check('endnotes listed at the end (i, ii)', page.locator('.doc-en-area li').count() == 2 and 'Müller 2024' in page.locator('.doc-en-area').inner_text())
        # bookmark
        wcaret(page, 'Tabellen und', False)
        X(page, 'ins-bookmark').click()
        page.locator('dialog[open] [name=name]').fill('Rohdaten Teil A')
        dlg_ok(page)
        check('bookmark inserted (name cleaned)', page.locator('.doc-page span.bm[data-bm="Rohdaten_Teil_A"]').count() == 1)
        # link to a heading
        wcaret(page, 'Erster Satz', False)
        X(page, 'ins-link').click()
        page.locator('dialog[open] [data-mode="doc"]').click()
        page.locator('dialog[open] .lk-opt', has_text='Methode').locator('input').check()
        page.locator('dialog[open] [name=text]').fill('siehe Methode')
        dlg_ok(page)
        href = page.locator('.doc-page a', has_text='siehe Methode').get_attribute('href')
        tgt = page.evaluate("h => !!document.querySelector(`.doc-page h1 span.bm[data-bm='${h.slice(1)}']`)", href or '#')
        check('internal link to a heading (target bookmark created)', href and href.startswith('#_Ref') and tgt, href)
        # cross references: text + page
        wcaret(page, 'Zweiter Satz')
        page.keyboard.type(' Siehe ')
        X(page, 'ins-xref').click()
        page.locator('dialog[open] [name=kind]').select_option('bookmark')
        dlg_ok(page)
        page.keyboard.type(' auf Seite ')
        X(page, 'ins-xref').click()
        page.locator('dialog[open] [name=kind]').select_option('heading')
        page.locator('dialog[open] .lk-opt', has_text='Anhang Daten').locator('input').check()
        page.locator('dialog[open] [name=xk]').select_option('page')
        dlg_ok(page)
        page.wait_for_timeout(400)
        xr = page.locator('.doc-page span.xref').all_inner_texts()
        n = page.locator('.pv-page').count()
        check('cross references: bookmark text + page number', len(xr) == 2 and 'Tabellen und Rohdaten' in xr[0] and xr[1].isdigit() and int(xr[1]) == n, (xr, n))
        shot(page, 'desktop_references')
        dp = export(page, 'docx', 'refs.docx')
        x = zxml(dp)
        en = zxml(dp, 'word/endnotes.xml')
        check('docx: endnotes part + references', 'Müller 2024' in en and 'endnoteReference' in x)
        check('docx: bookmarks, internal hyperlink, REF/PAGEREF fields', 'w:name="Rohdaten_Teil_A"' in x and re.search(r'w:anchor="_Ref\d+"', x) is not None and 'REF Rohdaten_Teil_A' in x and 'PAGEREF _Ref' in x, re.findall(r'w:instr="[^"]*"', x)[:5])
        lp = lo_convert([dp])[0]
        t = pdftext(lp)
        check('LibreOffice: endnotes + cross reference text', 'Müller 2024' in t and 'Endnote zwei' in t and 'Siehe Tabellen und Rohdaten' in re.sub(r'\s+', ' ', t), t[-400:])
        pp = export(page, 'pdf', 'refs.pdf')
        t = pdftext(pp)
        check('own PDF: endnotes section with roman numbers', 'Endnoten' in t and re.search(r'\bi\.\s+Endnote eins', t) is not None and re.search(r'\bii\.\s+Endnote zwei', t) is not None, t[-300:])
        from pypdf import PdfReader
        r = PdfReader(pp)
        titles = [o.title for o in r.outline if not isinstance(o, list)]
        links = [a.get_object() for pg_ in r.pages for a in (pg_.get('/Annots') or [])]
        internal = [a for a in links if '/Dest' in a]
        check('own PDF: bookmarks (outline) from headings', titles[:2] == ['Einleitung', 'Methode'] and r.page_mode == '/UseOutlines', titles)
        check('own PDF: internal link annotations (link + cross references)', len(internal) >= 2, len(internal))
        reopen(page, dp)
        check('re-open: endnotes, bookmark, internal link, cross references', page.locator('.doc-page sup.en').count() == 2 and page.locator('.doc-page span.bm[data-bm="Rohdaten_Teil_A"]').count() == 1 and page.locator('.doc-page a[href^="#_Ref"]').count() == 1 and page.locator('.doc-page span.xref').count() == 2)
    step('endnotes, bookmarks, links, cross references', references)

    # ---------------- captions + table of figures + numbered headings ----------------
    def captions():
        new_doc(page)
        png = os.path.join(WORK, 'pic.png')
        from PIL import Image
        Image.new('RGB', (400, 300), (59, 55, 160)).save(png)
        set_html(page, '<h1>Ergebnisse</h1><p>Text davor.</p><p>Bild folgt.</p><table><tbody><tr><td><p>Alpha</p></td><td><p>1</p></td></tr><tr><td><p>B</p></td><td><p>2</p></td></tr></tbody></table><h2>Details</h2><p>Zweites Bild.</p><p>Ende.</p>')
        for anchor in ['Bild folgt.', 'Zweites Bild.']:
            wcaret(page, anchor)
            rb(page, 'start')
            with page.expect_file_chooser() as fc:
                page.locator('[data-image]').click()
            fc.value.set_files(png)
            page.wait_for_timeout(500)
            page.locator('.doc-page img').last.click()
            page.wait_for_timeout(150)
            page.keyboard.press('Escape')
            rb(page, 'image')
            page.locator('.ribbon [data-rbp="image"] [data-x="ins-caption"]').click()
            page.locator('dialog[open] [name=text]').fill(f'Testbild zu {anchor[:5]}')
            dlg_ok(page)
        wcaret(page, 'Alpha', False)
        rb(page, 'insert')
        X(page, 'ins-caption').click()
        check('caption dialog defaults to "Tabelle" above a table', page.locator('dialog[open] [name=label]').input_value() == 'Tabelle' and page.locator('dialog[open] [name=pos]').input_value() == 'above')
        page.locator('dialog[open] [name=text]').fill('Werte')
        dlg_ok(page)
        caps = page.locator('.doc-page p.caption').all_inner_texts()
        check('captions numbered per label', [c.split(':')[0] for c in caps] == ['Abbildung 1', 'Tabelle 1', 'Abbildung 2'], caps)
        wcaret(page, 'Ende.')
        X(page, 'ins-toc').click()
        menu(page, 'Abbildungsverzeichnis')
        page.wait_for_timeout(400)
        ents = page.locator('.doc-page [data-toc-kind="Abbildung"] .toc-e').all_inner_texts()
        check('table of figures lists both figures', len(ents) == 2 and ents[1].startswith('Abbildung 2'), ents)
        # numbered headings via the styles dialog
        rb(page, 'start')
        X(page, 'styles').click()
        page.locator('dialog[open] [data-hnum]').check()
        page.wait_for_timeout(500)
        hn = page.evaluate("[...document.querySelectorAll('.doc-page h1, .doc-page h2')].map(h => h.dataset.hnum)")
        check('heading numbering switched on (1, 1.1)', hn == ['1', '1.1'], hn)
        shot(page, 'desktop_captions')
        dp = export(page, 'docx', 'captions.docx')
        x = zxml(dp)
        check('docx: SEQ fields, Caption style, figures TOC, heading numbering', 'SEQ Abbildung' in x and 'SEQ Tabelle' in x and 'w:val="Caption"' in x and 'TOC \\h \\z \\c "Abbildung"' in x and 'fale-headings' not in x and '<w:numPr>' in x, re.findall(r'instr[^>]{0,60}', x)[:6])
        lp = lo_convert([dp])[0]
        t = re.sub(r'\s+', ' ', pdftext(lp))
        check('LibreOffice: captions + numbered headings', 'Abbildung 2' in t and 'Tabelle 1' in t and '1.1 Details' in t, t[:400])
        reopen(page, dp)
        hn2 = page.evaluate("[...document.querySelectorAll('.doc-page h1, .doc-page h2')].map(h => h.dataset.hnum)")
        check('re-open: captions (seq), table of figures, numbered headings', page.locator('.doc-page p.caption span.seq').count() == 3 and page.locator('.doc-page [data-toc-kind="Abbildung"]').count() == 1 and hn2 == ['1', '1.1'], hn2)
    step('captions, table of figures, numbered headings', captions)

    # ---------------- custom style ----------------
    def custom_style():
        new_doc(page)
        set_html(page, '<p>Wichtiger Hinweis zum Ablauf.</p><p>Normaler Text.</p>')
        wcaret(page, 'Wichtiger')
        X(page, 'styles').click()
        page.locator('dialog[open] [data-new]').click()
        page.wait_for_selector('dialog[open] [name=name]')
        page.locator('dialog[open] [name=name]').fill('Hinweis')
        page.locator('dialog[open] [name=b]').check()
        page.locator('dialog[open] [name=size]').fill('13')
        dlg_ok(page)
        page.wait_for_timeout(300)
        ok = page.evaluate("() => { const p = [...document.querySelectorAll('.doc-page p')].find(x => x.textContent.startsWith('Wichtiger')); const cs = getComputedStyle(p); return [p.className, cs.fontWeight, cs.fontSize]; }")
        check('new custom style applied (bold, 13 pt)', ok[0] == 'us-u1' and int(ok[1]) >= 600 and abs(float(ok[2][:-2]) - 13 * 96 / 72) < 0.6, ok)
        check('custom style in the style list', page.locator('#w-block option[value="us:u1"]').count() == 1)
        dp = export(page, 'docx', 'custom.docx')
        st = zxml(dp, 'word/styles.xml')
        check('docx: custom paragraph style', re.search(r'w:customStyle="1" w:styleId="FaleStyle1"', st) is not None and 'w:val="Hinweis"' in st)
        reopen(page, dp)
        st2 = page.evaluate(f"{W}.styles()")
        check('re-open: custom style restored', st2.get('u1', {}).get('name') == 'Hinweis' and page.locator('.doc-page p.us-u1').count() == 1, st2.get('u1'))
    step('custom style', custom_style)

    # ---------------- tables: sort, formula, convert ----------------
    def tables():
        new_doc(page)
        set_html(page, '<table><tbody><tr data-hdr=""><td><p>Artikel</p></td><td><p>Preis</p></td></tr><tr><td><p>Birne</p></td><td><p>2,50 €</p></td></tr><tr><td><p>Apfel</p></td><td><p>12,00 €</p></td></tr><tr><td><p>Kiwi</p></td><td><p>1,20 €</p></td></tr><tr><td><p>Summe</p></td><td><p><br></p></td></tr></tbody></table><p>Name;Ort</p><p>Ada;Berlin</p><p>Bob;Köln</p>')
        wcaret(page, 'Birne')
        rb(page, 'table')
        page.locator('[data-t="sort"]').click()
        page.locator('dialog[open] [name=col]').select_option('1')
        page.locator('dialog[open] [data-ord="desc"]').click()
        dlg_ok(page)
        col = page.evaluate("[...document.querySelector('.doc-page table').rows].map(r => r.cells[0].textContent)")
        check('sort by price descending (header kept, empty sum row last)', col[:4] == ['Artikel', 'Apfel', 'Birne', 'Kiwi'], col)
        page.evaluate("() => { const t = document.querySelector('.doc-page table'); const tr = [...t.rows].find(r => r.cells[0].textContent === 'Summe'); t.tBodies[0].appendChild(tr); const td = tr.cells[1]; const r = document.createRange(); r.selectNodeContents(td.querySelector('p')); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }")
        page.wait_for_timeout(150)
        rb(page, 'table')
        page.locator('[data-t="formula"]').click()
        check('formula dialog proposes =SUM(ABOVE) with a live result', page.locator('dialog[open] [name=f]').input_value() == '=SUM(ABOVE)' and '15,70' in page.locator('dialog[open] [data-prev]').inner_text())
        page.locator('dialog[open] [name=f]').fill('=SUMME(OBEN)')
        dlg_ok(page)
        tf = page.locator('.doc-page span.tf')
        check('formula field: sum above', tf.count() == 1 and tf.inner_text() == '15,70 €' and tf.get_attribute('data-f') == '=SUM(ABOVE)', tf.inner_text() if tf.count() else '')
        # change a value → recalculated
        page.evaluate("() => { const td = [...document.querySelectorAll('.doc-page td')].find(t => t.textContent === '1,20 €'); td.querySelector('p').textContent = '3,20 €'; document.querySelector('.doc-page').dispatchEvent(new Event('input', { bubbles: true })); }")
        page.wait_for_timeout(500)
        check('formula recalculates after an edit', tf.inner_text() == '17,70 €', tf.inner_text())
        # text → table
        page.evaluate("() => { const ps = [...document.querySelectorAll('.doc-page > p')].filter(p => /;/.test(p.textContent)); const r = document.createRange(); r.setStart(ps[0].firstChild, 0); r.setEnd(ps[2].firstChild, 3); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }")
        page.locator('.office-toolbar[data-rbp="table"] [data-t="totext"]').count()
        page.evaluate(f"{W}.extras.textToTable({W}.F.blocksIn(document.querySelector('.doc-page'), getSelection().getRangeAt(0)))")
        page.wait_for_timeout(300)
        check('text → table (semicolon separated)', page.locator('.doc-page table').count() == 2 and page.evaluate("document.querySelectorAll('.doc-page table')[1].rows.length") == 3)
        dp = export(page, 'docx', 'tables.docx')
        x = zxml(dp)
        check('docx: formula kept in a tagged content control with its value', 'w:tag w:val="fale-tf:0,00 €|=SUM(ABOVE)"' in x and '17,70 €' in x, re.findall(r'<w:tag[^>]*>', x))
        t = pdftext(lo_convert([dp])[0])
        check('LibreOffice shows the formula result', '17,70' in t, t[:300])
        reopen(page, dp)
        check('re-open: formula field restored and recalculated', page.locator('.doc-page span.tf').count() == 1 and page.locator('.doc-page span.tf').inner_text() == '17,70 €')
    step('tables: sort, formula, convert', tables)

    # ---------------- images: crop, rotate, wrap top/bottom ----------------
    def images():
        new_doc(page)
        set_html(page, '<p>Bild:</p><p>Danach.</p>')
        wcaret(page, 'Bild:')
        png = os.path.join(WORK, 'pic2.png')
        from PIL import Image
        Image.new('RGB', (400, 300), (11, 143, 128)).save(png)
        with page.expect_file_chooser() as fc:
            page.locator('[data-image]').click()
        fc.value.set_files(png)
        page.wait_for_timeout(600)
        img = page.locator('.doc-page img').first
        img.click()
        page.wait_for_timeout(150)
        page.keyboard.press('Escape')
        rb(page, 'image')
        page.locator('[data-i="crop"]').click()
        page.wait_for_selector('.crop-dlg canvas')
        page.locator('dialog[open] [name=l]').fill('20')
        page.locator('dialog[open] [name=l]').dispatch_event('input')
        shot(page, 'desktop_crop')
        dlg_ok(page)
        page.wait_for_timeout(500)
        nw = page.evaluate("[document.querySelector('.doc-page img').naturalWidth, document.querySelector('.doc-page img').naturalHeight]")
        check('crop: 20 % from the left (400 → 320 px)', nw == [320, 300], nw)
        page.locator('[data-i="rotate"]').click()
        page.wait_for_timeout(600)
        nw = page.evaluate("[document.querySelector('.doc-page img').naturalWidth, document.querySelector('.doc-page img').naturalHeight]")
        check('rotate 90°: 320×300 → 300×320', nw == [300, 320], nw)
        page.locator('[data-i="wrap"]').click()
        menu(page, 'Oben und unten')
        check('wrap top and bottom → centred block', page.evaluate("getComputedStyle(document.querySelector('.doc-page img')).display") == 'block')
        dp = export(page, 'docx', 'img.docx')
        check('docx: image saved', 'word/media/' in ' '.join(zipfile.ZipFile(dp).namelist()))
    step('images', images)

    # ---------------- sections with orientation, tab stops, drop caps ----------------
    def sections_tabs():
        new_doc(page)
        set_html(page, '<p data-dropcap="">' + 'Es war einmal ein Absatz mit einer großen Initiale am Anfang, der über mehrere Zeilen läuft und den Platz neben dem Buchstaben füllt. ' * 2 + '</p><p data-tabs="300:r:dot">Kaffee\t2,80 €</p><p>Hochformat Ende.</p>')
        wcaret(page, 'Hochformat Ende.')
        rb(page, 'layout')
        X(page, 'breaks').click()
        menu(page, 'folgende Seiten im Querformat')
        page.keyboard.type('Breite Tabelle im Querformat.')
        page.wait_for_timeout(300)
        check('section break with orientation in the editor', page.locator('.doc-page hr[data-orient="landscape"]').count() == 1)
        pp = export(page, 'pdf', 'sect.pdf')
        w1, h1 = page_size(pp, 1)
        w2, h2 = page_size(pp, 2)
        check('own PDF: page 1 portrait, page 2 landscape', w1 < h1 and w2 > h2, ((w1, h1), (w2, h2)))
        t = pdftext(pp, layout=True)
        check('own PDF: right tab with dot leader', re.search(r'Kaffee \.{10,}\s*2,80 €', t) is not None, t[:600])
        dp = export(page, 'docx', 'sect.docx')
        x = zxml(dp)
        check('docx: two sections, second landscape; tab stop with leader; drop cap frame', x.count('<w:sectPr') == 2 and 'w:orient="landscape"' in x and 'w:leader="dot"' in x and 'w:dropCap="drop"' in x)
        lp = lo_convert([dp])[0]
        lw, lh = page_size(lp, 2)
        check('LibreOffice: second section in landscape', lw > lh and pdfpages(lp) == 2, (lw, lh, pdfpages(lp)))
        reopen(page, dp)
        check('re-open: no empty section paragraphs', page.evaluate("document.querySelectorAll('.doc-page > p').length") == 4, page.evaluate("document.querySelector('.doc-page').innerHTML")[:600])
        check('re-open: section break orientation, tab stops, drop cap', page.locator('.doc-page hr[data-orient="landscape"]').count() == 1 and ':r:dot' in (page.locator('.doc-page p[data-tabs]').first.get_attribute('data-tabs') or '') and page.locator('.doc-page p[data-dropcap]').count() == 1 and page.locator('.doc-page p[data-dropcap]').inner_text().startswith('Es war'))
    step('sections, tab stops, drop caps', sections_tabs)

    # ---------------- paste options, floating format bar, modes, outline ----------------
    def ux():
        new_doc(page)
        set_html(page, '<h1>Teil A</h1><p>Alpha Text.</p><h1>Teil B</h1><p>Beta Text.</p><h2>Unterpunkt</h2><p>Gamma.</p>')
        wcaret(page, 'Alpha Text.')
        page.evaluate("""() => { const dt = new DataTransfer(); dt.setData('text/html', '<p><b style="color:#ff0000;font-size:20px">Fett rot</b> normal</p>'); dt.setData('text/plain', 'Fett rot normal');
          document.querySelector('.doc-page').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""")
        page.wait_for_timeout(400)
        check('paste options chip after formatted paste', page.locator('.w-pastechip').is_visible())
        page.locator('.w-pastechip').click()
        menu(page, 'Nur den Text übernehmen')
        page.wait_for_timeout(300)
        check('paste as text only (no bold/colour)', page.locator('.doc-page b, .doc-page strong').count() == 0 and 'Fett rot normal' in page.locator('.doc-page').inner_text())
        # floating format bar
        wsel(page, 'Beta')
        page.wait_for_timeout(400)
        check('floating format bar above the selection', page.locator('.w-fbar').is_visible() and not page.locator('.w-fbar.dock').count())
        shot(page, 'desktop_fbar')
        page.locator('.w-fbar [data-fb="bold"]').click()
        page.wait_for_timeout(200)
        check('floating bar: bold', page.locator('.doc-page b, .doc-page strong', has_text='Beta').count() == 1)
        # outline: move section B up, demote
        rb(page, 'view')
        if page.locator('.w-outline').is_hidden():
            X(page, 'nav').click()
        page.wait_for_timeout(300)
        row = page.locator('.w-ol-row', has_text='Teil B')
        row.hover()
        row.locator('[data-ol="up"]').click()
        page.wait_for_timeout(300)
        hs = page.evaluate("[...document.querySelectorAll('.doc-page h1, .doc-page h2')].map(h => h.tagName + ':' + h.textContent)")
        check('outline: move section up (with its sub-heading)', hs == ['H1:Teil B', 'H2:Unterpunkt', 'H1:Teil A'], hs)
        row = page.locator('.w-ol-row', has_text='Teil A')
        row.hover()
        row.locator('[data-ol="demote"]').click()
        page.wait_for_timeout(300)
        check('outline: demote heading', page.evaluate("[...document.querySelectorAll('.doc-page h2')].map(h => h.textContent)") == ['Unterpunkt', 'Teil A'])
        shot(page, 'desktop_outline')
        # focus + reading mode
        X(page, 'view-focus').click()
        page.wait_for_timeout(300)
        check('focus mode hides ribbon and header', page.locator('.ribbon').is_hidden() and page.locator('#tool-screen .screen-head').is_hidden() and page.locator('.w-modeexit').is_visible())
        shot(page, 'desktop_focus')
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        check('Esc leaves focus mode', page.locator('.ribbon').is_visible())
        rb(page, 'view')
        X(page, 'view-read').click()
        page.wait_for_timeout(300)
        check('reading mode: read only', page.locator('.doc-page').get_attribute('contenteditable') == 'false' and page.locator('.ribbon').is_hidden())
        shot(page, 'desktop_reading')
        page.locator('.w-modeexit').click()
        page.wait_for_timeout(300)
        check('leave reading mode', page.locator('.doc-page').get_attribute('contenteditable') == 'true')
        # keyboard shortcuts: footnote, endnote dialog
        wcaret(page, 'Gamma.')
        page.keyboard.press('Control+Alt+d')
        page.wait_for_timeout(300)
        check('Strg+Alt+D opens the endnote dialog', page.locator('dialog[open]', has_text='Endnote einfügen').count() == 1)
        page.keyboard.press('Escape')
        # language
        rb(page, 'review')
        X(page, 'lang').click()
        menu(page, 'Englisch (USA)')
        check('document language for spell checking', page.evaluate("document.querySelector('.doc-page').lang") == 'en-US' and page.evaluate("document.querySelector('.doc-page').spellcheck"))
        X(page, 'lang').click()
        menu(page, 'Deutsch (Deutschland)')
    step('paste options, format bar, outline, modes', ux)

    # ---------------- markdown with footnotes ----------------
    def markdown():
        new_doc(page)
        set_html(page, '<h1>Titel</h1><p>Satz mit Fußnote<sup class="fn" data-fn="Quelle A" contenteditable="false"></sup>.</p>')
        md = open(export(page, 'md', 'fn.md'), encoding='utf-8').read()
        check('Markdown export: footnote reference + definition', '[^1]' in md and '[^1]: Quelle A' in md, md)
        html = page.evaluate("t => import('./js/office/docmodel.js').then(m => m.markdownToHtml(t))", md)
        check('Markdown import: footnotes become editor footnotes', 'class="fn"' in html and 'data-fn="Quelle A"' in html, html)
    step('markdown footnotes', markdown)

    leave(page)
    b.close()


# =====================================================================
def phone(p):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', locale='de-DE', has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page()
    attach_logging(page, 'phone')
    page.goto(URL)
    page.wait_for_timeout(1200)

    def ph():
        goto(page, '#/vorlagen/dokument', 1500)
        cards = page.locator('.dtp .stp-card')
        check('phone: template gallery (all templates), two columns', cards.count() >= 40 and abs(cards.nth(0).bounding_box()['y'] - cards.nth(1).bounding_box()['y']) < 2)
        check('phone: no horizontal overflow on the start screen', page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
        shot(page, 'phone_templates')
        page.locator('.stp-card[data-id="lebenslauf-modern"] .stp-open').tap()
        page.wait_for_selector('.doc-page', timeout=15000)
        page.wait_for_timeout(900)
        tabs = page.locator('.rb-tabs')
        check('phone: ribbon tabs scroll horizontally', page.evaluate("(() => { const t = document.querySelector('.rb-tabs'); return getComputedStyle(t).overflowX === 'auto'; })()"))
        sizes = page.evaluate("[...document.querySelectorAll('.office-toolbar:not([hidden]) button.tb')].filter(b => b.offsetParent).map(b => Math.min(b.offsetWidth, b.offsetHeight))")
        check('phone: toolbar touch targets ≥ 40 px', sizes and min(sizes) >= 40, sizes[:8])
        void_ = tabs
        shot(page, 'phone_writer_template')
        # floating format bar docked at the bottom
        wsel(page, 'Kreativ')
        page.wait_for_timeout(500)
        fb = page.locator('.w-fbar.dock')
        check('phone: format bar docked at the bottom', fb.is_visible() and fb.bounding_box()['y'] + fb.bounding_box()['height'] <= 844 and fb.bounding_box()['y'] > 600, fb.bounding_box() if fb.count() else None)
        btn = page.locator('.w-fbar [data-fb="bold"]').bounding_box()
        check('phone: format bar buttons ≥ 44 px', btn['width'] >= 44 and btn['height'] >= 44, btn)
        page.locator('.w-fbar [data-fb="bold"]').tap()
        page.wait_for_timeout(250)
        check('phone: bold via format bar', page.locator('.doc-page strong, .doc-page b', has_text='Kreativ').count() >= 1)
        # keyboard-aware: simulated keyboard height lifts the bar
        wsel(page, 'strukturiert')
        page.wait_for_timeout(400)
        page.evaluate("document.querySelector('.writer').style.setProperty('--kb', '300px')")
        page.wait_for_timeout(100)
        bb = page.locator('.w-fbar.dock').bounding_box()
        check('phone: format bar sits above the keyboard (--kb)', bb and bb['y'] + bb['height'] <= 844 - 300 + 2, bb)
        shot(page, 'phone_fbar_keyboard')
        page.evaluate("document.querySelector('.writer').style.removeProperty('--kb')")
        # header/footer dialog fits
        page.locator('.rb-tab[data-rb="insert"]').tap()
        X(page, 'ins-hf').tap()
        page.wait_for_selector('.hf-dlg')
        page.wait_for_timeout(300)
        check('phone: header/footer dialog fits the screen', page.evaluate("(() => { const d = document.querySelector('dialog[open]'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().width <= innerWidth; })()"))
        shot(page, 'phone_hf_dialog')
        page.locator('dialog[open] button[value=cancel]').tap()
        page.wait_for_timeout(300)
        # cross reference dialog + caption on phone
        X(page, 'ins-xref').tap()
        page.wait_for_selector('.xr-dlg')
        shot(page, 'phone_xref_dialog')
        page.locator('dialog[open] button[value=cancel]').tap()
        page.wait_for_timeout(300)
        # reading mode on phone
        page.locator('.rb-tab[data-rb="view"]').tap()
        X(page, 'view-read').tap()
        page.wait_for_timeout(400)
        check('phone: reading mode', page.locator('.doc-page').get_attribute('contenteditable') == 'false')
        shot(page, 'phone_reading')
        page.locator('.w-modeexit').tap()
        page.wait_for_timeout(300)
        # template with many features renders on phone
        leave(page)
        goto(page, '#/neu/dokument?vorlage=rechnung', 300)
        page.wait_for_selector('.doc-page', timeout=15000)
        page.wait_for_timeout(800)
        check('phone: invoice formulas computed', '749,70 €' in page.locator('.doc-page').inner_text())
        shot(page, 'phone_invoice')
        leave(page)
    step('phone', ph)
    b.close()


with sync_playwright() as p:
    if ONLY in ('all', 'desktop'):
        desktop(p)
    if ONLY in ('all', 'phone'):
        phone(p)

passed = sum(1 for r in results if r[1])
print(f'\n==== {passed}/{len(results)} passed · {len(console_problems)} console problems ====')
for c in console_problems[:30]:
    print('  console:', c[:300])
for r in results:
    if not r[1]:
        print('  FAILED:', r[0], '|', str(r[2])[:300])

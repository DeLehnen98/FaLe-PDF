"""End-to-end tests for FaLe PDF (desktop 1366x860 + phone 390x844)."""
import os, sys, json, zipfile, subprocess, traceback, re, shutil
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
TD = '/home/claude/FalePDF/tests/base/testdata'
OUT = os.path.join(SP, 'out')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = 'http://127.0.0.1:9202/'
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'

results = []
console_problems = []


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:500], flush=True)
        traceback.print_exc()


DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, pages: d.pages, size: d.size, textReady: d.textReady, starred: d.starred, encrypted: d.encrypted}))); });
  db.close(); return res; }"""


def docs(page):
    return page.evaluate(DOCS_JS)


def doc_by_name(page, name):
    for d in docs(page):
        if d['name'] == name:
            return d
    return None


def pdf_info(path):
    """Verify a PDF with pypdf and pdfinfo; return (pages, text)."""
    from pypdf import PdfReader
    r = PdfReader(path)
    n = len(r.pages)
    txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    ok = subprocess.run(['pdfinfo', path], capture_output=True, text=True).returncode == 0
    return n, txt, ok, r


def node_pages(path):
    js = ("const {PDFDocument}=require('/opt/npm-tools/node_modules/pdf-lib');const fs=require('fs');"
          f"PDFDocument.load(fs.readFileSync({json.dumps(path)})).then(d=>console.log(d.getPageCount()+' '+d.getPages().map(p=>p.getRotation().angle).join(',')+' '+d.getForm().getFields().length)).catch(e=>console.log('ERR '+e.message))")
    return subprocess.run(['node', '-e', js], capture_output=True, text=True).stdout.strip()


def download_result(page, name):
    btn = page.locator('.result-card [data-r="dl"]').last
    with page.expect_download() as d:
        btn.click()
    path = os.path.join(OUT, name)
    d.value.save_as(path)
    return path


def attach_logging(page, label):
    def on_console(m):
        if m.type in ('error', 'warning'):
            console_problems.append(f'{label} [{m.type}] {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))


def wait_toast(page, text, timeout=15000):
    page.locator('.toast', has_text=text).first.wait_for(timeout=timeout)


def hl_visible(page):
    hl = page.locator('#viewer .textLayer .highlight.selected').first
    if not hl.count():
        hl = page.locator('#viewer .textLayer .highlight').first
    b = hl.bounding_box()
    c = page.locator('[data-v="container"]').bounding_box()
    return b is not None and c['y'] <= b['y'] <= c['y'] + c['height'] - b['height']


def shot(page, name):
    page.screenshot(path=os.path.join(SP, f'pdf_{name}.png'))


def goto_hash(page, h):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(400)


# =====================================================================
def desktop(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(bypass_csp=True, viewport={'width': 1366, 'height': 860}, accept_downloads=True, locale='de-DE')
    page = ctx.new_page()
    attach_logging(page, 'desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')
    check('home renders hero', page.locator('#view-start .hero h1').is_visible())
    check('tool tiles present', page.locator('.tiles .tile').count() >= 8)  # more tools since office/pro release
    shot(page, 'desktop_home_empty')

    # ---- import 4 PDFs via file input
    def imp():
        page.set_input_files('#pdf-input', [os.path.join(TD, f) for f in ['bericht.pdf', 'anhang.pdf', 'formular.pdf', 'bild.pdf', 'unkomprimiert.pdf']])
        page.wait_for_function("document.querySelectorAll('#view-start .doc').length >= 5", timeout=20000)
        check('import 5 docs listed', page.locator('#view-start .doc').count() == 5)
        page.wait_for_function("Array.from(document.querySelectorAll('#view-start .doc-thumb img')).every(i => i.complete && i.naturalWidth > 0) && document.querySelectorAll('#view-start .doc-thumb img').length >= 5", timeout=15000)
        check('thumbnails rendered', True)
        meta = page.locator('#view-start .doc', has_text='bericht.pdf').locator('.doc-meta').inner_text()
        check('meta shows pages/size', '6 Seiten' in meta and 'KB' in meta, meta)
        page.wait_for_function(f"({DOCS_JS})().then(d => d.every(x => x.textReady))", timeout=20000)
        check('text index ready for all', True)
    step('import', imp)
    shot(page, 'desktop_home')

    # ---- star + tabs + rename via menu
    def star_menu():
        row = page.locator('#view-start .doc', has_text='anhang.pdf')
        row.locator('.star-btn').click()
        page.wait_for_timeout(300)
        page.locator('[data-tab="starred"]').click()
        page.wait_for_timeout(300)
        check('starred tab shows 1', page.locator('#view-start .doc').count() == 1)
        page.locator('[data-tab="recent"]').click()
        page.wait_for_timeout(300)
        page.locator('#view-start .doc', has_text='anhang.pdf').locator('.more-btn').click()
        page.locator('.menu-item', has_text='Umbenennen').click()
        page.locator('dialog .input').fill('Anhang Steuer.pdf')
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(500)
        check('rename works', page.locator('#view-start .doc', has_text='Anhang Steuer.pdf').count() == 1)
    step('star/rename', star_menu)

    # ---- viewer
    ids = {d['name']: d['id'] for d in docs(page)}

    def viewer():
        page.locator('#view-start .doc', has_text='bericht.pdf').locator('.doc-open').click()
        page.wait_for_selector('#viewer .textLayer span', timeout=15000)
        check('viewer text layer', page.locator('#viewer .page[data-page-number="1"] .textLayer span').count() > 10)
        check('page count shown', page.locator('[data-v="pagecount"]').inner_text() == '6')
        z0 = page.locator('[data-v="zoomval"]').inner_text()
        page.locator('[data-v="zoomin"]').click()
        page.wait_for_timeout(400)
        z1 = page.locator('[data-v="zoomval"]').inner_text()
        check('zoom in changes scale', z0 != z1, f'{z0} -> {z1}')
        page.locator('[data-v="fitpage"]').click()
        page.wait_for_timeout(300)
        page.locator('[data-v="fitwidth"]').click()
        page.wait_for_timeout(300)
        # find
        page.locator('[data-v="find"]').click()
        page.locator('[data-v="findinput"]').fill('Zitronenfalter')
        page.wait_for_function("document.querySelector('[data-v=findcount]').textContent.includes('1 von 1')", timeout=10000)
        check('find count 1 von 1', True)
        page.wait_for_selector('#viewer .textLayer .highlight', timeout=8000)
        check('find highlight visible', page.locator('#viewer .textLayer .highlight').count() >= 1)
        page.wait_for_timeout(500)
        check('find scrolled match into view', hl_visible(page), page.locator('[data-v="pagenum"]').input_value())
        page.locator('[data-v="findinput"]').fill('Testtext')
        page.wait_for_function("/von 180/.test(document.querySelector('[data-v=findcount]').textContent)", timeout=10000)
        check('find many matches', True, page.locator('[data-v="findcount"]').inner_text())
        page.locator('[data-v="findnext"]').click()
        page.wait_for_timeout(200)
        # panel thumbnails
        page.locator('[data-v="panel"]').click()
        page.wait_for_selector('#viewer .thumb-btn canvas', timeout=8000)
        check('thumbnail panel renders', page.locator('#viewer .thumb-btn').count() == 6)
        page.locator('#viewer .thumb-btn[data-page="2"]').click()
        page.wait_for_timeout(400)
        check('thumb click navigates', page.locator('[data-v="pagenum"]').input_value() == '2')
        page.locator('[data-ptab="outline"]').click()
        page.wait_for_timeout(300)
        check('outline tab empty msg', 'keine Gliederung' in page.locator('[data-v="outline"]').inner_text())
        page.locator('[data-ptab="thumbs"]').click()
        # page jump
        page.locator('[data-v="pagenum"]').fill('5')
        page.locator('[data-v="pagenum"]').press('Enter')
        page.wait_for_timeout(500)
        check('page jump to 5', page.locator('[data-v="pagenum"]').input_value() == '5')
        page.locator('[data-v="rotate"]').click()
        page.wait_for_timeout(500)
        page.locator('[data-v="night"]').click()
        page.wait_for_timeout(300)
        check('night mode class', 'night' in page.locator('#viewer').get_attribute('class'))
        shot(page, 'desktop_viewer_night')
        page.locator('[data-v="night"]').click()
        page.locator('[data-v="rotate"]').click()
        page.locator('[data-v="rotate"]').click()
        page.locator('[data-v="rotate"]').click()
        page.wait_for_timeout(500)
        page.locator('[data-v="pagenum"]').fill('4')
        page.locator('[data-v="pagenum"]').press('Enter')
        page.locator('[data-v="findinput"]').fill('Zitronenfalter')
        page.wait_for_timeout(900)
        shot(page, 'desktop_viewer')
        # read aloud
        page.locator('[data-v="read"]').click()
        page.wait_for_timeout(800)
        check('read bar visible', page.locator('[data-v="readbar"]').is_visible())
        check('read status text', 'Seite' in page.locator('[data-v="readstatus"]').inner_text() or 'Fertig' in page.locator('[data-v="readstatus"]').inner_text(), page.locator('[data-v="readstatus"]').inner_text())
        page.locator('[data-v="readstop"]').click()
        page.locator('[data-v="pagenum"]').fill('3')
        page.locator('[data-v="pagenum"]').press('Enter')
        # download from viewer
        with page.expect_download() as d:
            page.locator('[data-v="download"]').click()
        check('viewer download', d.value.suggested_filename == 'bericht.pdf', d.value.suggested_filename)
        # last page remembered
        page.wait_for_timeout(900)
        page.locator('[data-v="back"]').click()
        page.wait_for_timeout(500)
        check('viewer closed', page.locator('#viewer').is_hidden())
        page.locator('#view-start .doc', has_text='bericht.pdf').locator('.doc-open').click()
        page.wait_for_selector('#viewer .textLayer span', timeout=15000)
        page.wait_for_timeout(700)
        check('last page remembered', page.locator('[data-v="pagenum"]').input_value() == '3', page.locator('[data-v="pagenum"]').input_value())
        page.locator('[data-v="back"]').click()
        page.wait_for_timeout(300)
    step('viewer', viewer)

    # ---- global search
    def gsearch():
        goto_hash(page, '#/suche')
        page.locator('#global-search').fill('zitronenfalter')
        page.wait_for_selector('.result-hit', timeout=8000)
        check('global search finds doc', page.locator('.result-group').count() >= 1 and 'S. 4' in page.locator('.result-hit').first.inner_text())
        check('snippet highlighted', page.locator('.result-hit mark').first.inner_text().lower() == 'zitronenfalter')
        page.locator('#global-search').fill('Steuererklaerung')
        page.wait_for_timeout(600)
        check('search second doc', page.locator('.result-group', has_text='Anhang Steuer.pdf').count() == 1)
        page.locator('#global-search').fill('zitronenfalter')
        page.wait_for_timeout(600)
        page.locator('.result-hit').first.click()
        page.wait_for_selector('#viewer .textLayer .highlight', timeout=12000)
        page.wait_for_timeout(600)
        check('search opens viewer at match (p4/5)', page.locator('[data-v="pagenum"]').input_value() in ('4', '5') and hl_visible(page), page.locator('[data-v="pagenum"]').input_value())
        check('search term highlighted in viewer', page.locator('#viewer .textLayer .highlight').count() >= 1)
        page.locator('[data-v="back"]').click()
        page.wait_for_timeout(400)
    step('global search', gsearch)

    # ---- merge
    def merge():
        goto_hash(page, '#/werkzeug/zusammenfuegen')
        page.locator('[data-add]').click()
        page.locator('dialog .pick-item', has_text='bericht.pdf').locator('input').check()
        page.locator('dialog .pick-item', has_text='Anhang Steuer.pdf').locator('input').check()
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(400)
        check('merge list has 2', page.locator('.order-item').count() == 2)
        # reorder: move second up
        page.locator('.order-item').nth(1).locator('[data-up]').click()
        check('merge reorder', 'Anhang' in page.locator('.order-item').first.inner_text())
        shot(page, 'desktop_merge')
        page.locator('[data-merge]').click()
        page.wait_for_selector('.result-card', timeout=20000)
        path = download_result(page, 'merged.pdf')
        n, txt, ok, _ = pdf_info(path)
        check('merged pdf 9 pages (pypdf)', n == 9 and ok, str(n))
        check('merged order (Anhang first)', txt.find('Anhang 1') < txt.find('Kapitel 1'))
        check('merged pdf-lib load', node_pages(path).startswith('9 '), node_pages(path))
        goto_hash(page, '#/start')
    step('merge', merge)

    # ---- organize
    def organize():
        goto_hash(page, f"#/werkzeug/seiten?doc={ids['bericht.pdf']}")
        page.wait_for_selector('.pcard canvas', timeout=15000)
        check('organize grid 6', page.locator('.pcard').count() == 6)
        page.locator('.pcard').nth(0).locator('[data-r]').click()  # rotate p1
        page.locator('.pcard').nth(1).locator('[data-x]').click()  # delete p2
        page.wait_for_timeout(300)
        check('after delete 5', page.locator('.pcard').count() == 5)
        # drag card index 2 (orig p4) before card 0
        page.locator('.pcard').nth(2).drag_to(page.locator('.pcard').nth(0))
        page.wait_for_timeout(400)
        first_label = page.locator('.pcard').nth(0).locator('.pcard-num').inner_text()
        check('drag reorder moved p4 first', 'S. 4' in first_label, first_label)
        page.wait_for_timeout(500)
        shot(page, 'desktop_organize')
        page.locator('[data-save]').click()
        page.wait_for_selector('.result-card', timeout=20000)
        path = download_result(page, 'organized.pdf')
        n, txt, ok, r = pdf_info(path)
        check('organized 5 pages', n == 5 and ok, str(n))
        rots = [pg.get('/Rotate', 0) for pg in r.pages]
        check('organized rotation p2=90', rots[1] == 90 and rots[0] == 0, str(rots))
        t0 = r.pages[0].extract_text()
        check('organized first page is Kapitel 4', 'Kapitel 4' in t0)
        check('organized lost Kapitel 2', 'Kapitel 2' not in txt)
        # extract: select first two pages
        page.locator('.pcard').nth(0).locator('.pcard-thumb').click()
        page.locator('.pcard').nth(1).locator('.pcard-thumb').click()
        page.locator('[data-extract]').click()
        page.wait_for_function("document.querySelector('.result-card .result-title') && /extrahiert/.test(document.querySelector('.result-card .result-title').textContent)", timeout=20000)
        path = download_result(page, 'extracted.pdf')
        n, txt, ok, _ = pdf_info(path)
        check('extracted 2 pages', n == 2 and ok, str(n))
        # split
        page.locator('[data-split]').click()
        page.locator('dialog .btn-primary').click()
        page.wait_for_selector('.result-card [data-zip]', timeout=30000)
        with page.expect_download() as d:
            page.locator('.result-card [data-zip]').click()
        zp = os.path.join(OUT, 'split.zip')
        d.value.save_as(zp)
        with zipfile.ZipFile(zp) as z:
            names = z.namelist()
            check('split zip valid', z.testzip() is None and len(names) == 5, str(names[:2]))
            z.extract(names[0], OUT)
            n, _, ok, _ = pdf_info(os.path.join(OUT, names[0]))
            check('split part has 1 page', n == 1 and ok)
        goto_hash(page, '#/start')
    step('organize', organize)

    # ---- images -> PDF
    def images():
        goto_hash(page, '#/werkzeug/bilder')
        with page.expect_file_chooser() as fc:
            page.locator('[data-pick]').click()
        fc.value.set_files([os.path.join(TD, 'farbverlauf.png'), os.path.join(TD, 'foto.jpg')])
        page.wait_for_selector('.img-card img', timeout=5000)
        check('images listed', page.locator('.img-card').count() == 2)
        page.locator('[data-size="a4"]').click()
        shot(page, 'desktop_images')
        page.locator('[data-make]').click()
        page.wait_for_selector('.result-card', timeout=20000)
        path = download_result(page, 'images.pdf')
        n, _, ok, r = pdf_info(path)
        w, hgt = float(r.pages[0].mediabox.width), float(r.pages[0].mediabox.height)
        check('images pdf 2 pages A4 landscape', n == 2 and ok and abs(w - 841.89) < 1 and abs(hgt - 595.28) < 1, f'{n} {w}x{hgt}')
        goto_hash(page, '#/start')
    step('images', images)

    # ---- fill & sign
    def sign():
        goto_hash(page, f"#/werkzeug/unterschreiben?doc={ids['formular.pdf']}")
        page.wait_for_selector('.sign-page canvas', timeout=15000)
        check('form panel lists fields', page.locator('.form-panel [data-fi]').count() == 4)
        page.locator('.form-panel input.input').first.fill('Max Müller Łódź')
        page.locator('.form-panel input[type=checkbox]').first.check()
        sels = page.locator('.form-panel select')
        # tarif dropdown + zahlung radio (order of fields as created)
        for i in range(sels.count()):
            opts = sels.nth(i).locator('option').all_inner_texts()
            if 'Premium' in opts:
                sels.nth(i).select_option('Premium')
            if 'Lastschrift' in opts:
                sels.nth(i).select_option('Lastschrift')
        check('field overlay preview', page.locator('.field-ov.changed').count() >= 2)
        pg = page.locator('.sign-page').first
        box = pg.bounding_box()
        # text
        page.locator('[data-mode="text"]').click()
        page.mouse.click(box['x'] + box['width'] * 0.55, box['y'] + 60)
        page.wait_for_timeout(200)
        page.keyboard.type('Hallo Welt Zażółć')
        page.mouse.click(box['x'] + 5, box['y'] + 500)  # deselect
        # date
        page.locator('[data-mode="date"]').click()
        page.mouse.click(box['x'] + box['width'] * 0.62, box['y'] + 330)
        check('text + date items', page.locator('.s-item.s-textbox').count() == 2)
        # signature
        page.locator('[data-mode="sign"]').click()
        page.wait_for_selector('dialog .sig-pad')
        pad = page.locator('dialog .sig-pad').bounding_box()
        page.mouse.move(pad['x'] + 30, pad['y'] + 120)
        page.mouse.down()
        for i in range(1, 40):
            page.mouse.move(pad['x'] + 30 + i * 9, pad['y'] + 120 - 40 * ((i % 8) / 8.0))
        page.mouse.up()
        page.mouse.move(pad['x'] + 80, pad['y'] + 60)
        page.mouse.down()
        page.mouse.move(pad['x'] + 160, pad['y'] + 150, steps=8)
        page.mouse.up()
        shot(page, 'desktop_sign_pad')
        page.locator('dialog .btn-primary').click()
        page.wait_for_timeout(400)
        page.mouse.click(box['x'] + box['width'] * 0.35, box['y'] + 420)
        page.wait_for_selector('.s-item.s-image', timeout=5000)
        check('signature placed', page.locator('.s-item.s-image').count() == 1)
        # resize via handle
        it = page.locator('.s-item.s-image')
        b0 = it.bounding_box()
        hd = it.locator('.s-resize').bounding_box()
        page.mouse.move(hd['x'] + hd['width'] / 2, hd['y'] + hd['height'] / 2)
        page.mouse.down()
        page.mouse.move(hd['x'] + 60, hd['y'] + 30, steps=5)
        page.mouse.up()
        b1 = it.bounding_box()
        check('signature resized', b1['width'] > b0['width'] + 20, f"{b0['width']:.0f}->{b1['width']:.0f}")
        # drag move
        page.mouse.move(b1['x'] + 20, b1['y'] + 15)
        page.mouse.down()
        page.mouse.move(b1['x'] + 60, b1['y'] + 45, steps=5)
        page.mouse.up()
        b2 = it.bounding_box()
        check('signature moved', abs(b2['x'] - b1['x'] - 40) < 6, f"{b1['x']:.0f}->{b2['x']:.0f}")
        page.wait_for_timeout(300)
        shot(page, 'desktop_sign')
        page.locator('[data-save]').click()
        page.wait_for_selector('.result-card', timeout=20000)
        path = download_result(page, 'signed.pdf')
        n, txt, ok, r = pdf_info(path)
        check('signed pdf 1 page', n == 1 and ok)
        check('signed has form value (Unicode font for Polish letters)', 'Max Müller Łódź' in txt, txt[:200].replace('\n', ' '))
        check('signed has free text (Unicode)', 'Hallo Welt Zażółć' in txt, txt[:300].replace('\n', ' '))
        import datetime
        check('signed has date', datetime.date.today().strftime('%d.%m.%Y') in txt)
        res = node_pages(path)
        check('form flattened (0 fields)', res.endswith(' 0'), res)
        xo = r.pages[0]['/Resources'].get('/XObject', {})
        check('signature image embedded', any(xo[k].get_object().get('/Subtype') == '/Image' for k in xo), str(list(xo.keys())))
        # saved signature reuse
        goto_hash(page, f"#/werkzeug/unterschreiben?doc={ids['bericht.pdf']}")
        page.wait_for_selector('.sign-page canvas', timeout=15000)
        page.locator('[data-mode="sign"]').click()
        page.wait_for_selector('dialog .sig-saved-item', timeout=5000)
        check('saved signature offered', page.locator('dialog .sig-saved-item').count() == 1)
        page.locator('dialog .sig-saved-item').first.click()
        page.wait_for_timeout(300)
        bx = page.locator('.sign-page').first.bounding_box()
        page.mouse.click(bx['x'] + 200, bx['y'] + 300)
        check('saved signature placed', page.locator('.s-item.s-image').count() == 1)
        goto_hash(page, '#/start')
    step('sign', sign)

    # ---- compress
    def compress():
        goto_hash(page, f"#/werkzeug/komprimieren?doc={ids['unkomprimiert.pdf']}")
        page.wait_for_selector('[data-run]')
        page.locator('[data-run]').click()
        page.wait_for_selector('.compare', timeout=20000)
        page.wait_for_selector('.result-card', timeout=10000)
        check('lossless smaller', page.locator('.saving-pill').count() == 1, page.locator('.compare').inner_text().replace('\n', ' '))
        path = download_result(page, 'lossless.pdf')
        n, txt, ok, _ = pdf_info(path)
        check('lossless keeps text + pages', n == 6 and ok and 'Zitronenfalter' in txt and os.path.getsize(path) < os.path.getsize(os.path.join(TD, 'unkomprimiert.pdf')), f'{os.path.getsize(path)}')
        goto_hash(page, f"#/werkzeug/komprimieren?doc={ids['bild.pdf']}")
        page.wait_for_selector('[data-run]')
        page.locator('input[value="strong"]').check()
        check('strong warning visible', page.locator('[data-strong]').is_visible())
        page.locator('[data-run]').click()
        page.wait_for_selector('.result-card', timeout=30000)
        shot(page, 'desktop_compress')
        path = download_result(page, 'strong.pdf')
        n, _, ok, _ = pdf_info(path)
        check('strong 2 pages & smaller', n == 2 and ok and os.path.getsize(path) < os.path.getsize(os.path.join(TD, 'bild.pdf')), f'{os.path.getsize(path)} vs {os.path.getsize(os.path.join(TD, "bild.pdf"))}')
        goto_hash(page, '#/start')
    step('compress', compress)

    # ---- export
    def export():
        goto_hash(page, f"#/werkzeug/exportieren?doc={ids['bericht.pdf']}")
        page.wait_for_selector('[data-img]')
        page.locator('[data-dpi]').select_option('72')
        with page.expect_download(timeout=30000) as d:
            page.locator('[data-img]').click()
        zp = os.path.join(OUT, 'export.zip')
        d.value.save_as(zp)
        with zipfile.ZipFile(zp) as z:
            names = z.namelist()
            okz = z.testzip() is None
            pngs = [n for n in names if n.endswith('.png') and z.read(n)[:8] == b'\x89PNG\r\n\x1a\n']
            check('export zip with 6 PNGs', okz and len(pngs) == 6, str(names))
        from PIL import Image
        with zipfile.ZipFile(zp) as z:
            z.extract(names[0], OUT)
        im = Image.open(os.path.join(OUT, names[0]))
        check('exported PNG size ~ A4@72dpi', abs(im.width - 595) <= 2, str(im.size))
        page.locator('[data-range]').fill('2-3')
        page.locator('[data-fmt]').select_option('jpg')
        with page.expect_download(timeout=30000) as d:
            page.locator('[data-img]').click()
        d.value.save_as(os.path.join(OUT, 'export2.zip'))
        with zipfile.ZipFile(os.path.join(OUT, 'export2.zip')) as z:
            check('export range 2 JPGs', len(z.namelist()) == 2 and all(n.endswith('.jpg') for n in z.namelist()), str(z.namelist()))
        with page.expect_download() as d:
            page.locator('[data-txt]').click()
        tp = os.path.join(OUT, 'text.txt')
        d.value.save_as(tp)
        t = open(tp, encoding='utf-8-sig').read()
        check('text export contains term', 'Zitronenfalter' in t and '===== Seite 6 =====' in t)
        goto_hash(page, '#/start')
    step('export', export)

    # ---- password protected
    def password():
        page.set_input_files('#pdf-input', [os.path.join(TD, 'geschuetzt.pdf')])
        page.wait_for_selector('dialog input[type=password]', timeout=10000)
        page.locator('dialog input[type=password]').fill('falsch')
        page.locator('dialog .btn-primary').click()
        page.wait_for_selector('dialog .text-danger', timeout=10000)
        check('wrong password message', 'Falsches Passwort' in page.locator('dialog').inner_text())
        page.locator('dialog input[type=password]').fill('geheim')
        page.locator('dialog .btn-primary').click()
        page.wait_for_selector('#viewer .textLayer span', timeout=15000)
        check('encrypted doc opens in viewer', page.locator('#viewer').is_visible())
        d = doc_by_name(page, 'geschuetzt.pdf')
        check('encrypted flag stored', d and d['encrypted'])
        page.locator('[data-v="back"]').click()
        page.wait_for_timeout(400)
        check('lock icon in list', page.locator('#view-start .doc', has_text='geschuetzt.pdf').locator('.lock').count() == 1)
    step('password', password)

    # ---- tools page, password tile, files, settings
    def misc():
        goto_hash(page, '#/werkzeuge')
        page.wait_for_selector('.tool-card')
        check('tools page 8+ cards', page.locator('.tool-card').count() >= 8)  # tools grouped + office section
        shot(page, 'desktop_tools')
        page.locator('#view-werkzeuge .tool-card[data-tool="passwort"]').click()
        page.wait_for_selector('#tool-screen .chooser', timeout=10000)  # password tool now real: asks for a document
        check('password tile opens tool (document chooser)', page.locator('#tool-screen').is_visible())
        page.locator('#tool-screen [data-back]').click()
        page.wait_for_timeout(400)
        goto_hash(page, '#/dateien')
        page.wait_for_selector('[data-storage] .stat-row')
        check('storage estimate shown', 'belegt' in page.locator('[data-storage]').inner_text(), page.locator('[data-storage]').inner_text()[:120])
        shot(page, 'desktop_files')
        pb = page.locator('[data-storage] [data-persist]')
        if pb.count():
            pb.click()
            page.wait_for_timeout(800)
        goto_hash(page, '#/einstellungen/allgemein')
        page.locator('[data-theme-opt="dark"]').click()
        check('dark theme applied', page.evaluate("document.documentElement.dataset.theme") == 'dark')
        page.locator('#set-zoom').select_option('page-width')
        shot(page, 'desktop_settings_dark')
        goto_hash(page, '#/start')
        page.wait_for_timeout(300)
        shot(page, 'desktop_home_dark')
        goto_hash(page, '#/einstellungen/allgemein')
        page.locator('[data-theme-opt="auto"]').click()
        check('auto theme', page.evaluate("document.documentElement.dataset.theme") is None)
        # delete a doc via menu
        goto_hash(page, '#/start')
        before = len(docs(page))
        page.locator('#view-start .doc', has_text='unkomprimiert.pdf').first.locator('.more-btn').click()
        page.locator('.menu-item', has_text='Löschen').click()
        page.locator('dialog .btn-danger').click()
        page.wait_for_timeout(500)
        check('delete doc', len(docs(page)) == before - 1)
    step('misc', misc)

    # ---- service worker + offline
    def sw():
        page.evaluate("navigator.serviceWorker.ready.then(() => true)")
        page.wait_for_function("navigator.serviceWorker.controller !== null || true")
        reg = page.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && (r.active || r.installing || r.waiting)))")
        check('service worker registered', reg)
        page.wait_for_function("caches.keys().then(k => k.some(x => x.startsWith('falepdf-')))", timeout=30000)
        # wait for install complete
        page.wait_for_function("navigator.serviceWorker.getRegistration().then(r => r && r.active && r.active.state === 'activated')", timeout=60000)
        n = page.evaluate("caches.keys().then(k => caches.open(k.find(x => x.startsWith('falepdf-')))).then(c => c.keys()).then(k => k.length)")
        check('precache populated', n > 300, str(n))
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector('#view-start .doc', timeout=15000)
        check('works offline after reload', page.locator('#view-start .doc').count() >= 5)
        page.locator('#view-start .doc', has_text='bericht.pdf').first.locator('.doc-open').click()
        page.wait_for_selector('#viewer .textLayer span', timeout=15000)
        check('viewer works offline', True)
        page.locator('[data-v="back"]').click()
        ctx.set_offline(False)
    step('service worker', sw)

    browser.close()


# =====================================================================
def phone(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                              accept_downloads=True, locale='de-DE',
                              user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')
    page = ctx.new_page()
    attach_logging(page, 'phone')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')
    check('phone bottom nav visible', page.locator('.bottom-nav').is_visible())
    check('phone sidebar hidden', page.locator('.sidebar').is_hidden())

    def imp():
        page.set_input_files('#pdf-input', [os.path.join(TD, f) for f in ['bericht.pdf', 'formular.pdf', 'anhang.pdf']])
        page.wait_for_function("document.querySelectorAll('#view-start .doc').length >= 3", timeout=20000)
        page.wait_for_function("Array.from(document.querySelectorAll('#view-start .doc-thumb img')).every(i => i.complete && i.naturalWidth > 0)", timeout=15000)
        page.wait_for_timeout(500)
        sw = page.evaluate("document.documentElement.scrollWidth")
        check('phone no horizontal overflow', sw <= 390, str(sw))
        shot(page, 'phone_home')
    step('phone import', imp)
    ids = {d['name']: d['id'] for d in docs(page)}

    def viewer():
        page.locator('#view-start .doc', has_text='bericht.pdf').locator('.doc-open').tap()
        page.wait_for_selector('#viewer .textLayer span', timeout=15000)
        page.wait_for_timeout(600)
        shot(page, 'phone_viewer')
        # bottom bar fits
        bb = page.locator('.vbar-bottom').bounding_box()
        check('phone viewer bottom bar fits', bb['width'] <= 390)
        # auto-hide on scroll
        page.locator('[data-v="container"]').evaluate("c => { c.scrollTop = 0; }")
        page.wait_for_timeout(100)
        page.locator('[data-v="container"]').evaluate("c => { c.dispatchEvent(new WheelEvent('wheel', {deltaY: 100})); c.scrollTop = 400; c.dispatchEvent(new Event('scroll')); }")
        page.wait_for_timeout(100)
        page.locator('[data-v="container"]').evaluate("c => { c.dispatchEvent(new WheelEvent('wheel', {deltaY: 100})); c.scrollTop = 900; c.dispatchEvent(new Event('scroll')); }")
        page.wait_for_timeout(400)
        check('phone chrome auto-hides', 'chrome-hidden' in page.locator('#viewer').get_attribute('class'))
        page.locator('[data-v="container"]').evaluate("c => { c.dispatchEvent(new WheelEvent('wheel', {deltaY: -100})); c.scrollTop = 600; c.dispatchEvent(new Event('scroll')); }")
        page.wait_for_timeout(400)
        check('phone chrome reappears', 'chrome-hidden' not in page.locator('#viewer').get_attribute('class'))
        page.locator('[data-v="panel"]').tap()
        page.wait_for_selector('#viewer .v-panel.open .thumb-btn canvas', timeout=8000)
        page.wait_for_timeout(400)
        shot(page, 'phone_viewer_panel')
        page.locator('#viewer .thumb-btn[data-page="3"]').tap()
        page.wait_for_timeout(600)
        check('phone drawer closes + navigates', page.locator('[data-v="pagenum"]').input_value() == '3' and 'open' not in page.locator('.v-panel').get_attribute('class'))
        page.locator('[data-v="more"]').tap()
        page.wait_for_selector('.menu-layer.as-sheet .menu-item')
        shot(page, 'phone_viewer_menu')
        check('phone menu as sheet', page.locator('.menu-layer.as-sheet').count() == 1)
        page.locator('.menu-item', has_text='Nachtmodus').tap()
        page.wait_for_timeout(300)
        page.locator('[data-v="find"]').tap()
        page.locator('[data-v="findinput"]').fill('Fahrrad')
        page.wait_for_function("/von/.test(document.querySelector('[data-v=findcount]').textContent)", timeout=10000)
        check('phone find works', True)
        page.wait_for_timeout(300)
        shot(page, 'phone_viewer_find_night')
        # pinch zoom via CDP-less synthetic touch events
        z0 = page.locator('[data-v="zoomval"]').inner_text()
        page.evaluate("""() => { const c = document.querySelector('[data-v=container]');
            const mk = (x1, x2) => [new Touch({identifier: 1, target: c, clientX: x1, clientY: 400}), new Touch({identifier: 2, target: c, clientX: x2, clientY: 400})];
            c.dispatchEvent(new TouchEvent('touchstart', {touches: mk(150, 240), bubbles: true, cancelable: true}));
            c.dispatchEvent(new TouchEvent('touchmove', {touches: mk(100, 300), bubbles: true, cancelable: true}));
            c.dispatchEvent(new TouchEvent('touchend', {touches: [], bubbles: true, cancelable: true})); }""")
        page.wait_for_timeout(700)
        z1 = page.locator('[data-v="zoomval"]').inner_text()
        check('phone pinch zoom', z0 != z1, f'{z0} -> {z1}')
        page.locator('[data-v="findclose"]').tap()
        page.locator('[data-v="more"]').tap()
        page.locator('.menu-item', has_text='Nachtmodus').tap()
        page.locator('[data-v="back"]').tap()
        page.wait_for_timeout(400)
    step('phone viewer', viewer)

    def tools():
        page.locator('.bnav[data-nav="werkzeuge"]').tap()
        page.wait_for_selector('.tool-card')
        shot(page, 'phone_tools')
        page.locator('.bnav[data-nav="dateien"]').tap()
        page.wait_for_selector('[data-storage] .stat-row')
        shot(page, 'phone_files')
        page.locator('.topbar [data-nav="suche"]').tap()  # search moved from bottom nav to the top bar (bottom nav: Start/Dateien/Werkzeuge/Ich)
        page.locator('#global-search').fill('Kontoauszug')
        page.wait_for_selector('.result-hit', timeout=8000)
        shot(page, 'phone_search')
        check('phone global search', page.locator('.result-group').count() == 1)
    step('phone tools/files/search', tools)

    def organize():
        goto_hash(page, f"#/werkzeug/seiten?doc={ids['bericht.pdf']}")
        page.wait_for_selector('.pcard canvas', timeout=15000)
        check('phone move buttons visible', page.locator('.pcard').first.locator('[data-mr]').is_visible())
        page.locator('.pcard').first.locator('[data-mr]').tap()
        page.wait_for_timeout(300)
        check('phone move reorders', 'S. 2' in page.locator('.pcard').first.locator('.pcard-num').inner_text())
        page.wait_for_timeout(500)
        shot(page, 'phone_organize')
    step('phone organize', organize)

    def sign():
        goto_hash(page, f"#/werkzeug/unterschreiben?doc={ids['formular.pdf']}")
        page.wait_for_selector('.sign-page canvas', timeout=15000)
        page.locator('[data-mode="form"]').tap()
        page.wait_for_timeout(400)
        page.locator('.form-panel input.input').first.fill('Erika Mustermann')
        shot(page, 'phone_sign_form')
        page.locator('.form-panel [data-close]').tap()
        page.wait_for_timeout(300)
        page.locator('[data-mode="sign"]').tap()
        page.wait_for_selector('dialog .sig-pad')
        pad = page.locator('dialog .sig-pad').bounding_box()
        # draw with mouse emulation (touch drawing uses pointer events too)
        page.mouse.move(pad['x'] + 20, pad['y'] + 100)
        page.mouse.down()
        for i in range(1, 30):
            page.mouse.move(pad['x'] + 20 + i * 9, pad['y'] + 100 - 30 * ((i % 6) / 6.0))
        page.mouse.up()
        page.locator('dialog .btn-primary').tap()
        page.wait_for_timeout(300)
        bx = page.locator('.sign-page').first.bounding_box()
        page.mouse.click(bx['x'] + bx['width'] * 0.4, bx['y'] + bx['height'] * 0.66)
        page.wait_for_selector('.s-item.s-image')
        page.wait_for_timeout(300)
        shot(page, 'phone_sign')
        page.locator('[data-save]').tap()
        page.wait_for_selector('.result-card', timeout=20000)
        path = download_result(page, 'phone_signed.pdf')
        n, txt, ok, _ = pdf_info(path)
        check('phone signed pdf ok', n == 1 and ok and 'Erika Mustermann' in txt)
    step('phone sign', sign)

    def images():
        goto_hash(page, '#/werkzeug/bilder')
        check('camera button present', page.locator('[data-cam]').is_visible())
        with page.expect_file_chooser() as fc:
            page.locator('[data-cam]').tap()
        check('camera input uses capture', page.evaluate("!!document.querySelector('input[capture=environment]')"))
        fc.value.set_files([os.path.join(TD, 'foto.jpg')])
        page.wait_for_selector('.img-card img')
        page.wait_for_timeout(300)
        shot(page, 'phone_images')
        page.locator('[data-make]').tap()
        page.wait_for_selector('.result-card', timeout=20000)
        check('phone images->pdf', True)
    step('phone images', images)

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

"""E2E tests for the FaLe PDF "Plus" features (reading mode, compare, forms, crop, bookmarks, batch,
signature/stamp library, image tools, passport photo, QR codes, viewer improvements).
Run: python3 test_pdfplus.py [all|desktop|phone|shots][:step1,step2]   (server: 127.0.0.1:8795)
"""
import os, sys, json, re, zipfile, subprocess, traceback, io
import numpy as np
import cv2
from PIL import Image
from pypdf import PdfReader
import csp_compat  # noqa: F401 – CSP-safe wait_for_function
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pplus_common import (SP, TD, TDP, OUT, URL, console, ensure_server, launch, context, attach, docs, doc_id, goto,
                          import_pdfs, shot, set_theme)

ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
STEPS = set(ONLY.split(':', 1)[1].split(',')) if ':' in ONLY else None
ONLY = ONLY.split(':', 1)[0]
results = []
CUR = {'page': None}
for f in os.listdir(OUT):
    if f.startswith('t_') or f.startswith('fail_'):
        os.remove(os.path.join(OUT, f))


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    if STEPS and name not in STEPS:
        return
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        try:
            if CUR['page']:
                CUR['page'].screenshot(path=os.path.join(OUT, 'fail_' + re.sub(r'\W+', '_', name) + '.png'))
        except Exception:
            pass
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def dl(page, locator, name, timeout=30000):
    with page.expect_download(timeout=timeout) as d:
        locator.click()
    path = os.path.join(OUT, 't_' + name)
    d.value.save_as(path)
    return path


def pdftext(path):
    return subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout


def render_pdf_page(path, page=1, dpi=150):
    out = os.path.join(OUT, 't_render')
    subprocess.run(['pdftoppm', '-r', str(dpi), '-f', str(page), '-l', str(page), '-png', path, out], check=True)
    for f in sorted(os.listdir(OUT)):
        if f.startswith('t_render') and f.endswith('.png'):
            p = os.path.join(OUT, f)
            img = cv2.imread(p)
            os.remove(p)
            return img
    return None


def qr_decode(img):
    if img is None:
        return ''
    for det in (cv2.QRCodeDetector(),):
        val, pts, _ = det.detectAndDecode(img)
        if val:
            return val
    # try with a white border (crops without quiet zone)
    big = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    val, _, _ = cv2.QRCodeDetector().detectAndDecode(big)
    return val


def no_dialog(page):
    page.wait_for_function("!document.querySelector('dialog[open]')", timeout=8000)


PROFILE = {'vorname': 'Max', 'nachname': 'Mustermann', 'strasse': 'Musterweg', 'hausnummer': '5', 'plz': '66111', 'ort': 'Saarbrücken',
           'land': 'Deutschland', 'email': 'max@example.de', 'telefon': '0681 123456', 'geburtsdatum': '1990-02-01'}

MOCK_BARCODE = """
(() => {
  window.__qrValue = 'WIFI:T:WPA;S:FaLe Gast;P:geheim123;;';
  class BD {
    constructor(o) { this.o = o; }
    static async getSupportedFormats() { return ['qr_code', 'ean_13']; }
    async detect(src) {
      if (!window.__qrValue) return [];
      return [{ rawValue: window.__qrValue, format: 'qr_code', boundingBox: { x: 100, y: 100, width: 200, height: 200 },
        cornerPoints: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }] }];
    }
  }
  window.BarcodeDetector = BD;
})();
"""


def setup_docs(pg):
    pg.goto(URL)
    pg.wait_for_timeout(800)
    import_pdfs(pg, [os.path.join(TDP, n) for n in ['bericht_v1.pdf', 'bericht_v2.pdf', 'antrag.pdf', 'raender.pdf', 'nur_scan.pdf']])
    pg.evaluate("p => import('./js/extras/profile.js').then(m => m.setProfile(p))", PROFILE)


# ======================================================================================= desktop
def desktop(p):
    browser = launch(p)
    ctx = context(browser)
    pg = ctx.new_page()
    CUR['page'] = pg
    attach(pg, 'desktop')

    step('setup', lambda: setup_docs(pg))
    ids = {d['name']: d['id'] for d in docs(pg)}

    # ------------------------------------------------------------ viewer: progress, bookmarks, wake lock
    def viewer():
        did = ids['bericht_v1.pdf']
        goto(pg, f'#/ansicht/{did}', None)
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.locator('[data-v=next]').click()
        pg.wait_for_timeout(600)
        prog = pg.evaluate("id => import('./js/viewer.js').then(m => m.getReadingProgress(id))", did)
        check('viewer: getReadingProgress after page change', prog and prog['page'] == 2 and prog['pages'] == 3 and prog['updatedAt'] > 0, str(prog))
        pg.locator('[data-v=mark]').click()
        pg.wait_for_timeout(300)
        marks = pg.evaluate("id => JSON.parse(localStorage.getItem('fale-marks:' + id) || '[]')", did)
        check('viewer: page bookmark stored', len(marks) == 1 and marks[0]['page'] == 2, str(marks))
        check('viewer: bookmark button pressed', pg.locator('[data-v=mark]').get_attribute('aria-pressed') == 'true')
        pg.locator('[data-v=panel]').click()
        pg.locator('[data-ptab=marks]').click()
        pg.wait_for_selector('.v-marks li')
        check('viewer: bookmark list shows entry', pg.locator('.v-marks .v-mark-p').first.text_content().strip() == 'S. 2')
        shot(pg, 'desk_light_viewer_bookmarks')
        pg.locator('[data-v=prev]').click()
        pg.wait_for_timeout(300)
        pg.locator('.v-mark-go').first.click()
        pg.wait_for_timeout(500)
        check('viewer: bookmark jumps to page', pg.locator('[data-v=pagenum]').input_value() == '2')
        pg.locator('[data-v=panel]').click()
        pg.locator('[data-v=more]').click()
        items = pg.locator('.menu-item span').all_text_contents()
        check('viewer: menu has reading mode + wake lock + new tools', 'Lesemodus' in items and any(i.startswith('Bildschirm anlassen') for i in items) and 'Formular erstellen' in items, ', '.join(items[:8]))
        pg.locator('.menu-item', has_text='Bildschirm anlassen').click()
        pg.wait_for_timeout(500)
        check('viewer: wake lock setting stored', pg.evaluate("localStorage.getItem('fale-wakelock')") == '1')
    step('viewer', viewer)

    # ------------------------------------------------------------ reading mode
    def reflow():
        did = ids['bericht_v1.pdf']
        goto(pg, f'#/ansicht/{did}?seite=1', None)
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.locator('[data-v=reflow]').click()
        pg.wait_for_selector('.rf-doc p', timeout=15000)
        pg.wait_for_function("document.querySelector('[data-rf=more]').hidden", timeout=20000)
        heads = pg.locator('.rf-h').all_text_contents()
        check('reflow: headings detected', any('Zusammenfassung' in h for h in heads) and any('Ausblick' in h for h in heads), ' | '.join(heads))
        lv = pg.evaluate("Array.from(document.querySelectorAll('.rf-sec')).map(d => d.dataset.level).join(',')")
        check('reflow: heading levels (h1/h2)', '1' in lv and '2' in lv, lv)
        paras = pg.locator('.rf-doc p').all_text_contents()
        joined = ' '.join(paras)
        check('reflow: lines merged into paragraphs', any(len(t) > 300 for t in paras) and 'zwölf Prozent' in joined)
        pg.wait_for_selector('.rf-fig canvas', timeout=15000)
        check('reflow: image kept as inline figure', pg.locator('.rf-fig canvas').count() >= 1)
        # collapse a section
        sec = pg.locator('.rf-sec').nth(1)
        sec.locator('summary').first.click()
        check('reflow: section collapsible', pg.evaluate("!document.querySelectorAll('.rf-sec')[1].open"))
        sec.locator('summary').first.click()
        # settings
        pg.locator('[data-rf=settings]').click()
        pg.locator('[data-rf=bigger]').click(); pg.locator('[data-rf=bigger]').click()
        pg.locator('[data-th=sepia]').click()
        st = pg.evaluate("JSON.parse(localStorage.getItem('fale-reflow-settings'))")
        check('reflow: settings saved (size, theme)', st['size'] == 21 and st['theme'] == 'sepia', str(st))
        check('reflow: sepia applied', pg.evaluate("getComputedStyle(document.querySelector('.rf')).backgroundColor") == 'rgb(246, 238, 220)')
        shot(pg, 'desk_light_reflow_settings')
        pg.locator('[data-rf=settings]').click()
        # scroll to "2. Ausblick" and remember position
        pg.evaluate("Array.from(document.querySelectorAll('.rf-h')).find(e => e.textContent.includes('Ausblick')).scrollIntoView()")
        pg.wait_for_timeout(700)
        pos = pg.evaluate("id => JSON.parse(localStorage.getItem('fale-reflow-pos:' + id))", did)
        check('reflow: position remembered', pos and pos['p'] == 2, str(pos))
        pg.locator('[data-rf=close]').click()
        pg.wait_for_timeout(500)
        check('reflow: closing returns to the viewer at the reading page', pg.locator('.rf-overlay').count() == 0 and pg.locator('[data-v=pagenum]').input_value() == '2')
        # reopen → restored
        pg.locator('[data-v=reflow]').click()
        pg.wait_for_function("document.querySelector('[data-rf=more]') && document.querySelector('[data-rf=more]').hidden", timeout=20000)
        pg.wait_for_timeout(400)
        vis = pg.evaluate("""() => { const s = document.querySelector('.rf-scroll').getBoundingClientRect();
          const h = Array.from(document.querySelectorAll('.rf-h')).find(e => e.textContent.includes('Ausblick')).getBoundingClientRect();
          return h.top >= s.top - 30 && h.top < s.top + s.height / 2; }""")
        check('reflow: reopening restores the position', vis)
        pg.locator('[data-th=hell]').count()
        pg.evaluate("localStorage.setItem('fale-reflow-settings', JSON.stringify({size: 19, lead: 1.6, theme: 'auto', font: 'serif', width: 'normal'}))")
        pg.locator('[data-rf=close]').click()
        # scanned PDF fallback
        goto(pg, f"#/ansicht/{ids['nur_scan.pdf']}", None)
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.locator('[data-v=reflow]').click()
        pg.wait_for_selector('.rf-noscan', timeout=15000)
        check('reflow: scanned PDF shows the no-text message', 'keinen erkennbaren Text' in pg.locator('.rf-noscan').text_content())
        shot(pg, 'desk_light_reflow_scan')
        pg.locator('.rf-noscan [data-go]').click()
        pg.wait_for_timeout(300)
        check('reflow: fallback button returns to page view', pg.locator('.rf-overlay').count() == 0)
        # stand-alone tool screen
        goto(pg, f"#/werkzeug/lesemodus?doc={ids['bericht_v2.pdf']}", '.rf-doc p')
        pg.wait_for_function("document.querySelector('[data-rf=more]').hidden", timeout=20000)
        check('reflow tool screen: shows the new paragraph', 'Luxemburg' in pg.locator('.rf-doc').text_content())
        pg.locator('.rf-orig[data-go="2"]').click()
        pg.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=10000)
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.wait_for_timeout(500)
        check('reflow tool screen: "Original" opens the page in the viewer', pg.locator('[data-v=pagenum]').input_value() == '2')
    step('reflow', reflow)

    # ------------------------------------------------------------ compare
    def compare():
        goto(pg, f"#/werkzeug/vergleichen?doc={ids['bericht_v1.pdf']}", '.cmp-slot')
        pg.locator('[data-slot=b] button').click()
        pg.wait_for_selector('dialog .pick-item')
        pg.locator(f"dialog input[value=\"{ids['bericht_v2.pdf']}\"]").check()
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('.cmp-side canvas', timeout=30000)
        stats = pg.locator('.cmp-stats b').all_text_contents()
        check('compare: 3 changes (1 insert, 2 replaced)', stats == ['3', '1', '0', '2'], str(stats))
        check('compare: highlights drawn on both pages', pg.locator('.cmp-hl.rep-old').count() >= 1 and pg.locator('.cmp-hl.rep-new').count() >= 1)
        chips = pg.locator('.cmp-pagechip').all_text_contents()
        check('compare: per-page summary', len(chips) == 2 and chips[0].startswith('Seite 1'), str(chips))
        shot(pg, 'desk_light_compare_side')
        pg.locator('[data-view=text]').click()
        txt = ' '.join(pg.locator('.cmp-change').all_text_contents())
        check('compare: text view shows old/new words', 'zwölf' in txt and 'fünfzehn' in txt and 'Luxemburg' in txt)
        check('compare: deletions/insertions styled', pg.locator('.cmp-change del').count() >= 2 and pg.locator('.cmp-change ins').count() >= 3)
        pg.locator('[data-view=overlay]').click()
        pg.wait_for_selector('.cmp-overlay canvas', timeout=15000)
        leg = pg.locator('.cmp-legend').text_content()
        check('compare: overlay finds visual differences', '% der Fläche unterschiedlich' in leg, leg)
        shot(pg, 'desk_light_compare_overlay')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('.cmp-report .result-card', timeout=40000)
        path = dl(pg, pg.locator('.cmp-report [data-r=dl]'), 'compare_report.pdf')
        r = PdfReader(path)
        t = pdftext(path)
        check('compare: report PDF with summary, changes and page views', len(r.pages) >= 3 and 'Vergleichsbericht' in t and 'fünfzehn' in t and 'Luxemburg' in t, f'{len(r.pages)} pages')
    step('compare', compare)

    # ------------------------------------------------------------ form creation
    def formcreate():
        goto(pg, f"#/werkzeug/formular-erstellen?doc={ids['antrag.pdf']}", '.pt-page canvas')
        pg.locator('.pt-tool', has_text='Erkennen').click()
        pg.wait_for_selector('.fc-field', timeout=15000)
        pg.wait_for_timeout(500)
        names = pg.evaluate("Array.from(document.querySelectorAll('.fc-field .fc-name')).map(e => e.textContent)")
        types = pg.evaluate("Array.from(document.querySelectorAll('.fc-field')).map(e => e.className.split(' ')[1])")
        want = {'Vorname', 'Nachname', 'Straße', 'PLZ / Ort', 'E-Mail', 'Telefon', 'Datum', 'Unterschrift'}
        check('form: auto-detect finds labelled fields', want.issubset(set(names)), ', '.join(names))
        check('form: auto-detect finds checkboxes, date and signature', types.count('fc-check') == 2 and 'fc-date' in types and 'fc-sign' in types, str(types))
        shot(pg, 'desk_light_form_detect')
        # add a radio group and a dropdown by hand
        page_box = pg.locator('.pt-page[data-page="1"]').bounding_box()
        pg.locator('[data-tool=radio]').click()
        pg.mouse.click(page_box['x'] + page_box['width'] * 0.74, page_box['y'] + 480)
        pg.wait_for_selector('.fc-radio.sel')
        pg.locator('.pt-props button', has_text='Eigenschaften').click()
        pg.wait_for_selector('dialog textarea[name=opts]')
        pg.fill('dialog [name=name]', 'Zahlungsart')
        pg.fill('dialog textarea[name=opts]', 'Bar\nÜberweisung\nLastschrift')
        pg.fill('dialog [name=def]', 'Überweisung')
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        pg.locator('[data-tool=dropdown]').click()
        pg.mouse.click(page_box['x'] + page_box['width'] * 0.78, page_box['y'] + 290)
        pg.wait_for_selector('.fc-dropdown.sel')
        pg.locator('.pt-props button', has_text='Eigenschaften').click()
        pg.wait_for_selector('dialog textarea[name=opts]')
        pg.fill('dialog [name=name]', 'Tarif')
        pg.fill('dialog textarea[name=opts]', 'Basis\nPlus\nFamilie')
        pg.locator('dialog [name=req]').check()
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        # rename a detected field + required via props bar
        pg.locator('.fc-field', has=pg.locator('.fc-name', has_text='Telefon')).click()
        pg.locator('.fc-reqchk input').check()
        # undo / redo work
        n0 = pg.locator('.fc-field').count()
        pg.locator('[aria-label="Rückgängig"]').click()
        pg.locator('[aria-label="Wiederholen"]').click()
        check('form: undo/redo keeps fields', pg.locator('.fc-field').count() == n0)
        shot(pg, 'desk_light_form_edit')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('.pt-result .result-card', timeout=30000)
        path = dl(pg, pg.locator('.pt-result [data-r=dl]'), 'form.pdf')
        r = PdfReader(path)
        f = r.get_fields()
        ft = {k: (str(v.get('/FT')), int(v.get('/Ff', 0) or 0)) for k, v in f.items()}
        check('form: AcroForm text fields', all(ft.get(n, ('',))[0] == '/Tx' for n in ['Vorname', 'Nachname', 'Straße', 'E-Mail', 'Telefon', 'Datum']), str(ft))
        check('form: checkboxes', ft.get('Ich stimme den Bedingungen zu', ('',))[0] == '/Btn')
        zf = f.get('Zahlungsart') or {}
        check('form: radio group with options + default', ft.get('Zahlungsart', ('', 0))[0] == '/Btn' and ft['Zahlungsart'][1] & 32768 and list(zf.get('/Opt', [])) == ['Bar', 'Überweisung', 'Lastschrift'] and str(zf.get('/V')) == '/1' and len(zf.get('/Kids', [])) == 3, str(zf))
        check('form: dropdown (combo) with options, required', ft.get('Tarif', ('', 0))[0] == '/Ch' and ft['Tarif'][1] & 131072 and ft['Tarif'][1] & 2, str(f.get('Tarif')))
        check('form: signature field', ft.get('Unterschrift', ('',))[0] == '/Sig')
        check('form: required flag on Telefon', ft.get('Telefon', ('', 0))[1] & 2 == 2)
        date_aa = r.get_fields()['Datum'].indirect_reference.get_object().get('/AA') if r.get_fields()['Datum'].indirect_reference else None
        raw = open(path, 'rb').read()
        check('form: date field has format action', b'AFDate_FormatEx' in raw or (date_aa is not None))
        # fill the new form with the profile
        pg.locator('.pt-result button', has_text='Jetzt ausfüllen').click()
        pg.wait_for_selector('.form-panel', timeout=20000)
        pg.wait_for_selector('.sign-autofill', timeout=10000)
        check('sign: profile suggestions shown', pg.locator('.sign-prof').count() >= 5)
        pg.locator('.sign-autofill').click()
        pg.wait_for_timeout(300)
        vals = pg.evaluate("Object.fromEntries(Array.from(document.querySelectorAll('.form-panel input.input[data-fi]')).map(i => [i.closest('label').querySelector('.field-label').textContent, i.value]))")
        check('sign: autofill from profile', vals.get('Vorname') == 'Max' and vals.get('Nachname') == 'Mustermann' and vals.get('PLZ / Ort') == '66111 Saarbrücken' and vals.get('E-Mail') == 'max@example.de' and vals.get('Straße') == 'Musterweg 5', str(vals))
        shot(pg, 'desk_light_sign_autofill')
        pg.locator('[data-flatten]').uncheck()
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('.sign-stage .result-card', timeout=30000)
        path = dl(pg, pg.locator('.sign-stage [data-r=dl]'), 'filled.pdf')
        f2 = PdfReader(path).get_fields()
        check('sign: values saved, form stays fillable', f2 and str(f2['Nachname'].get('/V')) == 'Mustermann' and str(f2['Ort' if 'Ort' in f2 else 'PLZ / Ort'].get('/V')).startswith('66111'), str({k: v.get('/V') for k, v in (f2 or {}).items()})[:300])
    step('formcreate', formcreate)

    # ------------------------------------------------------------ crop
    def crop():
        goto(pg, f"#/werkzeug/zuschneiden?doc={ids['raender.pdf']}", '.cr-box')
        pg.locator('[data-auto]').click()
        pg.wait_for_timeout(1200)
        shot(pg, 'desk_light_crop')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=20000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'crop.pdf')
        r = PdfReader(path)
        boxes = [[round(float(v)) for v in pgx.cropbox] for pgx in r.pages]
        ok = all(140 <= b[0] <= 150 and 290 <= b[1] <= 300 and 450 <= b[2] <= 460 and 560 <= b[3] <= 570 for b in boxes)
        check('crop: CropBox set to content (both pages)', ok and len(boxes) == 2, str(boxes))
        check('crop: MediaBox unchanged by default', [round(float(v)) for v in r.pages[0].mediabox] == [0, 0, 595, 842])
        # manual: one page only, with MediaBox
        goto(pg, f"#/werkzeug/zuschneiden?doc={ids['bericht_v1.pdf']}", '.cr-box')
        pg.fill('[name=t]', '20'); pg.fill('[name=l]', '15')
        pg.locator('[data-scope=one]').click()
        pg.locator('[name=media]').check()
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=20000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'crop2.pdf')
        r = PdfReader(path)
        b0 = [round(float(v), 1) for v in r.pages[0].cropbox]; m0 = [round(float(v), 1) for v in r.pages[0].mediabox]
        b1 = [round(float(v)) for v in r.pages[1].cropbox]
        check('crop: manual margins in mm on one page (+MediaBox)', abs(b0[0] - 15 * 72 / 25.4) < 1 and abs(b0[3] - (841.9 - 20 * 72 / 25.4)) < 1 and m0 == b0 and b1 == [0, 0, 595, 842], f'{b0} {m0} {b1}')
    step('crop', crop)

    # ------------------------------------------------------------ bookmarks
    def bookmarks():
        goto(pg, f"#/werkzeug/lesezeichen?doc={ids['bericht_v1.pdf']}", '.bm-card')
        pg.locator('[data-gen]').click()
        pg.wait_for_selector('.bm-row', timeout=15000)
        rows = pg.locator('.bm-row .bm-title').all_text_contents()
        check('bookmarks: generated from headings', rows[:3] == ['Quartalsbericht 2026', '1. Zusammenfassung', '1.1 Details'] and len(rows) == 6, str(rows))
        # rename the first, delete the title entry, move "3. Anhang" up, add one
        pg.locator('.bm-row').first.click()
        pg.locator('[data-act=del]').click()
        pg.locator('.bm-row', has_text='3. Anhang').click()
        pg.locator('[data-act=up]').click()
        pg.locator('[data-add]').click()
        pg.wait_for_selector('dialog [name=t]')
        pg.fill('dialog [name=t]', 'Kontakt')
        pg.fill('dialog [name=p]', '3')
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        pg.locator('[data-act=in]').click()
        shot(pg, 'desk_light_bookmarks')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=20000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'bookmarks.pdf')
        r = PdfReader(path)
        flat = []
        def walk(o, d=0):
            for x in o:
                if isinstance(x, list):
                    walk(x, d + 1)
                else:
                    flat.append((d, x.title, r.get_destination_page_number(x) + 1))
        walk(r.outline)
        check('bookmarks: outline written with nesting and order', flat == [(0, '1. Zusammenfassung', 1), (1, '1.1 Details', 1), (0, '3. Anhang', 3), (1, 'Kontakt', 3), (0, '2. Ausblick', 2), (1, '2.1 Risiken', 2)], str(flat))
        check('bookmarks: document opens with outline panel', str(r.trailer['/Root'].get('/PageMode')) == '/UseOutlines')
    step('bookmarks', bookmarks)

    # ------------------------------------------------------------ batch
    def batch():
        def pick_all(names):
            pg.locator('[data-lib]').click()
            pg.wait_for_selector('dialog .pick-item')
            for n in names:
                pg.locator(f'dialog input[value="{ids[n]}"]').check()
            pg.locator('dialog .btn-primary').click()
            no_dialog(pg)
        goto(pg, '#/werkzeug/stapel', '.bt-action')
        pick_all(['bericht_v1.pdf', 'bericht_v2.pdf', 'raender.pdf'])
        pg.set_input_files('.screen-body input[type=file]', []) if pg.locator('.screen-body input[type=file]').count() else None
        # add an image from the device
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-dev]').click()
        fc.value.set_files(os.path.join(TDP, 'chart.png'))
        pg.wait_for_timeout(300)
        check('batch: 4 inputs listed (3 PDFs + image)', pg.locator('.bt-item').count() == 4)
        # watermark
        pg.locator('[data-action=watermark]').click()
        pg.fill('[data-opts] [name=text]', 'ENTWURF')
        pg.locator('[data-save]').uncheck()
        shot(pg, 'desk_light_batch')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'batch_wm.zip')
        z = zipfile.ZipFile(path)
        names = z.namelist()
        ok = len(names) == 4 and all(n.endswith('(Wasserzeichen).pdf') for n in names)
        found = []
        for n in names:
            rr = PdfReader(io.BytesIO(z.read(n)))
            data = rr.pages[0].get_contents().get_data()
            found.append(b'454E5457555246' in data.upper() or b'(ENTWURF)' in data)
        check('batch: watermark on all files (ZIP)', ok and all(found), f'{names} {found}')
        check('batch: per-file status done', pg.locator('.bt-st.bt-done').count() == 4)
        # protect
        pg.locator('[data-action=protect]').click()
        pg.fill('[data-opts] [name=pw1]', 'test1234'); pg.fill('[data-opts] [name=pw2]', 'test1234')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'batch_pw.zip')
        z = zipfile.ZipFile(path)
        enc = []
        for n in z.namelist():
            rr = PdfReader(io.BytesIO(z.read(n)))
            enc.append(rr.is_encrypted and rr.decrypt('test1234') > 0)
        check('batch: all files encrypted (AES, password works)', len(enc) == 4 and all(enc), str(enc))
        # compress strong
        pg.locator('[data-action=compress]').click()
        pg.locator('[data-cm=strong]').click()
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=60000)
        check('batch: compress shows sizes per file', pg.locator('.bt-st.bt-done').count() == 4 and '→' in pg.locator('.bt-st').first.text_content())
        # images
        pg.locator('[data-action=images]').click()
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'batch_img.zip')
        nl = zipfile.ZipFile(path).namelist()
        check('batch: pages as images in folders', len(nl) == 3 + 3 + 2 + 1 and all(n.endswith('.jpg') for n in nl) and len({n.split('/')[0] for n in nl}) == 4, str(nl[:4]))
        # merge in order (move image to the front)
        pg.locator('.bt-item').nth(3).locator('[data-up]').click()
        pg.locator('.bt-item').nth(2).locator('[data-up]').click()
        pg.locator('.bt-item').nth(1).locator('[data-up]').click()
        order = pg.locator('.bt-item .doc-name').all_text_contents()
        pg.locator('[data-action=merge]').click()
        pg.locator('[data-save]').check()
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'batch_merge.pdf')
        r = PdfReader(path)
        t1 = r.pages[1].extract_text()
        exp = 'Inhalt Seite 1' if order[1].startswith('raender') else 'Quartalsbericht'
        check('batch: merged in list order (image first, 9 pages)', len(r.pages) == 9 and order[0] == 'chart.png' and len(r.pages[0].extract_text().strip()) == 0 and exp in t1, f'{len(r.pages)} pages, order {order}')
    step('batch', batch)

    # ------------------------------------------------------------ signatures & stamps
    def signatures():
        goto(pg, '#/werkzeug/signaturen', '.ss-grid')
        pg.locator('.ss-section').nth(0).locator('.ss-new').click()
        pg.wait_for_selector('dialog .sig-pad')
        pg.wait_for_timeout(300)
        bb = pg.locator('dialog .sig-pad').bounding_box()
        pg.mouse.move(bb['x'] + 30, bb['y'] + 110); pg.mouse.down()
        for i in range(40):
            pg.mouse.move(bb['x'] + 30 + i * 8, bb['y'] + 110 + (25 if i % 3 == 0 else -15 if i % 3 == 1 else 0), steps=2)
        pg.mouse.up()
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        # typed initials
        pg.locator('.ss-section').nth(1).locator('.ss-new').click()
        pg.wait_for_selector('dialog [data-mode=type]')
        pg.locator('dialog [data-mode=type]').click()
        pg.fill('dialog [name=typed]', 'M. M.')
        pg.locator('dialog .ss-font').nth(1).click()
        shot(pg, 'desk_light_sig_typed')
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        # stamp
        pg.locator('.ss-section').nth(2).locator('.ss-new').click()
        pg.wait_for_selector('dialog [data-preset=firma]')
        pg.locator('dialog [data-preset=firma]').click()
        pg.fill('dialog [name=lines]', 'FaLe GmbH\nHauptstraße 1\n66111 Saarbrücken')
        pg.locator('dialog [data-border=oval]').click()
        shot(pg, 'desk_light_stamp_designer')
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        pg.wait_for_timeout(500)
        counts = [pg.locator('.ss-section').nth(i).locator('.ss-manage').count() for i in range(3)]
        check('library: signature, initials and stamp saved', counts == [1, 1, 1], str(counts))
        kinds = pg.evaluate("import('./js/tools/sigstore.js').then(m => m.listAssets()).then(l => l.map(a => a.kind).sort())")
        check('library: stored in IndexedDB with kinds', kinds == ['initials', 'signature', 'stamp'], str(kinds))
        shot(pg, 'desk_light_sig_library')
        # place stamp + signature in "Ausfüllen & unterschreiben" (one tap each)
        goto(pg, f"#/werkzeug/unterschreiben?doc={ids['bericht_v2.pdf']}", '.sign-page canvas')
        pg.locator('[data-mode=stamp]').click()
        pg.wait_for_selector('dialog .ss-item img')
        pg.locator('dialog .ss-item:not(.ss-new)').first.click()
        no_dialog(pg)
        pg.wait_for_selector('[data-mode=stamp][aria-pressed=true]')
        pb = pg.locator('.sign-page[data-page="1"]').bounding_box()
        pg.mouse.click(pb['x'] + pb['width'] * 0.7, pb['y'] + 120)
        pg.locator('[data-mode=sign]').click()
        pg.wait_for_selector('dialog .ss-item img')
        pg.locator('dialog .ss-item:not(.ss-new)').first.click()
        no_dialog(pg)
        pg.wait_for_selector('[data-mode=sign][aria-pressed=true]')
        pg.mouse.click(pb['x'] + pb['width'] * 0.3, pb['y'] + 220)
        check('sign: stamp and signature placed', pg.locator('.s-item.s-image').count() == 2)
        shot(pg, 'desk_light_sign_stamp')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('.sign-stage .result-card', timeout=30000)
        path = dl(pg, pg.locator('.sign-stage [data-r=dl]'), 'signed.pdf')
        res = PdfReader(path).pages[0]['/Resources']
        xo = res.get('/XObject') or {}
        check('sign: images embedded in page', len([k for k in xo.keys()]) >= 2, str(list(xo.keys())))
        # annotate: stamp tool → /Stamp annotation
        goto(pg, f"#/werkzeug/kommentieren?doc={ids['bericht_v2.pdf']}", '.pt-page canvas')
        pg.locator('[data-tool=stamp]').click()
        pg.wait_for_selector('dialog .ss-item img')
        pg.locator('dialog .ss-item:not(.ss-new)').first.click()
        no_dialog(pg)
        pg.wait_for_selector('[data-tool=stamp][aria-pressed=true]')
        pb = pg.locator('.pt-page[data-page="1"]').bounding_box()
        pg.mouse.click(pb['x'] + pb['width'] * 0.6, pb['y'] + 160)
        pg.wait_for_timeout(300)
        check('annotate: stamp placed and selected', pg.locator('.pt-page svg image').count() == 1)
        shot(pg, 'desk_light_annotate_stamp')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('.pt-result .result-card', timeout=30000)
        path = dl(pg, pg.locator('.pt-result [data-r=dl]'), 'annot_stamp.pdf')
        subs = [str(a.get_object().get('/Subtype')) for a in (PdfReader(path).pages[0].get('/Annots') or [])]
        check('annotate: saved as /Stamp annotation with appearance', '/Stamp' in subs, str(subs))
        img = render_pdf_page(path, 1, 72)
        crop = img[30:230, int(img.shape[1] * 0.4):int(img.shape[1] * 0.85)]
        colored = int((crop.max(2).astype(int) - crop.min(2).astype(int) > 70).sum())
        check('annotate: stamp visible when rendered', colored > 200, str(colored))
    step('signatures', signatures)

    # ------------------------------------------------------------ image tools
    def imagetools():
        def open_img(name):
            goto(pg, '#/werkzeug/bildwerkzeuge', None)
            pg.wait_for_selector('[data-pick], .it-canvas', timeout=10000)
            if pg.locator('[data-pick]').count():
                with pg.expect_file_chooser() as fc:
                    pg.locator('[data-pick]').click()
            else:
                with pg.expect_file_chooser() as fc:
                    pg.locator('.screen-foot [aria-label="Anderes Bild öffnen"]').click()
            fc.value.set_files(os.path.join(TDP, name))
            pg.wait_for_selector('.it-canvas', timeout=15000)
            pg.wait_for_timeout(300)

        def apply(tool, wait=1500):
            pg.locator(f'[data-tool={tool}]').click()
            pg.wait_for_timeout(wait)
            pg.locator('[data-apply]').click()
            pg.wait_for_function("document.querySelector('[data-busy]').hidden && !document.querySelector('[data-apply]')", timeout=60000)

        def export(name, fmt='png', kb=None):
            pg.locator('.screen-foot .btn', has_text='Bild').click()
            pg.wait_for_selector('dialog [data-fmt]')
            pg.locator(f'dialog [data-fmt={fmt}]').click()
            if kb:
                pg.fill('dialog [name=kb]', str(kb))
            with pg.expect_download(timeout=60000) as d:
                pg.locator('dialog .btn-primary').click()
            path = os.path.join(OUT, 't_' + name)
            d.value.save_as(path)
            no_dialog(pg)
            return path

        def flat_std(a, region):
            y0, y1, x0, x1 = region
            g = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)[y0:y1, x0:x1].astype(float)
            return g.std(), g.mean()

        # shadow removal: paper brightness becomes even
        open_img('schatten.jpg')
        apply('shadow')
        shot(pg, 'desk_light_imagetools')
        out = cv2.imread(export('shadow.png'))
        src = cv2.imread(os.path.join(TDP, 'schatten.jpg'))
        # paper strip between text lines across the whole width
        s0, m0 = flat_std(src, (128, 145, 50, 1150)); s1, m1 = flat_std(out, (128, 145, 50, 1150))
        check('image: shadow removal evens out the paper', s1 < s0 * 0.4 and m1 > m0, f'std {s0:.1f}→{s1:.1f}, mean {m0:.0f}→{m1:.0f}')
        # sharpen: more high-frequency energy
        open_img('unscharf.png')
        apply('sharpen')
        out = cv2.imread(export('sharp.png'))
        src = cv2.imread(os.path.join(TDP, 'unscharf.png'))
        lv = lambda a: cv2.Laplacian(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        check('image: one-tap sharpen increases detail', lv(out) > lv(src) * 1.6, f'{lv(src):.0f} → {lv(out):.0f}')
        # enhance: less noise in flat areas
        open_img('rauschen.png')
        apply('enhance', 2500)
        out = cv2.imread(export('enhance.png'))
        src = cv2.imread(os.path.join(TDP, 'rauschen.png'))
        s0, _ = flat_std(src, (60, 100, 300, 860)); s1, _ = flat_std(out, (60, 100, 300, 860))
        check('image: enhance reduces noise', s1 < s0 * 0.75, f'{s0:.1f} → {s1:.1f}')
        # moiré: high-frequency pattern energy drops
        open_img('moire.png')
        apply('moire', 2000)
        out = cv2.imread(export('moire_out.png'))
        src = cv2.imread(os.path.join(TDP, 'moire.png'))
        hf = lambda a: np.abs(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(float) - cv2.GaussianBlur(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(float), (0, 0), 3)).mean()
        check('image: moiré reduced', hf(out) < hf(src) * 0.5, f'{hf(src):.1f} → {hf(out):.1f}')
        # filter black & white
        pg.locator('[data-tool=filter]').click()
        pg.wait_for_timeout(1500)
        pg.locator('[data-look=sw]').click()
        pg.wait_for_timeout(800)
        pg.locator('[data-apply]').click()
        pg.wait_for_function("document.querySelector('[data-busy]').hidden && !document.querySelector('[data-apply]')", timeout=30000)
        # crop: rotate right + straighten + resize
        pg.locator('[data-tool=crop]').click()
        pg.locator('[data-rot="90"]').click()
        pg.wait_for_timeout(300)
        pg.locator('[data-tool=size]').click()
        pg.locator('.it-chips [data-pct="50"]').click()
        pg.locator('[data-apply]').click()
        pg.wait_for_timeout(500)
        out = export('final.jpg', 'jpg', 40)
        im = Image.open(out)
        arr = np.asarray(im.convert('RGB')).astype(int)
        sat = (arr.max(2) - arr.min(2)).mean()
        check('image: B/W filter, rotate 90°, resize 50 %', im.size == (300, 450) and sat < 6, f'{im.size} sat={sat:.1f}')
        check('image: target size in KB respected', os.path.getsize(out) <= 40 * 1024, str(os.path.getsize(out)))
        # export as PDF
        pg.locator('.screen-foot .btn', has_text='Als PDF').click()
        pg.wait_for_selector('.it-result .result-card:has-text("PDF erstellt")', timeout=20000)
        check('image: saved as PDF to library', 'PDF erstellt' in pg.locator('.it-result').text_content())
        # compress many images
        goto(pg, '#/werkzeug/bilder-komprimieren', '[data-pick]')
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-pick]').click()
        fc.value.set_files([os.path.join(TDP, 'rauschen.png'), os.path.join(TDP, 'schatten.jpg')])
        pg.wait_for_selector('.img-card')
        pg.fill('[name=kb]', '60')
        pg.locator('[data-fmt=webp]').click()
        shot(pg, 'desk_light_compress_images')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=60000)
        path = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'imgs.zip')
        z = zipfile.ZipFile(path)
        sizes = [i.file_size for i in z.infolist()]
        check('compress images: ZIP with WebP files under target', len(sizes) == 2 and all(s <= 60 * 1024 for s in sizes) and all(n.endswith('.webp') for n in z.namelist()), str(list(zip(z.namelist(), sizes))))
    step('imagetools', imagetools)

    # ------------------------------------------------------------ passport photo
    def passphoto():
        goto(pg, '#/werkzeug/passfoto', '.pp-tpls')
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-pick]').click()
        fc.value.set_files(os.path.join(TDP, 'portrait.jpg'))
        pg.wait_for_selector('.pp-frame', timeout=10000)
        pg.wait_for_timeout(400)
        # zoom + drag the photo so that the head fills the template
        pg.fill('[name=zoom]', '1.5')
        pg.locator('[name=zoom]').dispatch_event('input')
        fb = pg.locator('.pp-frame').bounding_box()
        pg.mouse.move(fb['x'] + fb['width'] / 2, fb['y'] + fb['height'] / 2)
        pg.mouse.down(); pg.mouse.move(fb['x'] + fb['width'] / 2, fb['y'] + fb['height'] / 2 + 40, steps=5); pg.mouse.up()
        # background lightening
        pg.locator('[data-tab=bg]').click()
        pg.locator('[data-bgmode]').click()
        pg.mouse.click(fb['x'] + 6, fb['y'] + 6)
        pg.wait_for_timeout(500)
        pg.locator('[data-tab=check]').click()
        check('passfoto: checklist and disclaimer', pg.locator('.pp-check li').count() >= 7 and 'Behörde' in pg.locator('.pp-disclaimer').text_content())
        shot(pg, 'desk_light_passfoto_check')
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-sheet] canvas', timeout=15000)
        shot(pg, 'desk_light_passfoto_export')
        with pg.expect_download() as d:
            pg.locator('[data-dl1]').click()
        p1 = os.path.join(OUT, 't_pass.jpg'); d.value.save_as(p1)
        im = Image.open(p1)
        check('passfoto: single photo 35×45 mm at 600 dpi', im.size == (827, 1063), str(im.size))
        px = np.asarray(im.convert('RGB'))
        corner = px[20:60, 20:60].reshape(-1, 3).mean(0)
        check('passfoto: background lightened to light grey', all(abs(c - 232) < 12 for c in corner), str(corner))
        with pg.expect_download() as d:
            pg.locator('[data-dlsheet]').click()
        p2 = os.path.join(OUT, 't_sheet.jpg'); d.value.save_as(p2)
        sh = Image.open(p2)
        check('passfoto: print sheet 10×15 cm (600 dpi)', sh.size == (3543, 2362), str(sh.size))
        g = np.asarray(sh.convert('L')).astype(int)
        # count photo blocks: dark-ish columns/rows of photos on white
        cols = (g < 245).mean(0) > 0.3
        runs = np.diff(np.concatenate([[0], cols.astype(int), [0]]))
        check('passfoto: 3 columns of photos on the sheet', int((runs == 1).sum()) == 3, str(int((runs == 1).sum())))
        pg.locator('[data-pdf]').click()
        pg.wait_for_selector('[data-result] .result-card:has-text("Druckbogen als PDF")', timeout=20000)
        p3 = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'sheet.pdf')
        r = PdfReader(p3)
        mb = [round(float(v), 1) for v in r.pages[0].mediabox]
        content = r.pages[0].get_contents().get_data().decode('latin-1')
        draws = [(a, b) for a, b in re.findall(r'([\d.]+) 0 0 ([\d.]+) 0 0 cm', content) if (float(a), float(b)) != (1.0, 1.0)]
        sizes = {(round(float(a), 1), round(float(b), 1)) for a, b in draws}
        check('passfoto: PDF sheet 150×100 mm with 6 photos at 35×45 mm', mb == [0, 0, 425.2, 283.5] and len(draws) == 6 and sizes == {(99.2, 127.6)}, f'{mb} {len(draws)} {sizes}')
        # US template
        pg.locator('.screen-foot .btn').click()
        pg.locator('.screen-foot .btn-ghost', has_text='Neues Foto').click()
        pg.locator('[data-tpl=us]').click()
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-pick]').click()
        fc.value.set_files(os.path.join(TDP, 'portrait.jpg'))
        pg.wait_for_selector('.pp-frame', timeout=10000)
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('[data-sheet] canvas', timeout=15000)
        with pg.expect_download() as d:
            pg.locator('[data-dl1]').click()
        p4 = os.path.join(OUT, 't_pass_us.jpg'); d.value.save_as(p4)
        check('passfoto: US visa 2×2 inch = 1200×1200 px', Image.open(p4).size == (1200, 1200), str(Image.open(p4).size))
        check('passfoto: US sheet offers 2 photos', pg.locator('[data-counts] button').all_text_contents() == ['2'])
    step('passphoto', passphoto)

    # ------------------------------------------------------------ QR create
    def qrcreate():
        goto(pg, '#/werkzeug/qr-erstellen', '.qt-types')
        url = 'https://fale.dev/pdf?test=äöü&n=1'
        pg.fill('[name=url]', url)
        pg.wait_for_timeout(200)
        with pg.expect_download() as d:
            pg.locator('[data-exp=png]').click()
        p1 = os.path.join(OUT, 't_qr.png'); d.value.save_as(p1)
        check('qr: PNG decodes to the URL', qr_decode(cv2.imread(p1)) == url, qr_decode(cv2.imread(p1)))
        # WLAN with high ECC
        pg.locator('[data-type=wifi]').click()
        pg.fill('[name=ssid]', 'FaLe Gast')
        pg.fill('[name=password]', 'p;a:ss"w,ord')
        pg.locator('.pt-details summary').click()
        pg.select_option('[name=ecc]', 'H')
        pg.wait_for_timeout(200)
        with pg.expect_download() as d:
            pg.locator('[data-exp=png]').click()
        p2 = os.path.join(OUT, 't_qr_wifi.png'); d.value.save_as(p2)
        v = qr_decode(cv2.imread(p2))
        check('qr: WLAN payload (escaped) decodes', v == 'WIFI:T:WPA;S:FaLe Gast;P:p\\;a\\:ss\\"w\\,ord;;', v)
        shot(pg, 'desk_light_qr_wifi')
        # vCard → SVG + PDF
        pg.locator('[data-type=vcard]').click()
        pg.wait_for_timeout(200)
        check('qr: contact prefilled from profile', pg.locator('[name=nachname]').input_value() == 'Mustermann')
        with pg.expect_download() as d:
            pg.locator('[data-exp=svg]').click()
        p3 = os.path.join(OUT, 't_qr.svg'); d.value.save_as(p3)
        svg = open(p3).read()
        check('qr: SVG export is vector', svg.startswith('<svg') and '<path d="M' in svg)
        pg.locator('[data-exp=pdf]').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=20000)
        p4 = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'qr.pdf')
        v = qr_decode(render_pdf_page(p4, 1, 150))
        check('qr: PDF (vector) decodes to the vCard', v.startswith('BEGIN:VCARD') and 'Mustermann' in v, v[:60])
        # long text → higher version
        pg.locator('[data-type=text]').click()
        long = ('Lorem ipsum dolor sit amet, ' * 40)[:1000]
        pg.fill('[name=text]', long)
        pg.wait_for_timeout(300)
        info = pg.locator('[data-info]').text_content()
        with pg.expect_download() as d:
            pg.locator('[data-exp=png]').click()
        p5 = os.path.join(OUT, 't_qr_long.png'); d.value.save_as(p5)
        check('qr: 1000-byte text (high version) decodes', qr_decode(cv2.imread(p5)) == long, info)
        # stamp onto a PDF page
        pg.locator('[data-type=url]').click()
        pg.fill('[name=url]', 'https://fale.dev')
        pg.locator('[data-choose]').click()
        pg.wait_for_selector('dialog .pick-item')
        pg.locator(f"dialog input[value=\"{ids['raender.pdf']}\"]").check()
        pg.locator('dialog .btn-primary').click()
        no_dialog(pg)
        pg.wait_for_selector('.qt-mark svg', timeout=15000)
        pg.locator('[data-corner=tl]').click()
        pg.fill('[data-stamp] [name=size]', '40')
        pg.locator('[data-stamp] [name=size]').dispatch_event('input')
        shot(pg, 'desk_light_qr_stamp')
        pg.locator('[data-apply]').click()
        pg.wait_for_selector('[data-result] .result-card', timeout=20000)
        p6 = dl(pg, pg.locator('[data-result] [data-r=dl]'), 'qr_stamp.pdf')
        img = render_pdf_page(p6, 1, 150)
        tl = img[0:int(img.shape[0] * 0.3), 0:int(img.shape[1] * 0.45)]
        check('qr: stamped code on the PDF page decodes', qr_decode(tl) == 'https://fale.dev', qr_decode(tl))
    step('qrcreate', qrcreate)

    # ------------------------------------------------------------ QR scan (mocked BarcodeDetector)
    def qrscan():
        c2 = context(browser)
        c2.add_init_script(MOCK_BARCODE)
        p2 = c2.new_page()
        attach(p2, 'desk-qr')
        CUR['page'] = p2
        p2.goto(URL + '#/werkzeug/qr-scannen')
        p2.wait_for_selector('.qs-sheet', timeout=20000)
        check('qr scan: WLAN code recognised from camera', 'FaLe Gast' in p2.locator('.qs-sheet').text_content())
        check('qr scan: password hidden until revealed', 'geheim123' not in p2.locator('.qs-sheet').text_content())
        p2.locator('[data-showpw]').click()
        check('qr scan: password revealed', 'geheim123' in p2.locator('.qs-sheet').text_content())
        p2.locator('[data-act=copypw]').click()
        p2.wait_for_timeout(300)
        check('qr scan: password copied to clipboard', p2.evaluate('navigator.clipboard.readText()') == 'geheim123')
        shot(p2, 'desk_light_qr_scan_wifi')
        # URL code → open asks for confirmation
        p2.evaluate("window.__qrValue = 'https://example.org/test'")
        p2.locator('[data-again]').click()
        p2.wait_for_selector('[data-act=open]', timeout=10000)
        p2.locator('[data-act=open]').click()
        p2.wait_for_selector('dialog[open]')
        check('qr scan: link opens only after confirmation', 'example.org/test' in p2.locator('dialog[open]').text_content())
        p2.locator('dialog[open] .btn-ghost').click()
        # vCard → .vcf
        p2.evaluate("window.__qrValue = 'BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nN:Muster;Erika;;;\\r\\nFN:Erika Muster\\r\\nTEL:+49 681 1\\r\\nEND:VCARD'")
        p2.locator('[data-again]').click()
        p2.wait_for_selector('[data-act=vcf]', timeout=10000)
        with p2.expect_download() as d:
            p2.locator('[data-act=vcf]').click()
        vp = os.path.join(OUT, 't_contact.vcf'); d.value.save_as(vp)
        check('qr scan: vCard saved as .vcf', d.value.suggested_filename == 'Erika Muster.vcf' and 'FN:Erika Muster' in open(vp).read())
        # text → note + PDF
        p2.evaluate("window.__qrValue = 'Treffpunkt: Eingang Nord, 18 Uhr'")
        p2.locator('[data-again]').click()
        p2.wait_for_selector('[data-act=pdf]', timeout=10000)
        p2.locator('[data-act=pdf]').click()
        p2.wait_for_timeout(1500)
        p2.locator('[data-act=note]').click()
        p2.wait_for_timeout(1500)
        names = [d['name'] for d in docs(p2)]
        check('qr scan: text saved as PDF and as note', any(n.startswith('QR-Code ') and n.endswith('.pdf') for n in names) and any(n.startswith('QR-Notiz') for n in names), str(names))
        # switch to document mode
        p2.locator('[data-again]').click()
        p2.evaluate("window.__qrValue = ''")
        p2.locator('[data-cmode=doc]').click()
        check('qr scan: switch back to document mode', p2.locator('[data-shoot]').is_visible())
        c2.close()
        CUR['page'] = pg
        # without BarcodeDetector support: QR mode is hidden / explained
        c3 = context(browser)
        c3.add_init_script("delete window.BarcodeDetector; Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });")
        p3 = c3.new_page()
        attach(p3, 'desk-noqr')
        p3.goto(URL + '#/werkzeug/scannen')
        p3.wait_for_selector('.sc-cap', timeout=15000)
        p3.wait_for_timeout(800)
        check('scanner: QR mode switch hidden when unsupported', p3.locator('[data-modes]').is_hidden())
        p3.goto(URL + '#/werkzeug/qr-scannen')
        p3.wait_for_selector('.empty h3', timeout=15000)
        check('qr scan: unsupported browser gets an explanation', 'nicht möglich' in p3.locator('.empty h3').text_content())
        c3.close()
    step('qrscan', qrscan)

    # ------------------------------------------------------------ scanner: new filters
    def scanfilters():
        goto(pg, '#/werkzeug/scannen', '.sc-cap')
        pg.wait_for_timeout(500)
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-gallery]').click()
        fc.value.set_files(os.path.join(TD, 'scan_2_dark.jpg'))
        pg.wait_for_selector('.sc-card img', timeout=20000)
        pg.locator('[data-allf=magic]').click()
        pg.wait_for_function("Array.from(document.querySelectorAll('.sc-card img')).every(i => i.naturalWidth > 0)", timeout=30000)
        pg.wait_for_timeout(2500)
        check('scanner: "Magie" filter available for all pages', pg.locator('[data-allf=magic]').get_attribute('aria-pressed') == 'true')
        shot(pg, 'desk_light_scanner_magic')
    step('scanfilters', scanfilters)

    browser.close()


# ======================================================================================= phone
def phone(p):
    browser = launch(p)
    ctx = context(browser, phone=True)
    pg = ctx.new_page()
    CUR['page'] = pg
    attach(pg, 'phone')
    step('phone setup', lambda: setup_docs(pg))
    ids = {d['name']: d['id'] for d in docs(pg)}

    def tz():
        did = ids['bericht_v1.pdf']
        goto(pg, f'#/ansicht/{did}?seite=1', None)
        pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
        pg.wait_for_timeout(600)
        c = pg.locator('[data-v=container]').bounding_box()
        pg.touchscreen.tap(c['x'] + c['width'] * 0.92, c['y'] + c['height'] * 0.5)
        pg.wait_for_timeout(900)
        check('phone viewer: tap on right edge → next page', pg.locator('[data-v=pagenum]').input_value() == '2')
        pg.touchscreen.tap(c['x'] + c['width'] * 0.06, c['y'] + c['height'] * 0.5)
        pg.wait_for_timeout(900)
        check('phone viewer: tap on left edge → previous page', pg.locator('[data-v=pagenum]').input_value() == '1')
        # swipe left
        cdp = pg.context.new_cdp_session(pg)
        y = c['y'] + c['height'] * 0.5
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 320, 'y': y}]})
        for x in (280, 230, 170, 120):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y + 2}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        cdp.detach()
        pg.wait_for_timeout(900)
        check('phone viewer: swipe left → next page', pg.locator('[data-v=pagenum]').input_value() == '2')
        pg.evaluate("document.getElementById('viewer').classList.remove('chrome-hidden')")
        pg.touchscreen.tap(c['x'] + c['width'] * 0.5, c['y'] + c['height'] * 0.4)
        pg.wait_for_timeout(600)
        check('phone viewer: tap in the middle hides the bars', 'chrome-hidden' in (pg.locator('#viewer').get_attribute('class') or ''))
        before = pg.evaluate("document.querySelector('[data-v=zoomval]').textContent")
        pg.touchscreen.tap(c['x'] + c['width'] * 0.5, c['y'] + c['height'] * 0.4)
        pg.wait_for_timeout(100)
        pg.touchscreen.tap(c['x'] + c['width'] * 0.5, c['y'] + c['height'] * 0.4)
        pg.wait_for_timeout(900)
        after = pg.evaluate("document.querySelector('[data-v=zoomval]').textContent")
        check('phone viewer: double-tap zooms in', before != after, f'{before} → {after}')
        pg.touchscreen.tap(c['x'] + c['width'] * 0.5, c['y'] + c['height'] * 0.4)
        pg.wait_for_timeout(100)
        pg.touchscreen.tap(c['x'] + c['width'] * 0.5, c['y'] + c['height'] * 0.4)
        pg.wait_for_timeout(900)
        check('phone viewer: second double-tap zooms back', pg.evaluate("document.querySelector('[data-v=zoomval]').textContent") == before)
        pg.evaluate("document.getElementById('viewer').classList.remove('chrome-hidden')")
        shot(pg, 'phone_light_viewer')
        pg.locator('[data-v=reflow]').click()
        pg.wait_for_function("document.querySelector('[data-rf=more]') && document.querySelector('[data-rf=more]').hidden", timeout=20000)
        pg.wait_for_timeout(500)
        shot(pg, 'phone_light_reflow')
        pg.locator('[data-rf=settings]').click()
        shot(pg, 'phone_light_reflow_settings')
        pg.locator('[data-th=dunkel]').click()
        pg.locator('[data-rf=settings]').click()
        shot(pg, 'phone_dark_reflow')
        pg.locator('[data-rf=settings]').click()
        pg.locator('[data-th=sepia]').click()
        pg.locator('[data-rf=settings]').click()
        shot(pg, 'phone_sepia_reflow')
        pg.locator('[data-rf=toc]').click()
        shot(pg, 'phone_light_reflow_toc')
        check('phone reflow: table of contents lists headings', pg.locator('.rf-toc-item').count() >= 5)
        pg.locator('.rf-toc-item', has_text='Zusammenfassung').click()
        pg.wait_for_timeout(600)
        pg.evaluate("localStorage.setItem('fale-reflow-settings', JSON.stringify({size: 19, lead: 1.6, theme: 'auto', font: 'serif', width: 'normal'}))")
        pg.locator('[data-rf=close]').click()
        pg.wait_for_timeout(500)
        check('phone reflow: closes at the page that was read', pg.locator('[data-v=pagenum]').input_value() == '1')
    step('phone viewer', tz)

    def cam_passfoto():
        goto(pg, '#/werkzeug/passfoto', '.pp-tpls')
        shot(pg, 'phone_light_passfoto_start')
        pg.locator('[data-cam]').tap()
        pg.wait_for_function("document.querySelector('.pp-cam video') && document.querySelector('.pp-cam video').videoWidth > 0", timeout=15000)
        pg.wait_for_timeout(500)
        shot(pg, 'phone_light_passfoto_camera')
        check('phone passfoto: front camera preview mirrored', 'mirror' in pg.locator('.pp-cam video').get_attribute('class'))
        pg.locator('[data-shoot]').tap()
        pg.wait_for_selector('.pp-frame', timeout=10000)
        pg.wait_for_timeout(400)
        # pinch zoom
        fb = pg.locator('.pp-frame').bounding_box()
        z0 = float(pg.locator('[name=zoom]').input_value())
        cdp = pg.context.new_cdp_session(pg)
        cx, cy = fb['x'] + fb['width'] / 2, fb['y'] + fb['height'] / 2
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx - 30, 'y': cy, 'id': 1}, {'x': cx + 30, 'y': cy, 'id': 2}]})
        for d in (40, 60, 80):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx - d, 'y': cy, 'id': 1}, {'x': cx + d, 'y': cy, 'id': 2}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        cdp.detach()
        pg.wait_for_timeout(300)
        z1 = float(pg.locator('[name=zoom]').input_value())
        check('phone passfoto: pinch zooms the photo', z1 > z0 * 1.6, f'{z0:.2f} → {z1:.2f}')
        shot(pg, 'phone_light_passfoto_adjust')
        pg.locator('[data-tab=check]').tap()
        shot(pg, 'phone_light_passfoto_check')
        pg.locator('.screen-foot .btn-primary').tap()
        pg.wait_for_selector('[data-sheet] canvas', timeout=15000)
        shot(pg, 'phone_light_passfoto_export')
    step('phone passfoto camera', cam_passfoto)

    def qr_phone():
        c2 = context(browser, phone=True)
        c2.add_init_script(MOCK_BARCODE)
        p2 = c2.new_page()
        attach(p2, 'phone-qr')
        p2.goto(URL + '#/werkzeug/scannen')
        p2.wait_for_selector('[data-cmode=qr]', timeout=15000)
        p2.wait_for_timeout(500)
        shot(p2, 'phone_light_scanner_modes')
        p2.locator('[data-cmode=qr]').tap()
        p2.wait_for_selector('.qs-sheet', timeout=10000)
        shot(p2, 'phone_light_qr_scan')
        c2.close()
    step('phone qr scan', qr_phone)
    browser.close()


# ======================================================================================= screenshots
SCREENS = [
    ('compare', lambda ids: f"#/werkzeug/vergleichen?doc={ids['bericht_v1.pdf']}", '.cmp-slot'),
    ('form', lambda ids: f"#/werkzeug/formular-erstellen?doc={ids['antrag.pdf']}", '.pt-page canvas'),
    ('crop', lambda ids: f"#/werkzeug/zuschneiden?doc={ids['raender.pdf']}", '.cr-box'),
    ('bookmarks', lambda ids: f"#/werkzeug/lesezeichen?doc={ids['bericht_v1.pdf']}", '.bm-card'),
    ('batch', lambda ids: '#/werkzeug/stapel', '.bt-action'),
    ('signatures', lambda ids: '#/werkzeug/signaturen', '.ss-grid'),
    ('imagetools', lambda ids: '#/werkzeug/bildwerkzeuge', '[data-pick]'),
    ('compress_images', lambda ids: '#/werkzeug/bilder-komprimieren', '[data-pick]'),
    ('passfoto', lambda ids: '#/werkzeug/passfoto', '.pp-tpls'),
    ('qr_create', lambda ids: '#/werkzeug/qr-erstellen', '.qt-types'),
    ('sign', lambda ids: f"#/werkzeug/unterschreiben?doc={ids['antrag.pdf']}", '.sign-page canvas'),
    ('tools', lambda ids: '#/werkzeuge', '.tool-card, .tile, main'),
]


def shots(p):
    browser = launch(p)
    for dev in os.environ.get('SHOTS_DEV', 'desk,phone').split(','):
        for theme in ('light', 'dark'):
            ctx = context(browser, phone=dev == 'phone', dark=theme == 'dark')
            pg = ctx.new_page()
            attach(pg, f'shots-{dev}-{theme}')
            CUR['page'] = pg
            pg.goto(URL)
            pg.wait_for_timeout(700)
            set_theme(pg, theme == 'dark')
            import_pdfs(pg, [os.path.join(TDP, n) for n in ['bericht_v1.pdf', 'bericht_v2.pdf', 'antrag.pdf', 'raender.pdf']])
            ids = {d['name']: d['id'] for d in docs(pg)}
            for name, hfn, sel in SCREENS:
                try:
                    goto(pg, hfn(ids), sel)
                    pg.wait_for_timeout(900)
                    shot(pg, f'{dev}_{theme}_{name}')
                except Exception as e:
                    check(f'screenshot {dev} {theme} {name}', False, str(e)[:200])
            # a few interactive states
            try:
                goto(pg, hfn(ids) if False else f"#/ansicht/{ids['bericht_v1.pdf']}", None)
                pg.wait_for_function("document.querySelector('[data-v=loading]').hidden", timeout=20000)
                pg.locator('[data-v=reflow]').click()
                pg.wait_for_function("document.querySelector('[data-rf=more]') && document.querySelector('[data-rf=more]').hidden", timeout=20000)
                pg.wait_for_timeout(500)
                shot(pg, f'{dev}_{theme}_reflow')
                pg.locator('[data-rf=close]').click()
                pg.locator('[data-v=panel]').click()
                pg.locator('[data-ptab=marks]').click()
                pg.wait_for_timeout(300)
                shot(pg, f'{dev}_{theme}_viewer_marks')
            except Exception as e:
                shot(pg, f'fail_shots_reflow_{dev}_{theme}')
                check(f'screenshot {dev} {theme} reflow', False, str(e)[:200])
            try:
                goto(pg, '#/werkzeug/qr-erstellen', '.qt-types')
                pg.fill('[name=url]', 'https://fale.dev')
                pg.wait_for_timeout(300)
                shot(pg, f'{dev}_{theme}_qr_filled')
                goto(pg, '#/werkzeug/signaturen', '.ss-grid')
                pg.locator('.ss-section').nth(2).locator('.ss-new').click()
                pg.wait_for_selector('dialog .ss-stamp-prev canvas')
                pg.wait_for_timeout(300)
                shot(pg, f'{dev}_{theme}_stamp_designer')
                pg.locator('dialog .dlg-actions .btn-ghost').click()
                pg.locator('.ss-section').nth(0).locator('.ss-new').click()
                pg.wait_for_selector('dialog .sig-pad')
                pg.locator('dialog [data-mode=type]').click()
                pg.fill('dialog [name=typed]', 'Max Mustermann')
                pg.wait_for_timeout(300)
                shot(pg, f'{dev}_{theme}_signature_typed')
                pg.locator('dialog .dlg-actions .btn-ghost').click()
                goto(pg, f"#/werkzeug/vergleichen?doc={ids['bericht_v1.pdf']}", '.cmp-slot')
                pg.locator('[data-slot=b] button').click()
                pg.wait_for_selector('dialog .pick-item')
                pg.locator(f"dialog input[value=\"{ids['bericht_v2.pdf']}\"]").check()
                pg.locator('dialog .btn-primary').click()
                no_dialog(pg)
                pg.locator('.screen-foot .btn-primary').click()
                pg.wait_for_selector('.cmp-summary', timeout=30000)
                pg.wait_for_timeout(1200)
                shot(pg, f'{dev}_{theme}_compare_result')
                goto(pg, '#/werkzeug/bildwerkzeuge', '[data-pick]')
                with pg.expect_file_chooser() as fc:
                    pg.locator('[data-pick]').click()
                fc.value.set_files(os.path.join(TDP, 'schatten.jpg'))
                pg.wait_for_selector('.it-canvas', timeout=15000)
                pg.locator('[data-tool=adjust]').click()
                pg.wait_for_timeout(500)
                shot(pg, f'{dev}_{theme}_imagetools_editor')
                goto(pg, '#/werkzeug/passfoto', '.pp-tpls')
                with pg.expect_file_chooser() as fc:
                    pg.locator('[data-pick]').click()
                fc.value.set_files(os.path.join(TDP, 'portrait.jpg'))
                pg.wait_for_selector('.pp-frame', timeout=10000)
                pg.wait_for_timeout(500)
                shot(pg, f'{dev}_{theme}_passfoto_adjust')
                goto(pg, f"#/werkzeug/formular-erstellen?doc={ids['antrag.pdf']}", '.pt-page canvas')
                pg.locator('.pt-tool', has_text='Erkennen').click()
                pg.wait_for_selector('.fc-field', timeout=15000)
                pg.locator('.fc-field').first.click()
                pg.wait_for_timeout(400)
                shot(pg, f'{dev}_{theme}_form_selected')
                goto(pg, '#/werkzeug/stapel', '.bt-action')
                pg.locator('[data-lib]').click()
                pg.wait_for_selector('dialog .pick-item')
                pg.locator('dialog .pick-item input').nth(0).check()
                pg.locator('dialog .pick-item input').nth(1).check()
                pg.locator('dialog .btn-primary').click()
                no_dialog(pg)
                pg.locator('[data-action=numbers]').click()
                pg.locator('.screen-foot .btn-primary').click()
                pg.wait_for_selector('[data-result] .result-card', timeout=60000)
                pg.wait_for_timeout(600)
                shot(pg, f'{dev}_{theme}_batch_done')
            except Exception as e:
                check(f'screenshot {dev} {theme} interactive', False, str(e)[:200])
                traceback.print_exc()
            ctx.close()
    browser.close()


ensure_server()
if not os.path.exists(os.path.join(TDP, 'portrait.jpg')):
    subprocess.run(['python3', os.path.join(SP, 'make_plus_data.py')], cwd=SP, check=True)
with sync_playwright() as p:
    if ONLY in ('all', 'desktop'):
        desktop(p)
    if ONLY in ('all', 'phone'):
        phone(p)
    if ONLY in ('all', 'shots'):
        shots(p)

print('\n==== SUMMARY ====')
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
for f in fails:
    print('FAILED:', f[0], f[2])
print('\n==== CONSOLE errors/warnings ====')
ignored = [c for c in console if 'extras/onboarding.js' in c]
real = [c for c in console if c not in ignored]
for c in real:
    print(c)
print(f'{len(real)} console problems ({len(ignored)} ignored: missing files of the parallel office work)')
sys.exit(1 if fails else 0)

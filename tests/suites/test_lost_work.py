"""Nothing a person typed gets lost silently.
- every place with unsaved work (Ausfüllen & unterschreiben, Kommentieren, PDF bearbeiten, Seiten verwalten, Word,
  Excel): leaving asks first – by the arrow on top AND by the phone's back button / gesture AND by a link;
  „Abbrechen“ keeps the work, „Verwerfen“ leaves, „Speichern“ saves a new file and says where it is
- nothing to ask when nothing was changed, and not again after saving
- „Ausfüllen & unterschreiben“: the app is closed/killed in the middle (page closed without a question) → at the
  next start the entries are offered, „Weiter ausfüllen“ brings text, check mark and form-field values back;
  saving or discarding removes the kept entries; a deleted document leaves nothing behind
- leaving never stalls the app (worst stall < 700 ms at CPU ×4)
Server: node tests/suites/sec/csp_server.mjs 9202 <repo>"""
import base64, json, os, traceback
from playwright.sync_api import sync_playwright
import test_nav_stress as N

URL = os.environ.get('APP_URL', 'http://127.0.0.1:9202/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_lost_work')
os.makedirs(OUT, exist_ok=True)
results, problems = [], []
NATIVE = "window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { AdMob: { initialize: async () => {}, addListener: async () => ({ remove() {} }) } } }; try { localStorage.setItem('fale-ads-off', '1'); } catch (e) {}"
BACK = "import('./js/platform.js').then(m => m.handleBackButton({ canGoBack: true }))"
SCREEN = "[...document.querySelectorAll('.screen')].some(s => !s.hidden)"
DOCS = "async () => (await (await import('./js/db.js')).listDocs()).map(d => d.name)"
DRAFTS = "async () => (await (await import('./js/tools/signdraft.js')).listDrafts()).length"


def check(name, cond, info=''):
    results.append((name, bool(cond), str(info)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:500]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:600], flush=True)
        traceback.print_exc()


def form_pdf():
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    path = os.path.join(OUT, 'antrag.pdf')
    if not os.path.exists(path):
        c = canvas.Canvas(path, pagesize=A4)
        c.setFont('Helvetica', 12)
        c.drawString(60, 780, 'Antrag auf Verlängerung')
        c.drawString(60, 740, 'Name:'); c.acroForm.textfield(name='name', x=140, y=732, width=260, height=22, borderWidth=1, forceBorder=True)
        c.drawString(60, 700, 'Ort:'); c.acroForm.textfield(name='ort', x=140, y=692, width=260, height=22, borderWidth=1, forceBorder=True)
        c.drawString(60, 660, 'Einverstanden:'); c.acroForm.checkbox(name='ok', x=170, y=654, size=18, buttonStyle='check', forceBorder=True)
        c.save()
    return path


def change_sign(pg):
    pg.wait_for_selector('.sign-page canvas', timeout=30000); pg.wait_for_timeout(800)
    box = pg.locator('.sign-page').first.bounding_box()
    pg.mouse.click(box['x'] + box['width'] * .5, box['y'] + min(box['height'] * .5, 300)); pg.wait_for_timeout(400)
    pg.keyboard.type('Hallo Test'); pg.wait_for_timeout(400)
    pg.mouse.click(box['x'] + 20, box['y'] + 20); pg.wait_for_timeout(300)
def change_annot(pg):
    pg.wait_for_selector('#tool-screen canvas', timeout=30000); pg.wait_for_timeout(1000)
    pg.locator('.pt-tool', has_text='Stift').first.click()
    box = pg.locator('.pt-page').first.bounding_box()
    pg.mouse.move(box['x'] + 60, box['y'] + 120); pg.mouse.down(); pg.mouse.move(box['x'] + 160, box['y'] + 180, steps=6); pg.mouse.up(); pg.wait_for_timeout(500)
def change_edit(pg):
    pg.wait_for_selector('#tool-screen canvas', timeout=30000); pg.wait_for_timeout(1000)
    pg.locator('.pt-tool', has_text='Text').first.click()
    box = pg.locator('.pt-page').first.bounding_box()
    pg.mouse.click(box['x'] + 120, box['y'] + 200); pg.wait_for_timeout(400); pg.keyboard.type('Neu'); pg.wait_for_timeout(400)
def change_org(pg):
    pg.wait_for_selector('.pcard', timeout=30000); pg.wait_for_timeout(800)
    pg.locator('.pcard .icon-btn[aria-label*="drehen"]').first.click(); pg.wait_for_timeout(400)
def change_writer(pg):
    pg.wait_for_selector('.doc-page[contenteditable]', timeout=30000); pg.wait_for_timeout(1000)
    pg.locator('.doc-page[contenteditable]').first.click(); pg.keyboard.type('Neuer Satz. '); pg.wait_for_timeout(500)
def change_sheet(pg):
    pg.wait_for_selector('.sheet-app', timeout=30000); pg.wait_for_timeout(1500)
    pg.keyboard.type('123'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)


def dlg(pg):
    d = pg.locator('dialog[open]')
    return d.first.inner_text() if d.count() else ''
def press(pg, label):
    pg.locator('dialog[open] button', has_text=label).first.click(); pg.wait_for_timeout(700)
def go(pg, hsh, wait=700):
    pg.evaluate(f'location.hash = {json.dumps(hsh)}'); pg.wait_for_timeout(wait)
def clean(pg):
    """Back to the start page, whatever is open (answers the question with „Verwerfen“)."""
    for _ in range(3):
        if pg.locator('dialog[open] button', has_text='Verwerfen').count(): press(pg, 'Verwerfen')
        if pg.evaluate('location.hash') in ('#/start', ''): break
        go(pg, '#/start')
    pg.wait_for_timeout(300)


def new_context(browser, extra=''):
    c = browser.new_context(viewport={'width': 412, 'height': 900}, locale='de-DE')
    c.add_init_script(N.INIT + NATIVE + extra)
    return c
def watch(pg):
    pg.on('pageerror', lambda e: problems.append(str(e)[:200]))
    pg.on('console', lambda m: problems.append(m.text[:200]) if m.type == 'error' and 'Failed to load resource' not in m.text else None)


def run(p):
    browser = p.chromium.launch()
    c = new_context(browser, N.WATCH)
    pg = c.new_page(); watch(pg)
    cdp = c.new_cdp_session(pg); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    pg.goto(URL + '#/start'); pg.wait_for_selector('#view-start'); pg.wait_for_timeout(1200)
    F = N.files(); F['form'] = form_pdf()
    mime = dict(N.MIME, form='application/pdf')
    ids = {k: pg.evaluate(N.IMPORT, [base64.b64encode(open(v, 'rb').read()).decode(), os.path.basename(v), mime[k]]) for k, v in F.items()}
    pdf = ids['pdf']; pg.wait_for_timeout(4000)
    CASES = [('Ausfüllen & unterschreiben', f'#/werkzeug/unterschreiben?doc={pdf}&modus=text', change_sign, 'ausgefüllt'),
             ('Kommentieren', f'#/werkzeug/kommentieren?doc={pdf}', change_annot, 'kommentiert'),
             ('PDF bearbeiten', f'#/werkzeug/bearbeiten?doc={pdf}', change_edit, 'bearbeitet'),
             ('Seiten verwalten', f'#/werkzeug/seiten?doc={pdf}', change_org, 'bearbeitet'),
             ('Word-Editor', f"#/bearbeiten/{ids['docx']}", change_writer, None),
             ('Excel-Editor', f"#/bearbeiten/{ids['xlsx']}", change_sheet, None)]

    # ---- 1) nothing changed → no question
    def untouched():
        for label, hsh, _, _ in CASES:
            go(pg, '#/dateien'); go(pg, hsh, 2500)
            pg.evaluate(BACK); pg.wait_for_timeout(900)
            check(f'{label}: nothing changed → back leaves without a question', not dlg(pg) and not pg.evaluate(SCREEN), [dlg(pg)[:60], pg.evaluate('location.hash')])
            clean(pg)
    step('untouched', untouched)

    # ---- 2) every way out asks; Abbrechen keeps, Verwerfen leaves
    def ways():
        for label, hsh, change, _ in CASES:
            for how in ('arrow', 'phone back button', 'link'):
                go(pg, '#/dateien'); go(pg, hsh)
                change(pg)
                pg.evaluate('window.__d.length = 0')
                if how == 'arrow': pg.locator('.screen:not([hidden]) .screen-head [data-back]').first.click()
                elif how == 'phone back button': pg.evaluate(BACK)
                else: pg.evaluate("location.hash = '#/werkzeuge'")
                pg.wait_for_timeout(1000)
                t = dlg(pg)
                check(f'{label} · {how}: asks before leaving', 'Änderungen speichern?' in t and 'Verwerfen' in t and 'Speichern' in t, t[:120])
                if not t: clean(pg); continue
                press(pg, 'Abbrechen')
                still = pg.evaluate(SCREEN)
                foot = pg.evaluate("(document.querySelector('.screen:not([hidden]) .foot-info, .screen:not([hidden]) .office-state, .screen:not([hidden]) [data-office-state]') || {}).textContent || ''")
                check(f'{label} · {how}: „Abbrechen“ keeps the tool and the work', still and not dlg(pg) and pg.evaluate('location.hash').split('&')[0] == hsh.split('&')[0], [still, foot, pg.evaluate('location.hash')])
                if how == 'arrow': pg.locator('.screen:not([hidden]) .screen-head [data-back]').first.click()
                elif how == 'phone back button': pg.evaluate(BACK)
                else: pg.evaluate("location.hash = '#/werkzeuge'")
                pg.wait_for_timeout(1000)
                check(f'{label} · {how}: asks again the second time', 'Änderungen speichern?' in dlg(pg), dlg(pg)[:80])
                press(pg, 'Verwerfen'); pg.wait_for_timeout(500)
                check(f'{label} · {how}: „Verwerfen“ leaves', not pg.evaluate(SCREEN) and not dlg(pg), [pg.evaluate('location.hash'), dlg(pg)[:60]])
                worst = max([g for _, g in pg.evaluate('window.__d')] or [0])
                check(f'{label} · {how}: leaving does not stall ({worst} ms < 700)', worst < 700, worst)
                clean(pg)
    step('ways out', ways)

    # ---- 3) „Speichern“ in the question saves a new file, stays, and does not ask again
    def save_from_question():
        for label, hsh, change, word in CASES:
            if not word: continue
            go(pg, '#/dateien'); go(pg, hsh)
            change(pg)
            before = pg.evaluate(DOCS)
            pg.evaluate(BACK); pg.wait_for_timeout(1000)
            press(pg, 'Speichern')
            try: pg.wait_for_selector('.screen:not([hidden]) .result-card', timeout=30000)
            except Exception: pass
            pg.wait_for_timeout(600)
            after = pg.evaluate(DOCS)
            new = [n for n in after if n not in before]
            where = pg.evaluate("(document.querySelector('.screen:not([hidden]) .result-where') || {}).textContent || ''")
            check(f'{label}: „Speichern“ in the question saves a new file', len(new) == 1 and word in new[0] and len(after) == len(before) + 1, new)
            check(f'{label}: the new file has a name of its own (no twins in the list)', len(set(after)) == len(after), after)
            check(f'{label}: the result says where the file is and that the original is untouched', 'Dateien' in where and 'Original' in where, where)
            check(f'{label}: the tool stays open after saving', pg.evaluate(SCREEN))
            pg.evaluate(BACK); pg.wait_for_timeout(1000)
            check(f'{label}: after saving, back leaves without a question', not dlg(pg) and not pg.evaluate(SCREEN), [dlg(pg)[:60], pg.evaluate('location.hash')])
            clean(pg)
        check('no kept entries left after saving / discarding', pg.evaluate(DRAFTS) == 0, pg.evaluate(DRAFTS))
    step('save from the question', save_from_question)
    c.close()

    # ---- 4) app closed in the middle of filling in → entries come back
    def killed():
        c2 = new_context(browser)
        a = c2.new_page(); watch(a)
        a.goto(URL + '#/start'); a.wait_for_selector('#view-start'); a.wait_for_timeout(1000)
        fid = a.evaluate(N.IMPORT, [base64.b64encode(open(F['form'], 'rb').read()).decode(), 'antrag.pdf', 'application/pdf'])
        a.wait_for_timeout(2500)
        go(a, f'#/werkzeug/unterschreiben?doc={fid}')
        a.wait_for_selector('.sign-page canvas', timeout=30000); a.wait_for_timeout(1500)
        # two form fields, a check box, a free text and a check mark
        a.evaluate("""() => { const set = (i, v) => { const e = document.querySelector(`.form-panel [data-fi="${i}"]`); if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
          const names = [...document.querySelectorAll('.form-panel [data-fi]')].map(e => e.closest('label, .field') ? e.closest('label, .field').textContent.trim().slice(0, 20) : '');
          window.__fields = names; set(0, 'Erika Mustermann'); set(1, 'Köln'); set(2, true); }""")
        if a.locator('.form-panel.open [data-close], .form-panel.open .icon-btn[aria-label*="schließen"]').count(): a.locator('.form-panel.open [data-close], .form-panel.open .icon-btn[aria-label*="schließen"]').first.click()
        a.evaluate("document.querySelector('.form-panel') && document.querySelector('.form-panel').classList.remove('open')")
        a.locator('.sign-tools [data-mode="text"], [data-mode="text"]').first.click(); a.wait_for_timeout(300)
        box = a.locator('.sign-page').first.bounding_box()
        a.mouse.click(box['x'] + box['width'] * .5, box['y'] + box['height'] * .6); a.wait_for_timeout(400)
        a.keyboard.type('Bitte Rückruf'); a.wait_for_timeout(300)
        a.mouse.click(box['x'] + 15, box['y'] + box['height'] * .9); a.wait_for_timeout(1500)
        foot = a.evaluate("(document.querySelector('.screen:not([hidden]) .foot-info') || {}).textContent || ''")
        check('filling in: the tool says „Ungespeicherte Änderungen“', 'Ungespeichert' in foot, foot)
        check('filling in: the entries are kept on the device within 1.5 s', a.evaluate(DRAFTS) == 1, a.evaluate(DRAFTS))
        a.close()  # the app is gone – no question, no save

        b = c2.new_page(); watch(b)
        b.goto(URL + '#/start'); b.wait_for_selector('#view-start'); b.wait_for_timeout(2500)
        t = dlg(b)
        check('next start: „Nicht gespeicherte Einträge gefunden“ names the document', 'Nicht gespeicherte Einträge gefunden' in t and 'antrag.pdf' in t and 'Weiter ausfüllen' in t, t[:200])
        press(b, 'Später')
        check('„Später“ keeps the entries', b.evaluate(DRAFTS) == 1 and not dlg(b))
        b.reload(); b.wait_for_selector('#view-start'); b.wait_for_timeout(2500)
        check('they are offered again at the next start', 'Nicht gespeicherte Einträge gefunden' in dlg(b), dlg(b)[:80])
        press(b, 'Weiter ausfüllen')
        b.wait_for_selector('.sign-page canvas', timeout=30000); b.wait_for_timeout(2500)
        st = b.evaluate("""() => ({ vals: [...document.querySelectorAll('.form-panel [data-fi]')].map(e => e.type === 'checkbox' ? e.checked : e.value),
          texts: [...document.querySelectorAll('.s-item .s-text')].map(e => e.textContent), ov: [...document.querySelectorAll('.field-ov.changed')].length,
          foot: (document.querySelector('.screen:not([hidden]) .foot-info') || {}).textContent || '', save: !document.querySelector('[data-save]').disabled,
          toast: [...document.querySelectorAll('.toast')].map(x => x.textContent).join(' | ') })""")
        check('„Weiter ausfüllen“: form fields are back', st['vals'][:3] == ['Erika Mustermann', 'Köln', True], st['vals'])
        check('the free text is back on the page', 'Bitte Rückruf' in st['texts'], st['texts'])
        check('the page shows the values in the fields', st['ov'] >= 3, st['ov'])
        check('it counts as unsaved and can be saved', 'Ungespeichert' in st['foot'] and st['save'], st)
        check('a message says the entries are back', 'wieder da' in st['toast'], st['toast'])
        # leaving with „Abbrechen“ keeps the draft, saving removes it
        b.evaluate(BACK); b.wait_for_timeout(900)
        check('restored entries are protected like fresh ones', 'Änderungen speichern?' in dlg(b), dlg(b)[:80])
        press(b, 'Speichern')
        for _ in range(3):  # „Prüfen vor dem Speichern“ may ask about empty fields
            x = b.locator('dialog[open] button', has_text='Trotzdem speichern')
            if x.count(): x.first.click(); b.wait_for_timeout(500)
        try: b.wait_for_selector('.screen:not([hidden]) .result-card', timeout=30000)
        except Exception: pass
        b.wait_for_timeout(800)
        names = b.evaluate(DOCS)
        check('saving writes the filled-in file', any('ausgefüllt' in n for n in names), names)
        check('saving removes the kept entries', b.evaluate(DRAFTS) == 0, b.evaluate(DRAFTS))
        txt = b.evaluate("""async () => { const db = await import('./js/db.js'); const d = (await db.listDocs()).find(x => /ausgefüllt/.test(x.name)); const { getDocBytes } = await import('./js/library.js');
          const { loadPdf } = await import('./js/pdfcore.js'); const { pdf } = await loadPdf(await getDocBytes(d.id), { name: d.name }); const p = await pdf.getPage(1);
          const t = (await p.getTextContent()).items.map(i => i.str).join(' '); const an = (await p.getAnnotations()).map(x => x.fieldValue).filter(Boolean).join(' '); pdf.destroy(); return t + ' ## ' + an; }""")
        check('the saved PDF holds the restored entries', 'Erika Mustermann' in txt and 'Köln' in txt and 'Bitte Rückruf' in txt, txt[:300])
        b.goto(URL + '#/start'); b.reload(); b.wait_for_selector('#view-start'); b.wait_for_timeout(2500)
        check('no offer at the next start after saving', not dlg(b), dlg(b)[:80])

        # discard at the start offer / deleted document
        go(b, f'#/werkzeug/unterschreiben?doc={fid}&modus=text'); change_sign(b); b.wait_for_timeout(1200)
        check('new entries are kept again', b.evaluate(DRAFTS) == 1)
        b.close()
        d = c2.new_page(); watch(d)
        d.goto(URL + '#/start'); d.wait_for_selector('#view-start'); d.wait_for_timeout(2500)
        check('offered after the second kill', 'Nicht gespeicherte Einträge gefunden' in dlg(d), dlg(d)[:80])
        press(d, 'Verwerfen')
        check('„Verwerfen“ at the offer removes them', d.evaluate(DRAFTS) == 0)
        go(d, f'#/werkzeug/unterschreiben?doc={fid}&modus=text'); change_sign(d); d.wait_for_timeout(1200)
        d.evaluate(BACK); d.wait_for_timeout(900); press(d, 'Verwerfen'); d.wait_for_timeout(600)
        check('„Verwerfen“ when leaving removes them too', d.evaluate(DRAFTS) == 0, d.evaluate(DRAFTS))
        go(d, f'#/werkzeug/unterschreiben?doc={fid}&modus=text'); change_sign(d); d.wait_for_timeout(1200)
        d.close()
        e = c2.new_page(); watch(e)
        e.add_init_script("window.__noOffer = true")
        e.goto(URL + '#/einstellungen'); e.wait_for_timeout(2500)
        if dlg(e): press(e, 'Später')
        e.evaluate(f"async () => {{ const db = await import('./js/db.js'); await db.deleteDoc({json.dumps(fid)}); }}")
        e.reload(); e.wait_for_timeout(2500)
        check('document deleted → nothing is offered and the entries are removed', not dlg(e) and e.evaluate(DRAFTS) == 0, [dlg(e)[:60], e.evaluate(DRAFTS)])
        c2.close()
    step('killed app', killed)
    browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        run(p)
    check('no console errors', not problems, problems[:5])
    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} passed')
    for n, c, i in results:
        if not c:
            print('  FAIL', n, i[:300])

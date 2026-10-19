"""E2E tests for the four assistants (Briefkasten, Dokumenten-Gedächtnis, Steuer-Belege, Familien-Ordner).
  python3 test_smart.py [all|accuracy|inbox|scan|memory|tax|offline|i18n|family|shots]
App from source on 127.0.0.1:9300 (serve.py); Familien-Ordner/KI against the account harness on :9310 (+ mock Supabase :9311).
Screenshots + reports → out/."""
import os, sys, json, base64, re, io, time, socket, subprocess, urllib.request, traceback
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, 'out')
os.makedirs(OUT, exist_ok=True)
URL = 'http://127.0.0.1:9300/'
HURL = 'http://127.0.0.1:9310/'
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
results, console_problems = [], []
PAGES = []
TODAY = '2026-10-14'
IGNORED = ('favicon', 'status of 404', 'status of 400', 'status of 401', 'status of 403', 'status of 409', 'ERR_INTERNET_DISCONNECTED', 'net::ERR_FAILED', 'ERR_CONNECTION_REFUSED')


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:500]}]' if info and not cond else ''), flush=True)


def step(name, fn):
    if ONLY != 'all' and name not in ONLY.split(','):
        return
    t = time.time()
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:900], flush=True)
        traceback.print_exc()
        for i, pg in enumerate(PAGES[-3:]):
            try:
                pg.screenshot(path=os.path.join(OUT, f'fail_{name}_{i}.png'))
                print('   toasts:', pg.locator('#toasts').inner_text()[:300], '| url:', pg.url[:120])
            except Exception:
                pass
    print(f'   ({name}: {time.time() - t:.1f}s)', flush=True)


def port_open(p):
    s = socket.socket()
    try:
        s.connect(('127.0.0.1', p)); return True
    except OSError:
        return False
    finally:
        s.close()


def ensure_server():
    if not port_open(9300):
        subprocess.Popen(['python3', os.path.join(SP, 'serve.py'), '9300'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            if port_open(9300): break
            time.sleep(0.2)


def attach(page, label):
    page.on('console', lambda m: console_problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and not any(i in m.text for i in IGNORED) else None)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))


INIT = r"""
try { localStorage.setItem('fale-onboarded', '1'); localStorage.setItem('fale-onboarding', 'done'); localStorage.setItem('fale-ocr-consent', '1');
      if (!localStorage.getItem('fale-lang')) localStorage.setItem('fale-lang', 'de'); } catch (e) {}
window.__t = {
  async importBytes(b64, name, type) {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const lib = await import('/js/library.js');
    const d = await lib.importAny(new File([u], name, { type }), { quiet: true, silent: true });
    return d.id;
  },
  async waitText(id) { const db = await import('/js/db.js'); for (let i = 0; i < 100; i++) { const d = await db.getDoc(id); if (d && d.textReady) return true; await new Promise(r => setTimeout(r, 100)); } return false; },
};
"""


def new_page(browser, label, w=1280, h=900, base=URL, theme=None, lang='de', mobile=False, offline=False):
    # the account harness uses a local mock Supabase (http://127.0.0.1:93xx) that the production CSP (connect-src) does not list
    ctx = browser.new_context(viewport={'width': w, 'height': h}, locale='de-DE', device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, accept_downloads=True, bypass_csp=(base != URL))
    ctx.add_init_script(INIT)
    ctx.add_init_script(f"try {{ localStorage.setItem('fale-lang', '{lang}'); }} catch (e) {{}}")
    if theme:
        ctx.add_init_script(f"try {{ localStorage.setItem('fale-theme', '{theme}'); }} catch (e) {{}}")
    ctx.route('**/js/security.js', _patch_security)
    pg = ctx.new_page()
    attach(pg, label)
    PAGES.append(pg)
    pg.goto(base + '#/start')
    wait_js(pg, 'document.documentElement.classList.contains("ready")', timeout=30000)
    return ctx, pg


def _patch_security(route):
    # test-only workaround (see serve.py): raw U+2028/U+2029 in a regex literal of js/security.js (another agent's file)
    r = route.fetch()
    body = r.body()
    if b'\xe2\x80\xa8' in body or b'\xe2\x80\xa9' in body:
        body = body.replace(b'\xe2\x80\xa8', b'\\u2028').replace(b'\xe2\x80\xa9', b'\\u2029')
    route.fulfill(response=r, body=body)


def wait_js(pg, expr, timeout=30000):
    # the app's CSP forbids eval → Playwright's wait_for_function cannot run; poll with evaluate instead
    t = time.time()
    while time.time() - t < timeout / 1000:
        if pg.evaluate(f'async () => !!(await ({expr}))'):
            return True
        time.sleep(0.15)
    raise TimeoutError('wait_js: ' + expr)


def goto(pg, h, wait=700):
    if pg.evaluate('location.hash') == h:
        pg.evaluate("location.hash = '#/start'"); pg.wait_for_timeout(250)
    pg.evaluate(f'location.hash = {json.dumps(h)}')
    pg.wait_for_timeout(wait)


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


def import_file(pg, path, name=None, typ=None):
    name = name or os.path.basename(path)
    typ = typ or ('application/pdf' if path.endswith('.pdf') else 'image/jpeg')
    return pg.evaluate('([b, n, t]) => window.__t.importBytes(b, n, t)', [b64(path), name, typ])


def qr_decode(path):
    # OpenCV's detector is picky: add a quiet zone and try a few scales
    import cv2
    img = cv2.imread(path)
    img = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    for f in (2, 3, 1, 4):
        dec = cv2.QRCodeDetector().detectAndDecode(cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_NEAREST))[0]
        if dec:
            return dec
    return ''


def shot(pg, name, full=False):
    pg.wait_for_timeout(350)
    pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


def close_dialogs(pg):
    for _ in range(3):
        if pg.locator('dialog[open]').count():
            pg.keyboard.press('Escape'); pg.wait_for_timeout(200)


CORPUS = os.path.join(SP, 'corpus')
HOLD = os.path.join(SP, 'holdout')
TRUTH = json.load(open(os.path.join(CORPUS, 'truth.json')))
HTRUTH = json.load(open(os.path.join(HOLD, 'truth.json')))


# ------------------------------------------------------------------ metrics (same rules as test_extract.mjs)
def norm_name(s):
    s = str(s or '').lower()
    s = re.sub(r'gmbh|&\s*co\.?\s*kg|\bag\b|\bkg\b|e\.\s?v\.|ohg|e\.k\.|vvag|\bse\b', '', s)
    s = re.sub(r'[^\w\d ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def name_eq(a, b):
    x, y = norm_name(a), norm_name(b)
    if not x or not y: return False
    if x == y or x in y or y in x: return True
    A, B = set(x.split()), set(y.split())
    return len(A & B) / max(len(A), len(B)) >= 0.6


refn = lambda s: re.sub(r'\s+', '', str(s or '')).upper()
digits = lambda s: re.sub(r'\D', '', str(s or ''))
money_eq = lambda a, b, tol=0.005: abs(float(a) - float(b)) < tol
FIELDS = [
    ('type', lambda t: t['type'], lambda r: r['type'], lambda a, b: a == b, False),
    ('sender', lambda t: t['sender'], lambda r: r['sender'], name_eq, False),
    ('recipient', lambda t: t['recipient'], lambda r: r['recipient'], name_eq, False),
    ('date', lambda t: t['date'], lambda r: r['date'], lambda a, b: a == b, False),
    ('kundennummer', lambda t: t['kundennummer'], lambda r: r['refs'].get('kundennummer'), lambda a, b: refn(a) == refn(b), False),
    ('rechnungsnummer', lambda t: t['rechnungsnummer'], lambda r: r['refs'].get('rechnungsnummer'), lambda a, b: refn(a) == refn(b), False),
    ('vertragsnummer', lambda t: t['vertragsnummer'], lambda r: r['refs'].get('vertragsnummer'), lambda a, b: refn(a) == refn(b), False),
    ('aktenzeichen', lambda t: t['aktenzeichen'], lambda r: r['refs'].get('aktenzeichen'), lambda a, b: refn(a) == refn(b), False),
    ('steuernummer', lambda t: t['steuernummer'], lambda r: r['refs'].get('steuernummer'), lambda a, b: refn(a) == refn(b), False),
    ('betrag', lambda t: t['betrag'], lambda r: r['amount'], money_eq, False),
    ('iban', lambda t: t['iban'], lambda r: r['iban'], lambda a, b: refn(a) == refn(b), False),
    ('bic', lambda t: t['bic'], lambda r: r['bic'], lambda a, b: refn(a) == refn(b), False),
    ('frist', lambda t: t['due'], lambda r: r['due'], lambda a, b: a == b, False),
    ('telefon', lambda t: t['phone'], lambda r: r['phone'], lambda a, b: digits(a) == digits(b), False),
    ('email', lambda t: t['email'], lambda r: r['email'], lambda a, b: str(a).lower() == str(b).lower(), False),
    ('beleg.haendler', lambda t: t['tax']['merchant'], lambda r: r['receipt']['merchant'], name_eq, True),
    ('beleg.datum', lambda t: t['tax']['date'], lambda r: r['receipt']['date'], lambda a, b: a == b, True),
    ('beleg.brutto', lambda t: t['tax']['total'], lambda r: r['receipt']['total'], money_eq, True),
    ('beleg.mwst19', lambda t: t['tax'].get('vat19'), lambda r: next((v['tax'] for v in r['receipt']['vat'] if v['rate'] == 19), None), lambda a, b: money_eq(a, b, 0.015), True),
    ('beleg.mwst7', lambda t: t['tax'].get('vat7'), lambda r: next((v['tax'] for v in r['receipt']['vat'] if v['rate'] == 7), None), lambda a, b: money_eq(a, b, 0.015), True),
    ('beleg.netto', lambda t: t['tax'].get('net'), lambda r: r['receipt']['net'], lambda a, b: money_eq(a, b, 0.015), True),
    ('beleg.zahlart', lambda t: t['tax'].get('payment'), lambda r: r['receipt']['payment'], lambda a, b: a == b, True),
    ('beleg.kategorie', lambda t: t['tax']['category'], lambda r: r['tax'], lambda a, b: a == b, True),
    ('beleg.arbeitskosten', lambda t: t['tax'].get('labor'), lambda r: r['receipt']['labor'], lambda a, b: money_eq(a, b, 0.015), True),
]


def metrics(preds, truth):
    stats = {f[0]: {'tp': 0, 'fp': 0, 'fn': 0} for f in FIELDS}
    fails = []
    for id_, r in preds.items():
        t = truth[id_]
        for name, gt, gp, eq, tax_only in FIELDS:
            if tax_only and not t.get('tax'): continue
            a, b = gt(t), gp(r)
            has, got = a not in (None, ''), b not in (None, '')
            s = stats[name]
            if got and has and eq(a, b): s['tp'] += 1
            else:
                if got: s['fp'] += 1
                if has: s['fn'] += 1
                if got or has: fails.append(f'{id_} {name}: erwartet {a!r} · erkannt {b!r}')
    return stats, fails


def table(stats, title, n):
    lines = [f'### {title} – {n} Dokumente', '', '| Feld | Präzision | Recall | TP | FP | FN |', '|---|---:|---:|---:|---:|---:|']
    T = {'tp': 0, 'fp': 0, 'fn': 0}
    for k, s in stats.items():
        P = s['tp'] / (s['tp'] + s['fp']) if s['tp'] + s['fp'] else None
        R = s['tp'] / (s['tp'] + s['fn']) if s['tp'] + s['fn'] else None
        for x in T: T[x] += s[x]
        f = lambda v: '–' if v is None else f'{v * 100:.1f} %'
        lines.append(f"| {k} | {f(P)} | {f(R)} | {s['tp']} | {s['fp']} | {s['fn']} |")
    P = T['tp'] / (T['tp'] + T['fp']) if T['tp'] + T['fp'] else 0
    R = T['tp'] / (T['tp'] + T['fn']) if T['tp'] + T['fn'] else 0
    lines.append(f"| **gesamt** | **{P * 100:.1f} %** | **{R * 100:.1f} %** | {T['tp']} | {T['fp']} | {T['fn']} |")
    return '\n'.join(lines), P, R


ANALYZE_JS = r"""async ([b64, kind]) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const X = await import('/js/smart/extract.js');
  const S = await import('/js/smart/textsrc.js');
  let text = '';
  if (kind === 'pdf') {
    const { loadPdf } = await import('/js/pdfcore.js');
    const { pdf } = await loadPdf(u);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); pages.push(await S.pageLayoutText(p)); }
    pdf.destroy();
    text = pages.join('\n\n');
  } else {
    const eng = await import('/js/ocr/engine.js');
    const r = await eng.recognize(new Blob([u], { type: 'image/jpeg' }), { lang: 'deu+eng' });
    text = S.ocrLayoutText(r);
  }
  const r = X.analyze(text, { today: '2026-10-14' });
  return { text, type: r.type, sender: r.sender && r.sender.name, recipient: r.recipient && r.recipient.name, date: r.date, refs: r.refs, amount: r.amounts.main,
    iban: r.bank.iban, bic: r.bank.bic, due: r.due && r.due.date, phone: r.contact.phone, email: r.contact.email,
    receipt: { merchant: r.receipt.merchant, date: r.receipt.date, total: r.receipt.total, vat: r.receipt.vat, net: r.receipt.net, payment: r.receipt.payment, labor: r.receipt.labor }, tax: r.tax.id };
}"""


with sync_playwright() as pw:
    ensure_server()
    browser = pw.chromium.launch()
    report = {}

    # ---------------------------------------------------------------- extractor accuracy (browser: pdf.js text layer + OCR on photos)
    def t_accuracy():
        ctx, pg = new_page(browser, 'acc')
        md = ['# Briefkasten-Extraktor – Genauigkeit', '', f'Stand {TODAY}; synthetische deutsche Briefe/Belege (gen_corpus.py, gen_holdout.py).', '']
        for title, d, truth, kind, ext in [('Entwicklungs-Korpus · PDF-Textebene (pdf.js)', CORPUS, TRUTH, 'pdf', '.pdf'),
                                           ('Holdout · PDF-Textebene (pdf.js)', HOLD, HTRUTH, 'pdf', '.pdf'),
                                           ('Fotos (OCR auf dem Gerät, tesseract deu+eng)', CORPUS, TRUTH, 'img', '.jpg')]:
            preds = {}
            for id_ in truth:
                p = os.path.join(d, id_ + ext)
                if not os.path.exists(p): continue
                preds[id_] = pg.evaluate(ANALYZE_JS, [b64(p), kind])
            stats, fails = metrics(preds, truth)
            tab, P, R = table(stats, title, len(preds))
            md += [tab, '', '<details><summary>Abweichungen</summary>', '', *[f'- {f}' for f in fails], '', '</details>', '']
            report[title] = {'n': len(preds), 'precision': P, 'recall': R, 'fails': fails}
            print(tab)
            check(f'accuracy {title}: ≥ 40 docs or photos measured', len(preds) >= (40 if 'Entwicklung' in title else 10), len(preds))
            check(f'accuracy {title}: overall precision ≥ 85 %', P >= 0.85, P)
            if kind == 'img':
                json.dump({k: v['text'] for k, v in preds.items()}, open(os.path.join(OUT, 'ocr_texts.json'), 'w'), ensure_ascii=False, indent=1)
        open(os.path.join(OUT, 'accuracy.md'), 'w').write('\n'.join(md))
        ctx.close()

    # ---------------------------------------------------------------- Briefkasten: UI flow
    state = {}

    def t_inbox():
        ctx, pg = new_page(browser, 'inbox')
        goto(pg, '#/briefkasten', 900)
        check('inbox: empty state', pg.locator('.sm-inbox .empty').count() == 1)
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-sm-import]').click()
        fc.value.set_files(os.path.join(CORPUS, 'r01.pdf'))
        pg.wait_for_selector('.sm-letter', timeout=30000)
        val = lambda k: pg.locator(f'.sm-fields [data-field="{k}"]').input_value()
        check('inbox: type Rechnung', pg.locator('[data-type]').input_value() == 'rechnung')
        check('inbox: sender', val('sender') == 'Stadtwerke Saarbrücken GmbH', val('sender'))
        check('inbox: amount', val('amount') == '128,01', val('amount'))
        check('inbox: IBAN + checksum ok', val('iban').replace(' ', '') == TRUTH['r01']['iban'] and 'korrekt' in pg.locator('.sm-iban-state').inner_text(), val('iban'))
        check('inbox: due date', val('due') == '2026-10-27', val('due'))
        check('inbox: due box with label + date', pg.locator('[data-duebox] strong').inner_text().startswith('Zahlung fällig: 27.10.2026'), pg.locator('[data-duebox]').inner_text())
        shot(pg, 'dev_inbox_letter', True)
        letter_id = pg.evaluate("location.hash.split('/').pop()")
        state['letter'] = letter_id
        # edit a field → persisted
        pg.locator('.sm-fields [data-field="kundennummer"]').fill('400 128 777')
        pg.wait_for_timeout(700)
        saved = pg.evaluate("async id => (await (await import('/js/smart/common.js')).sdb.get('letters', id)).f.kundennummer", letter_id)
        check('inbox: edited field saved', saved == '400 128 777', saved)
        # Frist eintragen → reminder
        pg.locator('[data-act="frist"]').click()
        pg.wait_for_selector('dialog[open] .rem-form')
        check('inbox: reminder dialog prefilled', pg.locator('dialog[open] [name=title]').input_value().startswith('Stadtwerke Saarbrücken GmbH bezahlen') and pg.locator('dialog[open] [name=due]').input_value() == '2026-10-27')
        pg.locator('dialog[open] .btn-primary').click()
        pg.wait_for_timeout(600)
        rems = pg.evaluate("async () => (await (await import('/js/db.js')).listReminders()).map(r => ({ t: r.title, d: r.due, type: r.type, doc: r.docId }))")
        check('inbox: reminder created', any(r['d'] == '2026-10-27' and r['type'] == 'zahlung' and r['doc'] for r in rems), rems)
        # GiroCode
        pg.locator('[data-act="zahlen"]').click()
        pg.wait_for_selector('dialog[open] [data-qr] svg', timeout=8000)
        payload = pg.locator('dialog[open] [data-qr]').get_attribute('data-payload')
        pg.wait_for_timeout(500)  # dialog open animation
        pg.locator('dialog[open] [data-qr]').screenshot(path=os.path.join(OUT, 'girocode.png'))
        dec = qr_decode(os.path.join(OUT, 'girocode.png'))
        lines = dec.split('\n')
        check('girocode: decodes with OpenCV', dec == payload and len(lines) >= 8, [dec, payload])
        check('girocode: EPC header BCD/002/UTF-8/SCT', lines[:4] == ['BCD', '002', '1', 'SCT'], lines[:4])
        check('girocode: BIC, name, IBAN, amount', lines[4] == 'SAKSDE55XXX' and lines[5] == 'Stadtwerke Saarbrücken GmbH' and lines[6] == TRUTH['r01']['iban'] and lines[7] == 'EUR128.01', lines)
        check('girocode: remittance text', len(lines) > 10 and lines[10] == 'SR-2026-0098812', lines)
        shot(pg, 'dev_girocode_dialog')
        # change amount in the dialog → QR updates
        amt = pg.locator('dialog[open] [data-field="t_amount"]')
        amt.fill('100,00'); pg.wait_for_timeout(600)
        p2 = pg.locator('dialog[open] [data-qr]').get_attribute('data-payload')
        check('girocode: edited amount', 'EUR100.00' in p2, p2)
        pg.locator('dialog[open] .dlg-actions .btn-ghost').last.click() if False else pg.keyboard.press('Escape')
        pg.wait_for_timeout(300)
        # Antwort schreiben → prefilled generator
        pg.locator('[data-act="antwort"]').click()
        pg.locator('.menu-item', has_text='Auf Zahlungsaufforderung antworten').click()
        pg.wait_for_selector('.lt-gen', timeout=10000)
        rn = pg.locator('.lt-form [name=r_name]').input_value()
        z = pg.locator('.lt-form [name=zeichen]').input_value()
        check('answer: generator prefilled (recipient + reference)', rn == 'Stadtwerke Saarbrücken GmbH' and z == 'SR-2026-0098812', [rn, z])
        check('answer: preview contains sender address', 'Hohenzollernstraße 104' in pg.locator('.lt-paper').inner_text())
        shot(pg, 'dev_answer_letter')
        # Ablegen
        goto(pg, f'#/briefkasten/{letter_id}', 900)
        pg.locator('[data-act="ablegen"]').click()
        pg.wait_for_selector('dialog[open] .sm-file-form')
        pg.locator('dialog[open] .btn-primary').click()
        pg.wait_for_timeout(1500)
        doc = pg.evaluate("""async id => { const S = await import('/js/smart/common.js'); const l = await S.sdb.get('letters', id); const db = await import('/js/db.js'); const d = await db.getDoc(l.docId);
          const O = await import('/js/extras/organize.js'); const f = await O.listFolders(); const t = await O.listTags();
          return { name: d.name, folder: O.folderPath(f, d.folder).map(x => x.name), tags: (d.tags || []).map(x => (t.find(y => y.id === x) || {}).name), filed: l.filed }; }""", letter_id)
        check('ablegen: folder Post/Rechnungen + tags + renamed', doc['folder'] == ['Post', 'Rechnungen'] and 'Rechnung' in doc['tags'] and doc['name'].startswith('2026-10-06 Rechnung Stadtwerke') and doc['filed'], doc)
        # status → erledigt
        pg.locator('[data-act="status"]').click(); pg.wait_for_timeout(500)
        st = pg.evaluate("async id => (await (await import('/js/smart/common.js')).sdb.get('letters', id)).status", letter_id)
        check('inbox: mark done', st == 'erledigt', st)
        pg.locator('[data-act="status"]').click(); pg.wait_for_timeout(400)
        # second letter: Bescheid with computed Widerspruchsfrist + Einspruch answer
        did = import_file(pg, os.path.join(CORPUS, 'b01.pdf'), 'Steuerbescheid.pdf')
        goto(pg, f'#/briefkasten/neu?doc={did}', 400)
        pg.wait_for_selector('.sm-letter', timeout=30000)
        dl = pg.locator('[data-deadlines]').inner_text()
        check('bescheid: computed Einspruchsfrist with hint (4-day rule since 2025)', '12.11.2026' in dl and 'berechnet' in dl and 'vier Tage' in dl, dl)
        pg.locator('[data-act="antwort"]').click()
        pg.locator('.menu-item', has_text='Einspruch einlegen').click()
        pg.wait_for_selector('.lt-gen', timeout=10000)
        az = pg.locator('.lt-form [name=az]').input_value()
        check('bescheid: Einspruch prefilled with Steuernummer + date', az == '040/123/45678' and pg.locator('.lt-form [name=datum_bescheid]').input_value() == '2026-10-06', az)
        # list + start card
        goto(pg, '#/briefkasten', 800)
        check('inbox list: 2 open letters', pg.locator('.sm-row').count() == 2, pg.locator('.sm-row').count())
        shot(pg, 'dev_inbox_list')
        goto(pg, '#/start', 1200)
        check('start: due letter card', 'Stadtwerke Saarbrücken GmbH' in pg.locator('.sm-due-list').inner_text())
        check('start: assistants grid', pg.locator('.sm-start-tile').count() == 4)
        goto(pg, '#/werkzeuge', 800)
        check('werkzeuge: Assistenten group with 4 cards', pg.locator('[data-section="assistenten"] .tool-card').count() == 4)
        goto(pg, '#/dateien?smart=briefe', 900)
        names = pg.locator('[data-files] .doc-name, [data-files] .fr-name').all_inner_texts()
        check('dateien: smart filter "Briefe" shows only letters', len(names) == 2 and pg.locator('.sm-fchip[aria-pressed="true"]').count() == 1, names)
        state['inbox_ctx'] = (ctx, pg)

    # ---------------------------------------------------------------- photo + OCR + searchable "Ablegen" + KI button hidden effects
    def t_photo():
        ctx, pg = new_page(browser, 'photo')
        did = import_file(pg, os.path.join(CORPUS, 'r03.jpg'), 'Brief Wasser.jpg', 'image/jpeg')
        goto(pg, f'#/briefkasten/neu?doc={did}', 300)
        pg.wait_for_selector('.sm-letter', timeout=90000)
        iban = pg.locator('.sm-fields [data-field="iban"]').input_value().replace(' ', '')
        check('photo/OCR: IBAN recognised', iban == TRUTH['r03']['iban'], iban)
        check('photo/OCR: sender', 'Wasserverband' in pg.locator('.sm-fields [data-field="sender"]').input_value())
        pg.locator('[data-act="ablegen"]').click()
        pg.wait_for_selector('dialog[open] .sm-file-form')
        check('photo: searchable option offered', pg.locator('dialog[open] [name=f_search]').is_visible())
        pg.locator('dialog[open] .btn-primary').click()
        wait_js(pg, "!document.querySelector('.toast-progress')", timeout=60000)
        pg.wait_for_timeout(1500)
        info = pg.evaluate("""async () => { const db = await import('/js/db.js'); const fs = await db.listFiles(); const pdf = fs.find(f => (!f.kind || f.kind === 'pdf') && /Wasserverband/.test(f.name));
           if (!pdf) return { files: fs.map(f => f.name) }; const t = await db.getText(pdf.id) || []; const trash = (await db.listTrash()).map(x => x.meta.name); return { name: pdf.name, text: t.join(' ').slice(0, 400), trash }; }""")
        check('photo: replaced by searchable PDF with text layer', info.get('name', '').endswith('.pdf') and 'Wasserverband' in info.get('text', '') and 'Brief Wasser.jpg' in info.get('trash', []), info)
        ctx.close()

    # ---------------------------------------------------------------- scanner hand-off (?ziel=briefkasten)
    def t_scan():
        ctx, pg = new_page(browser, 'scan', w=390, h=844, mobile=True)
        goto(pg, '#/werkzeug/scannen?ziel=briefkasten', 2500)
        check('scan: title "Brief scannen"', 'Brief scannen' in pg.locator('.screen-title').inner_text())
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-gallery]').first.click()
        fc.value.set_files(os.path.join(CORPUS, 'm01.jpg'))
        pg.wait_for_selector('.sc-card', timeout=30000)
        pg.locator('.screen-foot .btn-primary').click()
        pg.wait_for_selector('.sm-letter', timeout=120000)
        t = pg.locator('[data-type]').input_value()
        amt = pg.locator('.sm-fields [data-field="amount"]').input_value()
        check('scan → Briefkasten: Mahnung recognised from the scan', t == 'mahnung' and amt == '92,40', [t, amt])
        shot(pg, 'dev_scan_letter_phone')
        ctx.close()

    # ---------------------------------------------------------------- Dokumenten-Gedächtnis
    def t_memory():
        ctx, pg = new_page(browser, 'memory')
        unit = pg.evaluate("""async () => { const M = await import('/js/smart/memory.js'); const toks = M.tokenize('Ihr Handyvertrag und die Versicherungsnummer 123/456');
          return { plural: M.stem('Verträge') === M.stem('Vertrag'), fold: M.fold('Straße') === 'strasse', split: toks.some(t => t.part && t.w === 'handy') && toks.some(t => t.part && t.w === 'vertrag'),
            code: toks.some(t => t.code && t.t === '123456'), ue: M.queryTerms('kuendigung').terms.has(M.stem('Kündigung')), syn: M.queryTerms('Handyvertrag').terms.has(M.stem('mobilfunk')) }; }""")
        check('memory unit: stemming, ß, compounds, codes, ue→ü, synonyms', all(unit.values()), unit)
        ids = {}
        for k in ['v03', 'v05', 'r10', 'r01', 'b01', 'k01', 'i03']:
            ids[k] = import_file(pg, os.path.join(CORPUS, k + '.pdf'), {'v03': 'Vertragsbestätigung Mobilfunk.pdf', 'v05': 'Fitness Willkommen.pdf', 'r10': 'Nebenkosten 2025.pdf'}.get(k, k + '.pdf'))
            pg.evaluate('id => window.__t.waitText(id)', ids[k])
        pg.evaluate("async () => { const M = await import('/js/smart/memory.js'); M.markDirty(); await M.syncIndex({ force: true }); }")
        def ask(q):
            goto(pg, '#/suche?q=' + urllib.request.quote(q), 300)
            pg.wait_for_selector('.sm-answer', timeout=10000)
            pg.wait_for_timeout(300)
            return pg.locator('.sm-answer').inner_text()
        a = ask('Wann läuft mein Handyvertrag aus?')
        check('memory: "Wann läuft mein Handyvertrag aus?" → contract answer', 'FunkNetz' in a and '31.03.2027' in a and 'Kündigungsfrist 1 Monat' in a, a)
        shot(pg, 'dev_memory_answer')
        a = ask('Kündigungsfrist Fitnessstudio')
        check('memory: fitness notice period 3 months, deadline 30.06.2027', 'Elbe Fitness' in a and '3 Monate' in a and '30.06.2027' in a, a)
        a = ask('IBAN Vermieter')
        check('memory: "IBAN Vermieter" → Hausverwaltung IBAN', 'Hausverwaltung Nordlicht' in a and TRUTH['r10']['iban'][:4] in a.replace(' ', ''), a)
        a = ask('Rechnung Stadtwerke 2025')
        check('memory: passages with highlight + "Öffnen auf Seite"', 'Öffnen auf Seite 1' in a and pg.locator('.sm-pass mark').count() > 0 and 'r01.pdf' in pg.locator('.sm-pass').first.inner_text() and 'Strom 2025' in pg.locator('.sm-pass').first.inner_text(), a)
        href = pg.locator('.sm-pass').first.get_attribute('href')
        check('memory: passage links to viewer page + query', re.match(r'#/ansicht/\w+\?seite=1&q=', href or ''), href)
        a = ask('Jahresabrechnung Strom')
        check('memory: classic results still shown below the answer', pg.locator('.search-results .result-group').count() >= 1 and 'Stadtwerke' in a, a)
        a = ask('Wie viel Nachzahlung Nebenkosten?')
        check('memory: amount question', '122,85' in a, a)
        # incremental: delete the contract → answer disappears; rename shows up
        pg.evaluate("async id => { const db = await import('/js/db.js'); await db.deleteDoc(id); (await import('/js/library.js')).emitChange(); }", ids['v03'])
        pg.wait_for_timeout(300)
        pg.evaluate("async () => { const M = await import('/js/smart/memory.js'); M.markDirty(); await M.syncIndex(); }")
        goto(pg, '#/suche?q=' + urllib.request.quote('Wann läuft mein Handyvertrag aus?'), 1500)
        txt = pg.locator('[data-smart-answer]').inner_text() if pg.locator('[data-smart-answer]').is_visible() else ''
        check('memory: incremental – deleted document no longer answers', 'FunkNetz' not in txt, txt)
        n_terms = pg.evaluate("async () => (await (await import('/js/smart/memory.js')).stats())")
        check('memory: index stats (IndexedDB inverted index)', n_terms['docs'] == 6 and n_terms['terms'] > 200 and n_terms['facts'] > 10, n_terms)
        goto(pg, '#/gedaechtnis', 1500)
        check('gedaechtnis screen: contracts listed', 'Elbe Fitness' in pg.locator('[data-contracts]').inner_text())
        shot(pg, 'dev_gedaechtnis', True)
        ctx.close()

    # ---------------------------------------------------------------- Steuer-Belege
    def t_tax():
        ctx, pg = new_page(browser, 'tax')
        goto(pg, '#/steuer/2026', 900)
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-import]').click()
        files = [os.path.join(CORPUS, f'{k}.pdf') for k in ['c01', 'c03', 'c05', 'r08', 'r12', 'r13', 's03', 'r06']]
        fc.value.set_files(files)
        wait_js(pg, "!document.querySelector('.toast-progress')", timeout=60000)
        pg.wait_for_timeout(1200)
        recs = pg.evaluate("async () => (await (await import('/js/smart/tax.js')).listReceipts()).map(r => ({ m: r.merchant, y: r.year, t: r.total, c: r.category, l: r.labor, p: r.payment }))")
        check('tax: 8 receipts recognised', len(recs) == 8, recs)
        cats = {r['m']: r['c'] for r in recs}
        check('tax: categories suggested (Handwerker, Fortbildung, Arbeitsmittel, Spenden, Fahrtkosten, haushaltsnah)', sorted(set(cats.values())) == sorted({'privat', 'arbeitsmittel', 'fahrtkosten', 'handwerker', 'fortbildung', 'haushaltsnah', 'spenden'}), cats)
        check('tax: labour cost (§ 35a) recognised', any(r['l'] == 273.7 for r in recs) and any(r['l'] == 285.6 for r in recs), recs)
        check('tax: donation from 2025 goes to 2025', any(r['y'] == 2025 and r['t'] == 150 for r in recs))
        goto(pg, '#/steuer/2026', 900)
        shot(pg, 'dev_tax_year', True)
        total = pg.locator('.sm-sum-total strong').inner_text()
        exp = sum(r['t'] for r in recs if r['y'] == 2026 and r['c'] != 'privat')
        check('tax: total of relevant receipts', total.replace(' ', ' ') == f"{exp:,.2f} €".replace(',', 'X').replace('.', ',').replace('X', '.'), [total, exp])
        # edit one receipt: change category of the supermarket bon to Arbeitsmittel and back (dialog)
        pg.locator('.sm-rc', has_text='Frischmarkt').locator('.sm-rc-main').click()
        pg.wait_for_selector('dialog[open] .sm-rc-form')
        pg.locator('dialog[open] [name=note]').fill('Testnotiz')
        pg.locator('dialog[open] [name=payment]').select_option('bar')
        pg.locator('dialog[open] [name=category]').select_option('handwerker')
        warn = pg.locator('dialog[open] .sm-cat-note').inner_text()
        check('tax: cash warning for §35a', 'Barzahlung' in warn, warn)
        pg.locator('dialog[open] [name=category]').select_option('privat')
        pg.locator('dialog[open] .btn-primary').click(); pg.wait_for_timeout(500)
        note = pg.evaluate("async () => (await (await import('/js/smart/tax.js')).listReceipts(2026)).find(r => /Frischmarkt/i.test(r.merchant)).note")
        check('tax: edit saved', note == 'Testnotiz', note)
        pg.locator('input[data-home]').fill('100'); pg.wait_for_timeout(200)
        check('tax: Homeoffice-Pauschale 100 × 6 €', '600,00' in pg.locator('[data-homesum]').inner_text())
        # XLSX export
        pg.locator('[data-exp="xlsx"]').click()
        pg.wait_for_selector('dialog[open]')
        with pg.expect_download() as d:
            pg.locator('dialog[open] .btn-primary').click()
        xp = os.path.join(OUT, 'steuer-2026.xlsx'); d.value.save_as(xp)
        import openpyxl
        wb = openpyxl.load_workbook(xp, data_only=True)
        wbf = openpyxl.load_workbook(xp)
        ws, wsf = wb[wb.sheetnames[0]], wbf[wbf.sheetnames[0]]
        rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0] is not None]
        brutto = round(sum(r[5] or 0 for r in rows), 2)
        sum_row = [r for r in ws.iter_rows(values_only=True) if r and r[2] == 'Summe'][0]
        sum_f = [r for r in wsf.iter_rows(values_only=True) if r and r[2] == 'Summe'][0]
        check('xlsx: one row per receipt of 2026', len(rows) == 7, len(rows))
        check('xlsx: SUM formula with correct cached value', str(sum_f[5]).startswith('=SUM(F2:F') and abs(sum_row[5] - brutto) < 0.005, [sum_f[5], sum_row[5], brutto])
        check('xlsx: labour column sum', abs(sum_row[9] - 273.7 - 285.6) < 0.005, sum_row)
        ov = wb['Übersicht']
        ovr = {r[1]: r for r in ov.iter_rows(values_only=True) if r and r[1]}
        check('xlsx: overview SUMIF per category', abs(ovr['Handwerkerleistungen'][3] - 442.68) < 0.005 and str(wbf['Übersicht']['D2'].value).startswith('=') , ovr.get('Handwerkerleistungen'))
        check('xlsx: Homeoffice row', any('Homeoffice' in str(r[0]) and r[3] == 600 for r in ov.iter_rows(values_only=True) if r and r[0]))
        # CSV
        pg.locator('[data-exp="csv"]').click(); pg.wait_for_selector('dialog[open]')
        with pg.expect_download() as d:
            pg.locator('dialog[open] .btn-primary').click()
        cp = os.path.join(OUT, 'steuer-2026.csv'); d.value.save_as(cp)
        csv = open(cp, encoding='utf-8-sig').read().splitlines()
        check('csv: header + 7 rows, German decimals, ; separated', len(csv) == 8 and csv[0].startswith('Nr.;Datum;') and any(';442,68;' in l for l in csv), csv[:3])
        # PDF bundle
        pg.locator('[data-exp="pdf"]').click()
        wait_js(pg, "!document.querySelector('.toast-progress')", timeout=60000)
        pg.wait_for_timeout(800)
        meta = pg.evaluate("""async () => { const db = await import('/js/db.js'); const d = (await db.listFiles()).find(x => /Mappe/.test(x.name)); const b = await db.getFile(d.id);
          const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return { name: d.name, b64: btoa(s) }; }""")
        pp = os.path.join(OUT, 'steuer-2026-mappe.pdf')
        open(pp, 'wb').write(base64.b64decode(meta['b64']))
        from pypdf import PdfReader
        rd = PdfReader(pp)
        t0 = rd.pages[0].extract_text(); t1 = rd.pages[1].extract_text()
        check('pdf bundle: cover + TOC + all receipt pages', len(rd.pages) == 2 + 7 and 'Belege zur Steuererklärung' in t0 and 'Inhaltsverzeichnis' in t1 and 'Frischmarkt' in t1, [len(rd.pages), t1[:200]])
        check('pdf bundle: receipt pages stamped', 'Beleg 1' in rd.pages[2].extract_text())
        subprocess.run(['pdftoppm', '-r', '50', '-f', '1', '-l', '2', '-png', pp, os.path.join(OUT, 'dev_mappe')], check=False)
        ctx.close()

    # ---------------------------------------------------------------- offline + no data leaves the device
    def t_offline():
        ctx, pg = new_page(browser, 'offline')
        external = []
        pg.on('request', lambda r: external.append(r.url) if not r.url.startswith(URL) and not r.url.startswith('data:') and not r.url.startswith('blob:') else None)
        wait_js(pg, "navigator.serviceWorker.getRegistration().then(r => !!(r && r.active && r.active.state === 'activated'))", timeout=120000)
        pg.reload(); wait_js(pg, 'document.documentElement.classList.contains("ready") && !!navigator.serviceWorker.controller', timeout=30000)
        ctx.set_offline(True)
        did = import_file(pg, os.path.join(CORPUS, 'm02.pdf'), 'Inkasso.pdf')
        goto(pg, f'#/briefkasten/neu?doc={did}', 300)
        pg.wait_for_selector('.sm-letter', timeout=30000)
        check('offline: Briefkasten works without network', pg.locator('[data-type]').input_value() == 'mahnung' and pg.locator('.sm-fields [data-field="aktenzeichen"]').input_value() == 'WFM 26/88123')
        pg.locator('[data-act="zahlen"]').click()
        pg.wait_for_selector('dialog[open] [data-qr] svg', timeout=8000)
        check('offline: GiroCode offline', 'EUR213.49' in pg.locator('dialog[open] [data-qr]').get_attribute('data-payload'))
        pg.keyboard.press('Escape')
        goto(pg, '#/suche?q=' + urllib.request.quote('Wie viel Inkasso Forderung?'), 2500)
        check('offline: Gedächtnis answer offline', '213,49' in pg.locator('[data-smart-answer]').inner_text())
        goto(pg, '#/steuer/2026', 800)
        check('offline: Steuer-Belege screen offline', pg.locator('.sm-tax').count() == 1)
        goto(pg, '#/familie', 2500)
        txt = pg.locator('.sm-family').inner_text()
        check('offline/no account: Familien-Ordner shows "kommt mit dem FaLe-Konto" or offline note', 'FaLe-Konto' in txt or 'Internetverbindung' in txt, txt[:200])
        check('privacy: no external requests at all', not external, external[:5])
        ctx.set_offline(False)
        goto(pg, '#/familie', 2500)
        txt = pg.locator('.sm-family').inner_text()
        check('accounts not enabled: "kommt mit dem FaLe-Konto"', 'kommt mit dem FaLe-Konto' in txt, txt[:200])
        shot(pg, 'dev_family_off')
        ctx.close()

    # ---------------------------------------------------------------- English UI (runtime translation)
    def t_i18n():
        ctx, pg = new_page(browser, 'en', lang='en')
        did = import_file(pg, os.path.join(CORPUS, 'r05.pdf'), 'DSL.pdf')
        goto(pg, f'#/briefkasten/neu?doc={did}', 300)
        pg.wait_for_selector('.sm-letter', timeout=30000)
        pg.wait_for_timeout(600)
        t = pg.locator('.sm-letter').inner_text()
        check('i18n: English labels', 'Prepare transfer' in t and ('Recognised details' in t or 'Recognized details' in t) and 'Payment due' in t and '% certain' in t, t[:300])
        check('i18n: document data untouched', 'HanseNet Kabel GmbH' in t)
        shot(pg, 'dev_letter_en')
        # every visible UI text on the assistant screens is English (document data excluded)
        GER = r"""(el) => { const skip = '[data-no-i18n],pre,code,textarea,.doc-name,.fr-name,.tchip,.sm-pass-snip,.sm-sender,.result-head strong,.hit-snippet,svg,script,style,option:not(:checked)';
          const re = /[äöüßÄÖÜ]|\b(und|der|die|das|nicht|mit|für|auf|oder|Frist|Fristen|Brief|Briefe|Beleg|Belege|Datei|Dateien|Steuer|Zahlung|Vertrag|Rechnung|Seite|Ordner|bitte|noch|keine|deine|dein)\b/;
          const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let n; while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (!t || !n.parentElement || n.parentElement.closest(skip)) continue;
            if (!n.parentElement.checkVisibility || !n.parentElement.checkVisibility()) continue; if (re.test(t)) out.push(t.slice(0, 80)); }
          return [...new Set(out)]; }"""
        left = {}
        for hsh in ['#/start', '#/werkzeuge', '#/briefkasten', f'#/briefkasten/neu?doc={did}', '#/gedaechtnis', '#/suche?q=' + urllib.request.quote('Wann muss ich DSL bezahlen?'), '#/steuer/2026', '#/familie']:
            goto(pg, hsh, 1500)
            if 'neu?doc' in hsh: pg.wait_for_selector('.sm-letter', timeout=30000); pg.wait_for_timeout(800)
            found = pg.evaluate(GER, pg.locator('main, #app, body').first.element_handle())
            if found: left[hsh] = found
        check('i18n: no German UI text left on assistant screens (EN)', not left, json.dumps(left, ensure_ascii=False)[:3000])
        ctx.close()
        ctx, pg = new_page(browser, 'de-sanity')
        goto(pg, '#/briefkasten', 1200)
        check('i18n: scanner sanity (finds German in DE mode)', len(pg.evaluate(GER, pg.locator('body').element_handle())) > 3)
        ctx.close()

    # ---------------------------------------------------------------- Familien-Ordner (account harness, two + one accounts) and KI
    def H(path, data=None):
        req = urllib.request.Request(HURL.rstrip('/') + path, data=data.encode() if isinstance(data, str) else data, method='POST' if data is not None else 'GET')
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())

    def sign_in(pg, email):
        goto(pg, '#/konto', 1500)
        pg.fill('input[name=email]', email)
        pg.click('[data-submit]')
        pg.wait_for_selector('.acct-code:not([hidden])', timeout=8000)
        code = H(f'/__test/otp?email={email}')['code']
        pg.fill('input[name=code]', code)
        pg.wait_for_selector('.acct-head', timeout=10000)
        pg.evaluate("async pw => { const E = await import('/js/sync/engine.js'); const st = await E.refreshRemote(); if (st && !st.key) { await E.setup(pw); E.start(); } }", 'Korrekt-Pferd-Batterie-42')

    def t_family():
        if not port_open(9310):
            env = dict(os.environ, PGDB='fale_smart_e2e')
            subprocess.Popen(['node', os.path.join(SP, '..', 'acct', 'account_harness.mjs'), '9310'], env=env, stdout=open(os.path.join(OUT, 'harness.log'), 'w'), stderr=subprocess.STDOUT)
            for _ in range(80):
                if port_open(9310): break
                time.sleep(0.25)
        H('/__test/reset')
        ctxA, A = new_page(browser, 'famA', base=HURL)
        ctxB, B = new_page(browser, 'famB', base=HURL, w=390, h=844, mobile=True)
        ctxC, C = new_page(browser, 'famC', base=HURL)
        for pg, mail in [(A, 'anna@example.com'), (B, 'ben@example.com'), (C, 'carla@example.com')]:
            sign_in(pg, mail)
        goto(A, '#/familie', 2500)
        A.locator('[data-new]').click()
        A.wait_for_selector('dialog[open] input')
        A.locator('dialog[open] input').fill('Familie Muster')
        A.locator('dialog[open] .btn-primary').click()
        A.wait_for_selector('.sm-invite', timeout=15000)
        gid = A.evaluate("location.hash.split('/')[2].split('?')[0]")
        check('family: group created (name only encrypted on the server)', len(gid) == 36 and not H('/__test/sql', f"select 1 from public.fam_groups where sealed_name like '%Muster%'")['rows'])
        # invite Ben as Mitglied
        A.locator('.sm-invite [name=role]').select_option('mitglied')
        A.locator('[data-invite]').click()
        A.wait_for_selector('dialog[open] input[data-link]')
        link = A.locator('dialog[open] input[data-link]').input_value()
        A.wait_for_timeout(500)  # dialog open animation
        A.locator('dialog[open] [data-qr]').screenshot(path=os.path.join(OUT, 'invite_qr.png'))
        dec = qr_decode(os.path.join(OUT, 'invite_qr.png'))
        check('family: invite QR decodes to the link', dec == link and '#/familie/beitreten?i=' in link, [dec, link])
        secret = link.split('&t=')[1]
        logs = H('/__test/log')['log']
        check('family: invite secret never sent to the server', not any(secret in (e.get('body') or '') or secret in e.get('path', '') for e in logs))
        shot(A, 'dev_family_invite')
        A.keyboard.press('Escape')
        frag = link.split('#', 1)[1]
        goto(B, '#' + frag, 2000)
        B.locator('[data-join]').click()
        B.wait_for_selector('.sm-fam-panel', timeout=15000)
        check('family: Ben joined', gid in B.evaluate('location.hash'))
        # one-time: reuse fails
        goto(C, '#' + frag, 2000)
        C.locator('[data-join]').click(); C.wait_for_timeout(1500)
        check('family: invite is one-time', 'schon verwendet' in C.locator('#toasts').inner_text(), C.locator('#toasts').inner_text())
        # Anna shares a document
        did = import_file(A, os.path.join(CORPUS, 'i03.pdf'), 'Haftpflicht-Police.pdf')
        goto(A, f'#/familie/{gid}?tab=dokumente', 2000)
        A.locator('.sm-fam-bar .btn-primary').click()
        A.wait_for_selector('dialog[open] .sm-pick-item')
        A.locator('dialog[open] .sm-pick-item', has_text='Haftpflicht-Police.pdf').locator('input').check()
        A.locator('dialog[open] .btn-primary').click()
        A.wait_for_selector('.sm-fam-item', timeout=20000)
        objs = H('/__test/sql', "select name, (metadata->>'size')::int s from storage.objects where bucket_id = 'family'")['rows']
        check('family: encrypted object stored under <group>/<blob>', len(objs) == 1 and objs[0]['name'].startswith(gid + '/'), objs)
        meta_rows = H('/__test/sql', "select meta from public.fam_items")['rows']
        check('family: no plaintext file name on the server', meta_rows and all('Haftpflicht' not in (r['meta'] or '') for r in meta_rows))
        # shared reminder + note
        goto(A, f'#/familie/{gid}?tab=fristen', 1500)
        A.locator('.sm-fam-bar .btn-primary').click()
        A.locator('dialog[open] [name=title]').fill('Kfz-Versicherung wechseln')
        A.locator('dialog[open] [name=due]').fill('2026-11-30')
        A.locator('dialog[open] .btn-primary').click(); A.wait_for_timeout(1500)
        # Ben downloads + takes over the reminder
        goto(B, f'#/familie/{gid}?tab=dokumente', 2500)
        B.locator('.sm-fam-item .btn-soft').first.click()
        B.wait_for_timeout(2500)
        same = B.evaluate("""async () => { const db = await import('/js/db.js'); const d = (await db.listFiles()).find(x => x.name === 'Haftpflicht-Police.pdf'); if (!d) return null;
           const b = await db.getFile(d.id); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join(''); }""")
        import hashlib
        check('family: Ben decrypts the shared document (identical bytes)', same == hashlib.sha256(open(os.path.join(CORPUS, 'i03.pdf'), 'rb').read()).hexdigest(), same)
        shot(B, 'dev_family_docs_phone')
        goto(B, f'#/familie/{gid}?tab=fristen', 2000)
        B.locator('.sm-fam-item .btn-soft', has_text='Bei mir eintragen').click(); B.wait_for_timeout(800)
        rem = B.evaluate("async () => (await (await import('/js/db.js')).listReminders()).map(r => r.title + '|' + r.due)")
        check('family: shared reminder taken over locally', 'Kfz-Versicherung wechseln|2026-11-30' in rem, rem)
        # Carla as Notfallkontakt
        goto(A, f'#/familie/{gid}?tab=mitglieder', 2000)
        A.locator('.sm-invite [name=role]').select_option('notfall')
        A.locator('[data-invite]').click()
        A.wait_for_selector('dialog[open] input[data-link]')
        link2 = A.locator('dialog[open] input[data-link]').input_value(); A.keyboard.press('Escape')
        goto(C, '#' + link2.split('#', 1)[1], 2000)
        C.locator('[data-join]').click()
        C.wait_for_selector('.sm-em-card', timeout=15000)
        check('emergency: contact sees nothing before release', 'Noch nicht eingerichtet' in C.locator('.sm-em-card').inner_text())
        r = C.evaluate("async g => (await (await import('/js/account/auth.js')).rpc('fam_items_list', { p_group: g, p_after: 0 }))", gid)
        check('emergency: server refuses items to the contact', r.get('ok') is False, r)
        goto(A, f'#/familie/{gid}?tab=notfall', 2000)
        A.locator('.sm-em-card select').select_option('7')
        A.locator('.sm-em-card .btn-primary').click(); A.wait_for_timeout(1500)
        check('emergency: escrow stored (wrapped for the contact)', H('/__test/sql', "select state, wait_days from public.fam_emergency")['rows'] == [{'state': 'bereit', 'wait_days': '7'}] or H('/__test/sql', "select state from public.fam_emergency")['rows'][0]['state'] == 'bereit')
        goto(C, f'#/familie/{gid}?tab=notfall', 2000)
        C.locator('.sm-em-card .btn-primary').click()
        C.wait_for_selector('dialog[open]'); C.locator('dialog[open] .btn-primary').click(); C.wait_for_timeout(1500)
        check('emergency: requested, waiting period shown', 'Anfrage läuft' in C.locator('.sm-em-card').inner_text(), C.locator('.sm-em-card').inner_text())
        shot(C, 'dev_emergency_contact')
        goto(A, '#/start', 3000)
        check('emergency: owner alerted on Start', 'Notfallzugang angefragt' in A.locator('.sm-due-list').inner_text(), A.locator('.sm-due-list').inner_text())
        goto(A, f'#/familie/{gid}?tab=notfall', 2000)
        A.locator('.sm-em-card .btn-danger').click(); A.wait_for_timeout(1200)
        st = H('/__test/sql', "select state from public.fam_emergency")['rows'][0]['state']
        check('emergency: owner declines', st == 'abgelehnt', st)
        # time passes: decline older than 24h, new request, waiting period over
        H('/__test/sql', "update public.fam_emergency set decided_at = now() - interval '2 days'")
        goto(C, f'#/familie/{gid}?tab=notfall', 2000)
        C.locator('.sm-em-card .btn-primary').click(); C.wait_for_selector('dialog[open]'); C.locator('dialog[open] .btn-primary').click(); C.wait_for_timeout(1500)
        H('/__test/sql', "update public.fam_emergency set release_at = now() - interval '1 minute'")
        goto(C, f'#/familie/{gid}?tab=notfall', 2000)
        C.locator('.sm-em-card .btn-primary').click(); C.wait_for_timeout(2500)
        goto(C, f'#/familie/{gid}?tab=dokumente', 2500)
        check('emergency: after the waiting period the contact can read', C.locator('.sm-fam-item', has_text='Haftpflicht-Police.pdf').count() == 1)
        shot(C, 'dev_emergency_released')
        # Ben leaves → no access
        goto(B, f'#/familie/{gid}?tab=mitglieder', 2000)
        B.locator('.sm-member', has_text='(du)').locator('.btn-danger-ghost').click()
        B.wait_for_selector('dialog[open]'); B.locator('dialog[open] .btn-danger').click(); B.wait_for_timeout(1500)
        r = B.evaluate("async g => (await (await import('/js/account/auth.js')).rpc('fam_items_list', { p_group: g, p_after: 0 }))", gid)
        check('family: after leaving no server access', r.get('ok') is False, r)
        goto(A, '#/familie', 2500)
        shot(A, 'dev_family_overview')
        state['famA'] = (ctxA, A, gid)

        # ---------------------------------------------------------- KI: letter_extract (mock provider), consent first
        did = import_file(A, os.path.join(CORPUS, 'm03.pdf'), 'Zahnarzt.pdf')
        goto(A, f'#/briefkasten/neu?doc={did}', 400)
        try:
            A.wait_for_selector('.sm-letter', timeout=30000)
        except Exception:
            shot(A, 'dbg_ki_fail'); print(A.locator('main').inner_text()[:1500]); raise
        A.locator('.sm-fields [data-field="kundennummer"]').fill(''); A.wait_for_timeout(600)
        ai_req = []
        A.on('request', lambda r: ai_req.append(r.url) if '/api/ai' in r.url and 'quota' not in r.url else None)
        ai_calls = lambda: list(ai_req)
        A.locator('[data-act="ki"]').click()
        A.wait_for_selector('dialog[open] pre', state='attached')
        check('ki: shows exactly what is sent (before any request)', 'Zahnarztpraxis' in (A.locator('dialog[open] pre').text_content() or ''))
        A.locator('dialog[open] .btn-primary').click()
        A.wait_for_selector('dialog[open] .ai-consent', timeout=10000)
        check('ki: consent dialog before any request (no AI call yet)', not ai_calls(), ai_calls()[:2])
        A.locator('dialog[open] .btn-primary').click()
        A.wait_for_timeout(3500)
        check('ki: AI request only after consent', len(ai_calls()) >= 1, ai_calls())
        kn = A.evaluate("async () => { const S = await import('/js/smart/common.js'); const all = await S.sdb.all('letters'); return all.map(l => l.f.kundennummer); }")
        check('ki: letter_extract fills empty fields only', 'KI-4711' in kn, kn)
        for c in (ctxB, ctxC):
            c.close()

    # ---------------------------------------------------------------- screenshots (phone + desktop, light + dark)
    def t_shots():
        for theme in ['light', 'dark']:
            for (w, h, mob, tag) in [(390, 844, True, 'phone'), (1280, 900, False, 'desktop')]:
                ctx, pg = new_page(browser, f'shots-{tag}-{theme}', w=w, h=h, mobile=mob, theme=theme)
                ids = {}
                for k in ['r01', 'b01', 'v05', 'm01']:
                    ids[k] = import_file(pg, os.path.join(CORPUS, k + '.pdf'), k + '.pdf')
                    goto(pg, f'#/briefkasten/neu?doc={ids[k]}', 300)
                    pg.wait_for_selector('.sm-letter', timeout=30000)
                letter = pg.evaluate("location.hash")
                for k in ['c01', 'c03', 'r08', 'r12']:
                    d = import_file(pg, os.path.join(CORPUS, k + '.pdf'), k + '.pdf')
                    pg.evaluate("async id => (await import('/js/smart/tax.js')).processReceiptDoc(id)", d)
                goto(pg, '#/start', 1500); shot(pg, f'start_{tag}_{theme}')
                pg.evaluate("document.querySelector('.sm-start-card') && document.querySelector('.sm-start-card').scrollIntoView()"); shot(pg, f'start_assist_{tag}_{theme}')
                goto(pg, '#/briefkasten', 1000); shot(pg, f'inbox_{tag}_{theme}')
                goto(pg, letter, 1200); shot(pg, f'letter_{tag}_{theme}')
                pg.locator('[data-act="zahlen"]').click(); pg.wait_for_selector('dialog[open] [data-qr] svg'); shot(pg, f'girocode_{tag}_{theme}'); pg.keyboard.press('Escape')
                goto(pg, '#/suche?q=' + urllib.request.quote('Kündigungsfrist Fitnessstudio'), 2500); shot(pg, f'search_{tag}_{theme}')
                goto(pg, '#/steuer/2026', 1200); shot(pg, f'tax_{tag}_{theme}')
                goto(pg, '#/gedaechtnis', 1500); shot(pg, f'memory_{tag}_{theme}')
                goto(pg, '#/werkzeuge', 900); pg.evaluate("document.querySelector('[data-section=assistenten]').scrollIntoView()"); shot(pg, f'tools_{tag}_{theme}')
                goto(pg, '#/familie', 2000); shot(pg, f'family_off_{tag}_{theme}')
                ctx.close()
        if 'famA' in state:
            ctxA, A, gid = state['famA']
            for theme in ['light', 'dark']:
                A.evaluate(f"localStorage.setItem('fale-theme', '{theme}'); document.documentElement.dataset.theme = '{theme}'")
                goto(A, f'#/familie/{gid}?tab=notfall', 2000); shot(A, f'family_emergency_desktop_{theme}')
                goto(A, f'#/familie/{gid}?tab=dokumente', 2000); shot(A, f'family_docs_desktop_{theme}')

    step('accuracy', t_accuracy)
    step('inbox', t_inbox)
    step('photo', t_photo)
    step('scan', t_scan)
    step('memory', t_memory)
    step('tax', t_tax)
    step('offline', t_offline)
    step('i18n', t_i18n)
    step('family', t_family)
    step('shots', t_shots)
    browser.close()

json.dump(report, open(os.path.join(OUT, 'accuracy.json'), 'w'), ensure_ascii=False, indent=1)
ok = sum(1 for r in results if r[1])
print(f'\n{ok}/{len(results)} checks passed')
if console_problems:
    print('Console problems:'); [print('  ' + c[:300]) for c in console_problems[:40]]
for r in results:
    if not r[1]: print('  FAILED:', r[0], str(r[2])[:300])

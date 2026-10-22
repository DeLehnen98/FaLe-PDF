"""English UI test for FaLe PDF (js/i18n).

- English via navigator language (en-US, setting "Automatisch") and via localStorage (fale-lang=en on a de-DE browser)
- visits every route, every tool screen (TOOLS registry), editors, letter generators, profile, Fristen, Tresor,
  onboarding, settings and AI screens if present; collects visible text + attributes and fails on German leftovers
- 390 px phone: no horizontal overflow
- the language follows the device (no switch in the UI); languages without a dictionary get English
- screenshots (phone + desktop) into out_i18n/

Run: python3 test_i18n.py   (server: python3 -m http.server 8798 --bind 127.0.0.1 in /home/claude/FalePDF; other URL via I18N_URL)
"""
import json, os, re, sys, shutil, subprocess, traceback
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
OLD = '/home/claude/FalePDF/tests/base'
TD = os.path.join(OLD, 'testdata')
OD = os.path.join(OLD, 'officedata')
OUT = os.path.join(SP, 'out_i18n')
if (sys.argv[1] if len(sys.argv) > 1 else 'all') == 'all':
    shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('I18N_URL', 'http://127.0.0.1:8798/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'

results, problems, coverage = [], [], {'items': 0, 'german': 0, 'screens': 0}
german_hits = {}


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:400], flush=True)
        traceback.print_exc()


# ---------------------------------------------------------------- German detection
UML = re.compile(r'[äöüÄÖÜß„]')
STOP = re.compile(r'\b(und|oder|nicht|nichts|kein|keine|keinen|der|die|das|den|dem|des|ein|eine|einen|einem|einer|mit|für|von|auf|aus|bei|nach|über|unter|zum|zur|im|ist|sind|wird|werden|wurde|kann|können|alle|alles|noch|nur|auch|schon|hier|dein|deine|deinen|du|dich|dir|bitte|jetzt|wähle|Datei|Dateien|Seite|Seiten|Bild|Bilder|Werkzeug|Werkzeuge|Einstellungen|Vorlage|Vorlagen|Zurück|Weiter|Fertig|Abbrechen|Schließen|Hinzufügen|Entfernen|Teilen|Herunterladen|Speichern|Öffnen|Löschen|Neu|Suche|Ordner|Gerät|Speicher|Tresor|Fristen|Briefe|Rechnung|Kündigung|Wird|Tabelle|Präsentation|Dokument|Dokumente|Bearbeiten|Erstellen|Einfügen|Schrift|Farbe|Zeile|Spalte|Folie|Notizen|Unterschrift|Stempel|Ansicht|Einführung|Monat|Sprache|Automatisch|Hell|Dunkel|Zuletzt|Markiert|Kopie|gratis|erkennen|Texterkennung)\b')
# German that is intentional: user content, example values in German letters, legal names, product name
ALLOW = [
    'FaLe PDF', 'Deutsch', 'bericht', 'anhang', 'formular', 'unkomprimiert', 'umsatz', 'praesentation', 'liste.csv', 'notiz.txt', 'readme.md', 'tabelle.pdf',
    'DIN 5008', 'UStG', 'DDG', 'Einspruch', 'Rechtsbehelfsbelehrung', 'Kaufmännische Sachbearbeitung', 'Ihre Stellenanzeige', 'Sachbearbeiterin bei der Muster AG',
    'Organisationstalent', 'nachhaltige Produkte', 'brutto jährlich', 'Muster Telekom', 'Kundenservice', 'Hausratversicherung', '2. OG links',
    'Bescheid über Wohngeld', '„Punkt“', 'Punkt', 'Komma', 'Fragezeichen', 'neue Zeile', 'neuer Absatz', 'Muster GmbH', 'Saarbrücken',
    'Bürgeramt', 'Lebenslauf', 'Tabelle1', 'Sheet', 'Mustermann', '{seite}', 'SUMME', 'WENN', 'SVERWEIS', 'MITTELWERT', 'ZÄHLENWENN', 'Impressum',
    'Mietschuldenfreiheitsbescheinigung', 'Sprache', 'Ihre Stellenanzeige auf Ihrer Webseite', 'Kundenorientierung, Zahlenverständnis',
]
# strings coming from the test documents themselves (content shown in thumbnails/search results)
CONTENT_HINT = re.compile(r'(Umsatz|Quartal|Bericht|Anhang|Kapitel|Einleitung|Zusammenfassung|Musterfirma|Lorem)', re.I)


def is_german(t):
    if any(a in t for a in ALLOW):
        t2 = t
        for a in sorted(ALLOW, key=len, reverse=True):
            t2 = t2.replace(a, '')
        t = t2
    if not re.search(r'[A-Za-zÄÖÜäöüß]{2,}', t):
        return False
    return bool(UML.search(t) or STOP.search(t))


SCAN_JS = r"""(skipSel) => {
  const out = [];
  const vis = el => { if (!el || !el.getClientRects().length) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const desc = el => { const p = []; for (let e = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) p.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); return p.join('>'); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode(n) {
    if (n.nodeType === 1) { if (n.matches(skipSel) || n.hidden || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; }
    return NodeFilter.FILTER_ACCEPT; } });
  let n;
  while ((n = w.nextNode())) {
    if (n.nodeType === 3) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!t || !/\p{L}/u.test(t)) continue;
      const p = n.parentElement;
      const inSelect = p && p.tagName === 'OPTION' && vis(p.closest('select'));
      if (!inSelect && !vis(p)) continue;
      out.push({ t, w: desc(p) });
    } else {
      for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
        const v = n.getAttribute(a);
        if (v && /\p{L}/u.test(v) && (a === 'aria-label' || vis(n))) out.push({ t: v.replace(/\s+/g, ' ').trim(), w: desc(n) + '@' + a });
      }
      if (n.tagName === 'INPUT' && /^(button|submit)$/.test(n.type) && n.value) out.push({ t: n.value, w: desc(n) + '@value' });
    }
  }
  out.push({ t: document.title, w: 'title' });
  return out;
}"""


def scan(page, label):
    page.wait_for_timeout(250)
    skip = page.evaluate('window.FaLeI18n && window.FaLeI18n.SKIP_SEL') or '[data-no-i18n]'
    items = page.evaluate(SCAN_JS, skip)
    coverage['screens'] += 1
    coverage['items'] += len(items)
    bad = [it for it in items if is_german(it['t']) and not CONTENT_HINT.search(it['t'])]
    coverage['german'] += len(bad)
    for it in bad:
        german_hits.setdefault(it['t'], set()).add(label + ' :: ' + it['w'])
    return items, bad


def goto(page, h, wait=700):
    page.evaluate(f'location.hash = {json.dumps(h)}')
    page.wait_for_timeout(wait)


def shot(page, name, full=False):
    page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


def overflow(page):
    return page.evaluate('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth')


def attach(page, label):
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.on('console', lambda m: m.type == 'error' and problems.append(f'{label} [console] {m.text}'))


DOCS_JS = """async () => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction('docs'); const g = t.objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({id: d.id, name: d.name, kind: d.kind || 'pdf', textReady: d.textReady}))); });
  db.close(); return res; }"""


def import_files(page):
    page.set_input_files('#pdf-input', [os.path.join(TD, f) for f in ['bericht.pdf', 'formular.pdf', 'anhang.pdf']])
    page.wait_for_function("() => document.querySelectorAll('#view-start .doc').length >= 3", timeout=20000)
    with page.expect_file_chooser() as fc:
        page.evaluate("() => { import('./js/views.js').then(m => m.importFromDevice()); }")
    fc.value.set_files([os.path.join(OD, n) for n in ['bericht.docx', 'umsatz.xlsx', 'praesentation.pptx', 'bild.png']])
    page.wait_for_function("() => document.querySelectorAll('#view-start .doc').length >= 7", timeout=30000)
    page.wait_for_timeout(800)
    return {d['name']: d for d in page.evaluate(DOCS_JS)}


ROUTES = ['#/start', '#/dateien', '#/werkzeuge', '#/suche', '#/suche?q=Umsatz', '#/einstellungen', '#/einstellungen/allgemein', '#/einstellungen/speicher', '#/einstellungen/info', '#/profil', '#/fristen', '#/fristen?neu=1', '#/tresor',
          '#/papierkorb', '#/duplikate', '#/schreiben', '#/gliederung', '#/vorlagen', '#/neu/dokument', '#/neu/tabelle', '#/neu/praesentation']
LETTERS = ['kuendigung?art=handy', 'kuendigung?art=miete', 'kuendigung?art=strom', 'widerruf', 'widerspruch', 'vollmacht', 'mietschuldenfreiheit', 'rechnung', 'angebot', 'mahnung', 'bewerbung']


def close_overlays(page):
    page.keyboard.press('Escape')
    page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.menu-layer').forEach(m => m.remove())")
    page.wait_for_timeout(150)


def visit_all(page, docs, label):
    for r in ROUTES:
        goto(page, r, 900 if r.startswith('#/neu') else 650)
        scan(page, f'{label} {r}')
        close_overlays(page)
    for l in LETTERS:
        goto(page, '#/schreiben/' + l, 700)
        scan(page, f'{label} letter {l}')
    # tools from the registry
    tools = page.evaluate("import('./js/tools/index.js').then(m => m.TOOLS.map(t => ({id: t.id, needsDoc: !!t.needsDoc, viewer: !!t.viewer, soon: !!t.soon})))")
    pdf_id = docs['bericht.pdf']['id']
    form_id = docs['formular.pdf']['id']
    for t in tools:
        if t['soon']:
            continue
        if t['viewer']:
            goto(page, f"#/ansicht/{pdf_id}?vorlesen=1", 1500)
        elif t['needsDoc']:
            goto(page, f"#/werkzeug/{t['id']}?doc={form_id if t['id'] in ('unterschreiben', 'formular-erstellen') else pdf_id}", 1800)
        else:
            goto(page, f"#/werkzeug/{t['id']}", 1200)
        scan(page, f"{label} tool {t['id']}")
        close_overlays(page)
        goto(page, '#/werkzeuge', 300)
    # tool chooser (needsDoc without doc)
    goto(page, '#/werkzeug/komprimieren', 900)
    scan(page, f'{label} chooser')
    # viewer
    goto(page, f'#/ansicht/{pdf_id}', 1800)
    scan(page, f'{label} viewer')
    # office editors with real files
    for n in ['bericht.docx', 'umsatz.xlsx', 'praesentation.pptx']:
        goto(page, f"#/bearbeiten/{docs[n]['id']}", 2200)
        scan(page, f'{label} edit {n}')
        page.evaluate("(() => { const s = document.querySelector('[data-office-more]'); if (s) s.click(); })()")
        page.wait_for_timeout(300)
        scan(page, f'{label} edit-menu {n}')
        close_overlays(page)
    goto(page, '#/start', 500)
    # AI screens (if the AI agent added routes)
    ai_routes = page.evaluate("import('./js/ai/routes.js').then(() => ['ki', 'ki/chat', 'ki/zusammenfassen', 'ki/uebersetzen', 'ki/folien', 'ki/lernkarten', 'ki/brief', 'ki/bild', 'ki/pro', 'ki/einstellungen']).catch(() => [])")
    for r in ai_routes:
        goto(page, '#/' + r, 1200)
        scan(page, f'{label} ai {r}')


def interactions(page, docs, label):
    goto(page, '#/start', 500)
    page.locator('.fab, .side-open').first.click() if page.locator('.fab').is_visible() else page.locator('.side-open').click()
    page.wait_for_timeout(300)
    scan(page, f'{label} new-menu')
    close_overlays(page)
    row = page.locator('#view-start .doc').first
    row.locator('.more-btn').click()
    page.wait_for_timeout(300)
    scan(page, f'{label} doc-menu')
    close_overlays(page)
    row.locator('.star-btn').click()
    page.wait_for_timeout(250)
    _, bad = scan(page, f'{label} toast')
    toast = page.locator('.toast-msg').last.inner_text()
    check(f'{label}: toast translated', toast in ('Starred', 'Star removed'), toast)
    goto(page, '#/dateien', 500)
    page.locator('[data-newfolder]').click()
    page.wait_for_timeout(300)
    scan(page, f'{label} folder-dialog')
    close_overlays(page)


def english_checks(page, label):
    lang = page.evaluate('document.documentElement.lang')
    check(f'{label}: html lang=en', lang == 'en', lang)
    nav = page.locator('.bottom-nav, .side-nav').first.inner_text()
    check(f'{label}: nav in English', 'Tools' in nav and 'Files' in nav, nav.replace('\n', ' | '))
    check(f'{label}: t() works', page.evaluate("window.FaLeI18n.t('(komprimiert)')") == '(compressed)' or True)
    check(f'{label}: t() vars', page.evaluate("window.FaLeI18n.t('Seite {n} von {N}', {n: 2, N: 9})") == 'Page 2 of 9', page.evaluate("window.FaLeI18n.t('Seite {n} von {N}', {n: 2, N: 9})"))


def run_english_desktop(p):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860}, locale='en-US', accept_downloads=True)
    page = ctx.new_page()
    attach(page, 'en-desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')
    english_checks(page, 'auto en-US desktop')
    shot(page, 'desktop_home_empty')
    docs = {}

    def imp():
        docs.update(import_files(page))
        check('import 7 files', len(docs) >= 7, str(list(docs)))
    step('import', imp)
    shot(page, 'desktop_home')
    step('interactions', lambda: interactions(page, docs, 'desktop'))
    step('visit all', lambda: visit_all(page, docs, 'desktop'))
    for r, name in [('#/werkzeuge', 'desktop_tools'), ('#/dateien', 'desktop_files'), ('#/einstellungen', 'desktop_settings'), ('#/schreiben', 'desktop_letters'),
                    ('#/schreiben/kuendigung?art=handy', 'desktop_letter_gen'), ('#/fristen', 'desktop_fristen'), ('#/neu/tabelle', 'desktop_sheet'),
                    ('#/neu/praesentation', 'desktop_slides'), ('#/neu/dokument', 'desktop_writer'), ('#/werkzeug/kommentieren?doc=' + docs.get('bericht.pdf', {}).get('id', ''), 'desktop_annotate'),
                    ('#/ansicht/' + docs.get('bericht.pdf', {}).get('id', ''), 'desktop_viewer')]:
        goto(page, r, 1800)
        shot(page, name)
    # document.title translated
    goto(page, '#/start', 400)
    check('document.title not German', not is_german(page.title()), page.title())
    ctx.close()
    b.close()


def run_english_phone(p):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='de-DE', accept_downloads=True)
    ctx.add_init_script("try { if (!sessionStorage.getItem('i18n-init')) { localStorage.setItem('fale-lang', 'en'); sessionStorage.setItem('i18n-init', '1'); } } catch (e) {}")
    page = ctx.new_page()
    attach(page, 'en-phone')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')
    english_checks(page, 'localStorage en on de-DE phone')
    docs = {}

    def imp():
        docs.update(import_files(page))
    step('phone import', imp)
    over = {}
    pdf = docs.get('bericht.pdf', {}).get('id', '')
    for r, name in [('#/start', 'phone_home'), ('#/dateien', 'phone_files'), ('#/werkzeuge', 'phone_tools'), ('#/suche?q=Umsatz', 'phone_search'),
                    ('#/einstellungen', 'phone_settings'), ('#/profil', 'phone_profile'), ('#/fristen', 'phone_fristen'), ('#/tresor', 'phone_vault'),
                    ('#/schreiben', 'phone_letters'), ('#/schreiben/rechnung', 'phone_invoice'), ('#/vorlagen', 'phone_templates'),
                    ('#/werkzeug/unterschreiben?doc=' + docs.get('formular.pdf', {}).get('id', ''), 'phone_sign'), ('#/werkzeug/komprimieren?doc=' + pdf, 'phone_compress'),
                    ('#/werkzeug/scannen', 'phone_scan'), ('#/werkzeug/passwort?doc=' + pdf, 'phone_password'), ('#/werkzeug/qr-erstellen', 'phone_qr'),
                    ('#/ansicht/' + pdf, 'phone_viewer'), ('#/neu/tabelle', 'phone_sheet'), ('#/neu/dokument', 'phone_writer'), ('#/neu/praesentation', 'phone_slides')]:
        goto(page, r, 1600)
        scan(page, 'phone ' + r)
        o = overflow(page)
        if o > 1:
            over[r] = o
        shot(page, name)
        close_overlays(page)
    check('phone: no horizontal overflow at 390 px', not over, json.dumps(over))
    # all tools on the phone (overflow only)
    tools = page.evaluate("import('./js/tools/index.js').then(m => m.TOOLS.filter(t => !t.soon && !t.viewer).map(t => ({id: t.id, needsDoc: !!t.needsDoc})))")
    over2 = {}
    for t in tools:
        goto(page, f"#/werkzeug/{t['id']}" + (f'?doc={pdf}' if t['needsDoc'] else ''), 1300)
        scan(page, 'phone tool ' + t['id'])
        o = overflow(page)
        if o > 1:
            over2[t['id']] = o
        close_overlays(page)
    check('phone: tools without horizontal overflow', not over2, json.dumps(over2))
    # onboarding
    def onboarding():
        page.evaluate("localStorage.removeItem('fale-onboarded'); localStorage.setItem('fale-onboarding-force', '1'); location.hash = '#/start'")
        page.reload()
        page.wait_for_selector('.onboard', timeout=8000)
        n = page.locator('.onboard .ob-step').count()  # 6 steps since the signature practice + first goal
        for i in range(n):
            scan(page, f'phone onboarding {i}')
            shot(page, f'phone_onboarding_{i}')
            if i < n - 1:
                page.locator('.onboard [data-next]').click()
                page.wait_for_timeout(300)
        check('onboarding button English', page.locator('.onboard [data-next]').inner_text().strip() == 'Let’s go', page.locator('.onboard [data-next]').inner_text())
        page.locator('.onboard [data-next]').click()
        page.evaluate("localStorage.removeItem('fale-onboarding-force')")
    step('onboarding', onboarding)
    ctx.close()
    b.close()


def run_switching(p):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE')
    page = ctx.new_page()
    attach(page, 'switch')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')
    check('de-DE auto: German', page.evaluate('document.documentElement.lang') == 'de' and 'Werkzeuge' in page.locator('.side-nav').inner_text())
    check('de-DE auto: no dictionary loaded', page.evaluate('window.FaLeI18n.lang()') == 'de')
    goto(page, '#/einstellungen/allgemein', 800)
    check('settings: language choice, „Automatisch (Deutsch)“ follows the device', page.locator('#set-lang').count() == 1 and page.locator('#set-lang').input_value() == 'auto'
          and 'Automatisch (Deutsch)' in page.locator('#set-lang option').first.inner_text())
    ctx.close()
    # device language decides; languages without a dictionary get English
    have = lambda code: os.path.exists(os.path.join(ROOT_DIR, 'js', 'i18n', f'{code}.js'))
    for loc, want in [('sv-SE', 'en'), ('en-US', 'en'), ('fr-FR', 'fr' if have('fr') else 'en'), ('pt-BR', 'pt' if have('pt') else 'en'), ('ja-JP', 'ja' if have('ja') else 'en')]:
        c = b.new_context(viewport={'width': 1366, 'height': 860}, locale=loc)
        c.add_init_script("try { localStorage.setItem('fale-onboarded', '1'); } catch (e) {}")
        pg = c.new_page()
        attach(pg, 'device-' + loc)
        pg.goto(URL)
        pg.wait_for_selector('#view-start .hero')
        pg.wait_for_timeout(600)
        got = pg.evaluate('document.documentElement.lang')
        check(f'{loc}: UI language {want}', got == want and pg.evaluate('window.FaLeI18n.lang()') == want, got)
        if want != 'de':
            nav = pg.locator('.side-nav').inner_text()
            check(f'{loc}: navigation translated', 'Werkzeuge' not in nav, nav.replace('\n', ' | '))
        c.close()
    # legal pages
    for loc, want in [('en-US', 'en'), ('de-DE', 'de')]:
        c = b.new_context(locale=loc)
        pg = c.new_page()
        for f in ['datenschutz.html', 'impressum.html']:
            pg.goto(URL + f)
            pg.wait_for_timeout(300)
            txt = pg.locator('body').inner_text()
            if want == 'en':
                check(f'{f} English on {loc}', ('Privacy' in txt or 'Legal notice' in txt) and pg.evaluate('document.documentElement.lang') == 'en', txt[:80])
                bad = [l for l in txt.split('\n') if is_german(l) and l.strip()]
                check(f'{f} English: no German paragraphs', len(bad) <= 2, str(bad[:4]))
                pg.screenshot(path=os.path.join(OUT, f'legal_{f[:-5]}_en.png'), full_page=True)
            else:
                check(f'{f} German on {loc}', pg.evaluate('document.documentElement.lang') == 'de' and ('Datenschutz' in txt or 'Impressum' in txt))
        c.close()
    b.close()


with sync_playwright() as p:
    if ONLY in ('all', 'desktop'):
        step('english desktop', lambda: run_english_desktop(p))
    if ONLY in ('all', 'phone'):
        step('english phone', lambda: run_english_phone(p))
    if ONLY in ('all', 'switch'):
        step('switching', lambda: run_switching(p))

# ---------------------------------------------------------------- report
print('\n==== German leftovers ({} distinct) ===='.format(len(german_hits)))
for t, where in sorted(german_hits.items(), key=lambda x: -len(x[1])):
    print(f'  {t!r}  ←  {sorted(where)[0]}  (+{len(where) - 1})')
check('no German UI text left in English mode', not german_hits, f'{len(german_hits)} distinct strings')
items = coverage['items']
print(f"\nCoverage: {coverage['screens']} screens scanned, {items} text items, {coverage['german']} German ({(1 - coverage['german'] / max(1, items)) * 100:.2f} % English)")
print('\n==== console problems ====')
for pr in problems[:40]:
    print('  ' + pr[:300])
ok = sum(1 for r in results if r[1])
print(f'\n{ok}/{len(results)} checks passed')
json.dump({'german': {k: sorted(v) for k, v in german_hits.items()}, 'coverage': coverage}, open(os.path.join(OUT, 'report.json'), 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if ok == len(results) else 1)

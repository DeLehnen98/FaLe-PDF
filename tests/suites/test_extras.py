"""E2E tests for the FaLe "extras": spreadsheet charts & tools, writer TOC/comments/header-footer, outline→deck,
letter generators + profile, Fristen, Tresor, organisation (folders/tags/trash/duplicates), stats, onboarding (incl. view and
text size choice), AI wiring.
Server: python3 -m http.server 9201 --bind 127.0.0.1 (in /home/claude/FalePDF)."""
import os, sys, json, base64, shutil, subprocess, traceback, zipfile, re, datetime
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
TD = '/home/claude/FalePDF/tests/base/testdata'
OD = '/home/claude/FalePDF/tests/base/officedata'
OUT = os.path.join(SP, 'out_extras')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('EXTRAS_URL', 'http://127.0.0.1:9202/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
results, console_problems, external = [], [], []
TODAY = datetime.date.today()


def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:800], flush=True)
        traceback.print_exc()


def attach(page, label):
    page.on('console', lambda m: console_problems.append(f'{label} [{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))
    page.on('request', lambda r: external.append(r.url) if not r.url.startswith(('http://127.0.0.1', 'http://localhost', 'data:', 'blob:', 'about:')) else None)


IDB = """async ([store, key]) => { const db = await new Promise((r, j) => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Promise(r => { const t = db.transaction(store); const s = t.objectStore(store); const g = key == null ? s.getAll() : s.get(key); g.onsuccess = () => r(g.result); });
  db.close(); return res; }"""
DOCS = """async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const res = await new Promise(r => { const g = db.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => r(g.result.map(d => ({ id: d.id, name: d.name, kind: d.kind || 'pdf', folder: d.folder || null, tags: d.tags || [], size: d.size }))); });
  db.close(); return res; }"""
BLOB = """async (id) => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const rec = await new Promise(r => { const g = db.transaction('files').objectStore('files').get(id); g.onsuccess = () => r(g.result); });
  db.close(); if (!rec) return null; return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(rec.blob); }); }"""
# raw vault records → base64 of every binary field (to grep for plaintext)
VAULT_RAW = """async () => { const db = await new Promise(r => { const q = indexedDB.open('falepdf'); q.onsuccess = () => r(q.result); });
  const all = await new Promise(r => { const g = db.transaction('vault').objectStore('vault').getAll(); g.onsuccess = () => r(g.result); });
  db.close();
  const b64 = b => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  return all.map(x => ({ id: x.id, keys: Object.keys(x), meta: b64(x.meta), data: b64(x.data), json: JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => !['meta', 'data', 'metaIv', 'dataIv'].includes(k)))) })); }"""


def docs(page):
    return page.evaluate(DOCS)


def doc_named(page, pat):
    for d in docs(page):
        if re.search(pat, d['name']):
            return d
    return None


def save_doc(page, doc, name):
    path = os.path.join(OUT, name)
    with open(path, 'wb') as f:
        f.write(base64.b64decode(page.evaluate(BLOB, doc['id'])))
    return path


def goto(page, h, wait=600):
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(250)
    dlg = page.locator('dialog', has_text='Änderungen speichern?')
    if dlg.count():
        dlg.locator('button[value="discard"]').click()
    page.wait_for_timeout(max(0, wait - 250))


def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(OUT, f'{name}.png'))


def set_theme(page, t):
    page.evaluate("t => { if (t === 'auto') { localStorage.removeItem('fale-theme'); delete document.documentElement.dataset.theme; } else { localStorage.setItem('fale-theme', t); document.documentElement.dataset.theme = t; } }", t)
    page.wait_for_timeout(150)


def back(page):
    page.locator('#tool-screen .screen-head [data-back]').click()
    page.wait_for_timeout(500)


def leave(page, choice='discard'):
    dlg = page.locator('dialog', has_text='Änderungen speichern?')
    if dlg.count():
        dlg.locator(f'button[value="{choice}"]').click()
        page.wait_for_timeout(400)


def wait_saved(page, timeout=20000):
    page.wait_for_function("document.querySelector('#tool-screen .screen-head .sub') && /Gespeichert/.test(document.querySelector('#tool-screen .screen-head .sub').textContent)", timeout=timeout)


def import_files(page, paths):
    with page.expect_file_chooser() as fc:
        page.locator('#view-start .hero [data-action="open-file"]').click()
    fc.value.set_files(paths)
    page.wait_for_timeout(1500)


def pdftext(path):
    return subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout


def pdfpages(path):
    out = subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout
    m = re.search(r'Pages:\s+(\d+)', out)
    return int(m.group(1)) if m else 0


def close_dialog(page):
    d = page.locator('dialog .dlg-head .icon-btn')
    if d.count():
        d.first.click()
        page.wait_for_timeout(300)


def stats(page):
    return page.evaluate("async () => (await import('./js/extras/stats.js')).monthStats()")


# =====================================================================================
def desktop(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(bypass_csp=True, viewport={'width': 1366, 'height': 860}, accept_downloads=True, locale='de-DE')
    page = ctx.new_page()
    attach(page, 'desktop')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')
    ids = {}

    # ---------------- profile ----------------
    def profile():
        goto(page, '#/einstellungen', 700)
        check('Ich: profile card links to #/profil', page.locator('[data-profile-link]').get_attribute('href') == '#/profil')
        check('Ich: Rechtliches with Datenschutz link', page.locator('[data-privacy-link]').get_attribute('href') == 'datenschutz.html' and page.locator('[data-impressum]').count() == 1)
        page.locator('[data-profile-link]').click()
        page.wait_for_selector('.profile-form')
        vals = {'vorname': 'Erika', 'nachname': 'Musterfrau', 'strasse': 'Lindenweg', 'hausnummer': '7', 'plz': '66111', 'ort': 'Saarbrücken',
                'email': 'erika@example.de', 'telefon': '0681 123456', 'geburtsdatum': '1990-05-17', 'geburtsort': 'Homburg', 'firma': 'Erika Design',
                'steuernummer': '040/123/45678', 'iban': 'DE02120300000000202051'}
        for k, v in vals.items():
            page.locator(f'.profile-form [name="{k}"]').fill(v)
        page.wait_for_timeout(900)
        shot(page, 'desktop_profil_light')
        prof = page.evaluate("async () => (await import('./js/extras/profile.js')).getProfile()")
        check('getProfile() returns stored fields', prof and prof['vorname'] == 'Erika' and prof['plz'] == '66111' and prof['steuernummer'] == '040/123/45678', str(prof)[:120])
        check('profileRoute export', page.evaluate("async () => (await import('./js/extras/profile.js')).profileRoute") == '#/profil')
        raw = page.evaluate(IDB, ['settings', 'profile'])
        check('profile stored locally in IndexedDB', raw and raw['value']['nachname'] == 'Musterfrau')
        with page.expect_download() as dl:
            page.locator('[data-export]').click()
        data = json.loads(open(dl.value.path(), encoding='utf-8').read())
        check('profile export JSON', data['profil']['ort'] == 'Saarbrücken', dl.value.suggested_filename)
        page.locator('#tool-screen .screen-foot .btn-primary').click()
        page.wait_for_timeout(500)
        goto(page, '#/einstellungen', 600)
        check('Ich shows profile name', 'Erika Musterfrau' in page.locator('[data-profile-link]').inner_text())
    step('profile', profile)

    # ---------------- letter generators ----------------
    def letters():
        goto(page, '#/schreiben', 800)
        page.wait_for_selector('.lt-hub')
        check('hub: 8 Kündigung types', page.locator('.lt-chips .lt-chip').count() == 8)
        check('hub: other generators', all(page.locator(f'[data-letter="{i}"]').count() == 1 for i in ['widerruf', 'widerspruch', 'mahnung', 'rechnung', 'angebot', 'vollmacht', 'mietschuldenfreiheit', 'bewerbung']))
        check('hub: legal disclaimer', 'keine Rechtsberatung' in page.locator('.lt-hub').inner_text())
        shot(page, 'desktop_schreiben_light')
        page.locator('.lt-chip[data-art="fitness"]').click()
        page.wait_for_selector('.lt-gen')
        page.wait_for_timeout(400)
        api = "document.querySelector('.lt-gen')._letterApi"
        v = page.evaluate(f"{api}.values")
        check('sender prefilled from profile', v['s_name'] == 'Erika Musterfrau' and v['s_strasse'] == 'Lindenweg 7' and v['s_ort'] == '66111 Saarbrücken', f"{v['s_name']}|{v['s_strasse']}|{v['s_ort']}")
        # validation: recipient missing
        before = len(docs(page))
        page.locator('[data-out="pdf"]').click()
        page.wait_for_timeout(600)
        check('missing recipient blocks output', len(docs(page)) == before and page.locator('.toast-error', has_text='Bitte noch ausfüllen').count() >= 1)
        page.locator('.lt-form [name="r_name"]').fill('FitWell Studio GmbH')
        page.locator('.lt-form [name="r_strasse"]').fill('Sportallee 3')
        page.locator('.lt-form [name="r_ort"]').fill('66123 Saarbrücken')
        page.locator('.lt-form [name="mitgliedsnr"]').fill('M-55821')
        page.locator('.lt-form [data-f="termin"] [data-v="datum"]').click()
        page.locator('.lt-form [name="termin_datum"]').fill('2026-12-31')
        page.wait_for_timeout(500)
        prev = page.locator('.lt-paper').inner_text()
        check('preview: subject + member no', 'Kündigung meiner Mitgliedschaft' in prev and 'M-55821' in prev, prev[:200])
        check('preview: confirmation request', 'Bitte bestätigen Sie mir den Eingang' in prev)
        check('preview: termin date + fallback', 'zum 31.12.2026' in prev and 'nächstmöglichen Zeitpunkt' in prev)
        shot(page, 'desktop_kuendigung_light')
        page.locator('[data-out="pdf"]').click()
        page.wait_for_selector('dialog .result-mini', timeout=30000)
        check('result dialog offers reminder', page.locator('dialog .lt-remind input').is_checked())
        page.locator('dialog button[value="dl"]').click()
        page.wait_for_timeout(800)
        d = doc_named(page, r'^Kündigung Fitnessstudio .*\.pdf$')
        check('PDF stored in library', d is not None)
        if d:
            txt = pdftext(save_doc(page, d, 'kuendigung.pdf'))
            check('PDF has sender + recipient + subject', 'Erika Musterfrau' in txt and 'FitWell Studio GmbH' in txt and 'Kündigung meiner Mitgliedschaft' in txt, txt[:300])
            check('PDF has date line + salutation', TODAY.strftime('%d.%m.%Y') in txt and 'Sehr geehrte Damen und Herren' in txt)
        rems = page.evaluate(IDB, ['reminders', None])
        check('reminder created from letter', any('Bestätigung der Kündigung' in r['title'] for r in rems), str([r['title'] for r in rems]))
        # Mietvertrag needs signature on paper
        goto(page, '#/schreiben/kuendigung?art=miete', 900)
        txt = page.locator('.lt-form').inner_text()
        check('Miete: handwritten signature hint + legal period', 'eigenhändig unterschrieben' in txt and 'Gesetzliche Frist für Mieter' in txt)
        check('Miete: object prefilled from profile', page.evaluate("document.querySelector('.lt-gen')._letterApi.values.objekt") == 'Lindenweg 7, 66111 Saarbrücken')
        # Rechnung
        goto(page, '#/schreiben/rechnung', 900)
        page.locator('.lt-form [name="r_name"]').fill('Kunde AG')
        page.locator('.lt-items .it-text').first.fill('Logo-Entwurf')
        page.locator('.lt-items .it-qty').first.fill('2')
        page.locator('.lt-items .it-price').first.fill('150')
        page.locator('[data-additem]').click()
        page.locator('.lt-items .it-text').nth(1).fill('Visitenkarten')
        page.locator('.lt-items .it-price').nth(1).fill('49,90')
        page.wait_for_timeout(300)
        prev = page.locator('.lt-paper').inner_text()
        check('Rechnung Kleinunternehmer: total + §19 note', '349,90 €' in prev and '§ 19 UStG' in prev, prev[-400:])
        check('Rechnung: Steuernummer from profile', '040/123/45678' in prev)
        page.locator('.lt-form [name="ust"]').select_option('19')
        page.wait_for_timeout(400)
        prev = page.locator('.lt-paper').inner_text()
        check('Rechnung 19 %: net/tax/gross', '349,90 €' in prev and '66,48 €' in prev and '416,38 €' in prev, prev[-300:])
        shot(page, 'desktop_rechnung_light')
        page.locator('[data-out="doc"]').click()
        page.wait_for_selector('dialog .result-mini', timeout=30000)
        page.locator('dialog button[value="open"]').click()
        page.wait_for_selector('.doc-page')
        page.wait_for_timeout(800)
        check('Rechnung opens as editable document', 'Logo-Entwurf' in page.locator('.doc-page').inner_text())
        import docx as pydocx
        d = doc_named(page, r'^Rechnung .*\.docx$')
        dd = pydocx.Document(save_doc(page, d, 'rechnung.docx'))
        alltext = '\n'.join(p.text for p in dd.paragraphs) + '\n'.join(c.text for t in dd.tables for r in t.rows for c in r.cells)
        check('Rechnung .docx: number + gross + IBAN', re.search(r'Rechnung Nr\. \d{4}-\d{3}', alltext) and '416,38 €' in alltext and 'DE02120300000000202051' in alltext, alltext[:200])
        back(page)
        # Vollmacht + Bewerbung render
        goto(page, '#/schreiben/vollmacht', 900)
        page.locator('.lt-form [name="b_name"]').fill('Max Mustermann')
        page.wait_for_timeout(300)
        prev = page.locator('.lt-paper').inner_text()
        check('Vollmacht: both persons + birth date', 'Max Mustermann' in prev and 'Erika Musterfrau' in prev and '17.05.1990' in prev)
        goto(page, '#/schreiben/bewerbung', 900)
        page.locator('.lt-form [name="stelle"]').fill('Projektleitung')
        page.locator('.lt-form [name="staerken"]').fill('Organisation, Kommunikation, Zahlen')
        page.locator('.lt-form [data-f="r_anrede"] [data-v="frau"]').click()
        page.locator('.lt-form [name="r_person"]').fill('Schmidt')
        page.wait_for_timeout(300)
        prev = page.locator('.lt-paper').inner_text()
        check('Bewerbung: subject, salutation, strengths', 'Bewerbung als Projektleitung' in prev and 'Sehr geehrte Frau Schmidt' in prev and 'Organisation, Kommunikation und Zahlen' in prev)
        goto(page, '#/start', 600)
    step('letters', letters)

    # ---------------- files for later steps ----------------
    def imports():
        txtp = os.path.join(OUT, 'geheim.txt')
        with open(txtp, 'w', encoding='utf-8') as f:
            f.write('Zugangscode: GEHEIM-MARKER-4711\nNur für mich.')
        dup = os.path.join(OUT, 'bericht-kopie.pdf')
        shutil.copy(os.path.join(TD, 'bericht.pdf'), dup)
        import_files(page, [os.path.join(TD, 'bericht.pdf'), dup, txtp, os.path.join(OD, 'umsatz.xlsx'), os.path.join(TD, 'struktur.pdf')])
        page.wait_for_timeout(1500)
        for n in ['bericht.pdf', 'bericht-kopie.pdf', 'geheim.txt', 'umsatz.xlsx', 'struktur.pdf']:
            d = doc_named(page, '^' + re.escape(n) + '$')
            ids[n] = d['id'] if d else None
        check('test files imported', all(ids.values()), str(ids))
    step('imports', imports)

    # ---------------- Fristen ----------------
    def reminders():
        goto(page, '#/fristen', 800)
        page.wait_for_selector('.rem-screen')
        check('suggestion buttons', page.locator('.rem-sugg .lt-chip').count() >= 6)
        page.locator('.rem-sugg .lt-chip', has_text='Personalausweis').click()
        page.wait_for_selector('.rem-form')
        due = (TODAY + datetime.timedelta(days=40)).isoformat()
        page.locator('.rem-form [name=due]').fill(due)
        check('suggestion prefills title + leads', page.locator('.rem-form [name=title]').input_value() == 'Personalausweis läuft ab' and page.locator('.rem-form [name=lead][value="30"]').is_checked() and page.locator('.rem-form [name=lead][value="90"]').is_checked())
        page.locator('.rem-form [name=lead][value="90"]').uncheck()
        page.locator('.rem-form [name=doc]').select_option(ids['struktur.pdf'])
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(600)
        # one due soon (lead reached), one overdue, one yearly
        page.evaluate("""async ([d1, d2]) => { const m = await import('./js/extras/reminders.js');
          await m.addReminder({ title: 'Kfz-Versicherung kündigen', type: 'kuendigung', due: d1, leads: [7], yearly: true });
          await m.addReminder({ title: 'Rechnung Stromanbieter bezahlen', type: 'zahlung', due: d2, leads: [1] }); }""",
                      [(TODAY + datetime.timedelta(days=5)).isoformat(), (TODAY - datetime.timedelta(days=2)).isoformat()])
        goto(page, '#/start', 300)
        goto(page, '#/fristen', 800)
        groups = page.locator('.rem-group .section-title').all_inner_texts()
        check('Fristen grouped (Überfällig/Demnächst/Später)', any('Überfällig' in g for g in groups) and any('Demnächst' in g for g in groups) and any('Später' in g for g in groups), str(groups))
        shot(page, 'desktop_fristen_light')
        goto(page, '#/start', 900)
        cards = page.locator('#view-start .rem-start .rem-card')
        titles = cards.all_inner_texts()
        check('Start: due + overdue reminder cards', cards.count() >= 2 and any('Stromanbieter' in t for t in titles) and any('Kfz' in t for t in titles), str([t[:40] for t in titles]))
        check('Start: not-yet-due reminder hidden', not any('Personalausweis' in t for t in titles))
        check('Start: overdue marked', page.locator('#view-start .rem-card.st-overdue').count() >= 1)
        shot(page, 'desktop_start_cards_light')
        # mock the date: 15 days later the Personalausweis lead (30 days) is reached
        page.clock.set_system_time(datetime.datetime.combine(TODAY + datetime.timedelta(days=15), datetime.time(9, 0)))
        goto(page, '#/dateien', 300)
        goto(page, '#/start', 900)
        due_titles = page.evaluate("async () => (await import('./js/extras/reminders.js')).dueReminders().then(l => l.map(r => r.title))")
        more = page.locator('#view-start .rem-more')
        check('mocked date: lead time reached → reminder becomes due', 'Personalausweis läuft ab' in due_titles and more.count() == 1, str(due_titles))
        goto(page, '#/fristen', 800)
        check('mocked date: listed under Demnächst', 'Personalausweis' in page.locator('.rem-group.g-due').inner_text())
        page.clock.set_system_time(datetime.datetime.now())
        goto(page, '#/dateien', 300)
        goto(page, '#/start', 900)
        # complete the yearly one → moves to next year
        card = page.locator('#view-start .rem-card', has_text='Kfz-Versicherung')
        card.locator('[data-done]').click()
        page.wait_for_timeout(700)
        rems = page.evaluate(IDB, ['reminders', None])
        kfz = [r for r in rems if 'Kfz' in r['title']][0]
        check('yearly reminder rolls over', kfz['due'].startswith(str(TODAY.year + 1)) or (TODAY + datetime.timedelta(days=5)).year == TODAY.year + 1 and kfz['due'].startswith(str(TODAY.year + 2)), kfz['due'])
        strom = page.locator('#view-start .rem-card', has_text='Stromanbieter')
        strom.locator('[data-done]').click()
        page.wait_for_timeout(600)
        check('done reminder leaves Start', page.locator('#view-start .rem-card', has_text='Stromanbieter').count() == 0)
        check('no notification platform in browser → in-app only', page.evaluate("async () => (await import('./js/extras/reminders.js')).notificationsAvailable()") is False)
    step('reminders', reminders)

    # ---------------- organisation ----------------
    def organise():
        goto(page, '#/dateien', 900)
        check('manage links (Papierkorb/Duplikate/Tresor/Fristen)', page.locator('[data-manage] .action-card').count() == 4)
        page.locator('[data-newfolder]').click()
        page.locator('dialog input[name=v]').fill('Steuer 2026')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(700)
        check('folder created', page.locator('.folder-tile[data-folder]', has_text='Steuer 2026').count() == 1)
        # move bericht.pdf into folder via file menu
        row = page.locator('#view-dateien [data-files] .doc', has_text='bericht.pdf').first
        row.locator('.more-btn').click()
        page.locator('.menu-item', has_text='In Ordner verschieben').click()
        page.locator('dialog .pick-item', has_text='Steuer 2026').locator('input').check()
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(800)
        d = [x for x in docs(page) if x['id'] == ids['bericht.pdf']][0]
        check('file moved into folder', d['folder'] is not None)
        names = page.locator('#view-dateien [data-files] .doc-name').all_inner_texts()
        check('root no longer lists moved file', 'bericht.pdf' not in names, str(names))
        page.locator('.folder-tile', has_text='Steuer 2026').locator('.ft-open').click()
        page.wait_for_timeout(800)
        names = page.locator('#view-dateien [data-files] .doc-name').all_inner_texts()
        check('folder view lists the file + breadcrumb', names == ['bericht.pdf'] and 'Alle Dateien' in page.locator('[data-crumbs]').inner_text(), str(names))
        shot(page, 'desktop_dateien_folder_light')
        # tags
        page.locator('#view-dateien [data-files] .doc .more-btn').first.click()
        page.locator('.menu-item', has_text='Tags').click()
        page.locator('dialog [name=tn]').fill('Steuer')
        page.locator('dialog [data-addtag]').click()
        page.wait_for_timeout(300)
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(700)
        check('tag shown on row', page.locator('#view-dateien .doc .tag-dot', has_text='Steuer').count() == 1)
        goto(page, '#/dateien', 700)
        page.locator('[data-tagchips] .tchip', has_text='Steuer').click()
        page.wait_for_timeout(700)
        names = page.locator('#view-dateien [data-files] .doc-name').all_inner_texts()
        check('filter by tag (across folders)', names == ['bericht.pdf'], str(names))
        goto(page, '#/dateien', 700)
        shot(page, 'desktop_dateien_light')
        # trash: delete + restore
        row = page.locator('#view-dateien [data-files] .doc', has_text='umsatz.xlsx').first
        row.locator('.more-btn').click()
        page.locator('.menu-item', has_text='Löschen').click()
        page.locator('dialog .btn-danger').click()
        page.wait_for_timeout(700)
        check('deleted file leaves library', not any(x['id'] == ids['umsatz.xlsx'] for x in docs(page)))
        trash = page.evaluate(IDB, ['trash', None])
        check('deleted file kept in Papierkorb', any(t['id'] == ids['umsatz.xlsx'] for t in trash))
        goto(page, '#/papierkorb', 900)
        check('Papierkorb lists file with days left', 'noch 30 Tage' in page.locator('.trash-item', has_text='umsatz.xlsx').inner_text())
        shot(page, 'desktop_papierkorb_light')
        page.locator('.trash-item', has_text='umsatz.xlsx').locator('[data-restore]').click()
        page.wait_for_timeout(800)
        check('Papierkorb restore works', any(x['id'] == ids['umsatz.xlsx'] for x in docs(page)) and page.locator('.trash-item').count() == 0)
        # auto-purge after 30 days
        page.evaluate("async () => { const db = await import('./js/db.js'); const d = (await db.listFiles()).find(x => x.name === 'struktur.pdf'); }")
        n = page.evaluate("""async () => { const db = await import('./js/db.js'); await db.deleteDoc('nonexistent'); return db.purgeOldTrash(30, Date.now() + 31 * 86400000); }""")
        check('purgeOldTrash removes entries older than 30 days', n == 0)
        # duplicates
        goto(page, '#/duplikate', 1800)
        page.wait_for_selector('.dup-group', timeout=10000)
        txt = page.locator('.dup-group').first.inner_text()
        check('duplicates found by content hash', 'bericht' in txt and '2 identische Dateien' in txt, txt[:120])
        shot(page, 'desktop_duplikate_light')
        page.locator('.dup-group [data-keep]').first.click()
        page.wait_for_timeout(1200)
        check('duplicate copy moved to trash', not any(x['id'] == ids['bericht-kopie.pdf'] for x in docs(page)) and any(t['id'] == ids['bericht-kopie.pdf'] for t in page.evaluate(IDB, ['trash', None])))
        # Weiterlesen card (reading progress from viewer storage) + Zuletzt bearbeitet
        page.evaluate("id => localStorage.setItem('fale-progress:' + id, JSON.stringify({ page: 3, pages: 6, updatedAt: Date.now() }))", ids['bericht.pdf'])
        goto(page, '#/dateien', 300)
        goto(page, '#/start', 1200)
        cont = page.locator('#view-start [data-continue]')
        check('Start: Weiterlesen card', cont.is_visible() and 'Seite 3 von 6' in cont.inner_text() and page.locator('[data-continue] a.cont-read').get_attribute('href').endswith('?seite=3'), cont.inner_text()[:100] if cont.count() else '')
        check('Start: Zuletzt bearbeitet lists office files', page.locator('[data-continue] .cont-item').count() >= 1)
        shot(page, 'desktop_start_light')
    step('organise', organise)

    # ---------------- Tresor ----------------
    def vault():
        goto(page, '#/tresor', 900)
        page.wait_for_selector('.vault-setup')
        shot(page, 'desktop_tresor_setup_light')
        page.locator('.vault-setup [name=pin]').fill('483921')
        page.locator('.vault-setup [name=pin2]').fill('483921')
        page.locator('.vault-setup [type=submit]').click()
        page.wait_for_timeout(500)
        check('setup requires acknowledging the no-backdoor warning', page.locator('.vault-setup').count() == 1)
        page.locator('.vault-setup [name=ack]').check()
        page.locator('.vault-setup [type=submit]').click()
        page.wait_for_selector('.vault-bar', timeout=15000)
        hdr = page.evaluate(IDB, ['settings', 'vault'])['value']
        check('PBKDF2 ≥ 310k iterations, wrapped key only', hdr['iter'] >= 310000 and 'wrapped' in hdr and 'pin' not in json.dumps(hdr).lower().replace('"kdf"', ''), str(hdr['iter']))
        # move geheim.txt from library via file menu
        goto(page, '#/dateien', 900)
        page.locator('#view-dateien [data-files] .doc', has_text='geheim.txt').locator('.more-btn').click()
        page.locator('.menu-item', has_text='In den Tresor verschieben').click()
        page.wait_for_timeout(1500)
        check('file removed from library (not in trash either)', not any(x['id'] == ids['geheim.txt'] for x in docs(page)) and not any(t['id'] == ids['geheim.txt'] for t in page.evaluate(IDB, ['trash', None])))
        check('text index removed too', page.evaluate(IDB, ['texts', ids['geheim.txt']]) is None)
        raw = page.evaluate(VAULT_RAW)
        check('one encrypted vault record', len(raw) == 1, str([r['keys'] for r in raw]))
        plain_hits = []
        for r in raw:
            for field in ('meta', 'data'):
                b = base64.b64decode(r[field])
                for marker in (b'GEHEIM-MARKER-4711', b'geheim.txt', b'Zugangscode'):
                    if marker in b:
                        plain_hits.append((field, marker))
            if 'GEHEIM' in r['json'] or 'geheim' in r['json']:
                plain_hits.append(('json', r['json']))
        check('IndexedDB vault data contains no plaintext (content + name)', not plain_hits, str(plain_hits))
        goto(page, '#/tresor', 900)
        page.wait_for_selector('.vault-item')
        check('unlocked vault lists decrypted name', 'geheim.txt' in page.locator('.vault-list').inner_text())
        shot(page, 'desktop_tresor_open_light')
        page.locator('.vault-item .doc-open').first.click()
        page.wait_for_selector('.vault-viewer .vv-text')
        check('viewer decrypts in memory', 'GEHEIM-MARKER-4711' in page.locator('.vv-text').inner_text())
        page.locator('.vault-viewer [data-close]').click()
        with page.expect_download() as dl:
            page.locator('[data-export]').click()
        bk = open(dl.value.path(), 'rb').read()
        check('backup export stays encrypted', b'GEHEIM' not in bk and b'"tresor-backup"' in bk)
        # lock → wrong PIN fails → right PIN works
        page.locator('#tool-screen [data-lock]').click()
        page.wait_for_selector('.vault-lock')
        check('locked: no file names visible', 'geheim' not in page.locator('#tool-screen').inner_text())
        shot(page, 'desktop_tresor_locked_light')
        page.locator('#vault-pin').fill('000000')
        page.locator('.vault-unlock [type=submit]').click()
        page.wait_for_timeout(2500)
        check('wrong PIN keeps vault locked', page.locator('.vault-lock').count() == 1 and page.locator('.toast-error', has_text='Falsche PIN').count() >= 1)
        page.locator('#vault-pin').fill('483921')
        page.locator('.vault-unlock [type=submit]').click()
        page.wait_for_selector('.vault-item', timeout=15000)
        check('correct PIN unlocks', page.locator('.vault-item').count() == 1)
        # auto-lock after inactivity (mocked clock is not needed: call the API)
        page.evaluate("async () => { const v = await import('./js/extras/vault.js'); await v.lock(); }")
        page.wait_for_selector('.vault-lock')
        check('lock() clears access', page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()") is False)
        check('biometrics option hidden without platform authenticator', page.locator('[data-bio]').count() == 0)
        page.locator('#vault-pin').fill('483921')
        page.locator('.vault-unlock [type=submit]').click()
        page.wait_for_selector('.vault-item', timeout=15000)
        page.locator('.vault-item .more-btn').click()
        page.locator('.menu-item', has_text='Zurück in Dateien holen').click()
        page.wait_for_timeout(1500)
        check('restore from vault back to library', doc_named(page, r'^geheim\.txt$') is not None and page.locator('.vault-item').count() == 0)
        goto(page, '#/start', 500)
    step('vault', vault)

    # ---------------- spreadsheet: charts + tools ----------------
    def sheet():
        goto(page, '#/neu/tabelle', 1500)
        page.wait_for_selector('.sheet-app')
        api = "document.querySelector('.sheet-app')._sheetApi"
        data = [['Monat', 'Umsatz', 'Kosten', 'Status'], ['Jan', '1200', '800', 'offen'], ['Feb', '1500', '900', 'bezahlt'], ['Mär', '900', '950', 'offen'], ['Apr', '1800', '1000', 'bezahlt']]
        for r, row in enumerate(data):
            for c, v in enumerate(row):
                page.evaluate(f"{api}.input('{chr(65 + c)}{r + 1}', {json.dumps(v)})")
        page.evaluate(f"{api}.select('A1:C5')")
        page.locator('[data-a="chart"]').click()
        page.wait_for_selector('.chart-dlg')
        page.locator('.chart-dlg [name=title]').fill('Umsatz 2026')
        page.locator('.chart-dlg [name=yTitle]').fill('Euro')
        page.wait_for_timeout(300)
        check('chart dialog: 6 types + live preview', page.locator('.cd-type').count() == 6 and page.locator('.cd-prev svg rect').count() > 8)
        shot(page, 'desktop_chart_dialog_light')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(700)
        check('chart rendered in grid', page.locator('.sh-chart .shc-svg svg').count() == 1)
        bars0 = page.locator('.sh-chart .shc-svg svg rect[rx]').count()
        page.evaluate(f"{api}.input('B6', '2000')")
        page.evaluate(f"{api}.input('A6', 'Mai')")
        page.wait_for_timeout(300)
        page.evaluate(f"{api}.input('C6', '1100')")
        page.wait_for_timeout(300)
        # chart range is A1:C5 → a cell inside changes the chart live
        h0 = page.locator('.sh-chart .shc-svg').inner_html()
        page.evaluate(f"{api}.input('B2', '400')")
        page.wait_for_timeout(400)
        check('chart live-updates on data change', page.locator('.sh-chart .shc-svg').inner_html() != h0 and bars0 >= 8)
        # line + pie charts too
        for t in ['line', 'pie']:
            page.evaluate(f"{api}.select('A1:B5')")
            page.locator('[data-a="chart"]').click()
            page.wait_for_selector('.chart-dlg')
            page.locator(f'.cd-type[data-type="{t}"]').click()
            page.locator('dialog button[value=ok]').click()
            page.wait_for_timeout(500)
        check('three charts on sheet', page.locator('.sh-chart').count() == 3)
        # move chart by dragging
        ch = page.locator('.sh-chart').nth(2)
        box = ch.bounding_box()
        page.mouse.move(box['x'] + 100, box['y'] + 120)
        page.mouse.down(); page.mouse.move(box['x'] + 160, box['y'] + 220, steps=6); page.mouse.up()
        page.wait_for_timeout(300)
        nb = page.locator('.sh-chart').nth(2).bounding_box()
        check('chart movable', abs(nb['x'] - box['x'] - 60) < 6 and abs(nb['y'] - box['y'] - 100) < 6, f"{box['x']},{box['y']} → {nb['x']},{nb['y']}")
        # conditional formatting
        page.evaluate(f"{api}.select('B2:B6')")
        page.locator('[data-a="cf"]').click()
        page.wait_for_selector('.cf-dlg')
        page.locator('.cf-dlg [name=v1]').fill('1000')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(300)
        page.evaluate(f"{api}.select('A1')")
        page.wait_for_timeout(300)
        bg = page.evaluate("getComputedStyle(document.querySelector('[data-cell=\"B3\"]')).backgroundColor")
        bg_low = page.evaluate("getComputedStyle(document.querySelector('[data-cell=\"B2\"]')).backgroundColor")
        check('conditional formatting (> 1000) colours cells', bg == 'rgb(255, 199, 206)' and bg_low != bg, f'{bg} / {bg_low}')
        page.evaluate(f"{api}.select('C2:C6')")
        page.locator('[data-a="cf"]').click()
        page.locator('.cf-dlg [name=type]').select_option('scale')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(300)
        # borders, wrap, merge
        page.evaluate(f"{api}.select('A1:D6')")
        page.locator('[data-a="border"]').click()
        page.locator('.menu-item', has_text='Alle Rahmenlinien').click()
        page.evaluate(f"{api}.select('A8:D8')")
        page.locator('[data-a="merge"]').click()
        page.evaluate(f"{api}.input('A8', 'Zusammenfassung über alle Monate hinweg')")
        page.evaluate(f"{api}.select('A8')")
        page.locator('[data-a="wrap"]').click()
        sh = page.evaluate(f"(() => {{ const s = {api}.sheet(); return {{ merges: s.merges, wrap: !!(s.cells.get(7*16384).s||{{}}).wrap, bd: (s.cells.get(0).s||{{}}).bd }}; }})()")
        check('merge cells + wrap + borders in model', sh['merges'] == [{'r1': 7, 'c1': 0, 'r2': 7, 'c2': 3}] and sh['wrap'] and sh['bd'] == {'t': True, 'r': True, 'b': True, 'l': True}, str(sh))
        # data validation dropdown
        page.evaluate(f"{api}.select('D2:D6')")
        page.locator('[data-a="dv"]').click()
        page.locator('dialog [name=list]').fill('offen\nbezahlt\nstorniert')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(300)
        page.evaluate(f"{api}.select('D3')")
        page.wait_for_timeout(200)
        check('dropdown arrow on validated cell', page.locator('.dv-btn').count() == 1)
        page.locator('.dv-btn').click()
        page.locator('.menu-item', has_text='storniert').click()
        page.wait_for_timeout(300)
        check('dropdown sets value', page.evaluate(f"{api}.sheet().cells.get(2*16384+3).v") == 'storniert')
        page.locator('.sh-scroll').focus()
        page.keyboard.type('falsch')
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        check('invalid value rejected', page.evaluate(f"{api}.sheet().cells.get(2*16384+3).v") == 'storniert' and page.locator('.toast-error', has_text='nicht erlaubt').count() >= 1)
        page.keyboard.press('Escape')
        # find & replace
        page.keyboard.press('Control+f')
        page.wait_for_selector('.s-find:not([hidden])')
        page.locator('.s-find [data-fq]').fill('offen')
        page.wait_for_timeout(300)
        check('find counts matches', page.locator('.s-find [data-fcount]').inner_text() == '1 von 2', page.locator('.s-find [data-fcount]').inner_text())
        page.locator('.s-find [data-fr]').fill('fällig')
        page.locator('.s-find [data-freall]').click()
        page.wait_for_timeout(300)
        check('replace all', page.evaluate(f"{api}.sheet().cells.get(1*16384+3).v") == 'fällig' and page.evaluate(f"{api}.sheet().cells.get(3*16384+3).v") == 'fällig')
        page.locator('.s-find [data-fclose]').click()
        # AutoFilter
        page.evaluate(f"{api}.select('A1')")
        page.locator('[data-a="filter"]').click()
        page.wait_for_timeout(300)
        check('filter buttons in header row', page.locator('.af-btn').count() == 4)
        page.locator('.af-btn[data-af="3"]').click()
        page.wait_for_selector('.af-dlg')
        shot(page, 'desktop_filter_dialog_light')
        page.locator('.af-item', has_text='bezahlt').locator('input').uncheck()
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(400)
        hid = page.evaluate(f"{api}.hiddenRows()")
        check('AutoFilter hides rows (D5 = bezahlt)', sorted(hid) == [4], str(hid))
        page.locator('.sh-scroll').focus()
        shot(page, 'desktop_sheet_extras_light')
        set_theme(page, 'dark'); page.wait_for_timeout(300)
        shot(page, 'desktop_sheet_extras_dark')
        set_theme(page, 'light')
        page.locator('#tool-screen .screen-head .title-btn').click()
        page.locator('dialog input[name=v]').fill('Extras-Tabelle')
        page.locator('dialog button[value=ok]').click()
        page.locator('[data-office-save]').click()
        wait_saved(page)
        d = doc_named(page, r'^Extras-Tabelle\.xlsx$')
        path = save_doc(page, d, 'extras.xlsx')
        z = zipfile.ZipFile(path)
        parts = z.namelist()
        check('xlsx: chart + drawing parts', len([n for n in parts if n.startswith('xl/charts/chart')]) == 3 and 'xl/drawings/drawing1.xml' in parts, str(parts))
        cx = z.read('xl/charts/chart1.xml').decode()
        check('xlsx: c:chartSpace bar chart with refs + title', '<c:chartSpace' in cx and '<c:barChart>' in cx and "'Extras-Tabelle'!$B$2:$B$5" not in cx and '$B$2:$B$5' in cx and 'Umsatz 2026' in cx)
        ct = z.read('[Content_Types].xml').decode()
        check('xlsx: content types for chart + drawing', 'drawingml.chart+xml' in ct and 'drawing+xml' in ct)
        import openpyxl
        wb = openpyxl.load_workbook(path)
        ws = wb.active
        kinds = sorted(type(c).__name__ for c in ws._charts)
        check('openpyxl sees 3 charts (bar/line/pie)', kinds == ['BarChart', 'LineChart', 'PieChart'], str(kinds))
        check('openpyxl: merged cells', 'A8:D8' in [str(m) for m in ws.merged_cells.ranges])
        check('openpyxl: borders + wrap', ws['B3'].border.left.style == 'thin' and ws['A8'].alignment.wrap_text)
        dvs = ws.data_validations.dataValidation
        check('openpyxl: dropdown validation', len(dvs) == 1 and dvs[0].type == 'list' and 'storniert' in dvs[0].formula1, str([(x.type, x.formula1, str(x.sqref)) for x in dvs]))
        cfr = [(str(k.sqref), [r.type for r in v]) for k, v in ws.conditional_formatting._cf_rules.items()]
        check('openpyxl: conditional formatting rules', any('cellIs' in t for _, t in cfr) and any('colorScale' in t for _, t in cfr), str(cfr))
        check('openpyxl: autofilter + hidden rows', ws.auto_filter.ref == 'A1:D6' and ws.row_dimensions[5].hidden and not ws.row_dimensions[3].hidden, ws.auto_filter.ref)
        # LibreOffice renders the chart (if available)
        if shutil.which('soffice'):
            lo = os.path.join(OUT, 'lo')
            subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', lo, path], capture_output=True, timeout=120)
            lop = os.path.join(lo, 'extras.pdf')
            check('LibreOffice opens the xlsx (with charts)', os.path.exists(lop) and pdfpages(lop) >= 1)
            if os.path.exists(lop):
                subprocess.run(['pdftoppm', '-r', '60', '-png', '-f', '1', '-l', '1', lop, os.path.join(OUT, 'libreoffice_xlsx')], capture_output=True)
        # re-open: charts read back from .xlsx
        back(page)
        goto(page, f"#/bearbeiten/{d['id']}", 2500)
        page.wait_for_selector('.sh-chart')
        charts = page.evaluate(f"{api}.charts()")
        check('charts read back from xlsx', len(charts) == 3 and charts[0]['title'] == 'Umsatz 2026' and charts[0]['type'] == 'col' and charts[2]['type'] == 'pie', str([(c['type'], c['title']) for c in charts]))
        check('filter + validation + cf read back', page.evaluate(f"(() => {{ const s = {api}.sheet(); return !!s.autoFilter && s.dv.length === 1 && s.cf.length === 2; }})()"))
        # PDF export includes the charts
        page.locator('[data-office-more]').click()
        page.locator('.menu-item', has_text='Als PDF exportieren').click()
        page.wait_for_selector('dialog .result-mini', timeout=40000)
        close_dialog(page)
        pd = doc_named(page, r'^Extras-Tabelle\.pdf$')
        pp = save_doc(page, pd, 'extras-tabelle.pdf')
        imgs = subprocess.run(['pdfimages', '-list', pp], capture_output=True, text=True).stdout
        check('sheet PDF contains chart images', len([l for l in imgs.splitlines()[2:] if l.strip()]) >= 3 and 'Diagramme' in pdftext(pp), imgs[-200:])
        back(page)
    step('sheet', sheet)

    # ---------------- writer ----------------
    def writer():
        goto(page, '#/neu/dokument', 1500)
        page.wait_for_selector('.doc-page')
        api = "document.querySelector('.writer')._writerApi"
        check('spellcheck on with de-DE', page.evaluate("(() => { const e = document.querySelector('.doc-page'); return e.spellcheck && e.lang === 'de-DE'; })()"))
        page.locator('[data-spell]').click()
        check('spellcheck toggle off', page.evaluate("document.querySelector('.doc-page').getAttribute('spellcheck')") == 'false')
        page.locator('[data-spell]').click()
        page.evaluate("""() => { const ed = document.querySelector('.doc-page'); ed.innerHTML = '<p>Vorwort.</p><h1>Einleitung</h1><p>Das ist ein wichtiger Satz.</p><h2>Ziele</h2><p>Wir wollen viel erreichen.</p><hr data-page-break><h1>Ergebnis</h1><p>Fertig.</p>'; ed.dispatchEvent(new Event('input', { bubbles: true })); }""")
        page.wait_for_timeout(400)
        page.locator('[data-panel="outline"]').click()
        page.wait_for_timeout(300)
        check('outline panel lists headings', page.locator('.w-ol-item').all_inner_texts() == ['Einleitung', 'Ziele', 'Ergebnis'], str(page.locator('.w-ol-item').all_inner_texts()))
        page.evaluate("""() => { const p = document.querySelector('.doc-page p'); const r = document.createRange(); r.setStart(p.firstChild, 8); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.doc-page').focus(); }""")
        page.locator('[data-toc]').click()
        page.wait_for_timeout(500)
        check('TOC inserted + generated', page.locator('.doc-page [data-toc] .toc-e').count() == 3)
        page.evaluate("""() => { const h = document.querySelectorAll('.doc-page h1')[1]; h.textContent = 'Ergebnisse'; h.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.doc-page').dispatchEvent(new Event('input', { bubbles: true })); }""")
        page.wait_for_timeout(600)
        check('TOC updates automatically', 'Ergebnisse' in page.locator('.doc-page [data-toc]').inner_text())
        page.evaluate("""() => { const p = [...document.querySelectorAll('.doc-page p')].find(x => x.textContent.includes('wichtiger')); const t = p.firstChild; const i = t.nodeValue.indexOf('wichtiger'); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 9); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
        page.locator('[data-comment]').click()
        page.locator('dialog [name=t]').fill('Quelle ergänzen')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(400)
        check('comment anchored to text + side panel', page.locator('.doc-page .cmt', has_text='wichtiger').count() == 1 and 'Quelle ergänzen' in page.locator('.w-cmt-list').inner_text())
        page.evaluate("""() => { const p = [...document.querySelectorAll('.doc-page p')].find(x => x.textContent.includes('erreichen')); const t = p.firstChild; const r = document.createRange(); r.setStart(t, t.nodeValue.length); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
        page.locator('[data-footnote]').click()
        page.locator('dialog [name=t]').fill('Laut Jahresplanung 2026')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(400)
        check('footnote inserted', page.locator('.doc-page sup.fn').count() == 1 and 'Jahresplanung' in page.locator('.doc-fn-area').inner_text())
        page.locator('[data-pagesetup]').click()
        page.wait_for_selector('.ps-dlg')
        page.locator('.ps-dlg [name=fmt]').select_option('a5')
        page.locator('.ps-dlg [data-or="quer"]').click()
        page.locator('.ps-dlg [name=mar]').select_option('schmal')
        page.locator('.ps-dlg [name=header]').fill('Projektbericht Sommer')
        page.locator('.ps-dlg [name=footer]').fill('Vertraulich')
        page.locator('.ps-dlg [name=pn]').select_option('footer-right')
        page.locator('.ps-dlg [name=pf]').select_option('n-of-m')
        shot(page, 'desktop_pagesetup_light')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_timeout(400)
        pg_ = page.evaluate(f"{api}.page()")
        check('page setup: A5 landscape, narrow margins', abs(pg_['w'] - 595.3) < 1 and abs(pg_['h'] - 419.5) < 1 and abs(pg_['ml'] - 36) < 1, str(pg_))
        check('header preview shown', 'Projektbericht Sommer' in page.locator('.doc-hf.top').inner_text())
        shot(page, 'desktop_writer_extras_light')
        set_theme(page, 'dark'); page.wait_for_timeout(250)
        shot(page, 'desktop_writer_extras_dark')
        set_theme(page, 'light')
        page.locator('#tool-screen .screen-head .title-btn').click()
        page.locator('dialog input[name=v]').fill('Extras-Bericht')
        page.locator('dialog button[value=ok]').click()
        page.locator('[data-office-save]').click()
        wait_saved(page)
        d = doc_named(page, r'^Extras-Bericht\.docx$')
        path = save_doc(page, d, 'extras.docx')
        import docx as pydocx
        dd = pydocx.Document(path)
        z = zipfile.ZipFile(path)
        x = z.read('word/document.xml').decode()
        check('docx: TOC field with cached entries', re.search(r'instrText[^>]*> TOC \\o "1-3"', x) is not None and 'Ergebnisse' in x and 'TOCHeading' in x)
        check('docx: comment part + anchors', 'word/comments.xml' in z.namelist() and 'Quelle ergänzen' in z.read('word/comments.xml').decode() and 'commentRangeStart' in x and 'commentReference' in x)
        sec = dd.sections[0]
        check('docx: header/footer text', sec.header.paragraphs[0].text == 'Projektbericht Sommer' and 'Vertraulich' in sec.footer.paragraphs[0].text)
        ft = z.read('word/footer1.xml').decode()
        check('docx: page number fields (PAGE / NUMPAGES)', 'PAGE' in ft and 'NUMPAGES' in ft)
        check('docx: footnote', 'word/footnotes.xml' in z.namelist() and 'Jahresplanung' in z.read('word/footnotes.xml').decode() and 'footnoteReference' in x)
        check('docx: A5 landscape page size', sec.orientation == 1 and abs(sec.page_width.pt - 595.3) < 2 and abs(sec.page_height.pt - 419.5) < 2, f'{sec.orientation} {sec.page_width.pt} {sec.page_height.pt}')
        # PDF export: header/footer/page numbers + TOC page numbers + footnote
        page.locator('[data-office-more]').click()
        page.locator('.menu-item', has_text='Als PDF exportieren').click()
        page.wait_for_selector('dialog .result-mini', timeout=40000)
        close_dialog(page)
        pp = save_doc(page, doc_named(page, r'^Extras-Bericht\.pdf$'), 'extras-bericht.pdf')
        t = pdftext(pp)
        check('PDF: header + "Seite 1 von N" footer', 'Projektbericht Sommer' in t and re.search(r'Seite 1 von \d', t) is not None, t[:300])
        check('PDF: TOC with page numbers', re.search(r'Ergebnisse \.+\s+\d', t) is not None)
        check('PDF: footnote at page bottom', 'Laut Jahresplanung 2026' in t)
        # reopen: comments/TOC/footnote/header-footer read back
        back(page)
        goto(page, f"#/bearbeiten/{d['id']}", 2500)
        page.wait_for_selector('.doc-page')
        page.wait_for_timeout(800)
        hf = page.evaluate(f"{api}.hf()")
        check('re-open: TOC block, comment, footnote', page.locator('.doc-page [data-toc] .toc-e').count() == 3 and page.locator('.doc-page [data-cmt]').count() >= 1 and page.locator('.doc-page sup.fn').count() == 1)
        check('re-open: header/footer settings', hf and hf['header'] == 'Projektbericht Sommer' and hf['pageNumbers'] == 'footer-right' and hf['pageFormat'] == 'n-of-m', str(hf))
        check('read-aloud button available', page.locator('[data-read]').is_visible())
        back(page)
    step('writer', writer)

    # ---------------- outline → deck ----------------
    def deck():
        goto(page, '#/gliederung', 1200)
        page.wait_for_selector('.ol-text')
        outline = "# Quartalsbericht\nUmsatz\n- Plus 12 %\n- Neue Kunden\nTeam\n- Zwei Neueinstellungen\n> Namen nennen\nRisiken\n- Lieferzeiten\n- Rohstoffe\n- Energie\n- Personal\n- Wechselkurs\n- Zinsen\n- Regulierung\n- Wetter"
        page.locator('.ol-text').fill(outline)
        page.locator('.ol-theme[data-theme="wald"]').click()
        page.wait_for_timeout(700)
        check('outline preview counts slides', page.locator('.ol-slide').count() == 7, str(page.locator('.ol-slide').count()))
        shot(page, 'desktop_gliederung_light')
        page.locator('[data-ol-create]').click()
        page.wait_for_selector('.slides-app')
        page.wait_for_timeout(1000)
        check('deck opens in editor (unsaved)', page.locator('.strip-item').count() == 7 and 'Nicht gespeichert' in page.locator('#tool-screen .screen-head .sub').inner_text())
        sapi = "document.querySelector('.slides-app')._slidesApi"
        page.evaluate(f"{sapi}.go(4)")
        page.wait_for_timeout(300)
        page.locator('.sn-ta').fill('Risiken nur kurz streifen.')
        page.locator('[data-a="transition"]').click()
        page.locator('.menu-item', has_text='Schieben').click()
        page.locator('[data-a="transition"]').click()
        page.locator('.menu-item', has_text='für alle Folien').click()
        page.wait_for_timeout(300)
        shot(page, 'desktop_slides_notes_light')
        page.locator('[data-a="presenter"]').click()
        page.wait_for_selector('.presenter')
        page.wait_for_timeout(500)
        check('presenter: current + next + notes + timer', page.locator('.pv-fit .slide').count() == 1 and page.locator('.pv-next-fit .slide').count() == 1 and 'Risiken nur kurz' in page.locator('.pv-notes-text').inner_text() and re.match(r'\d\d:\d\d', page.locator('.pv-timer').inner_text()))
        shot(page, 'desktop_presenter')
        page.keyboard.press('ArrowRight')
        page.wait_for_timeout(200)
        check('presenter navigation', page.locator('.pv-count').inner_text().startswith('6'))
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        # slideshow with transition
        page.locator('[data-a="show"]').click()
        page.wait_for_selector('.slideshow')
        page.keyboard.press('ArrowRight')
        page.wait_for_timeout(100)
        animating = page.evaluate("document.querySelectorAll('.ss-stage .slide').length")
        page.wait_for_timeout(600)
        check('slideshow transition animates', animating == 2 and page.evaluate("document.querySelectorAll('.ss-stage .slide').length") == 1, str(animating))
        page.keyboard.press('Escape')
        page.locator('[data-office-save]').click()
        wait_saved(page, 30000)
        d = doc_named(page, r'^Quartalsbericht\.pptx$')
        path = save_doc(page, d, 'deck.pptx')
        from pptx import Presentation
        prs = Presentation(path)
        titles = [[sh.text_frame.text for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.strip()][0] for s in prs.slides]
        check('python-pptx: expected slide titles', titles == ['Quartalsbericht', 'Agenda', 'Umsatz', 'Team', 'Risiken (1/2)', 'Risiken (2/2)', 'Vielen Dank!'], str(titles))
        bullets = [sh.text_frame.text for sh in prs.slides[4].shapes if sh.has_text_frame][-1]
        check('long list split (6 + 2)', bullets.count('\n') == 5 and 'Lieferzeiten' in bullets)
        notes = [s.notes_slide.notes_text_frame.text if s.has_notes_slide else '' for s in prs.slides]
        check('speaker notes saved (outline > + edited)', notes[3] == 'Namen nennen' and notes[4] == 'Risiken nur kurz streifen.', str(notes))
        sx = zipfile.ZipFile(path).read('ppt/slides/slide2.xml').decode()
        check('transition written to slide XML', '<p:transition' in sx and '<p:push' in sx)
        page.locator('[data-office-more]').click()
        page.locator('.menu-item', has_text='Handzettel').click()
        page.wait_for_selector('.ho-grid')
        shot(page, 'desktop_handout_dialog_light')
        page.locator('dialog button[value=ok]').click()
        page.wait_for_selector('dialog .result-mini', timeout=40000)
        close_dialog(page)
        hp = save_doc(page, doc_named(page, r'Handzettel\.pdf$'), 'handout.pdf')
        check('handout PDF: 3 slides/page → 3 pages with notes', pdfpages(hp) == 3 and 'Risiken nur kurz streifen.' in pdftext(hp), str(pdfpages(hp)))
        back(page)
        goto(page, f"#/bearbeiten/{d['id']}", 2500)
        page.wait_for_selector('.slides-app')
        pres = page.evaluate(f"(() => {{ const p = {sapi}.pres(); return p.slides.map(s => [s.transition || null, s.notes || '']); }})()")
        check('pptx re-open: notes + transitions', pres[4] == ['push', 'Risiken nur kurz streifen.'] and pres[3][1] == 'Namen nennen', str(pres))
        back(page)
    step('deck', deck)

    # ---------------- stats ----------------
    def stats_check():
        s = stats(page)
        check('stats counted (created/letters/pdf/reminders/vault/imported)', all(s.get(k, 0) >= 1 for k in ['files_created', 'letters_created', 'pdf_exported', 'reminders_created', 'vault_added', 'files_imported']), str(s))
        goto(page, '#/dateien', 300)
        goto(page, '#/start', 900)
        card = page.locator('#view-start [data-month] .month-card')
        check('Dein Monat card on Start', card.is_visible() and card.locator('.month-stat').count() >= 3)
        check('friendly milestone shown', 'Brief' in card.locator('.month-ms').inner_text() or '🎉' in card.inner_text() or '✨' in card.inner_text(), card.locator('.month-ms').inner_text())
        goto(page, '#/einstellungen', 800)
        sw = page.locator('label.switch:has([data-stats-toggle])')
        sw.click()
        page.wait_for_timeout(300)
        check('stats toggle off', not page.locator('[data-stats-toggle]').is_checked())
        before = stats(page)
        page.evaluate("async () => (await import('./js/extras/stats.js')).track('pages_read', 5)")
        check('opt-out: nothing counted', stats(page).get('pages_read', 0) == before.get('pages_read', 0))
        goto(page, '#/start', 800)
        check('opt-out hides card', not page.locator('#view-start [data-month] .month-card').count())
        goto(page, '#/einstellungen', 700)
        page.locator('label.switch:has([data-stats-toggle])').click()
        page.wait_for_timeout(300)
        page.evaluate("async () => (await import('./js/extras/stats.js')).track('pages_read', 120)")
        check('opt-in again counts', stats(page).get('pages_read', 0) >= 120)
        shot(page, 'desktop_ich_light')
    step('stats', stats_check)

    # ---------------- tools page / AI hidden ----------------
    def tools():
        goto(page, '#/werkzeuge', 800)
        check('Werkzeuge: Alltag & Organisation section (6 app tools + matching web tools)', page.locator('.alltag-grid .tool-card:not([data-tool^="web-"])').count() == 6)
        goto(page, '#/dateien', 800)
        page.locator('#view-dateien [data-files] .doc', has_text='struktur.pdf').locator('.more-btn').click()
        items = page.locator('.menu-item').all_inner_texts()
        check('AI entries hidden without on-device AI', not any('Zusammenfassen' in i or 'Übersetzen' in i for i in items), str(items))
        check('file menu: folder/tags/frist/vault', all(any(k in i for i in items) for k in ['In Ordner', 'Tags', 'Frist hinzufügen', 'Tresor']))
        page.keyboard.press('Escape')
        page.evaluate("document.querySelectorAll('.menu-layer').forEach(m => m.remove())")
    step('tools', tools)

    def dark_desktop():
        set_theme(page, 'dark')
        for hsh, n in [('#/start', 'start'), ('#/dateien', 'dateien'), ('#/einstellungen', 'ich'), ('#/profil', 'profil'), ('#/schreiben', 'schreiben'),
                       ('#/schreiben/kuendigung?art=handy', 'kuendigung'), ('#/schreiben/rechnung', 'rechnung'), ('#/fristen', 'fristen'), ('#/tresor', 'tresor_locked'),
                       ('#/papierkorb', 'papierkorb'), ('#/duplikate', 'duplikate'), ('#/gliederung', 'gliederung'), ('#/werkzeuge', 'werkzeuge')]:
            goto(page, hsh, 1300)
            shot(page, f'desktop_{n}_dark')
        set_theme(page, 'light')
        goto(page, '#/werkzeuge', 900)
        shot(page, 'desktop_werkzeuge_light')
    step('desktop dark screenshots', dark_desktop)
    check('no external network requests', not external, str(external[:5]))
    browser.close()


# =====================================================================================
def onboarding_and_ai(p):
    browser = p.chromium.launch()
    for vp, label in [({'width': 1366, 'height': 860}, 'desktop'), ({'width': 390, 'height': 844}, 'phone')]:
        ctx = browser.new_context(bypass_csp=True, viewport=vp, locale='de-DE', is_mobile=label == 'phone', has_touch=label == 'phone', device_scale_factor=2 if label == 'phone' else 1)
        ctx.add_init_script("try { localStorage.setItem('fale-onboarding-force', '1'); } catch (e) {}")
        page = ctx.new_page()
        attach(page, f'onboarding-{label}')
        page.goto(URL)

        def ob():
            page.wait_for_selector('.onboard', timeout=8000)
            # step 1: language – device language first and chosen, all 16 languages, greetings animated
            langs = page.locator('.ob-lang')
            check(f'{label}: onboarding starts with the language choice', page.locator('.onboard .ob-step:not([hidden]) h2').inner_text() == 'Wähle deine Sprache'
                  and langs.count() == 16 and langs.first.get_attribute('data-lang') == 'de' and langs.first.get_attribute('aria-checked') == 'true'
                  and 'Gerätesprache' in langs.first.inner_text())
            page.wait_for_timeout(1500)
            n_anim = page.evaluate("[...document.querySelectorAll('.ob-hi, .ob-globe')].reduce((n, e) => n + e.getAnimations().filter(a => a.playState === 'running').length, 0)")
            vis = page.evaluate("[...document.querySelectorAll('.ob-hi')].filter(e => +getComputedStyle(e).opacity > .5).length")
            check(f'{label}: greetings animated (several „Hallo“ visible at once)', n_anim >= 10 and vis >= 2, (n_anim, vis))
            shot(page, f'{label}_onboarding_0_lang')
            ob_lang = page.locator('.ob-lang')
            big = all(ob_lang.nth(i).bounding_box()['height'] >= 44 for i in range(16))
            check(f'{label}: language buttons big enough (≥ 44 px)', big)
            if label == 'phone':
                page.locator('.ob-lang[data-lang="en"]').click(); page.wait_for_timeout(900)
                check(f'{label}: tapping English switches at once (no reload)', page.locator('.ob-step:not([hidden]) h2').inner_text() == 'Choose your language'
                      and page.locator('[data-next]').inner_text().strip() == 'Next' and page.evaluate("localStorage.getItem('fale-lang')") == 'en')
                page.locator('.ob-lang[data-lang="de"]').click()
                page.wait_for_selector('.onboard .ob-step:not([hidden]) h2', timeout=15000); page.wait_for_timeout(900)
                check(f'{label}: back to the device language: reload continues on the same step, setting „auto“', page.locator('.ob-step:not([hidden]) h2').inner_text() == 'Wähle deine Sprache'
                      and page.evaluate("localStorage.getItem('fale-lang')") == 'auto' and page.locator('.ob-lang[data-lang="de"]').get_attribute('aria-checked') == 'true'
                      and page.evaluate("localStorage.getItem('fale-onboarding-step')") is None)
            page.locator('[data-next]').click()
            check(f'{label}: welcome step slides in, logo and file icons animated', page.locator('.onboard .ob-step:not([hidden]) h2').inner_text() == 'Willkommen bei FaLe'
                  and page.locator('.ob-step.ob-in-next:not([hidden])').count() == 1
                  and page.evaluate("[...document.querySelectorAll('.ob-step:not([hidden]) .ob-f')].every(e => e.getAnimations().length >= 1)"))
            shot(page, f'{label}_onboarding_1_light')
            page.locator('[data-next]').click()
            check(f'{label}: privacy promise step', 'Deine Dateien gehören dir' in page.locator('.ob-step:not([hidden])').inner_text())
            page.locator('[data-back]').click(); page.wait_for_timeout(100)
            check(f'{label}: „Zurück“ slides in from the other side', page.locator('.ob-step.ob-in-back:not([hidden]) h2').inner_text() == 'Willkommen bei FaLe')
            page.locator('[data-next]').click()
            shot(page, f'{label}_onboarding_2_light')
            page.locator('[data-next]').click()
            # step 3: choose the view (simple / all features) – applied at once, keyboard-operable radio group
            check(f'{label}: view choice step', 'Wie möchtest du starten?' in page.locator('.ob-step:not([hidden])').inner_text()
                  and page.locator('.ob-view[aria-checked="true"]').get_attribute('data-view') == 'full')
            page.locator('.ob-view[data-view="simple"]').click()
            check(f'{label}: "Einfach" switches the simple view on', page.evaluate("document.documentElement.classList.contains('simple') && localStorage.getItem('fale-simple') === '1'")
                  and page.locator('.ob-view[data-view="simple"]').get_attribute('aria-checked') == 'true')
            shot(page, f'{label}_onboarding_3_views')
            page.locator('.ob-view[data-view="simple"]').press('ArrowDown')
            check(f'{label}: arrow key selects "Alle Funktionen"', page.evaluate("!document.documentElement.classList.contains('simple') && localStorage.getItem('fale-simple') === null"))
            page.locator('.ob-view[data-view="simple"]').click()
            # same step: text size (Normal / Groß / Sehr groß) – applied at once, stored on the device
            sizes = page.locator('.ob-step:not([hidden]) .ob-size [data-ts-opt]')
            check(f'{label}: text size choice under the views', sizes.count() == 3
                  and page.locator('.ob-size [data-ts-opt="normal"]').get_attribute('aria-pressed') == 'true')
            page.locator('.ob-size [data-ts-opt="xl"]').click()
            page.wait_for_timeout(300)
            check(f'{label}: "Sehr groß" applies at once', page.evaluate("document.documentElement.classList.contains('ts-xl') && localStorage.getItem('fale-textsize') === 'xl'")
                  and page.locator('.ob-size [data-ts-opt="xl"]').get_attribute('aria-pressed') == 'true')
            nb, sz = page.locator('[data-next]').bounding_box(), page.locator('.ob-size [data-ts-opt="xl"]').bounding_box()
            check(f'{label}: buttons and size choice stay on screen', nb['y'] + nb['height'] <= vp['height'] and sz['y'] >= 0 and sz['y'] + sz['height'] <= nb['y'] + 2, f'{nb} {sz}')
            shot(page, f'{label}_onboarding_3_textsize_xl')
            page.locator('.ob-size [data-ts-opt="l"]').click()
            check(f'{label}: "Groß" applies at once', page.evaluate("document.documentElement.classList.contains('ts-l') && !document.documentElement.classList.contains('ts-xl') && localStorage.getItem('fale-textsize') === 'l'"))
            page.locator('[data-next]').click()
            check(f'{label}: signature practice step (optional)', 'Unterschreib einmal' in page.locator('.ob-step:not([hidden]) h2').inner_text())
            page.locator('[data-next]').click()
            page.locator('.ob-theme [data-theme-opt="dark"]').click()
            check(f'{label}: theme choice applies', page.evaluate("document.documentElement.dataset.theme") == 'dark')
            shot(page, f'{label}_onboarding_3_dark')
            page.locator('.ob-theme [data-theme-opt="light"]').click()
            page.locator('[data-next]').click()
            page.wait_for_timeout(400)
            check(f'{label}: onboarding closes + remembered', page.locator('.onboard').count() == 0 and page.evaluate("localStorage.getItem('fale-onboarded')") == '1')
            page.reload()
            page.wait_for_selector('#view-start .hero')
            page.wait_for_timeout(800)
            check(f'{label}: shown only once', page.locator('.onboard').count() == 0)
            check(f'{label}: chosen simple view is active, no extra hint card', page.locator('html.simple').count() == 1
                  and page.evaluate("localStorage.getItem('fale-simple-hint')") == 'hidden')
            check(f'{label}: chosen text size still active after reload', page.locator('html.ts-l').count() == 1)
            page.evaluate("import('./js/simple.js').then(m => { m.setSimple(false); m.setTextSize('normal'); })")
            # language later: Ich → Einstellungen
            page.evaluate("location.hash = '#/einstellungen'"); page.wait_for_selector('#set-lang')
            sel = page.locator('#set-lang')
            check(f'{label}: settings: language choice (Automatisch + 16 languages in their own names)', sel.locator('option').count() == 17 and sel.input_value() == 'auto'
                  and 'Automatisch (Deutsch)' in sel.locator('option').first.inner_text() and 'Français' in sel.inner_text())
            sel.select_option('fr'); page.wait_for_selector('#set-lang', timeout=15000); page.wait_for_timeout(800)
            check(f'{label}: settings: French applies (after reload)', page.evaluate("document.documentElement.lang") == 'fr' and page.locator('#set-lang').input_value() == 'fr'
                  and 'Paramètres' in page.locator('#view-einstellungen').inner_text())
            page.locator('#set-lang').select_option('auto'); page.wait_for_selector('#set-lang', timeout=15000); page.wait_for_timeout(800)
            check(f'{label}: settings: back to automatic (German device)', page.evaluate("document.documentElement.lang") == 'de')
        step(f'{label} onboarding', ob)
        ctx.close()

    # vault auto-lock: inactivity (mocked clock) + app hidden
    ctx = browser.new_context(bypass_csp=True, viewport={'width': 1366, 'height': 860}, locale='de-DE')
    page = ctx.new_page()
    attach(page, 'autolock')
    page.clock.install()
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')

    def autolock():
        page.evaluate("async () => { const v = await import('./js/extras/vault.js'); await v.setupVault('246810'); }")
        check('vault unlocked after setup', page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()"))
        page.clock.run_for(2 * 60 * 1000)
        check('still unlocked before the timeout', page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()"))
        waited = 120
        while waited < 300 and page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()"):
            page.clock.run_for(10 * 1000); waited += 10
        check('auto-lock after 3 minutes of inactivity', 180 <= waited <= 240, f'locked after {waited} s')
        ok = page.evaluate("async () => (await import('./js/extras/vault.js')).unlock('246810')")
        check('unlock again with PIN', ok)
        page.evaluate("() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }")
        page.wait_for_timeout(200)
        check('locks immediately when the app is hidden', page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()") is False)
        bad = page.evaluate("async () => (await import('./js/extras/vault.js')).unlock('000000')")
        check('wrong PIN rejected (API)', bad is False)
    step('vault auto-lock', autolock)
    ctx.close()

    # AI wiring with a stand-in for the browser's on-device API (the app itself never fakes output)
    ctx = browser.new_context(bypass_csp=True, viewport={'width': 1366, 'height': 860}, locale='de-DE')
    ctx.add_init_script("""self.Summarizer = { availability: async () => 'available', create: async () => ({ summarize: async t => 'KURZFASSUNG: ' + t.slice(0, 20), destroy() {} }) };
      self.Translator = { availability: async () => 'available', create: async () => ({ translate: async t => 'EN: ' + t, destroy() {} }) };""")
    page = ctx.new_page()
    attach(page, 'ai')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')

    def ai():
        caps = page.evaluate("async () => (await import('./js/extras/ai.js')).aiCapabilities()")
        check('AI capabilities detected from browser API', caps['summarize'] and caps['translate'], str(caps))
        goto(page, '#/neu/dokument', 1500)
        page.wait_for_selector('.doc-page')
        page.evaluate("""() => { const ed = document.querySelector('.doc-page'); ed.innerHTML = '<p>Ein langer Text über das Sommerfest im Park.</p>'; ed.dispatchEvent(new Event('input', { bubbles: true })); }""")
        page.locator('[data-office-more]').click()
        check('writer menu offers on-device summary', page.locator('.menu-item', has_text='Zusammenfassen').count() == 1)
        page.locator('.menu-item', has_text='Zusammenfassen').click()
        page.wait_for_selector('.ai-out:not([hidden])', timeout=8000)
        check('summary result from provider', page.locator('.ai-out').input_value().startswith('KURZFASSUNG: Ein langer Text'))
        shot(page, 'desktop_ai_summary_light')
        close_dialog(page)
        leave_btn = page.locator('#tool-screen .screen-head [data-back]')
        leave_btn.click()
        page.wait_for_timeout(300)
        leave(page)
    step('AI wiring', ai)
    ctx.close()
    browser.close()


# =====================================================================================
def phone(p):
    browser = p.chromium.launch()
    ctx = browser.new_context(bypass_csp=True, viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='de-DE', accept_downloads=True)
    page = ctx.new_page()
    attach(page, 'phone')
    page.goto(URL)
    page.wait_for_selector('#view-start .hero')

    def seed():
        page.evaluate("""async () => {
          const p = await import('./js/extras/profile.js'); await p.setProfile({ vorname: 'Erika', nachname: 'Musterfrau', strasse: 'Lindenweg', hausnummer: '7', plz: '66111', ort: 'Saarbrücken', email: 'erika@example.de' });
          const r = await import('./js/extras/reminders.js'); const d = new Date(); const iso = x => x.toISOString().slice(0, 10);
          await r.addReminder({ title: 'Reisepass läuft ab', type: 'ablauf', due: iso(new Date(d.getTime() + 20 * 864e5)), leads: [30] });
          await r.addReminder({ title: 'Miete überweisen', type: 'zahlung', due: iso(new Date(d.getTime() - 864e5)), leads: [1] });
          const s = await import('./js/extras/stats.js'); s.track('pages_read', 42); s.track('files_created', 3); s.track('letters_created', 1); s.track('bytes_saved', 5 * 1048576);
          const o = await import('./js/extras/organize.js'); await o.createFolder('Wohnung'); await o.createFolder('Auto'); }""")
        with page.expect_file_chooser() as fc:
            page.evaluate("document.querySelector('[data-action=open-file]').click()")
        fc.value.set_files([os.path.join(TD, 'bericht.pdf'), os.path.join(OD, 'umsatz.xlsx'), os.path.join(OD, 'bericht.docx')])
        page.wait_for_timeout(2000)
    step('phone seed', seed)

    def overflow(name):
        w = page.evaluate("Math.max(document.documentElement.scrollWidth, document.querySelector('#tool-screen:not([hidden]) .screen-body') ? document.querySelector('#tool-screen .screen-body').scrollWidth : 0)")
        check(f'phone {name}: no horizontal overflow', w <= 392, str(w))

    def screens():
        for theme in ['light', 'dark']:
            set_theme(page, theme)
            for hsh, n in [('#/start', 'start'), ('#/dateien', 'dateien'), ('#/werkzeuge', 'werkzeuge'), ('#/einstellungen', 'ich'), ('#/profil', 'profil'),
                           ('#/schreiben', 'schreiben'), ('#/schreiben/kuendigung?art=strom', 'kuendigung'), ('#/schreiben/rechnung', 'rechnung'),
                           ('#/fristen', 'fristen'), ('#/tresor', 'tresor_setup'), ('#/papierkorb', 'papierkorb'), ('#/duplikate', 'duplikate'), ('#/gliederung', 'gliederung')]:
                goto(page, hsh, 1300)
                shot(page, f'phone_{n}_{theme}')
                if theme == 'light':
                    overflow(n)
        set_theme(page, 'light')
        # letter preview toggle on phone
        goto(page, '#/schreiben/kuendigung?art=handy', 1200)
        page.locator('[data-prev]').tap()
        page.wait_for_timeout(400)
        check('phone: letter preview toggle', page.locator('.lt-side').is_visible() and 'Erika Musterfrau' in page.locator('.lt-paper').inner_text())
        shot(page, 'phone_kuendigung_preview_light')
        page.locator('[data-prev]').tap()
        # start cards
        goto(page, '#/start', 1200)
        check('phone: reminder + month cards on Start', page.locator('#view-start .rem-card').count() >= 2 and page.locator('#view-start .month-card').is_visible())
        check('phone: Fristen block rendered once', page.locator('#view-start .rem-start-head').count() == 1)
        page.evaluate("document.querySelector('#view-start [data-month]').scrollIntoView({ behavior: 'instant', block: 'center' })")
        shot(page, 'phone_start_month_light')
    step('phone screens', screens)

    def phone_office():
        d = [x for x in page.evaluate(DOCS) if x['name'] == 'umsatz.xlsx'][0]
        goto(page, f"#/bearbeiten/{d['id']}", 2500)
        page.wait_for_selector('.sheet-app')
        api = "document.querySelector('.sheet-app')._sheetApi"
        page.evaluate(f"{api}.select('A1:C5')")
        page.locator('[data-a="chart"]').scroll_into_view_if_needed()
        page.locator('[data-a="chart"]').tap()
        page.wait_for_selector('.chart-dlg')
        shot(page, 'phone_chart_dialog_light')
        page.locator('dialog button[value=ok]').tap()
        page.wait_for_timeout(700)
        check('phone: chart inserted', page.locator('.sh-chart').count() == 1)
        shot(page, 'phone_sheet_chart_light')
        set_theme(page, 'dark'); shot(page, 'phone_sheet_chart_dark'); set_theme(page, 'light')
        back(page); leave(page)
        d = [x for x in page.evaluate(DOCS) if x['name'] == 'bericht.docx'][0]
        goto(page, f"#/bearbeiten/{d['id']}", 2500)
        page.wait_for_selector('.doc-page')
        page.locator('[data-panel="outline"]').scroll_into_view_if_needed()
        page.locator('[data-panel="outline"]').tap()
        page.wait_for_timeout(400)
        shot(page, 'phone_writer_outline_light')
        page.locator('.w-outline [data-close-panel]').tap()
        page.locator('[data-pagesetup]').scroll_into_view_if_needed()
        page.locator('[data-pagesetup]').tap()
        page.wait_for_selector('.ps-dlg')
        shot(page, 'phone_pagesetup_light')
        close_dialog(page)
        back(page); leave(page)
        goto(page, '#/gliederung', 1200)
        page.locator('[data-example]').tap()
        page.wait_for_timeout(600)
        shot(page, 'phone_gliederung_example_light')
        page.locator('[data-ol-create]').tap()
        page.wait_for_selector('.slides-app')
        page.wait_for_timeout(900)
        page.locator('[data-a="notes"]').scroll_into_view_if_needed()
        page.locator('[data-a="notes"]').tap()
        page.wait_for_timeout(300)
        shot(page, 'phone_slides_notes_light')
        set_theme(page, 'dark'); shot(page, 'phone_slides_notes_dark'); set_theme(page, 'light')
        back(page); leave(page)
        # vault on phone
        goto(page, '#/tresor', 1200)
        page.locator('.vault-setup [name=pin]').fill('112233')
        page.locator('.vault-setup [name=pin2]').fill('112233')
        page.locator('.vault-setup [name=ack]').check()
        page.locator('.vault-setup [type=submit]').tap()
        page.wait_for_selector('.vault-bar', timeout=15000)
        shot(page, 'phone_tresor_open_light')
        set_theme(page, 'dark'); shot(page, 'phone_tresor_open_dark'); set_theme(page, 'light')
        page.locator('#tool-screen [data-lock]').tap()
        page.wait_for_selector('.vault-lock')
        shot(page, 'phone_tresor_locked_light')
        set_theme(page, 'dark'); shot(page, 'phone_tresor_locked_dark'); set_theme(page, 'light')
    step('phone office + vault', phone_office)
    check('phone: no external network requests', not external, str(external[:5]))
    browser.close()


with sync_playwright() as p:
    if ONLY in ('all', 'desktop'):
        desktop(p)
    if ONLY in ('all', 'onboarding'):
        onboarding_and_ai(p)
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

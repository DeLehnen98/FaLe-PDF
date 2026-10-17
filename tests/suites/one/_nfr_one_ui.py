"""E2E tests for the FaLe One web app (one/) against the local backend (one_harness.mjs: real /api/drive + /api/account
+ /api/share handlers, real SQL migrations in PostgreSQL, mock Supabase Auth).
   node one_harness.mjs &      python3 make_data.py      python3 test_one_ui.py [filter]
Phone = 390×844 touch (Pixel-like), desktop = 1366×900. Screenshots → shots/, montage → montage.png."""
import os, sys, json, re, time, hashlib, zipfile, io, shutil, urllib.request, subprocess
from playwright.sync_api import sync_playwright, expect

SP = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(SP, 'data')
SHOTS = os.path.join(SP, 'shots_regress')
DL = os.path.join(SP, 'downloads_regress')
APP = 'http://127.0.0.1:8937/'
API = 'http://127.0.0.1:8935'
SB = 'http://127.0.0.1:8939'
EMAIL = 'anna@example.com'
PW = 'Korrekt-Pferd-Batterie-42'
MARK = 'GEHEIM-ONE-4711'
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
ALLOWED_ORIGINS = ('http://127.0.0.1:8937', 'http://127.0.0.1:8935', 'http://127.0.0.1:8939', 'blob:', 'data:')
for d in (SHOTS, DL):
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)

results, problems, foreign = [], [], []
STATE = {}
PAGES = []

def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:500]}]' if info and not cond else ''), flush=True)
    return bool(cond)

def step(name, fn):
    if ONLY != 'all' and not any(o in name for o in ONLY.split(',')):
        return
    print(f'--- {name}', flush=True)
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:400]))
        print('FAIL ' + name + ' EXC ' + str(e)[:1200], flush=True)
        for i, pg in enumerate(PAGES[-2:]):
            try: pg.screenshot(path=os.path.join(SP, f'fail_{re.sub(r"[^A-Za-z0-9]+", "_", name)}_{i}.png'))
            except Exception: pass

def H(path, data=None, base=API):
    req = urllib.request.Request(base + path, data=data.encode() if isinstance(data, str) else data, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode() or 'null')
def sql(q):
    r = H('/__test/sql', q)
    if isinstance(r, dict) and r.get('error'): raise Exception(r['error'])
    return [{k: (int(v) if isinstance(v, str) and re.fullmatch(r'-?\d+', v) else v) for k, v in row.items()} for row in r['rows']]

IGNORED = ('status of 404', 'status of 409', 'status of 401', 'ERR_INTERNET_DISCONNECTED', 'net::ERR_FAILED', 'Failed to fetch', 'ERR_NETWORK_CHANGED', 'status of 405')
def attach(page, label):
    def on_console(m):
        if m.type == 'error' and not any(i in m.text for i in IGNORED): problems.append(f'{label} [console] {m.text[:300]}')
        if 'Content Security Policy' in m.text or 'Trusted Type' in m.text or 'Refused to' in m.text: problems.append(f'{label} [csp] {m.text[:300]}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.on('request', lambda r: foreign.append(f'{label} {r.url[:120]}') if not r.url.startswith(ALLOWED_ORIGINS) else None)

def device(p, browser, label, phone=True, lang='de', dark=False, extra_init=''):
    if phone:
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True, color_scheme='dark' if dark else 'light',
                                  user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36')
    else:
        ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True, color_scheme='dark' if dark else 'light')
    ctx.add_init_script("try{localStorage.setItem('fale-one-dev-api','%s');localStorage.setItem('fale-one-dev-pdf','%s');localStorage.setItem('fale-one-lang','%s')}catch(e){}%s" % (API, API, lang, extra_init))
    page = ctx.new_page()
    page.set_default_timeout(20000)
    attach(page, label)
    PAGES.append(page)
    return ctx, page

def wait_idle(page, timeout=60000, started=False):
    """until no upload job is active and a sync happened (started=True: first wait until a job exists)"""
    if started:
        try: page.wait_for_function("() => document.querySelector('.app') && document.querySelector('.app').dataset.jobs !== '0'", timeout=15000)
        except Exception: pass
    page.wait_for_function("() => { const a = document.querySelector('.app'); return a && a.dataset.jobs === '0' && +a.dataset.synced > 0; }", timeout=timeout)
    page.wait_for_timeout(400)

def tiles_in_order(page):
    """photo tiles in visual order (top → bottom, left → right)"""
    return page.evaluate("""() => [...document.querySelectorAll('.jg-tile')].map(e => ({ r: e.getBoundingClientRect(), l: e.getAttribute('aria-label') })).sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left)).map(x => x.l)""")

def reset_ui(page):
    for _ in range(4):
        if page.locator('.viewer').count() == 0 and page.locator('dialog.dlg[open]').count() == 0: break
        page.keyboard.press('Escape'); page.wait_for_timeout(250)

def go(page, h):
    reset_ui(page)
    page.evaluate(f"location.hash = '{h}'")
    page.wait_for_timeout(500)

def menu(page, row_text, item):
    row = page.locator('.row, .tile', has_text=row_text).first
    row.locator('.row-more').click()
    page.locator('dialog.sheet .menu-item', has_text=item).first.click()

def dialog(page):
    return page.locator('dialog.dlg[open]').last

def shot(page, name, keep_toasts=False):
    if not keep_toasts: page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(SHOTS, name + '.png'))

def signup(page, email=EMAIL):
    page.goto(APP)
    page.get_by_role('button', name=re.compile('Anmelden oder Konto erstellen|Sign in or create')).click()
    page.fill('#g-email', email)
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('#g-code')
    page.fill('#g-code', H('/__test/otp?email=' + email)['code'])
    page.locator('form.gate-form button[type=submit]').click()

def sha(b): return hashlib.sha256(b).hexdigest()

# ======================================================================================================== tests
def t_static():
    # i18n coverage: every t('…') / tp(…) literal has an English entry
    src = ''
    for root, _, files in os.walk('/home/claude/FalePDF/one/js'):
        if '/shared' in root: continue
        for f in files:
            if f.endswith('.js') and f != 'i18n-en.js': src += open(os.path.join(root, f), encoding='utf-8').read() + '\n'
    keys = set(re.findall(r"\bt\(\s*'((?:[^'\\]|\\.)*)'", src))
    for m in re.finditer(r"\btp\([^,]+,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'", src): keys.update([m.group(1), m.group(2)])
    en_src = open('/home/claude/FalePDF/one/js/i18n-en.js', encoding='utf-8').read()
    en = json.loads(subprocess.run(['node', '-e', "import('/home/claude/FalePDF/one/js/i18n-en.js').then(m=>console.log(JSON.stringify(m.default)))"], capture_output=True, text=True).stdout or '{}')
    missing = sorted(k.replace("\\'", "'") for k in keys if k.replace("\\'", "'") not in en)
    check('i18n: every German UI string has an English translation', not missing, missing[:15])
    check('i18n: dictionary has no unused entries (> 95 % used)', len([k for k in en if k in {x.replace("\\'", "'") for x in keys}]) >= 0.95 * len(en), len(en))
    # security: no innerHTML / eval / inline handlers in our code, no inline script/style in index.html
    bad = re.findall(r'innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(', src)
    check('code: no HTML-string sinks or eval in one/js', not bad, bad[:5])
    html = open('/home/claude/FalePDF/one/index.html').read()
    check('index.html: no inline script or style', not re.search(r'<script(?![^>]*\bsrc=)[^>]*>|<style|style="| on[a-z]+="', html))
    vc = json.load(open('/home/claude/FalePDF/one/vercel.json'))
    csp = vc['headers'][0]['headers'][0]['value']
    check('vercel.json: strict CSP (no unsafe-inline/eval, Trusted Types, connect-src limited)', "'unsafe" not in csp and "require-trusted-types-for 'script'" in csp and 'connect-src \'self\' https://fale-pdf.vercel.app https://*.supabase.co;' in csp and 'wasm' not in csp, csp)
    r = subprocess.run(['node', '/home/claude/FalePDF/scripts/sync-one-shared.mjs', '--check'], capture_output=True, text=True)
    check('sync-one-shared --check: shared copies + precache list current', r.returncode == 0, r.stderr[-400:])

def t_signup():
    H('/__test/reset?ONE_CHUNK_KB=64')
    ctx, page = device(P, B, 'A-phone')
    STATE['A'] = (ctx, page)
    page.goto(APP)
    shot(page, 'phone_light_01_welcome')
    signup(page)
    page.wait_for_selector('#g-pw1', timeout=20000)
    page.fill('#g-pw1', 'zu-kurz')
    page.fill('#g-pw2', 'zu-kurz')
    page.locator('form.gate-form button[type=submit]').click()
    check('setup: short Sync-Passwort is refused', page.locator('#g-pw1').is_visible())
    page.fill('#g-pw1', PW); page.fill('#g-pw2', PW)
    shot(page, 'phone_light_02_password')
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('[data-rk]', timeout=40000)
    rk = '-'.join(page.locator('[data-rk] span').all_inner_texts())
    STATE['rk'] = rk
    check('recovery key shown once (14 groups of 4)', re.fullmatch(r'([0-9A-Z]{4}-){13}[0-9A-Z]{4}', rk) is not None, rk)
    shot(page, 'phone_light_03_recovery')
    nxt = page.get_by_role('button', name='Weiter zu FaLe One')
    check('continue is disabled until the key is confirmed', nxt.is_disabled())
    with page.expect_download() as dl:
        page.get_by_role('button', name='Als Datei speichern').click()
    kit = open(dl.value.path(), encoding='utf-8').read()
    check('recovery kit file contains the key and guidance', rk in kit and 'Passwort' in kit)
    page.check('text=Ich habe den Schlüssel sicher aufbewahrt.')
    nxt.click()
    page.wait_for_selector('.app', timeout=20000)
    wait_idle(page)
    check('home: Fotos tab with status card and quota', page.locator('.status-card').is_visible() and 'von 2,0 GB' in page.locator('.status-card').inner_text())
    uid = sql(f"select id::text from auth.users where email = '{EMAIL}'")[0]['id']
    STATE['uid'] = uid
    keys = sql(f"select key_id from public.sync_keys where user_id = '{uid}'")
    check('the wrapped master key is stored server-side (sync_keys)', len(keys) == 1)

def t_drive_tree():
    ctx, page = STATE['A']
    go(page, '#/drive')
    page.locator('.fab').click()
    page.locator('dialog.sheet .menu-item', has_text='Ordner').first.click()
    d = dialog(page); d.locator('input').fill('Leerer Ordner'); d.get_by_role('button', name='Erstellen').click()
    page.wait_for_timeout(900)
    check('create folder', page.locator('.row', has_text='Leerer Ordner').count() == 1)
    page.locator('.fab').click()
    with page.expect_file_chooser() as fc:
        page.locator('dialog.sheet .menu-item', has_text='Ordner hochladen').click()
    fc.value.set_files(os.path.join(DATA, 'tree', 'Projekt'))
    wait_idle(page, started=True)
    check('folder upload: "Projekt" created in the root', page.locator('.row', has_text='Projekt').count() == 1, page.locator('.items').inner_text())
    page.locator('.row', has_text='Projekt').locator('.row-open').click()
    page.wait_for_timeout(600)
    names = page.locator('.row-name').all_inner_texts()
    check('folder tree: Unterordner + Notizen.txt inside Projekt', 'Unterordner' in names and 'Notizen.txt' in names, names)
    check('breadcrumbs show the path', 'Projekt' in page.locator('.crumbs').inner_text())
    page.locator('.row', has_text='Unterordner').locator('.row-open').click()
    page.wait_for_timeout(500)
    names = page.locator('.row-name').all_inner_texts()
    check('subfolder holds Bericht.pdf + tabelle.csv', set(names) >= {'Bericht.pdf', 'tabelle.csv'}, names)
    STATE['sub_url'] = page.evaluate('location.hash')
    shot(page, 'phone_light_06_drive_folder')
    # grid view + sort
    page.get_by_role('button', name='Ansicht wechseln').click()
    check('grid view toggles', page.locator('.items.grid .tile').count() == 2)
    shot(page, 'phone_light_07_drive_grid')
    page.get_by_role('button', name='Ansicht wechseln').click()
    page.get_by_role('button', name='Sortieren').click()
    page.locator('dialog.sheet .menu-item', has_text='Größe').click()
    page.wait_for_timeout(300)
    first = page.locator('.row-name').first.inner_text()
    check('sort by size (largest first)', first == 'Bericht.pdf', first)

def t_previews():
    ctx, page = STATE['A']
    page.locator('.row', has_text='Bericht.pdf').locator('.row-open').click()
    page.wait_for_selector('.viewer .pdf-page canvas', timeout=20000)
    page.wait_for_timeout(800)
    check('PDF preview renders with the vendored pdf.js', page.locator('.viewer .pdf-page canvas').count() >= 1)
    shot(page, 'phone_light_08_pdf_preview')
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    page.locator('.crumb', has_text='Projekt').click()
    page.wait_for_timeout(400)
    page.locator('.row', has_text='Notizen.txt').locator('.row-open').click()
    page.wait_for_selector('.viewer .vw-text')
    check('text preview shows the decrypted content', MARK in page.locator('.vw-text').inner_text())
    page.keyboard.press('Escape')

def t_rename_move_trash():
    ctx, page = STATE['A']
    menu(page, 'Notizen.txt', 'Umbenennen')
    d = dialog(page)
    d.locator('input').fill('Notizen-neu.txt')
    d.get_by_role('button', name='Speichern').click()
    page.wait_for_timeout(800)
    check('rename', page.locator('.row', has_text='Notizen-neu.txt').count() == 1)
    go(page, STATE['sub_url'])
    menu(page, 'tabelle.csv', 'Verschieben')
    d = dialog(page)
    d.locator('.crumb', has_text='Meine Dateien').click()
    d.get_by_role('button', name='Hierher verschieben').click()
    page.wait_for_timeout(900)
    check('move: tabelle.csv left the subfolder', page.locator('.row', has_text='tabelle.csv').count() == 0)
    go(page, '#/drive')
    check('move: tabelle.csv is now in the root', page.locator('.row', has_text='tabelle.csv').count() == 1)
    # trash → undo → trash → restore from trash → trash → delete forever
    menu(page, 'tabelle.csv', 'In den Papierkorb')
    page.wait_for_timeout(800)
    check('trash: item disappears', page.locator('.row', has_text='tabelle.csv').count() == 0)
    page.locator('.toast-act', has_text='Rückgängig').click()
    page.wait_for_timeout(1200)
    check('undo restores it', page.locator('.row', has_text='tabelle.csv').count() == 1)
    menu(page, 'tabelle.csv', 'In den Papierkorb')
    page.wait_for_timeout(800)
    go(page, '#/drive/papierkorb')
    row = page.locator('.row', has_text='tabelle.csv')
    check('trash view lists it with the final deletion date', row.count() == 1 and 'endgültig gelöscht' in row.inner_text(), row.inner_text() if row.count() else '')
    shot(page, 'phone_light_10_trash')
    row.get_by_role('button', name='Wiederherstellen').click()
    page.wait_for_timeout(1000)
    go(page, '#/drive')
    check('restore from the trash', page.locator('.row', has_text='tabelle.csv').count() == 1)
    menu(page, 'tabelle.csv', 'In den Papierkorb')
    page.wait_for_timeout(800)
    go(page, '#/drive/papierkorb')
    page.get_by_role('button', name='„tabelle.csv“ endgültig löschen').click()
    dialog(page).get_by_role('button', name='Endgültig löschen').click()
    page.wait_for_timeout(1200)
    check('delete forever empties the trash', page.locator('.row', has_text='tabelle.csv').count() == 0)
    left = sql(f"select count(*)::int n from public.one_nodes where user_id = '{STATE['uid']}' and deleted")[0]['n']
    check('server keeps only a tombstone (no key, no meta)', left == 1 and sql(f"select count(*)::int n from public.one_nodes where user_id = '{STATE['uid']}' and deleted and (key is not null or meta is not null)")[0]['n'] == 0)

def t_versions():
    ctx, page = STATE['A']
    go(page, '#/drive')
    page.locator('.row', has_text='Projekt').locator('.row-open').click()
    page.wait_for_timeout(500)
    with page.expect_file_chooser() as fc:
        menu(page, 'Notizen-neu.txt', 'Neue Version hochladen')
    fc.value.set_files(os.path.join(DATA, 'Notizen-v2.txt'))
    wait_idle(page, started=True)
    page.locator('.row', has_text='Notizen-neu.txt').locator('.row-open').click()
    page.wait_for_selector('.viewer .vw-text')
    check('new version is current', 'Zweite Version' in page.locator('.vw-text').inner_text())
    page.keyboard.press('Escape')
    menu(page, 'Notizen-neu.txt', 'Versionen')
    d = dialog(page)
    d.locator('.version').first.wait_for()
    page.wait_for_timeout(600)
    check('versions list: current + 1 older', d.locator('.version').count() == 2, d.inner_text())
    shot(page, 'phone_light_11_versions')
    d.get_by_role('button', name='Wiederherstellen').click()
    page.wait_for_timeout(1500)
    d.get_by_role('button', name='Schließen').last.click()
    page.locator('.row', has_text='Notizen-neu.txt').locator('.row-open').click()
    page.wait_for_selector('.viewer .vw-text')
    page.wait_for_timeout(500)
    txt = page.locator('.vw-text').inner_text()
    check('restored version is current again', 'geheime Notiz' in txt, txt)
    page.keyboard.press('Escape')

def t_resumable():
    ctx, page = STATE['A']
    go(page, '#/drive')
    puts = []
    def slow(route):
        u = route.request.url
        m = re.search(r'[?&]i=(\d+)', u)
        puts.append(int(m.group(1)) if m else -1)
        time.sleep(0.12)
        route.continue_()
    page.route(re.compile(r'.*/api/drive\?a=upload\.put.*'), slow)
    with page.expect_file_chooser() as fc:
        page.locator('.fab').click()
        page.locator('dialog.sheet .menu-item', has_text='Dateien hochladen').click()
    fc.value.set_files(os.path.join(DATA, 'big.bin'))
    page.wait_for_function("() => document.querySelector('.app').dataset.jobs === '1'")
    page.wait_for_timeout(1800)
    page.locator('button.up-btn').click()
    sheet = dialog(page)
    sheet.locator('.job').first.wait_for()
    sheet.get_by_role('button', name=re.compile('pausieren')).first.click()
    page.wait_for_timeout(1500)
    shot(page, 'phone_light_12_uploads_paused')
    before = len(set(puts))
    check('pause: upload stopped part-way', 0 < before < 34 and 'Pausiert' in sheet.inner_text(), (before, sheet.inner_text()[:200]))
    page.unroute(re.compile(r'.*/api/drive\?a=upload\.put.*'))
    # "app kill": reload the page – the job (sealed in IndexedDB) comes back, still paused
    page.reload()
    page.wait_for_selector('.app')
    page.wait_for_timeout(1500)
    puts2 = []
    page.route(re.compile(r'.*/api/drive\?a=upload\.put.*'), lambda r: (puts2.append(int(re.search(r'[?&]i=(\d+)', r.request.url).group(1))), r.continue_()))
    page.locator('button.up-btn').click()
    sheet = dialog(page)
    sheet.locator('.job', has_text='big.bin').wait_for()
    check('after reload the paused upload is listed', 'Pausiert' in sheet.locator('.job', has_text='big.bin').inner_text())
    sheet.get_by_role('button', name=re.compile('fortsetzen')).first.click()
    wait_idle(page, 90000)
    sheet.get_by_role('button', name='Schließen').last.click()
    page.unroute(re.compile(r'.*/api/drive\?a=upload\.put.*'))
    chunks = (2 * 1024 * 1024 + 12345 + (65536 - 28) - 1) // (65536 - 28)
    resent = len(set(puts2) & set(puts))
    check('resume sends only the missing chunks (upload.status)', set(puts2) | set(puts) >= set(range(chunks)) and len(puts2) <= chunks - before + 3, (len(puts), len(puts2), resent, chunks))
    check('big.bin is in Drive', page.locator('.row', has_text='big.bin').count() == 1)
    with page.expect_download() as dl:
        menu(page, 'big.bin', 'Herunterladen')
    got = open(dl.value.path(), 'rb').read()
    check('download after resume is byte-identical (digest verified)', sha(got) == sha(open(os.path.join(DATA, 'big.bin'), 'rb').read()))

def t_offline():
    ctx, page = STATE['A']
    go(page, '#/drive')
    menu(page, 'Projekt', 'Offline verfügbar machen')
    page.wait_for_timeout(3000)
    go(page, '#/drive/offline')
    page.wait_for_timeout(800)
    check('offline view lists the pinned folder', page.locator('.row', has_text='Projekt').count() == 1)
    page.evaluate("navigator.serviceWorker.ready")
    page.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=15000)
    ctx.set_offline(True)
    page.reload()
    page.wait_for_selector('.app', timeout=20000)
    page.wait_for_timeout(1500)
    check('offline: app shell loads from the service worker', page.locator('.notice', has_text='offline').count() >= 1)
    go(page, '#/drive')
    page.locator('.row', has_text='Projekt').locator('.row-open').click()
    page.wait_for_timeout(500)
    page.locator('.row', has_text='Notizen-neu.txt').locator('.row-open').click()
    page.wait_for_selector('.viewer .vw-text', timeout=15000)
    check('offline: a pinned file opens (encrypted local copy)', 'geheime Notiz' in page.locator('.vw-text').inner_text())
    shot(page, 'phone_light_13_offline')
    page.keyboard.press('Escape')
    go(page, '#/drive')
    page.locator('.row', has_text='big.bin').locator('.row-open').click()
    page.wait_for_timeout(1500)
    check('offline: an unpinned file says so honestly', 'Offline nicht verfügbar' in page.locator('.viewer').inner_text(), page.locator('.viewer').inner_text()[:200])
    page.locator('.viewer .vw-none button', has_text='Herunterladen').click()
    page.wait_for_timeout(1000)
    check('offline: download of an unpinned file explains why it fails', page.locator('.toast', has_text='Offline nicht verfügbar').count() >= 1)
    page.keyboard.press('Escape')
    ctx.set_offline(False)
    page.reload(); page.wait_for_selector('.app'); wait_idle(page)

def t_share_target():
    ctx, page = STATE['A']
    page.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=15000)
    st = page.evaluate("""async () => { const fd = new FormData(); fd.append('files', new File(['Geteilt aus einer anderen App'], 'Geteilt.txt', { type: 'text/plain' }));
        const r = await fetch('share-target', { method: 'POST', body: fd }); return { ok: r.ok, url: r.url, redirected: r.redirected }; }""")
    inbox = page.evaluate("new Promise(r => { const q = indexedDB.open('fale-one-inbox', 1); q.onsuccess = () => { const t = q.result.transaction('files').objectStore('files').count(); t.onsuccess = () => r(t.result); }; })")
    check('share target: the service worker takes the shared files (POST share-target) into the local inbox', st['ok'] and inbox == 1, (st, inbox))
    page.goto(APP + '?shared=1#/drive')
    d = page.locator('dialog.dlg[open]', has_text='geteilte Datei')
    d.wait_for(timeout=20000)
    shot(page, 'phone_light_09_share_target')
    d.get_by_role('button', name='In Drive speichern').click()
    wait_idle(page, started=True)
    check('share target: the shared file lands in Drive', page.locator('.row', has_text='Geteilt.txt').count() == 1)
    left = page.evaluate("new Promise(r => { const q = indexedDB.open('fale-one-inbox', 1); q.onsuccess = () => { const t = q.result.transaction('files').objectStore('files').count(); t.onsuccess = () => r(t.result); }; })")
    check('share target: the local inbox is emptied after pick-up', left == 0, left)
    menu(page, 'Geteilt.txt', 'In den Papierkorb')
    page.wait_for_timeout(600)

def t_grid_perf():
    ctx, page = STATE['A']
    r = page.evaluate("""async () => {
        const G = await import('./js/views/grid.js');
        const box = document.createElement('div'); box.className = 'perf-box'; document.querySelector('#main').appendChild(box);
        const list = []; const base = Date.UTC(2026, 9, 1);
        for (let i = 0; i < 12000; i++) { const d = new Date(base - i * 3.7e6); list.push({ id: 'p' + i, kind: 'photo', name: 'IMG_' + i + '.jpg', meta: { takenAt: d.toISOString().slice(0, 19) + 'Z', w: 1000 + (i % 7) * 120, h: 900 }, rev: { mime: 'image/jpeg' }, head: null }); }
        const grid = G.createGrid({});
        box.appendChild(grid.node);
        const t0 = performance.now(); grid.setGroups(G.groupByDay(list)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const t1 = performance.now();
        const tiles1 = grid.node.querySelectorAll('.jg-tile').length;
        window.scrollTo(0, grid.node.offsetTop + grid.node.offsetHeight / 2);
        const t2 = performance.now(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const t3 = performance.now();
        const tiles2 = grid.node.querySelectorAll('.jg-tile').length; const height = grid.node.offsetHeight;
        grid.destroy(); box.remove(); window.scrollTo(0, 0);
        return { layout: t1 - t0, scroll: t3 - t2, tiles1, tiles2, height };
    }""")
    check('virtual grid: 12 000 photos lay out fast (< 400 ms)', r['layout'] < 400, r)
    check('virtual grid: only a few hundred tiles in the DOM', 0 < r['tiles1'] < 400 and 0 < r['tiles2'] < 400 and r['height'] > 100000, r)
    check('virtual grid: jump-scroll renders in one frame budget (< 100 ms)', r['scroll'] < 100, r)

def t_photos():
    ctx, page = STATE['A']
    go(page, '#/fotos')
    photos = sorted(os.path.join(DATA, 'photos', f) for f in os.listdir(os.path.join(DATA, 'photos')))
    with page.expect_file_chooser() as fc:
        page.locator('.status-card button', has_text='Fotos sichern').click()
    fc.value.set_files(photos)
    wait_idle(page, 120000, started=True)
    n = len(photos)
    tiles = page.locator('.jg-tile').count()
    check('photo backup: every distinct photo/video is in the timeline (duplicate in the selection skipped)', tiles == n - 1, (tiles, n))
    rows = sql(f"select count(*)::int n from public.one_nodes where user_id = '{STATE['uid']}' and kind = 'photo' and not deleted")[0]['n']
    check('server: one photo node per distinct content', rows == n - 1, rows)
    thumbs = sql(f"select count(*)::int n from public.one_blobs where user_id = '{STATE['uid']}' and purpose = 'thumb' and status = 'live'")
    check('thumbnails were generated and uploaded encrypted', thumbs[0]['n'] >= n - 2, thumbs)
    heads = page.locator('.jg-head h3').all_inner_texts()
    months = page.locator('.jg-month').all_inner_texts()
    check('timeline grouped by month (newest first) from decrypted EXIF dates / file dates', months == ['Juli 2026', 'Mai 2026', 'März 2026', 'Januar 2026', 'Dezember 2025', 'November 2025'], months)
    check('day headers', any('14. Juli' in h for h in heads), heads)
    shot(page, 'phone_light_04_timeline')
    # backup status
    page.wait_for_timeout(1500)
    check('status card: last backup just now', 'Letzte Sicherung' in page.locator('.status-card').inner_text(), page.locator('.status-card').inner_text())
    dev = sql(f"select status, last_success_at is not null ok from public.one_backup_devices where user_id = '{STATE['uid']}'")
    check('backup.report: device reported success', len(dev) == 1 and dev[0]['ok'] in ('t', True), dev)
    # same selection again → everything skipped by the keyed hash
    with page.expect_file_chooser() as fc:
        page.locator('.status-card button', has_text='Fotos sichern').click()
    fc.value.set_files(photos)
    wait_idle(page, 60000, started=True)
    page.locator('button.up-btn').click()
    txt = dialog(page).inner_text()
    check('re-selecting the same photos uploads nothing (dedupe)', 'übersprungen' in txt and sql(f"select count(*)::int n from public.one_nodes where user_id = '{STATE['uid']}' and kind = 'photo' and not deleted")[0]['n'] == n - 1, txt[:300])
    shot(page, 'phone_light_05_uploads')
    dialog(page).get_by_role('button', name='Schließen').last.click()

def t_viewer():
    ctx, page = STATE['A']
    go(page, '#/fotos')
    order = tiles_in_order(page)
    check('timeline order: newest capture first (DOM order = visual order)', order[0].endswith('IMG_0002.jpg') and order[1].endswith('IMG_0001.jpg') and page.locator('.jg-tile').first.get_attribute('aria-label') == order[0], order[:4])
    page.locator('.jg-tile').first.click()
    page.wait_for_selector('.viewer .vw-img:not(.blur)', timeout=20000)
    page.wait_for_timeout(500)
    first = page.locator('.vw-title').inner_text()
    check('viewer opens the newest photo first', first == 'IMG_0002.jpg', first)
    page.get_by_role('button', name='Informationen').click()
    info = page.locator('.vw-info').inner_text()
    shot(page, 'phone_light_14_viewer_info')
    page.get_by_role('button', name='Informationen').click()
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(800)
    t2 = page.locator('.vw-title').inner_text()
    check('arrow / swipe goes to the next photo', t2 == 'IMG_0001.jpg', t2)
    page.get_by_role('button', name='Informationen').click()
    info = page.locator('.vw-info').inner_text()
    check('info panel: date, camera, place as coordinates', 'Canon EOS R6' in info and '54.12340° N, 7.89120° E' in info and '14. Juli 2026' in info, info)
    page.get_by_role('button', name='Informationen').click()
    # swipe with touch
    box = page.locator('.vw-stage').bounding_box()
    page.mouse.move(box['x'] + box['width'] * 0.8, box['y'] + box['height'] / 2)
    page.evaluate("""() => { const s = document.querySelector('.vw-stage'); const ev = (t, x) => s.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', clientX: x, clientY: 400, bubbles: true })); ev('pointerdown', 300); ev('pointerup', 80); }""")
    page.wait_for_timeout(800)
    check('swipe left → next', page.locator('.vw-count').inner_text().startswith('3 /'), page.locator('.vw-count').inner_text())
    shot(page, 'phone_light_15_viewer')
    page.locator('.vw-fav').click()
    page.wait_for_timeout(1200)
    page.keyboard.press('Escape')
    go(page, '#/fotos/favoriten')
    page.wait_for_timeout(800)
    check('favourite shows in Favoriten', page.locator('.jg-tile').count() == 1)
    # video plays from a blob URL
    go(page, '#/fotos')
    page.locator('.jg-tile.k-video').first.click()
    page.wait_for_selector('.viewer video', timeout=20000)
    src = page.locator('.viewer video').get_attribute('src')
    check('video is decrypted into a blob: URL', src and src.startswith('blob:'))
    page.wait_for_function("() => document.querySelector('.viewer video').readyState >= 1", timeout=15000)
    check('video metadata loads (playable)', page.evaluate("document.querySelector('.viewer video').duration") > 1.5)
    page.keyboard.press('Escape')
    # HEIC: original stored, honest message
    page.locator('.jg-tile', has=page.locator('xpath=.')).filter(has_text='').first.wait_for()
    heic = page.locator('.jg-tile[aria-label*="IMG_9999.HEIC"]')
    check('HEIC original is in the timeline', heic.count() == 1)
    heic.click()
    page.wait_for_timeout(1500)
    check('HEIC without browser support: honest message + download', 'HEIC' in page.locator('.viewer').inner_text(), page.locator('.viewer').inner_text()[:300])
    page.keyboard.press('Escape')

def t_albums_dups():
    ctx, page = STATE['A']
    go(page, '#/fotos')
    page.get_by_role('button', name='Auswählen').click()
    page.wait_for_timeout(200)
    check('selection bar shows no stray text', 'null' not in page.locator('.selbar').inner_text(), page.locator('.selbar').inner_text())
    page.locator('.jg-tile').nth(0).click()
    page.locator('.jg-tile').nth(1).click()
    check('selection bar counts', '2 ausgewählt' in page.locator('.selbar').inner_text())
    shot(page, 'phone_light_16_selection')
    page.locator('.selbar button', has_text='Zu Album').click()
    page.locator('dialog.sheet .menu-item', has_text='Neues Album').click()
    d = dialog(page)
    d.locator('input').fill('Sommer')
    d.get_by_role('button', name='Erstellen').click()
    page.wait_for_timeout(1500)
    go(page, '#/fotos/alben')
    page.wait_for_timeout(600)
    card = page.locator('.album-card', has_text='Sommer')
    check('album created with 2 photos', card.count() == 1 and '2 Elemente' in card.inner_text(), card.inner_text() if card.count() else '')
    shot(page, 'phone_light_17_albums')
    card.click()
    page.wait_for_timeout(800)
    check('album view shows its photos', page.locator('.jg-tile').count() == 2)
    page.locator('#main').get_by_role('button', name='Weitere Aktionen').click()
    page.locator('dialog.sheet .menu-item', has_text='Album umbenennen').click()
    d = dialog(page); d.locator('input').fill('Sommer 2026'); d.get_by_role('button', name='Speichern').click()
    page.wait_for_timeout(1000)
    check('album renamed', 'Sommer 2026' in page.locator('.view-title').inner_text())
    names = sql(f"select count(*)::int n from public.one_albums where user_id = '{STATE['uid']}' and not deleted")
    check('server: album exists (name encrypted)', names[0]['n'] == 1)
    # duplicates: the same photo uploaded again into Drive as a file
    go(page, '#/drive')
    with page.expect_file_chooser() as fc:
        page.locator('.fab').click()
        page.locator('dialog.sheet .menu-item', has_text='Dateien hochladen').click()
    fc.value.set_files(os.path.join(DATA, 'photos', 'IMG_0005.jpg'))
    wait_idle(page, started=True)
    go(page, '#/fotos/duplikate')
    page.wait_for_timeout(800)
    groups = page.locator('.dup-group').count()
    check('duplicate finder: same content in Fotos and Drive is one group', groups == 1, page.locator('.dups').inner_text()[:300])
    shot(page, 'phone_light_18_duplicates')
    page.locator('.dup-group button', has_text='Kopie entfernen').click()
    page.wait_for_timeout(1500)
    check('cleaning up keeps the oldest copy', page.locator('.dup-group').count() == 0)

def t_takeout():
    ctx, page = STATE['A']
    go(page, '#/fotos')
    page.locator('#main').get_by_role('button', name='Weitere Aktionen').click()
    with page.expect_file_chooser() as fc:
        page.locator('dialog.sheet .menu-item', has_text='Google Takeout').click()
    fc.value.set_files(os.path.join(DATA, 'takeout', 'takeout-20260101.zip'))
    d = page.locator('dialog.dlg[open]', has=page.get_by_role('button', name='Importieren', exact=True))
    d.wait_for(timeout=20000)
    txt = d.inner_text()
    check('Takeout scan: 3 photos found (2 + album copy), 1 album, sidecars matched', '3 Fotos' in txt and '1 Album' in txt and '3 mit Google-Metadaten' in txt, txt)
    d.get_by_role('button', name='Importieren').click()
    wait_idle(page, 60000, started=True)
    page.wait_for_timeout(1500)
    months = page.locator('.jg-month').all_inner_texts()
    check('Takeout: capture dates from the JSON sidecars (Mai 2019, Juni 2018)', 'Mai 2019' in months and 'Juni 2018' in months, months)
    go(page, '#/fotos/alben')
    try: page.locator('.album-card', has_text='Urlaub Ostsee').filter(has_text='1 Element').wait_for(timeout=15000)
    except Exception: pass
    page.wait_for_timeout(800)
    card = page.locator('.album-card', has_text='Urlaub Ostsee')
    check('Takeout: album folder became an album with the (deduplicated) photo', card.count() == 1 and '1 Element' in card.inner_text(), page.locator('.album-grid').inner_text())
    go(page, '#/fotos/favoriten')
    page.wait_for_timeout(600)
    favs = page.locator('.jg-tile').all()
    check('Takeout: "favorited" carried over', any('IMG_T1.jpg' in (t.get_attribute('aria-label') or '') for t in favs), [t.get_attribute('aria-label') for t in favs])

def t_share():
    ctx, page = STATE['A']
    H('/__one/share-reset')
    go(page, '#/drive')
    page.locator('.row', has_text='Projekt').locator('.row-open').click()
    page.wait_for_timeout(400)
    menu(page, 'Notizen-neu.txt', 'Link teilen')
    dialog(page).get_by_role('button', name='Link erstellen').click()
    done = page.locator('dialog.dlg[open]', has_text='Dein Link ist fertig')
    done.wait_for(timeout=30000)
    url = done.locator('input').input_value()
    check('share link: fragment carries the key, points to FaLe PDF', '#/s/' in url and '#k=' in url, url)
    shot(page, 'phone_light_19_share_link')
    done.get_by_role('button', name='Fertig').click()
    st = H('/__one/share-state')
    check('share server got only ciphertext (no name, no marker)', st['objects'] and all('Notizen' not in json.dumps(o) for o in st['objects']) and all(MARK not in l['body'] and 'Notizen' not in l['body'] for l in st['log']))
    # round trip: open the link in FaLe PDF (served by the same backend) and download
    c2 = B.new_context(accept_downloads=True)
    p2 = c2.new_page(); attach(p2, 'pdf-receiver')
    p2.goto(url)
    p2.wait_for_selector('text=Notizen-neu.txt', timeout=30000)
    with p2.expect_download() as dl:
        p2.locator('[data-dl]').click()
    got = open(dl.value.path(), encoding='utf-8').read()
    check('share link round trip: FaLe PDF decrypts the same file', 'geheime Notiz' in got, got[:80])
    c2.close()

def t_device_b():
    ctx, page = device(P, B, 'B-desktop', phone=False)
    STATE['B'] = (ctx, page)
    signup(page)
    page.wait_for_selector('text=FaLe One entsperren', timeout=20000)
    page.fill('#g-pw', 'falsches-passwort-123')
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('.form-error:visible', timeout=40000)
    check('unlock: wrong password is rejected', 'falsch' in page.locator('.form-error').inner_text())
    page.fill('#g-pw', PW)
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('.app', timeout=40000)
    wait_idle(page)
    go(page, '#/drive')
    page.wait_for_timeout(800)
    names = page.locator('.row-name').all_inner_texts()
    check('device B decrypts the same tree', 'Projekt' in names and 'big.bin' in names and 'Fotos' in names, names)
    go(page, '#/fotos')
    page.wait_for_timeout(1500)
    check('device B: timeline with thumbnails', page.locator('.jg-tile.loaded').count() >= 6, page.locator('.jg-tile.loaded').count())
    shot(page, 'desktop_light_01_timeline')
    go(page, '#/drive')
    page.locator('.row', has_text='Projekt').locator('.row-open').click()
    page.wait_for_timeout(600)
    shot(page, 'desktop_light_02_drive')
    # drag & drop upload (desktop)
    page.evaluate("""() => { const dt = new DataTransfer(); dt.items.add(new File(['abgelegt ' + 'GEHEIM-ONE-4711'], 'Abgelegt.txt', { type: 'text/plain' }));
        for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); }""")
    wait_idle(page, started=True)
    check('drag & drop upload into the open folder', page.locator('.row', has_text='Abgelegt.txt').count() == 1)
    # "In FaLe PDF öffnen" on desktop: decrypted download + FaLe PDF in a new tab (no cross-origin hand-off possible)
    page.locator('.row', has_text='Unterordner').locator('.row-open').click()
    page.wait_for_timeout(500)
    menu(page, 'Bericht.pdf', 'In FaLe PDF öffnen')
    d = page.locator('dialog.dlg[open]', has_text='In FaLe PDF öffnen')
    with page.expect_download() as dl, ctx.expect_page() as newp:
        d.get_by_role('button', name='Herunterladen und öffnen').click()
    pdf = open(dl.value.path(), 'rb').read()
    check('open in FaLe PDF: the decrypted PDF is handed over as a download', pdf.startswith(b'%PDF'))
    check('open in FaLe PDF: FaLe PDF opens in a new tab', newp.value.url.startswith(API), newp.value.url)
    newp.value.close()
    shot(page, 'desktop_light_03_subfolder')
    page.locator('.row', has_text='Bericht.pdf').locator('.row-open').click()
    page.wait_for_selector('.viewer .pdf-page canvas', timeout=20000)
    page.wait_for_timeout(800)
    shot(page, 'desktop_light_04_pdf')
    page.keyboard.press('Escape')
    # device C: recovery key
    c3, p3 = device(P, B, 'C-phone')
    signup(p3)
    p3.wait_for_selector('text=FaLe One entsperren', timeout=20000)
    p3.get_by_role('button', name=re.compile('Wiederherstellungsschlüssel verwenden')).click()
    p3.fill('#g-rk', STATE['rk'].lower().replace('-', ' '))
    p3.locator('form.gate-form button[type=submit]').click()
    p3.wait_for_selector('.app', timeout=40000)
    wait_idle(p3)
    check('device C unlocks with the recovery key', p3.locator('.jg-tile').count() >= 6)
    c3.close()

def t_search_settings():
    ctx, page = STATE['A']
    go(page, '#/suche?q=notiz')
    page.wait_for_timeout(800)
    check('search finds decrypted names (client-side)', page.locator('.row', has_text='Notizen-neu.txt').count() == 1)
    go(page, '#/suche?q=pixel')
    page.wait_for_timeout(500)
    check('search by camera model', page.locator('.row', has_text='IMG_0004.jpg').count() == 1)
    shot(page, 'phone_light_20_search')
    go(page, '#/einstellungen')
    page.wait_for_timeout(1500)
    txt = page.locator('.settings').inner_text()
    check('settings: account, storage, backup devices, sign-ins', EMAIL in txt and 'Dateien und Fotos' in txt and 'dieses Gerät' in txt, txt[:300])
    check('settings: honest list of what the server sees', 'Was der Server sieht' in txt and 'Dateinamen' in txt)
    shot(page, 'phone_light_21_settings')
    # change the Sync-Passwort and unlock with the new one later
    page.get_by_role('button', name='Sync-Passwort ändern').click()
    d = dialog(page)
    d.locator('#sd-cur').fill(PW); d.locator('#sd-n1').fill(PW + '-neu'); d.locator('#sd-n2').fill(PW + '-neu')
    d.get_by_role('button', name='Weiter').click()
    page.wait_for_selector('text=Sync-Passwort geändert', timeout=40000)
    check('Sync-Passwort changed', True)
    STATE['pw'] = PW + '-neu'
    page.get_by_role('button', name='Wiederherstellungs-Kit neu erstellen').click()
    d = dialog(page)
    d.locator('#sd-cur').fill(STATE['pw'])
    d.get_by_role('button', name='Weiter').click()
    nd = page.locator('dialog.dlg[open]', has_text='Dein neuer Wiederherstellungsschlüssel')
    nd.wait_for(timeout=40000)
    rk2 = '-'.join(nd.locator('.rk span').all_inner_texts())
    check('new recovery kit after re-auth (the old key is replaced)', re.fullmatch(r'([0-9A-Z]{4}-){13}[0-9A-Z]{4}', rk2) is not None and rk2 != STATE['rk'], rk2)
    nd.locator('label.check input').check()
    nd.get_by_role('button', name='Fertig').click()
    page.get_by_role('button', name='Dunkel', exact=True).click()
    check('theme switch: dark', page.evaluate("document.documentElement.dataset.theme") == 'dark')
    shot(page, 'phone_dark_09_settings_de')
    page.get_by_role('button', name='Wie System').click()
    check('theme switch: back to system', page.evaluate("document.documentElement.dataset.theme") is None)

def t_quota_backup_warn():
    ctx, page = STATE['A']
    uid = STATE['uid']
    used = int(sql(f"select (private.fale_one_usage('{uid}') ->> 'total')::bigint t")[0]['t'])
    sql(f"insert into public.one_accounts (user_id, quota_bytes) values ('{uid}', {int(used / 0.85)}) on conflict (user_id) do update set quota_bytes = excluded.quota_bytes")
    sql(f"update public.one_backup_devices set last_success_at = now() - interval '4 days', created_at = now() - interval '5 days' where user_id = '{uid}'")
    page.reload(); page.wait_for_selector('.app'); wait_idle(page)
    page.wait_for_timeout(1500)
    n = page.locator('.notices').inner_text()
    check('quota ≥ 80 %: one calm notice', 'zu 8' in n and '%' in n, n)
    check('backup stale > 3 days: warning', 'letzte erfolgreiche Sicherung' in n, n)
    shot(page, 'phone_light_22_warnings')
    sql(f"update public.one_accounts set quota_bytes = {used - 1000} where user_id = '{uid}'")
    page.reload(); page.wait_for_selector('.app'); wait_idle(page)
    page.wait_for_timeout(1200)
    n = page.locator('.notices').inner_text()
    check('quota 100 %: read-only notice, nothing deleted', 'Speicher voll' in n and 'Gelöscht wird nichts' in n, n)
    go(page, '#/drive')
    with page.expect_file_chooser() as fc:
        page.locator('.fab').click(); page.locator('dialog.sheet .menu-item', has_text='Dateien hochladen').click()
    fc.value.set_files(os.path.join(DATA, 'Notizen-v2.txt'))
    page.wait_for_timeout(1200)
    check('upload while full is refused with the calm message', page.locator('.toast', has_text='Speicher ist voll').count() >= 1)
    page.locator('.row', has_text='Projekt').locator('.row-open').click()
    page.wait_for_timeout(400)
    page.locator('.row', has_text='Notizen-neu.txt').locator('.row-open').click()
    page.wait_for_selector('.viewer .vw-text')
    check('read-only: everything stays readable', 'geheime Notiz' in page.locator('.vw-text').inner_text())
    page.keyboard.press('Escape')
    sql(f"update public.one_accounts set quota_bytes = null where user_id = '{uid}'")
    page.reload(); page.wait_for_selector('.app'); wait_idle(page)

def t_export():
    ctx, page = STATE['A']
    page.evaluate("delete window.showDirectoryPicker")  # ZIP mode (headless has no directory picker UI)
    go(page, '#/einstellungen')
    page.get_by_role('button', name='Alles exportieren').click()
    d = dialog(page)
    d.locator('label.check', has_text='ältere Versionen').locator('input').check()
    with page.expect_download(timeout=120000) as dl:
        d.get_by_role('button', name='Export starten').click()
    path = dl.value.path()
    z = zipfile.ZipFile(path)
    names = z.namelist()
    man = json.loads(z.read('manifest.json'))
    check('export: ZIP with manifest, folders and files', 'Projekt/Notizen-neu.txt' in names and 'Projekt/Unterordner/Bericht.pdf' in names and 'big.bin' in names, names[:20])
    check('export: content decrypted (marker readable)', MARK in z.read('Projekt/Notizen-neu.txt').decode())
    check('export: older versions included', any(n.startswith('Ältere Versionen/') for n in names), [n for n in names if 'Versionen' in n])
    side = [n for n in names if n.endswith('IMG_0001.jpg.json')]
    meta = json.loads(z.read(side[0])) if side else {}
    check('export: photo sidecar JSON with date, GPS, camera', meta.get('takenAt', '').startswith('2026-07-14T10:22') and meta.get('gps', {}).get('lat') == 54.1234 and meta.get('exif', {}).get('model') == 'Canon EOS R6', meta)
    check('export: albums listed', any(a['name'] == 'Sommer 2026' and len(a['items']) == 2 for a in man['albums']) and any(n.startswith('Alben/') for n in names), man['albums'])
    orig = open(os.path.join(DATA, 'photos', 'IMG_0001.jpg'), 'rb').read()
    inzip = [n for n in names if n.endswith('/IMG_0001.jpg')]
    check('export: originals are bit-identical (EXIF untouched)', inzip and sha(z.read(inzip[0])) == sha(orig))
    zi = z.getinfo('Projekt/Notizen-neu.txt')
    check('export: file dates preserved', zi.date_time[0] >= 2026)
    shutil.copy(path, os.path.join(DL, 'export.zip'))

def t_crypto():
    uid = STATE['uid']
    tables = ['one_nodes', 'one_revisions', 'one_blobs', 'one_albums', 'one_album_items', 'one_backup_devices', 'one_accounts']
    dump = ''
    for tb in tables:
        rows = sql(f"select coalesce(string_agg(t::text, E'\\n'), '') d from public.{tb} t")
        dump += rows[0]['d']
    needles = ['Notizen', 'Projekt', 'Unterordner', 'Bericht', 'IMG_0001', 'Sommer', 'Urlaub', 'Canon', 'Pixel 8', '54.1234', '7.8912', '2026:07:14', '2026-07-14', 'image/jpeg', 'text/plain', MARK, 'Kieler', 'FaLe One ·']
    hits = [n for n in needles if n in dump]
    check('DB: no plaintext names, EXIF, GPS, MIME types or device names in any one_* table', not hits and len(dump) > 1000, hits)
    for n in [MARK, 'Canon EOS R6', 'Notizen-neu.txt', 'JFIF', 'Exif']:
        c = sql(f"select count(*)::int n from public.one_chunks where position(convert_to('{n}', 'UTF8') in data) > 0")[0]['n']
        check(f'DB chunks: "{n}" never appears in stored bytes', c == 0, c)
    wrapped = sql(f"select count(*)::int n from public.one_nodes where user_id = '{uid}' and not deleted and (length(key) < 80 or meta !~ '^[A-Za-z0-9_-]+$')")[0]['n']
    check('DB: every node carries a wrapped key + opaque envelope', wrapped == 0)

def t_a11y_layout():
    ctx, page = STATE['A']
    page.set_viewport_size({'width': 360, 'height': 780})
    for h in ['#/fotos', '#/fotos/alben', '#/fotos/duplikate', '#/drive', '#/drive/papierkorb', '#/drive/offline', '#/suche?q=img', '#/einstellungen']:
        go(page, h); page.wait_for_timeout(500)
        sw = page.evaluate('document.scrollingElement.scrollWidth')
        check(f'no horizontal scroll at 360 px: {h}', sw <= 360, sw)
    go(page, '#/fotos'); page.locator('.jg-tile').first.click(); page.wait_for_timeout(1200)
    check('no horizontal scroll at 360 px: viewer', page.evaluate('document.scrollingElement.scrollWidth') <= 360)
    page.keyboard.press('Escape')
    page.set_viewport_size({'width': 390, 'height': 844})
    for h in ['#/fotos', '#/drive', '#/einstellungen']:
        go(page, h); page.wait_for_timeout(600)
        bad = page.evaluate("""() => [...document.querySelectorAll('button, a[href], input, [role=button]')].filter(e => e.offsetParent !== null).filter(e => {
            const n = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.getAttribute('placeholder') || '').trim();
            return !n; }).map(e => e.outerHTML.slice(0, 120))""")
        check(f'a11y: every control has an accessible name ({h})', not bad, bad[:5])
        junk = re.findall(r'\bnull\b|\bundefined\b|NaN|\{[a-z]+\}', page.locator('body').inner_text())
        check(f'no "null"/"undefined"/unfilled placeholders on screen ({h})', not junk, junk[:5])
        imgs = page.evaluate("[...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length")
        check(f'a11y: images have alt ({h})', imgs == 0, imgs)
    check('a11y: lang, main and nav landmarks', page.evaluate("document.documentElement.lang") == 'de' and page.locator('main').count() == 1 and page.locator('nav').count() >= 1)
    small = page.evaluate("""() => [...document.querySelectorAll('.bnav-item, .icon-btn, .btn')].filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect()).filter(r => r.height < 36 || r.width < 36).length""")
    check('a11y: touch targets ≥ 36 px', small == 0, small)
    # keyboard: skip link + focus visible
    page.reload(); page.wait_for_selector('.app'); page.wait_for_timeout(800)
    page.keyboard.press('Tab')
    check('a11y: first Tab reaches the skip link', page.evaluate("document.activeElement && document.activeElement.className") == 'skip')

def t_english_dark():
    ctx, page = device(P, B, 'D-en-dark', lang='en', dark=True)
    signup(page)
    page.wait_for_selector('text=Unlock FaLe One', timeout=20000)
    page.fill('#g-pw', STATE.get('pw', PW))
    shot(page, 'phone_dark_01_unlock_en')
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('.app', timeout=40000)
    wait_idle(page)
    page.wait_for_timeout(1500)
    txt = page.locator('body').inner_text()
    check('English UI', 'Photos' in txt and 'Timeline' in txt and 'Back up photos' in txt, txt[:300])
    check('English dates', 'July 2026' in page.locator('.jg-month').all_inner_texts(), page.locator('.jg-month').all_inner_texts())
    shot(page, 'phone_dark_02_timeline')
    go(page, '#/drive'); page.wait_for_timeout(800)
    shot(page, 'phone_dark_03_drive')
    go(page, '#/einstellungen'); page.wait_for_timeout(1200)
    txt = page.locator('.settings').inner_text()
    check('English settings', 'What the server sees' in txt and 'Delete account' in txt, txt[:200])
    shot(page, 'phone_dark_04_settings')
    go(page, '#/fotos'); page.locator('.jg-tile').first.click(); page.wait_for_selector('.viewer .vw-img:not(.blur)')
    shot(page, 'phone_dark_05_viewer')
    page.keyboard.press('Escape')
    go(page, '#/fotos/alben'); page.wait_for_timeout(800); shot(page, 'phone_dark_06_albums')
    # German dark screenshots too
    page.evaluate("localStorage.setItem('fale-one-lang','de')"); page.reload(); page.wait_for_selector('.app'); wait_idle(page)
    go(page, '#/fotos'); page.wait_for_timeout(1200); shot(page, 'phone_dark_07_timeline_de')
    page.locator('button.up-btn').click(); page.wait_for_timeout(500); shot(page, 'phone_dark_08_uploads_de')
    ctx.close()

def t_signout_delete():
    ctx, page = STATE['A']
    go(page, '#/einstellungen')
    page.get_by_role('button', name='Konto löschen …').click()
    dialog(page).get_by_role('button', name='Ohne Export weiter').click()
    d = page.locator('dialog.dlg[open]', has_text='Gib LÖSCHEN ein')
    d.locator('input').fill('LÖSCHEN')
    d.get_by_role('button', name='Endgültig löschen').click()
    page.wait_for_selector('text=Konto gelöscht', timeout=30000)
    left = sql(f"select (select count(*) from public.one_nodes where user_id = '{STATE['uid']}') + (select count(*) from public.one_chunks where user_id = '{STATE['uid']}') n")[0]['n']
    check('account deletion removes every FaLe One row', int(left) == 0, left)
    idb = page.evaluate("new Promise(r => { const q = indexedDB.open('fale-one'); q.onsuccess = () => { const db = q.result; const t = db.transaction('kv'); const s = t.objectStore('kv').count(); s.onsuccess = () => r(s.result); }; })")
    check('this device keeps nothing (IndexedDB wiped)', idb == 0, idb)

with sync_playwright() as P:
    B = P.chromium.launch()
    step('static checks', t_static)
    step('signup + key setup', t_signup)
    step('drive: folder tree upload, grid, sort', t_drive_tree)
    step('previews: pdf + text', t_previews)
    step('rename / move / trash / restore / delete', t_rename_move_trash)
    step('versions', t_versions)
    step('resumable upload', t_resumable)
    step('offline', t_offline)
    step('share target', t_share_target)
    step('photos: backup + dedupe + timeline', t_photos)
    step('virtual grid performance', t_grid_perf)
    step('viewer', t_viewer)
    step('albums + duplicates', t_albums_dups)
    step('takeout import', t_takeout)
    step('share link', t_share)
    step('devices B + C', t_device_b)
    step('search + settings', t_search_settings)
    step('quota + backup warnings', t_quota_backup_warn)
    step('export', t_export)
    step('crypto: server sees no plaintext', t_crypto)
    step('a11y + layout', t_a11y_layout)
    step('english + dark', t_english_dark)
    step('delete account', t_signout_delete)
    B.close()

check('no console errors / CSP violations / page errors', not problems, problems[:12])
check('no requests to foreign origins', not foreign, foreign[:10])
ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
print(f'\n{ok}/{len(results)} passed')
for r in bad: print('  FAIL', r[0], str(r[2])[:300])
json.dump({'passed': ok, 'total': len(results), 'failed': [r[0] for r in bad]}, open(os.path.join(SP, 'results_regress.json'), 'w'), indent=1)
sys.exit(1 if bad else 0)

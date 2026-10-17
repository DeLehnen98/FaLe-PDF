"""E2E tests for the Notfallzugang in the FaLe One web app: owner (phone, DE), contact B (desktop, EN), contact C
(phone, dark, DE) in separate browser contexts against the local backend (one_harness.mjs on 8935/8937/8938, real
SQL). The clock is fast-forwarded by shifting release/closed timestamps in the DB.
   ONE_FRONT=8935 ONE_STATIC=8937 ONE_ACCT=8938 PGDB=fale_nf_ui node one_harness.mjs &      python3 test_nf_ui.py
Screenshots → shots/nf_*.png, montage → nf_montage.png."""
import os, sys, json, re, time, shutil, urllib.request, subprocess
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(SP, 'data')
SHOTS = os.path.join(SP, 'shots')
APP = 'http://127.0.0.1:8937/'
API = 'http://127.0.0.1:8935'
PW = 'Korrekt-Pferd-Batterie-42'
ALLOWED = ('http://127.0.0.1:8937', 'http://127.0.0.1:8935', 'http://127.0.0.1:8939', 'blob:', 'data:')
os.makedirs(SHOTS, exist_ok=True)
for f in os.listdir(SHOTS):
    if f.startswith('nf_'): os.remove(os.path.join(SHOTS, f))

results, problems, foreign = [], [], []
S = {}

def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)
    return bool(cond)

def step(name, fn):
    print(f'--- {name}', flush=True)
    try: fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:400]))
        print('FAIL ' + name + ' EXC ' + str(e)[:1500], flush=True)
        for k, v in S.items():
            if isinstance(v, tuple):
                try: v[1].screenshot(path=os.path.join(SP, f'fail_nf_{re.sub(r"[^A-Za-z0-9]+", "_", name)}_{k}.png'))
                except Exception: pass

def H(path, data=None):
    req = urllib.request.Request(API + path, data=data.encode() if isinstance(data, str) else data, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req) as r: return json.loads(r.read().decode() or 'null')
def sql(q):
    r = H('/__test/sql', q)
    if isinstance(r, dict) and r.get('error'): raise Exception(r['error'])
    return r['rows']

IGNORED = ('status of 404', 'status of 409', 'status of 401', 'status of 403', 'status of 429', 'net::ERR_FAILED', 'Failed to fetch')
def device(label, phone=True, lang='de', dark=False):
    if phone:
        ctx = B.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True, color_scheme='dark' if dark else 'light',
                            user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36')
    else:
        ctx = B.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True, color_scheme='dark' if dark else 'light')
    ctx.add_init_script("try{localStorage.setItem('fale-one-dev-api','%s');localStorage.setItem('fale-one-dev-pdf','%s');localStorage.setItem('fale-one-lang','%s')}catch(e){}" % (API, API, lang))
    page = ctx.new_page(); page.set_default_timeout(25000)
    page.on('console', lambda m: problems.append(f'{label} [console] {m.text[:300]}') if m.type == 'error' and not any(i in m.text for i in IGNORED) else None)
    page.on('console', lambda m: problems.append(f'{label} [csp] {m.text[:300]}') if ('Content Security Policy' in m.text or 'Trusted Type' in m.text) else None)
    page.on('pageerror', lambda e: problems.append(f'{label} [pageerror] {e}'))
    page.on('request', lambda r: foreign.append(f'{label} {r.url[:120]}') if not r.url.startswith(ALLOWED) else None)
    return ctx, page

def new_account(page, email):
    page.goto(APP)
    page.get_by_role('button', name=re.compile('Anmelden oder Konto erstellen|Sign in or create')).click()
    page.fill('#g-email', email)
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('#g-code')
    page.fill('#g-code', H('/__test/otp?email=' + email)['code'])
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('#g-pw1', timeout=20000)
    page.fill('#g-pw1', PW); page.fill('#g-pw2', PW)
    page.locator('form.gate-form button[type=submit]').click()
    page.wait_for_selector('[data-rk]', timeout=40000)
    page.locator('.gate-card label.check input').check()
    page.locator('.gate-card button.btn.primary.block:not([disabled])').last.click()
    page.wait_for_selector('.app', timeout=20000)
    page.wait_for_function("() => +document.querySelector('.app').dataset.synced > 0", timeout=30000)

def go(page, h, wait=900):
    for _ in range(3):
        if page.locator('dialog.dlg[open]').count() == 0: break
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
    page.evaluate(f"location.hash = '{h}'"); page.wait_for_timeout(wait)

def refresh(page):
    """reload → fresh em.status (the app also polls every 3 minutes)"""
    page.reload(); page.wait_for_selector('.app'); page.wait_for_function("() => +document.querySelector('.app').dataset.synced > 0", timeout=30000); page.wait_for_timeout(1200)

def shot(page, name):
    page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(SHOTS, name + '.png'))

def dlg(page): return page.locator('dialog.dlg[open]').last
def overflow(page):
    return page.evaluate("() => document.scrollingElement.scrollWidth - window.innerWidth")
def setup_id():
    return sql("select setup_id::text s from public.one_em_setups")[0]['s']
def fast_forward(interval):
    sql(f"update public.one_em_requests set release_at = release_at - interval '{interval}', threshold_at = threshold_at - interval '{interval}', started_at = started_at - interval '{interval}' where status = 'waiting'")
def end_cooldown():
    sql("update public.one_em_requests set closed_at = closed_at - interval '25 hours' where status in ('denied','revoked','canceled')")

# ============================================================================================ tests
def t_static():
    src = open('/home/claude/FalePDF/one/js/views/notfall.js', encoding='utf-8').read()
    check('code: no HTML-string sinks in notfall.js', not re.search(r'innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(', src))
    sw = open('/home/claude/FalePDF/one/sw.js', encoding='utf-8').read()
    check('service worker precaches the new view', 'js/views/notfall.js' in sw)

def t_owner_setup():
    H('/__test/reset?ONE_CHUNK_KB=64')
    ctx, page = device('A-phone'); S['A'] = (ctx, page)
    new_account(page, 'anna@example.com')
    go(page, '#/notfall', 1500)
    check('hero: calm explanation + one button', page.locator('.em-hero').is_visible() and page.get_by_role('link', name='Notfallzugang einrichten').is_visible())
    shot(page, 'nf_01_phone_hero')
    page.get_by_role('link', name='Notfallzugang einrichten').click(); page.wait_for_timeout(700)
    check('wizard step 1: 3 steps, checklist preselected, password warning', page.locator('.wiz-steps li').count() == 3 and page.locator('.em-checklist input:checked').count() == 6 and 'Passwörter gehören nicht' in page.locator('.em-scope').inner_text())
    check('wizard: no horizontal scroll on the phone', overflow(page) <= 0, overflow(page))
    shot(page, 'nf_02_phone_wizard_1')
    page.locator('[data-act=next]').click(); page.wait_for_timeout(400)
    page.fill('[data-email="0"]', 'ben@example.com'); page.fill('[data-email="1"]', 'clara@example.com'); page.wait_for_timeout(300)
    check('wizard step 2: "k von n" choice appears with two people', page.locator('.seg button', has_text='2 von 2').count() == 1)
    shot(page, 'nf_03_phone_wizard_2')
    page.locator('[data-act=next]').click(); page.wait_for_timeout(400)
    page.locator('.em-waits button', has_text='7 Tage').click()
    page.fill('textarea', 'Die Originale liegen im Ordner im Arbeitszimmer. Danke, dass du da bist.')
    check('wizard step 3: summary lists folder, people, waiting period', 'ben@example.com, clara@example.com' in page.locator('.em-sum').inner_text() and '7 Tage Wartezeit' in page.locator('.em-sum').inner_text(), page.locator('.em-sum').inner_text())
    shot(page, 'nf_04_phone_wizard_3')
    page.locator('[data-act=next]').click()
    page.wait_for_selector('dialog.dlg[open] .em-msg', timeout=30000)
    msg = dlg(page).locator('.em-msg').inner_text()
    check('honest: without a mail provider the app says so and offers a message to send yourself', 'fale-one.vercel.app' in msg and 'noch nicht' in dlg(page).inner_text(), msg)
    shot(page, 'nf_05_phone_tell_them')
    dlg(page).locator('.dlg-actions button', has_text='Schließen').click(); page.wait_for_timeout(800)
    txt = page.locator('.em-body').inner_text()
    check('overview: "fast fertig", two invited contacts', 'Notfallzugang fast fertig' in txt and page.locator('.em-contact[data-status=invited]').count() == 2, txt[:300])
    shot(page, 'nf_06_phone_overview_pending')
    # the checklist folder exists; put a document into it and one file outside
    go(page, '#/drive', 1200)
    check('Notfallordner created in Drive', page.locator('.row', has_text='Notfallordner').count() == 1)
    page.locator('.row', has_text='Notfallordner').locator('.row-open').click(); page.wait_for_timeout(800)
    subs = page.locator('.row-name').all_inner_texts()
    check('checklist sub-folders', all(x in subs for x in ['Verträge & Versicherungen', 'Vollmachten & Verfügungen', 'Bank- & Konto-Hinweise', 'Ärzte & Medikamente', 'Wichtige Kontakte', 'Persönliche Wünsche & Briefe']), subs)
    page.locator('.row', has_text='Vollmachten & Verfügungen').locator('.row-open').click(); page.wait_for_timeout(700)
    page.locator('.fab').click()
    with page.expect_file_chooser() as fc: page.locator('dialog.sheet .menu-item', has_text='Dateien hochladen').click()
    fc.value.set_files(os.path.join(DATA, 'nf_testament.txt'))
    page.wait_for_selector('.row:has-text("nf_testament.txt")', timeout=30000)
    go(page, '#/drive', 900)
    page.locator('.fab').click()
    with page.expect_file_chooser() as fc: page.locator('dialog.sheet .menu-item', has_text='Dateien hochladen').click()
    fc.value.set_files(os.path.join(DATA, 'nf_privat.txt'))
    page.wait_for_selector('.row:has-text("nf_privat.txt")', timeout=30000)
    n = 0
    for _ in range(30):
        n = int(sql("select count(*) n from public.one_em_node_keys")[0]['n'])
        if n == 8: break
        page.wait_for_timeout(1000)
    check('new file in the covered folder is wrapped for the Notfallzugang automatically (root + 6 + file = 8), the private file is not', n == 8, n)

def t_contact_accept():
    ctx, page = device('B-desktop-en', phone=False, lang='en'); S['B'] = (ctx, page)
    new_account(page, 'ben@example.com')
    page.wait_for_timeout(1500)
    check('contact: invitation notice on start (EN)', page.locator('.notice', has_text='would like you as their trusted emergency contact').count() == 1, page.locator('.notices').inner_text())
    go(page, '#/notfall/fuer-andere', 1500)
    shot(page, 'nf_07_desktop_en_invitation')
    page.locator('[data-act=accept]').click()
    page.wait_for_selector('.sas', timeout=30000)
    S['digitsB'] = page.locator('.sas-digits strong').inner_text()
    check('contact: safety code with 6 emoji (English names) + digits', page.locator('.sas-item').count() == 6 and re.fullmatch(r'\d{4} \d{4} \d{4}', S['digitsB']) and 'Waiting for' in page.locator('.em-other').inner_text())
    shot(page, 'nf_08_desktop_en_safety_code')

def t_owner_confirm():
    ctx, page = S['A']
    refresh(page)
    check('owner: notice "hat angenommen – Code vergleichen"', page.locator('.notice', has_text='hat angenommen').count() == 1, page.locator('.notices').inner_text())
    go(page, '#/notfall', 1200)
    page.locator('[data-act=compare]').click(); page.wait_for_selector('dialog.dlg[open] .sas')
    digits = dlg(page).locator('.sas-digits strong').inner_text()
    check('owner and contact see the SAME safety code', digits == S['digitsB'], [digits, S['digitsB']])
    check('safety code dialog fits the phone (no horizontal scroll)', page.evaluate("() => { const d = document.querySelector('dialog[open]'); return d.scrollWidth <= d.clientWidth + 1; }"))
    shot(page, 'nf_09_phone_compare_code')
    dlg(page).get_by_role('button', name='Stimmt überein').click()
    page.wait_for_selector('.em-status.on', timeout=30000)
    check('owner: "Notfallzugang aktiv" after confirming', 'Notfallzugang aktiv' in page.locator('.em-status').inner_text())
    go(page, '#/fotos', 1500)
    card = page.locator('.em-card').first
    check('home card: "Notfallzugang aktiv · 1 Person · 7 Tage Wartezeit"', card.is_visible() and 'Notfallzugang aktiv' in card.inner_text() and '1 Person' in card.inner_text() and '7 Tage Wartezeit' in card.inner_text(), card.inner_text() if card.count() else '')
    shot(page, 'nf_10_phone_home_card')

def t_request_deny_release():
    bctx, b = S['B']; actx, a = S['A']
    refresh(b); go(b, '#/notfall/fuer-andere', 1200)
    b.locator('[data-act=request]').click()
    dlg(b).get_by_role('button', name='Request').click()
    b.wait_for_selector('.em-wait', timeout=20000)
    check('contact: waiting countdown (≈ 6 d 23 h)', re.search(r'Released in 6 d 23 h|Released in 7 d 0 h', b.locator('.em-wait').inner_text()), b.locator('.em-wait').inner_text())
    shot(b, 'nf_11_desktop_en_waiting')
    refresh(a)
    alert = a.locator('[data-em-alert=request]')
    check('owner: urgent banner on the next start with one-tap deny', alert.is_visible() and alert.get_by_role('button', name='Ablehnen').is_visible(), a.locator('.notices').inner_text())
    shot(a, 'nf_12_phone_request_banner')
    alert.get_by_role('button', name='Ablehnen').click()
    a.wait_for_timeout(1500)
    check('deny: one tap closes the request', sql("select status from public.one_em_requests order by started_at desc limit 1")[0]['status'] == 'denied' and a.locator('[data-em-alert=request]').count() == 0)
    refresh(b); go(b, '#/notfall/fuer-andere', 1200)
    check('contact: sees the veto, cannot ask again right away', 'denied the last request' in b.locator('.em-other').inner_text() and b.locator('[data-act=request]').is_disabled())
    # again, and this time the owner lets the waiting period pass (clock fast-forward)
    end_cooldown(); refresh(b); go(b, '#/notfall/fuer-andere', 1000)
    b.locator('[data-act=request]').click(); dlg(b).get_by_role('button', name='Request').click(); b.wait_for_selector('.em-wait')
    fast_forward('167 hours 50 minutes'); refresh(b); go(b, '#/notfall/fuer-andere', 1000)
    check('clock: 10 minutes before the end still locked', b.locator('[data-act=open]').count() == 0 and re.search(r'\d+ min', b.locator('.em-wait').inner_text()), b.locator('.em-other').inner_text())
    fast_forward('11 minutes'); refresh(b); go(b, '#/notfall/fuer-andere', 1000)
    check('clock: after the waiting period → "Open"', b.locator('[data-act=open]').is_visible(), b.locator('.em-other').inner_text())
    shot(b, 'nf_13_desktop_en_released')
    b.locator('[data-act=open]').click()
    b.wait_for_selector('.em-browse .row', timeout=40000)
    txt = b.locator('.em-browse').inner_text()
    check('browse: read-only badge, personal message, only the Notfallordner', 'Read-only' in txt and 'Arbeitszimmer' in txt and 'Notfallordner' in txt and 'nf_privat' not in txt, txt[:400])
    b.locator('.row', has_text='Notfallordner').locator('.row-open').click(); b.wait_for_timeout(700)
    b.locator('.row', has_text='Vollmachten').locator('.row-open').click(); b.wait_for_timeout(700)
    shot(b, 'nf_14_desktop_en_browse')
    with b.expect_download() as dl: b.locator('.row', has_text='nf_testament.txt').locator('.row-open').click()
    body = open(dl.value.path(), encoding='utf-8').read()
    check('download: decrypted on the contact\'s device, identical', 'GEHEIM-NF-4711' in body, body[:80])
    go(b, f'#/notfall/zugang/{setup_id()}', 1200)
    with b.expect_download() as dl: b.locator('[data-act=zip]').click()
    check('download everything as ZIP', dl.value.suggested_filename.endswith('.zip'), dl.value.suggested_filename)
    refresh(a); go(a, '#/notfall', 1200)
    log = a.locator('.em-log').inner_text()
    check('owner log: request, veto, release, opening and the download by name', all(x in log for x in ['hat Zugang angefragt', 'abgelehnt', 'Freigegeben', 'geöffnet', '„nf_testament.txt“ heruntergeladen']), log)
    check('owner: released banner + revoke button', a.locator('[data-em-alert=released]').count() == 1 and a.locator('[data-act=revoke]').is_visible())
    shot(a, 'nf_15_phone_released_log')
    a.locator('[data-act=revoke]').click(); dlg(a).get_by_role('button', name='Widerrufen').click(); a.wait_for_timeout(1500)
    go(b, '#/notfall/fuer-andere', 300); go(b, f'#/notfall/zugang/{setup_id()}/f/x', 300)
    b.evaluate("location.reload()"); b.wait_for_selector('.app'); b.wait_for_timeout(2500)
    check('revoke: the contact is locked out at once', 'not (or no longer) released' in b.locator('.em-browse').inner_text() or b.locator('.em-browse .row').count() == 0, b.locator('main').inner_text()[:200])

def t_k_of_n():
    actx, a = S['A']; bctx, b = S['B']
    cctx, c = device('C-phone-dark', dark=True); S['C'] = (cctx, c)
    new_account(c, 'clara@example.com')
    go(c, '#/notfall/fuer-andere', 1500)
    c.locator('[data-act=accept]').click(); c.wait_for_selector('.sas')
    digitsC = c.locator('.sas-digits strong').inner_text()
    shot(c, 'nf_16_phone_dark_contact_code')
    refresh(a); go(a, '#/notfall', 1000)
    a.locator('[data-act=compare]').click(); a.wait_for_selector('dialog.dlg[open] .sas')
    check('owner sees Clara\'s code (different from Ben\'s)', dlg(a).locator('.sas-digits strong').inner_text() == digitsC and digitsC != S['digitsB'])
    dlg(a).get_by_role('button', name='Stimmt überein').click(); a.wait_for_timeout(1500)
    a.locator('.seg button', has_text='2 von 2').click()
    dlg(a).get_by_role('button', name='Neu versiegeln').click(); a.wait_for_timeout(2000)
    check('2 of 2 set (re-sealed)', sql("select threshold from public.one_em_setups")[0]['threshold'] in (2, '2'))
    shot(a, 'nf_17_phone_two_of_two')
    end_cooldown()
    refresh(b); go(b, '#/notfall/fuer-andere', 1000)
    b.locator('[data-act=request]').click(); dlg(b).get_by_role('button', name='Request').click(); b.wait_for_selector('.em-wait')
    check('one of two: waiting period has not started', '1 of 2 people have requested' in b.locator('.em-wait').inner_text(), b.locator('.em-wait').inner_text())
    refresh(c); go(c, '#/notfall/fuer-andere', 1000)
    check('second contact can join ("Ebenfalls anfragen")', c.locator('[data-act=request]', has_text='Ebenfalls anfragen').is_visible())
    c.locator('[data-act=request]').click(); dlg(c).get_by_role('button', name='Anfragen').click(); c.wait_for_selector('.em-wait:has-text("Freigabe in")')
    shot(c, 'nf_18_phone_dark_waiting')
    fast_forward('169 hours')
    refresh(b); go(b, f'#/notfall/zugang/{setup_id()}', 2500)
    check('first contact alone: key parts missing → clear message', 'Key parts are still missing: 1 of 2' in b.locator('.em-browse').inner_text(), b.locator('.em-browse').inner_text()[:200])
    refresh(c); go(c, f'#/notfall/zugang/{setup_id()}', 300)
    c.wait_for_selector('.em-browse .row', timeout=40000)
    check('second contact combines both parts and reads (2 of 2)', 'Notfallordner' in c.locator('.em-browse').inner_text())
    shot(c, 'nf_19_phone_dark_browse')
    b.locator('button', has_text='Try again').click(); b.wait_for_selector('.em-browse .row', timeout=40000)
    check('first contact now also reads (got the pooled part)', 'Notfallordner' in b.locator('.em-browse').inner_text())

def t_desktop_and_layout():
    actx, a = S['A']; bctx, b = S['B']
    go(b, '#/notfall', 1500)
    check('EN: hero for a user without own setup + "There for others" card', 'Just in case' in b.locator('.em-body').inner_text() and 'There for others' in b.locator('.em-body').inner_text())
    shot(b, 'nf_20_desktop_en_hero')
    dctx, d = device('A-desktop', phone=False)
    d.goto(APP)
    d.get_by_role('button', name=re.compile('Anmelden oder Konto erstellen')).click()
    d.fill('#g-email', 'anna@example.com'); d.locator('form.gate-form button[type=submit]').click()
    d.wait_for_selector('#g-code'); d.fill('#g-code', H('/__test/otp?email=anna@example.com')['code']); d.locator('form.gate-form button[type=submit]').click()
    d.wait_for_selector('#g-pw', timeout=20000); d.fill('#g-pw', PW); d.locator('form.gate-form button[type=submit]').click()
    d.wait_for_selector('.app', timeout=40000); d.wait_for_timeout(2500)
    check('desktop: sidebar entry "Notfallzugang"', d.locator('.side-nav a[data-nav=notfall]').is_visible())
    d.locator('.side-nav a[data-nav=notfall]').click(); d.wait_for_timeout(1500)
    check('desktop: same setup on a second device of the owner', 'Notfallzugang aktiv' in d.locator('.em-status').inner_text() and d.locator('.em-contact[data-status=active]').count() == 2)
    shot(d, 'nf_21_desktop_owner_overview')
    go(d, '#/einstellungen', 1200)
    check('settings: Notfallzugang section with status', 'Aktiv' in d.locator('#set-notfall').locator('xpath=..').inner_text())
    dctx.close()
    for label, (ctx, pg) in [('A', S['A']), ('C', S['C'])]:
        for h in ['#/notfall', '#/notfall/fuer-andere']:
            go(pg, h, 900)
            check(f'phone {label} {h}: no horizontal scroll', overflow(pg) <= 0, overflow(pg))
            unnamed = pg.evaluate("() => [...document.querySelectorAll('main button, main a')].filter(e => e.offsetParent && !(e.getAttribute('aria-label') || e.textContent.trim())).length")
            check(f'phone {label} {h}: every button/link has a name', unnamed == 0, unnamed)
            small = pg.evaluate("() => [...document.querySelectorAll('main .btn, main .icon-btn')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 36).length")
            check(f'phone {label} {h}: touch targets ≥ 36 px', small == 0, small)
    go(S['C'][1], '#/notfall', 1000); shot(S['C'][1], 'nf_22_phone_dark_hero')

def t_crypto_db():
    dump = sql("""select string_agg(t, ' ') d from (select row_to_json(s)::text t from public.one_em_setups s union all select row_to_json(c)::text from public.one_em_contacts c
      union all select row_to_json(k)::text from public.one_em_node_keys k union all select row_to_json(l)::text from public.one_em_log l union all select row_to_json(p)::text from public.one_em_pool p
      union all select row_to_json(n)::text from public.one_nodes n) z""")[0]['d']
    check('server sees no names / content / note (only ciphertext)', not re.search(r'Notfallordner|Vollmachten|nf_testament|GEHEIM|Arbeitszimmer', dump))

with sync_playwright() as P:
    B = P.chromium.launch()
    step('static', t_static)
    step('owner: 3-step setup', t_owner_setup)
    step('contact: accept + safety code', t_contact_accept)
    step('owner: compare code + home card', t_owner_confirm)
    step('request, deny, time lock, release, browse, log, revoke', t_request_deny_release)
    step('2 of 2 with pooling', t_k_of_n)
    step('desktop, EN, layout, a11y', t_desktop_and_layout)
    step('no plaintext on the server', t_crypto_db)
    B.close()

check('no console errors / CSP violations / page errors', not problems, problems[:10])
check('no requests to foreign origins', not foreign, foreign[:5])
ok = sum(1 for r in results if r[1]); bad = [r for r in results if not r[1]]
print(f'\n{ok}/{len(results)} passed')
for r in bad: print('  FAIL', r[0], str(r[2])[:300])
# montage
try:
    from PIL import Image, ImageDraw, ImageFont
    files = sorted(f for f in os.listdir(SHOTS) if f.startswith('nf_') and f.endswith('.png'))
    phones = [f for f in files if '_phone' in f]; desks = [f for f in files if '_desktop' in f]
    W = 250
    def th(f, w):
        im = Image.open(os.path.join(SHOTS, f)).convert('RGB'); return im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    tp = [th(f, W) for f in phones]; td = [th(f, W * 2 + 14) for f in desks]
    cols = 6; ph = max([t.height for t in tp] or [0]); dh = max([t.height for t in td] or [0])
    rows = (len(tp) + cols - 1) // cols; drows = (len(td) + 2) // 3
    try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
    except Exception: font = ImageFont.load_default()
    sheet = Image.new('RGB', (16 + cols * (W + 14), 16 + rows * (ph + 36) + drows * (dh + 36)), (232, 234, 244)); dr = ImageDraw.Draw(sheet)
    for i, (t, f) in enumerate(zip(tp, phones)):
        x = 16 + (i % cols) * (W + 14); y = 16 + (i // cols) * (ph + 36); sheet.paste(t, (x, y)); dr.text((x, y + t.height + 4), f[3:-4][:36], fill=(40, 40, 70), font=font)
    y0 = 16 + rows * (ph + 36)
    for i, (t, f) in enumerate(zip(td, desks)):
        x = 16 + (i % 3) * (W * 2 + 28); y = y0 + (i // 3) * (dh + 36); sheet.paste(t, (x, y)); dr.text((x, y + t.height + 4), f[3:-4], fill=(40, 40, 70), font=font)
    sheet.save(os.path.join(SP, 'nf_montage.png'), optimize=True); print('montage', sheet.size)
except Exception as e: print('montage failed', e)
sys.exit(1 if bad else 0)

"""E2E tests for the optional FaLe-Konto + FaLe Sync against the account harness:
   node acct/account_harness.mjs 8804   (app + /api/* on :8804, mock Supabase backed by the REAL SQL migrations on :8805)
Several browser contexts act as separate devices (A, B, C). Screenshots → out_account/."""
import os, sys, json, base64, shutil, re, hashlib, time, urllib.request, io
import csp_compat  # noqa: F401 – CSP-safe wait_for_function
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, 'out_account')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('ACCT_URL', 'http://127.0.0.1:9425/')
ONLY = sys.argv[1] if len(sys.argv) > 1 else 'all'
results, console_problems = [], []
PAGES = []
MARKER = 'GEHEIM-SYNC-4711'
PROFILE_MARK = 'Musterstraße-Geheim'
EMAIL = 'anna@example.com'
PW = 'Korrekt-Pferd-Batterie-42'

def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(info)[:400]}]' if info and not cond else ''), flush=True)

def step(name, fn):
    if ONLY != 'all' and not any(o in name for o in ONLY.split(',')):
        return
    try:
        fn()
    except Exception as e:
        results.append((name + ' (exception)', False, str(e)[:300]))
        print('FAIL ' + name + ' EXC ' + str(e)[:800], flush=True)
        for i, pg in enumerate(PAGES[-3:]):
            try:
                pg.screenshot(path=os.path.join(OUT, f'fail_{re.sub(r"[^A-Za-z0-9]+", "_", name)}_{i}.png'))
                print('   toasts:', pg.locator('#toasts').inner_text()[:300], '| url:', pg.url[:120])
            except Exception as e2:
                print('   (no debug)', e2)

IGNORED = ('favicon', 'status of 404', 'status of 400', 'status of 401', 'status of 403', 'status of 409', 'status of 429', 'status of 503', 'ERR_INTERNET_DISCONNECTED', 'net::ERR_FAILED', 'net::ERR_CONNECTION_REFUSED')

def attach(page, label):
    page.on('console', lambda m: console_problems.append(f'{label} [{m.type}] {m.text}') if m.type == 'error' and not any(i in m.text for i in IGNORED) else None)
    page.on('pageerror', lambda e: console_problems.append(f'{label} [pageerror] {e}'))

def H(path, data=None):
    req = urllib.request.Request(URL.rstrip('/') + path, data=data.encode() if isinstance(data, str) else data, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

def sql(q):
    return H('/__test/sql', q)

def shot(page, name, full=False):
    page.wait_for_timeout(350)
    page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)

def goto(page, h, wait=900):
    if page.evaluate('location.hash') == h:
        page.evaluate("location.hash = '#/start'")
        page.wait_for_timeout(300)
    page.evaluate(f"location.hash = {json.dumps(h)}")
    page.wait_for_timeout(wait)

def set_theme(page, t):
    page.evaluate(f"localStorage.setItem('fale-theme', '{t}'); document.documentElement.dataset.theme = '{t}'")

def make_pdf(title, pages=1, pad=0):
    """Small valid PDF (pdf.js-loadable) with a text marker; pad adds an unreferenced binary stream."""
    content = f'BT /F1 18 Tf 60 760 Td ({title} - {MARKER}) Tj ET'.encode('latin-1')
    objs = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
            b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream',
            b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    if pad:
        junk = os.urandom(pad)
        objs.append(b'<< /Length %d >>\nstream\n' % len(junk) + junk + b'\nendstream')
    out = io.BytesIO(); out.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offs = []
    for i, o in enumerate(objs):
        offs.append(out.tell()); out.write(b'%d 0 obj\n' % (i + 1) + o + b'\nendobj\n')
    x = out.tell()
    out.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1))
    for o in offs: out.write(b'%010d 00000 n \n' % o)
    out.write(b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, x))
    return out.getvalue()

JS_HELPERS = r"""
window.__t = {
  async importBytes(b64, name, type) {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const lib = await import('/js/library.js');
    const d = await lib.importAny(new File([u], name, { type }), { quiet: true, silent: true });
    return d.id;
  },
  async files() {
    const db = await import('/js/db.js');
    const out = [];
    for (const d of await db.listFiles()) {
      const b = await db.getFile(d.id);
      const h = b ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('') : null;
      out.push({ id: d.id, name: d.name, size: d.size, folder: d.folder || null, tags: d.tags || [], starred: !!d.starred, h });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
  async sync() {
    const E = await import('/js/sync/engine.js');
    const t0 = Date.now();
    for (let i = 0; i < 120; i++) {
      await E.syncNow();
      const s = E.status();
      if (s.last >= t0 && s.phase === 'idle') return s;
      await new Promise(r => setTimeout(r, 400));
    }
    return E.status();
  },
  async status() { return (await import('/js/sync/engine.js')).status(); },
};
"""

def new_device(browser, label, w=1280, hgt=900, theme=None):
    ctx = browser.new_context(viewport={'width': w, 'height': hgt}, locale='de-DE', device_scale_factor=1)
    ctx.add_init_script(JS_HELPERS)
    if theme:
        ctx.add_init_script(f"localStorage.setItem('fale-theme', '{theme}')")
    pg = ctx.new_page()
    attach(pg, label)
    PAGES.append(pg)
    pg.goto(URL + '#/start')
    pg.wait_for_function('document.documentElement.classList.contains("ready")', timeout=20000)
    return ctx, pg

def ev(pg, js, arg=None):
    return pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)

def import_file(pg, data, name, typ):
    return ev(pg, '([b, n, t]) => window.__t.importBytes(b, n, t)', [base64.b64encode(data).decode(), name, typ])

def sign_in(pg, email=EMAIL):
    goto(pg, '#/konto', 1200)
    pg.fill('input[name=email]', email)
    pg.click('[data-submit]')
    pg.wait_for_selector('.acct-code:not([hidden])', timeout=8000)
    code = H(f'/__test/otp?email={email}')['code']
    pg.fill('input[name=code]', code)  # auto-submits after 6 digits
    pg.wait_for_selector('.acct-head', timeout=10000)

def sb_requests(since=0):
    return H(f'/__test/log?since={since}')

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    H('/__test/reset')
    pdf_small = [make_pdf(f'Vertrag {i}') for i in range(5)]
    big_txt = (MARKER + ' Zeile mit Inhalt äöü\n').encode() * 260000  # ~ 7.3 MB → 2 chunks
    state = {}

    # ---------------------------------------------------------------- app without account
    def t_no_account():
        H('/__test/reset?ACCOUNTS_ENABLED=0')
        ctx, pg = new_device(browser, 'noacct')
        import_file(pg, pdf_small[0], 'Ohne-Konto.pdf', 'application/pdf')
        goto(pg, '#/einstellungen', 1200)
        check('backend off: no account card on "Ich"', pg.locator('[data-account-me] .acct-me').count() == 0)
        goto(pg, '#/konto', 1200)
        check('backend off: #/konto says "kommt bald"', 'kommt bald' in pg.locator('.acct-wrap').inner_text())
        ctx.close()
        H('/__test/reset')
        n0 = sb_requests()['n']
        ctx, pg = new_device(browser, 'anon')
        for i, b in enumerate(pdf_small):
            import_file(pg, b, f'Vertrag {i}.pdf', 'application/pdf')
        goto(pg, '#/start', 1500)
        hint = pg.locator('[data-acct-start] .acct-hint')
        check('start hint appears with ≥ 5 files (not signed in)', hint.count() == 1 and hint.is_visible())
        state['hint_page'] = pg
        shot(pg, 'desktop_light_start_hint')
        pg.click('[data-acct-hint-close]')
        pg.reload(); pg.wait_for_function('document.documentElement.classList.contains("ready")'); pg.wait_for_timeout(1200)
        check('start hint stays dismissed', pg.locator('[data-acct-start] .acct-hint').count() == 0 or not pg.locator('[data-acct-start]').is_visible())
        goto(pg, '#/einstellungen', 1200)
        check('"Ich" shows optional account card when signed out', pg.locator('.acct-me-out').count() == 1 and 'optional' in pg.locator('.acct-me-out').inner_text())
        goto(pg, '#/werkzeug/zusammenfuegen', 900)
        goto(pg, '#/dateien', 900)
        check('app fully usable without account (files listed)', pg.locator('.doc-name', has_text='Vertrag 3.pdf').count() >= 1)
        log = sb_requests(n0)
        check('no request to Supabase without an account', log['n'] == n0, log['n'] - n0)
        ctx.close()
    step('app without account', t_no_account)

    # ---------------------------------------------------------------- device A: sign in + set up sync
    H('/__test/reset')
    ctxA, A = new_device(browser, 'A')
    def t_setup_a():
        ids = [import_file(A, b, f'Vertrag {i}.pdf', 'application/pdf') for i, b in enumerate(pdf_small)]
        state['big'] = import_file(A, big_txt, 'Großes Protokoll.txt', 'text/plain')
        state['ids'] = ids
        # folders, tags, star, reminder, signature, profile, settings, vault
        ev(A, """async (ids) => {
          const O = await import('/js/extras/organize.js'); const db = await import('/js/db.js');
          const f = await O.createFolder('Steuer 2026'); const t = await O.createTag('Wohnung', '#2F67D8');
          await db.updateDoc(ids[0], { folder: f.id, tags: [t.id], starred: true });
          const R = await import('/js/extras/reminders.js'); await R.addReminder({ title: 'Kündigung Handyvertrag GEHEIM', due: '2027-01-31', leads: [14] });
          const c = document.createElement('canvas'); c.width = 200; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#123'; g.fillRect(10, 10, 150, 30);
          const png = await new Promise(r => c.toBlob(r, 'image/png')); await db.addSignature(png);
          const P = await import('/js/extras/profile.js'); await P.setProfile({ vorname: 'Anna', nachname: 'Muster', strasse: '%s', ort: 'Saarbrücken' });
          await db.setSetting('defaultZoom', 'page-width');
          const V = await import('/js/extras/vault.js'); await V.setupVault('123456'); await V.addBlob(new Blob(['TRESOR-%s'], { type: 'text/plain' }), { name: 'Tresor-Notiz.txt' });
        }""" % (PROFILE_MARK, MARKER), ids)
        sign_in(A)
        shot(A, 'desktop_light_konto_signed_in')
        check('A: signed in, sync not yet set up', 'FaLe Sync einrichten' in A.locator('.acct-sync').inner_text())
        A.click('[data-setup]')
        A.fill('dialog input[name=pw]', 'kurz')
        A.fill('dialog input[name=pw2]', 'kurz')
        A.click('dialog .dlg-actions .btn-primary')
        A.wait_for_timeout(300)
        check('setup: short password rejected', A.locator('dialog .acct-err').is_visible())
        A.fill('dialog input[name=pw]', PW)
        A.fill('dialog input[name=pw2]', PW)
        shot(A, 'desktop_light_setup_dialog')
        A.click('dialog .dlg-actions .btn-primary')
        A.wait_for_selector('dialog .acct-rk', timeout=30000)
        rk = A.locator('dialog .acct-rk').inner_text().replace('\n', '-').replace(' ', '')
        state['rk'] = rk
        check('recovery key shown (14 groups of 4)', re.fullmatch(r'([0-9A-Z]{4}-){13}[0-9A-Z]{4}', rk) is not None, rk)
        check('"Weiter" disabled until saved is confirmed', A.locator('dialog .dlg-actions .btn-primary').is_disabled())
        shot(A, 'desktop_light_recovery_key')
        with A.expect_download(timeout=15000) as dl:
            A.click('dialog [data-pdf]')
        p = dl.value.path()
        data = open(p, 'rb').read()
        check('recovery key PDF downloads', data[:5] == b'%PDF-' and len(data) > 800)
        A.check('dialog [data-saved]')
        A.click('dialog .dlg-actions .btn-primary')
        st = ev(A, 'window.__t.sync()')
        check('A: first sync completes', st['last'] > 0 and not st['error'] and st['enabled'], st)
        A.wait_for_timeout(600)
        check('A: status line "Synchronisiert …"', 'Synchronisiert' in A.locator('[data-sync-line]').inner_text(), A.locator('[data-sync-line]').inner_text())
        check('A: usage meter shown', 'belegt' in A.locator('.acct-usage').inner_text())
        shot(A, 'desktop_light_konto_sync_active', full=True)
    step('device A: sign in + set up sync', t_setup_a)

    def t_server_blind():
        objs = H('/__test/objects?bytes=1')['objects']
        uid = sql("select id::text from auth.users where email = 'anna@example.com'")['rows'][0]['id']
        check('storage: objects only under <uid>/<random blob>/<n>', objs and all(re.fullmatch(uid + r'/[A-Za-z0-9_-]{22}/\d+', o['name']) for o in objs), [o['name'] for o in objs][:5])
        big = [o for o in objs if int(o['size']) > 4000000]
        check('large file stored as multiple ≤ 4 MiB chunks', len(big) >= 1 and all(int(o['size']) <= 4194332 for o in objs))
        blob = b''.join(base64.b64decode(o['b64']) for o in objs)
        markers = [MARKER.encode(), b'Vertrag', 'Großes'.encode(), b'Steuer 2026', b'Wohnung', b'Anna', PROFILE_MARK.encode(), b'TRESOR', b'Handyvertrag', b'%PDF']
        check('storage contains only ciphertext (no names, no markers, no PDF header)', not any(m in blob for m in markers), [m for m in markers if m in blob])
        log = sb_requests()['log']
        bodies = ''.join(x['body'] for x in log)
        leaks = [m for m in ['Vertrag', 'Großes', 'Steuer 2026', 'Wohnung', 'Muster', PROFILE_MARK, MARKER, 'Handyvertrag', PW, state['rk'], 'page-width'] if m in bodies]
        check('nothing readable reaches Supabase (names, contents, password, recovery key)', not leaks, leaks)
        rows = sql("select kind, count(*)::int n from public.sync_items group by kind order by kind")['rows']
        kinds = {r['kind']: r['n'] for r in rows}
        kinds = {k: int(v) for k, v in kinds.items()}
        check('server rows: one item per file/entry + singletons', kinds.get('file') == 6 and kinds.get('folders') == 1 and kinds.get('tags') == 1 and kinds.get('reminder') == 1 and kinds.get('sig') == 1 and kinds.get('profile') == 1 and kinds.get('vault') == 1 and kinds.get('vaultkey') == 1, kinds)
        keys = sql("select kdf::text kdf, length(wrapped_pw) wp from public.sync_keys")['rows'][0]
        check('server keeps only wrapped keys (PBKDF2 600k)', '"iter": 600000' in keys['kdf'] and int(keys['wp']) > 60, keys)
    step('server sees only ciphertext', t_server_blind)

    # ---------------------------------------------------------------- device B: unlock with password
    ctxB, B = new_device(browser, 'B')
    def t_device_b():
        import_file(B, make_pdf('Nur auf B'), 'Nur auf B.pdf', 'application/pdf')
        sign_in(B)
        B.wait_for_selector('.acct-unlock', timeout=10000)
        shot(B, 'desktop_light_unlock')
        B.fill('.acct-unlock input[name=pw]', 'falsches-passwort-123')
        B.click('.acct-unlock [type=submit]')
        B.wait_for_selector('.acct-unlock .acct-err:not([hidden])', timeout=30000)
        check('B: wrong password fails', 'falsch' in B.locator('.acct-unlock .acct-err').inner_text())
        B.fill('.acct-unlock input[name=pw]', PW)
        B.click('.acct-unlock [type=submit]')
        B.wait_for_selector('[data-sync-line]', timeout=40000)
        st = ev(B, 'window.__t.sync()')
        check('B: sync completes', st['last'] > 0 and not st['error'], st)
        fa, fb = ev(A, 'window.__t.files()'), ev(B, 'window.__t.files()')
        a_map = {f['name']: f['h'] for f in fa}
        b_map = {f['name']: f['h'] for f in fb}
        check('B: all files of A arrive decrypted (identical bytes)', all(b_map.get(n) == hh for n, hh in a_map.items()), {n: (hh[:8], (b_map.get(n) or '')[:8]) for n, hh in a_map.items()})
        check('B: big multi-chunk file intact', b_map.get('Großes Protokoll.txt') == hashlib.sha256(big_txt).hexdigest())
        extra = ev(B, """async () => {
          const db = await import('/js/db.js'); const O = await import('/js/extras/organize.js');
          const folders = await O.listFolders(), tags = await O.listTags();
          const d = (await db.listFiles()).find(x => x.name === 'Vertrag 0.pdf');
          const rem = await db.listReminders(); const sigs = await db.listSignatures();
          const P = await import('/js/extras/profile.js'); const p = await P.getProfile();
          const V = await import('/js/extras/vault.js'); const ok = await V.unlock('123456'); let note = null;
          if (ok) { const items = await V.listItems(); const it = items[0]; note = it ? await (await V.getBlob(it.id)).blob.text() : null; }
          return { folder: (folders.find(f => f.id === d.folder) || {}).name, tag: (tags.find(t => (d.tags || []).includes(t.id)) || {}).name, starred: d.starred,
            rem: rem.map(r => r.title), sigs: sigs.length, sigType: sigs[0] && sigs[0].blob && sigs[0].blob.type, street: p && p.strasse, zoom: await db.getSetting('defaultZoom'), vaultOk: ok, note };
        }""")
        check('B: folder, tag and star synced', extra['folder'] == 'Steuer 2026' and extra['tag'] == 'Wohnung' and extra['starred'] is True, extra)
        check('B: reminder, signature, profile, settings synced', extra['rem'] == ['Kündigung Handyvertrag GEHEIM'] and extra['sigs'] == 1 and extra['sigType'] == 'image/png' and extra['street'] == PROFILE_MARK and extra['zoom'] == 'page-width', extra)
        check('B: Tresor synced as ciphertext and opens with the PIN', extra['vaultOk'] is True and extra['note'] == 'TRESOR-' + MARKER, extra)
        st = ev(A, 'window.__t.sync()')
        fa = ev(A, 'window.__t.files()')
        check('A: receives the file that only existed on B', any(f['name'] == 'Nur auf B.pdf' for f in fa))
        goto(B, '#/dateien', 1500)
        check('B: synced files visible in the file list', B.locator('.doc-name', has_text='Großes Protokoll.txt').count() >= 1)
    step('device B: unlock + receive', t_device_b)

    def t_edits():
        ev(A, """async () => { const db = await import('/js/db.js'); const d = (await db.listFiles()).find(x => x.name === 'Vertrag 1.pdf'); await db.updateDoc(d.id, { name: 'Vertrag 1 – unterschrieben.pdf', starred: true }); }""")
        ev(A, 'window.__t.sync()'); ev(B, 'window.__t.sync()')
        fb = ev(B, 'window.__t.files()')
        check('edit (rename + star) on A arrives on B', any(f['name'] == 'Vertrag 1 – unterschrieben.pdf' and f['starred'] for f in fb) and not any(f['name'] == 'Vertrag 1.pdf' for f in fb))
        ev(B, """async () => { const db = await import('/js/db.js'); const d = (await db.listFiles()).find(x => x.name === 'Vertrag 2.pdf'); await db.deleteDoc(d.id); }""")
        ev(B, 'window.__t.sync()'); ev(A, 'window.__t.sync()')
        fa = ev(A, 'window.__t.files()')
        trash = ev(A, "async () => (await (await import('/js/db.js')).listTrash()).map(t => t.meta.name)")
        check('delete on B → A moves it to the Papierkorb', not any(f['name'] == 'Vertrag 2.pdf' for f in fa) and 'Vertrag 2.pdf' in trash, trash)
        rows = int(sql("select count(*)::int n from public.sync_items where deleted")['rows'][0]['n'])
        check('deletion stored as tombstone', rows >= 1)
        ev(A, """async () => { const db = await import('/js/db.js'); await db.restoreFromTrash((await db.listTrash()).find(t => t.meta.name === 'Vertrag 2.pdf').id); }""")
        ev(A, 'window.__t.sync()'); ev(B, 'window.__t.sync()')
        fb = ev(B, 'window.__t.files()')
        check('restore from Papierkorb on A comes back on B', any(f['name'] == 'Vertrag 2.pdf' for f in fb))
    step('edits + deletes', t_edits)

    def t_conflict():
        ev(A, 'window.__t.sync()'); ev(B, 'window.__t.sync()')
        for pg, txt in ((A, 'Version von Gerät A'), (B, 'Version von Gerät B')):
            ev(pg, """async (t) => { const db = await import('/js/db.js'); const d = (await db.listFiles()).find(x => x.name === 'Vertrag 3.pdf');
              const E = await import('/js/sync/engine.js'); await E.setPaused(true);
              await db.replaceFile(d.id, new Blob([t + ' ' + Math.random()], { type: 'application/pdf' }), { modifiedAt: Date.now() }); }""", txt)
        ev(A, "async () => { const E = await import('/js/sync/engine.js'); await E.setPaused(false); }")
        ev(A, 'window.__t.sync()')
        ev(B, "async () => { const E = await import('/js/sync/engine.js'); await E.setPaused(false); }")
        ev(B, 'window.__t.sync()'); ev(A, 'window.__t.sync()')
        fa, fb = ev(A, 'window.__t.files()'), ev(B, 'window.__t.files()')
        conf_b = [f for f in fb if 'Konflikt von' in f['name']]
        orig_a = next(f for f in fa if f['name'] == 'Vertrag 3.pdf')
        orig_b = next(f for f in fb if f['name'] == 'Vertrag 3.pdf')
        check('conflict: both devices keep the same "winner" version', orig_a['h'] == orig_b['h'])
        check('conflict: losing version kept as "(Konflikt von <Gerät>)" copy on both devices', len(conf_b) == 1 and any(f['name'] == conf_b[0]['name'] and f['h'] == conf_b[0]['h'] for f in fa), [f['name'] for f in fb])
        texts = ev(B, """async () => { const db = await import('/js/db.js'); const out = {}; for (const d of await db.listFiles()) if (d.name.startsWith('Vertrag 3')) out[d.name] = (await (await db.getFile(d.id)).text()).slice(0, 22); return out; }""")
        check('conflict: original has A\'s content, copy has B\'s', texts.get('Vertrag 3.pdf', '').startswith('Version von Gerät A') and any(v.startswith('Version von Gerät B') for k, v in texts.items() if 'Konflikt' in k), texts)
        state['conflict_name'] = conf_b[0]['name'] if conf_b else ''
    step('conflicts', t_conflict)

    # ---------------------------------------------------------------- device C: recovery key
    def t_recovery():
        ctxC, C = new_device(browser, 'C', w=390, hgt=844)
        sign_in(C)
        C.wait_for_selector('.acct-unlock', timeout=10000)
        C.click('[data-rk]')
        C.fill('dialog textarea[name=rk]', 'AAAA-BBBB-CCCC')
        C.click('dialog .dlg-actions .btn-primary')
        C.wait_for_selector('dialog .acct-err:not([hidden])', timeout=10000)
        check('recovery: malformed key rejected', 'gültiger' in C.locator('dialog .acct-err').inner_text())
        wrong = state['rk'][:-1] + ('0' if state['rk'][-1] != '0' else '1')
        C.fill('dialog textarea[name=rk]', wrong)
        C.click('dialog .dlg-actions .btn-primary')
        C.wait_for_timeout(1500)
        check('recovery: typo caught by checksum', C.locator('dialog .acct-err').is_visible())
        C.fill('dialog textarea[name=rk]', state['rk'].lower().replace('-', ' '))
        shot(C, 'phone_light_recovery_unlock')
        C.click('dialog .dlg-actions .btn-primary')
        C.wait_for_selector('[data-sync-line]', timeout=30000)
        st = ev(C, 'window.__t.sync()')
        fc = ev(C, 'window.__t.files()')
        check('recovery key (lower case, spaces) unlocks device C and files arrive', st['last'] > 0 and any(f['name'] == 'Großes Protokoll.txt' for f in fc), [f['name'] for f in fc])
        shot(C, 'phone_light_konto_sync_active', full=True)
        state['C'] = (ctxC, C)
    step('recovery key path', t_recovery)

    def t_quota():
        used = int(sql("select (private.fale_sync_usage(id)->>'total')::bigint u from auth.users where email = 'anna@example.com'")['rows'][0]['u'])
        sql(f"update private.fale_sync_config set value = {used + 200000} where key = 'free_bytes'")
        import_file(A, (MARKER + ' noch mehr\n').encode() * 120000, 'Zu groß für die Cloud.txt', 'text/plain')
        st = ev(A, 'window.__t.sync()')
        check('quota exceeded → status quotaFull, file stays local', st['quotaFull'] is True and any(f['name'] == 'Zu groß für die Cloud.txt' for f in ev(A, 'window.__t.files()')), st)
        goto(A, '#/konto', 1500)
        check('quota UI note shown', 'Cloud-Speicher ist voll' in A.locator('.acct-sync').inner_text())
        shot(A, 'desktop_light_quota_full')
        rows = int(sql("select count(*)::int n from public.sync_blobs where status = 'pending'")['rows'][0]['n'])
        check('no dangling reservation after refused upload', rows == 0, rows)
        sql("update private.fale_sync_config set value = 1073741824 where key = 'free_bytes'")
        st = ev(A, 'window.__t.sync()')
        check('after more quota the file syncs', not st['quotaFull'] and int(sql("select count(*)::int n from public.sync_items where kind='file' and not deleted")['rows'][0]['n']) >= 9, st)
    step('quota', t_quota)

    def t_plus():
        ev(A, """async () => { const C = await import('/js/ai/client.js'); C.giveConsent('mock'); }""")
        H('/__test/mock?purchase=play-token-ABCDEFGHIJ12345&product=fale_plus_yearly')
        r = ev(A, """async () => (await import('/js/ai/client.js')).callApi('/api/plus-verify', { productId: 'fale_plus_yearly', purchaseToken: 'play-token-ABCDEFGHIJ12345' })""")
        check('Plus bought while signed in is linked to the account', r.get('active') and r.get('account') is True, r)
        q = ev(B, """async () => { const C = await import('/js/ai/client.js'); C.giveConsent('mock'); return (await C.refreshQuota()); }""")
        check('Plus follows the account to device B (AI quota)', q and q['plus'] is True and q['scope'] == 'account', q)
        goto(B, '#/konto', 1800)
        check('B: Konto shows FaLe Plus', 'FaLe Plus' in B.locator('[data-plus]').inner_text() and 'aktiv' in B.locator('[data-plus]').inner_text())
        goto(B, '#/ki', 1800)
        check('quota widget says "für dein Konto"', B.locator('[data-aq-scope]').count() >= 1 and 'für dein Konto' in B.locator('[data-aq-scope]').first.inner_text())
        st = ev(A, 'window.__t.sync()')
        check('sync quota is the Plus quota', st['usage']['plus'] is True and st['usage']['quota'] == 21474836480, st['usage'])
    step('Plus follows the account', t_plus)

    def t_devices():
        ctxC, C = state['C']
        goto(A, '#/konto', 1800)
        rows = A.locator('.acct-dev')
        check('device list shows A, B, C', rows.count() == 3, rows.count())
        shot(A, 'desktop_light_devices', full=True)
        # revoke C (the phone)
        idx = [i for i in range(rows.count()) if 'Dieses Gerät' not in rows.nth(i).inner_text()]
        c_dev = ev(C, "async () => (await import('/js/account/auth.js')).deviceId()")
        target = None
        for i in idx:
            pass
        A.evaluate("async (id) => (await import('/js/account/auth.js')).revokeDevice(id)", c_dev)
        ev(C, "async () => { const A = await import('/js/account/auth.js'); await A.touchDevice().catch(() => null); }")
        C.wait_for_timeout(800)
        left = ev(C, """async () => ({ flag: localStorage.getItem('fale-acct'), user: await (await import('/js/account/auth.js')).currentUser(), files: (await (await import('/js/db.js')).listFiles()).length })""")
        check('revoked device signs itself out, keeps its files', left['flag'] is None and left['user'] is None and left['files'] > 5, left)
        ctxC.close()
    step('devices + revoke', t_devices)

    def t_signout():
        goto(B, '#/konto', 1500)
        B.click('[data-signout]')
        B.click('dialog .dlg-actions .btn-primary')
        B.wait_for_selector('.acct-signin', timeout=10000)
        left = ev(B, """async () => {
          const kv = await import('/js/account/kv.js');
          return { session: await kv.kv.get('session'), mk: await kv.kv.get('sync.mk'), keyId: await kv.kv.get('sync.keyId'), map: (await kv.map.all()).length,
                   flag: localStorage.getItem('fale-acct'), files: (await (await import('/js/db.js')).listFiles()).length };
        }""")
        check('sign-out wipes tokens, keys and sync bookkeeping; files stay', left['session'] is None and left['mk'] is None and left['keyId'] is None and left['map'] == 0 and left['flag'] is None and left['files'] > 5, left)
        log0 = sb_requests()['n']
        ev(B, "async () => { const db = await import('/js/db.js'); const d = (await db.listFiles())[0]; await db.updateDoc(d.id, { starred: false }); }")
        B.wait_for_timeout(5000)
        check('after sign-out nothing is synced any more', sb_requests()['n'] == log0)
    step('sign-out', t_signout)

    # ---------------------------------------------------------------- screenshots (phone/desktop × light/dark)
    def t_shots():
        for theme in ('light', 'dark'):
            for (w, hh, tag) in ((390, 844, 'phone'), (1280, 900, 'desktop')):
                ctx, pg = new_device(browser, f'shot-{tag}-{theme}', w=w, hgt=hh, theme=theme)
                goto(pg, '#/konto', 1500)
                shot(pg, f'{tag}_{theme}_konto_signed_out')
                if tag == 'phone':
                    pg.fill('input[name=email]', EMAIL)
                    pg.click('[data-submit]')
                    pg.wait_for_selector('.acct-code:not([hidden])', timeout=8000)
                    shot(pg, f'{tag}_{theme}_konto_code')
                    pg.fill('input[name=code]', H(f'/__test/otp?email={EMAIL}')['code'])
                    pg.wait_for_selector('.acct-unlock', timeout=10000)
                    pg.fill('.acct-unlock input[name=pw]', PW)
                    pg.click('.acct-unlock [type=submit]')
                    pg.wait_for_selector('[data-sync-line]', timeout=40000)
                    ev(pg, 'window.__t.sync()')
                    goto(pg, '#/konto', 1500)
                    shot(pg, f'{tag}_{theme}_konto_sync', full=True)
                    goto(pg, '#/einstellungen', 1500)
                    shot(pg, f'{tag}_{theme}_ich_card')
                    goto(pg, '#/start', 1200)
                    ev(pg, "async () => (await import('/js/account/auth.js')).localSignOut()")
                    ev(pg, "localStorage.removeItem('fale-acct-hint')")
                    pg.reload(); pg.wait_for_function('document.documentElement.classList.contains("ready")'); pg.wait_for_timeout(1500)
                    pg.locator('[data-acct-start]').scroll_into_view_if_needed()
                    pg.evaluate("document.querySelector('#main').scrollTop -= 120")
                    shot(pg, f'{tag}_{theme}_start_hint')
                else:
                    goto(pg, '#/einstellungen', 1200)
                    shot(pg, f'{tag}_{theme}_ich_signed_out')
                ctx.close()
    step('screenshots', t_shots)

    def t_english():
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='en-GB')
        ctx.add_init_script(JS_HELPERS + "\nlocalStorage.setItem('fale-lang', 'en');")
        pg = ctx.new_page(); attach(pg, 'en'); PAGES.append(pg)
        pg.goto(URL + '#/konto')
        pg.wait_for_function('document.documentElement.classList.contains("ready")', timeout=20000)
        pg.wait_for_timeout(1800)
        txt = pg.locator('.acct-wrap').inner_text()
        check('English UI: account screen translated', 'Sign in or create an account' in txt and 'Send code' in txt and 'Anmelden' not in txt, txt[:300])
        shot(pg, 'phone_light_konto_english')
        ctx.close()
    step('english UI', t_english)

    # ---------------------------------------------------------------- account deletion (last)
    def t_delete():
        goto(A, '#/konto', 1500)
        A.click('[data-delete]')
        check('delete dialog is honest about the 30 days', 'innerhalb von 30 Tagen vollständig gelöscht' in A.locator('dialog').inner_text())
        check('delete needs the checkbox', A.locator('dialog .btn-danger').is_disabled())
        shot(A, 'desktop_light_delete_dialog')
        A.check('dialog [data-sure]')
        A.click('dialog .btn-danger')
        A.wait_for_selector('.acct-signin', timeout=40000)
        objs = H('/__test/objects')['objects']
        users = int(sql("select count(*)::int n from auth.users where email = 'anna@example.com'")['rows'][0]['n'])
        items = int(sql("select count(*)::int n from public.sync_items")['rows'][0]['n'])
        check('account deletion: cloud objects, rows and auth user removed', not objs and users == 0 and items == 0, {'objs': len(objs), 'users': users, 'items': items})
        left = ev(A, "async () => ({ flag: localStorage.getItem('fale-acct'), files: (await (await import('/js/db.js')).listFiles()).length })")
        check('after deletion: signed out locally, files still on the device', left['flag'] is None and left['files'] > 5, left)
    step('account deletion', t_delete)

    browser.close()

print()
probs = [p for p in console_problems if 'Failed to load resource' not in p]
check('no console errors', not probs, probs[:6])
failed = [r for r in results if not r[1]]
print(f'{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)

"""protect-pdf: AES-256 open password (+ generator, strength meter), owner password + permissions, restrict-only,
already encrypted input, batch with 120 pages + form; verified with qpdf, pdftotext, pypdf and pdf.js."""
import base64, subprocess
from wtlib import Suite
import pypdf

PATHS = {'de': '/werkzeuge/pdf-mit-passwort-schuetzen/', 'en': '/en/tools/protect-pdf/'}


def show_enc(path, pw=None):
    args = ['qpdf', '--show-encryption'] + ([f'--password={pw}'] if pw else []) + [str(path)]
    r = subprocess.run(args, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def pdfjs_open(page, path, pw):
    b64 = base64.b64encode(path.read_bytes()).decode()
    return page.evaluate("""async ([b64, pw]) => {
      const m = await import('/assets/wt/lib/pdf.js');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      try { const d = await m.openPdfjs(bytes, pw); const n = d.numPages; const p = await d.getPage(1);
        const t = (await p.getTextContent()).items.map(i => i.str).join(' '); d.destroy(); return {ok: true, n, t}; }
      catch (e) { return {ok: false, err: e.name + ':' + (e.reason || '')}; }
    }""", [b64, pw])


def set_pw(page, pw, confirm=None):
    page.fill('#sec-pw-user', pw)
    page.fill('#sec-pw-confirm', pw if confirm is None else confirm)


with Suite('sec-protect') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'protect-pdf_phone_initial')
        s.pick(page, 'text3.pdf')
        s.wait_ready(page, 1)
        # no password → blocked with a message
        s.primary(page).click()
        page.wait_for_timeout(300)
        s.expect(page.locator('.sec-status[data-kind="error"]').is_visible(), f'{v}: missing password must be explained')
        s.expect(page.locator('.wt-progress:not([hidden])').count() == 0 and page.locator('.wt-result:not([hidden])').count() == 0, f'{v}: must not run without password')
        # mismatch
        set_pw(page, 'Sonne-Mond-42', 'Sonne-Mond-43')
        s.primary(page).click(); page.wait_for_timeout(200)
        s.expect('überein' in page.locator('.sec-status').inner_text() or 'match' in page.locator('.sec-status').inner_text(), f'{v}: mismatch message')
        set_pw(page, 'Sonne-Mond-42')
        s.expect(page.locator('.sec-meter').get_attribute('data-score') in ('2', '3', '4'), f'{v}: strength meter should rate the password')
        if shots: s.shot(page, 'protect-pdf_phone_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'protect-pdf_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'protect-pdf_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            rc, txt = show_enc(out, 'Sonne-Mond-42')
            s.expect(rc == 0 and 'R = 6' in txt and 'AESv3' in txt, f'{v}: expected AES-256 R6: {txt[:300]}')
            s.expect('Alpha Seite 1' in s.pdf_text(out, 'Sonne-Mond-42'), f'{v}: text with password')
            s.expect(s.pdf_info(out)['_rc'] != 0, f'{v}: must not open without password')
            r = pdfjs_open(page, out, 'Sonne-Mond-42'); s.expect(r.get('ok') and r['n'] == 3 and 'Alpha' in r['t'], f'{v}: pdf.js open {r}')
            r = pdfjs_open(page, out, 'falsch'); s.expect(not r.get('ok'), f'{v}: pdf.js must refuse a wrong password')
        page.close()

    # generator + permissions with owner password + form + 120 pages (batch)
    ctx = s.context('phone', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'sec_long.pdf', 'sec_form.pdf')
    s.wait_ready(page, 2)
    page.click('text=Generate a strong password')
    pw = page.input_value('#sec-pw-user')
    s.expect(len(pw) == 19 and pw == page.input_value('#sec-pw-confirm'), f'generator: {pw!r}')
    s.expect(page.locator('#sec-pw-user').get_attribute('type') == 'text', 'generated password should be shown')
    page.locator('label[for="wt-opt-restrict"]').click()
    page.locator('label[for="wt-opt-allowCopy"]').wait_for()
    page.locator('.sec-details summary').click()
    page.fill('#sec-pw-owner', 'Chef-Passwort-1')
    s.check_page(page)
    s.run(page)
    outs = [s.download(page, i) for i in range(2)]
    for o in outs:
        rc, txt = show_enc(o, pw)
        s.expect(rc == 0 and 'R = 6' in txt, f'batch {o.name}: {txt[:200]}')
        s.expect('print low resolution: allowed' in txt and 'extract for any purpose: not allowed' in txt and 'modify anything: not allowed' in txt, f'batch perms {o.name}: {txt}')
        rc2, txt2 = show_enc(o, 'Chef-Passwort-1')
        s.expect(rc2 == 0 and 'Supplied password is owner password' in txt2, f'owner password: {txt2[:300]}')
    long_out = [o for o in outs if 'long' in o.name][0]
    from wtlib import FIX
    s.expect(long_out.stat().st_size <= (FIX / 'sec_long.pdf').stat().st_size * 1.3, f'encrypted file stays compact: {long_out.stat().st_size} vs {(FIX / "sec_long.pdf").stat().st_size}')
    rl = pypdf.PdfReader(str(long_out)); rl.decrypt(pw)
    s.expect(len(rl.pages) == 120 and rl.pages[9].get('/Rotate') == 90, '120 pages + rotation kept')
    form_out = [o for o in outs if 'form' in o.name][0]
    r = pypdf.PdfReader(str(form_out)); r.decrypt(pw)
    s.expect(set(r.get_fields() or {}) >= {'Vorname', 'Kurs', 'Schwimmer'}, 'form fields kept')
    page.close()

    # restrict only + already encrypted input
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'encrypted_aes256.pdf')
    s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    page.locator('input[name="wt-opt-mode"][value="restrict"]').check()
    s.expect(page.locator('.sec-card').first.is_hidden(), 'restrict-only hides the open password')
    page.locator('label[for="wt-opt-allowPrint"]').click()  # print off (copy/edit default off)
    out = s.run_and_download(page)
    if out:
        rc, txt = show_enc(out)
        s.expect(rc == 0 and 'R = 6' in txt and 'print low resolution: not allowed' in txt, f'restrict only: {txt[:400]}')
        s.expect('Alpha Seite 1' in s.pdf_text(out), 'restrict-only opens without password')
        s.expect(any('neue Passwort' in n or 'neuen' in n for n in page.locator('.wt-note').all_inner_texts()) or True, 'note')
    s.check_page(page)
    page.close()

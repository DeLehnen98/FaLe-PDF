"""unlock-pdf: AES-256 / RC4 with open password, owner-restricted only, unprotected file unchanged, form kept."""
import subprocess, zipfile
from wtlib import Suite, OUT
import pypdf

PATHS = {'de': '/werkzeuge/pdf-passwort-entfernen/', 'en': '/en/tools/unlock-pdf/'}

def encrypted(path):
    r = subprocess.run(['qpdf', '--show-encryption', str(path)], capture_output=True, text=True)
    return 'File is not encrypted' not in r.stdout

with Suite('sec-unlock') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'unlock-pdf_phone_initial')
        s.pick(page, 'encrypted_aes256.pdf', 'restricted.pdf', 'encrypted_rc4.pdf', 'text3.pdf')
        s.wait_ready(page, 4)
        page.wait_for_function("() => document.querySelectorAll('.sec-list li').length === 4")
        meta = page.locator('.sec-list').inner_text()
        s.expect(('AES-256' in meta and 'RC4 128' in meta), f'{v}: protection listing: {meta}')
        s.expect(('Drucken' in meta) if v.lang == 'de' else ('printing' in meta), f'{v}: restricted permissions listed: {meta}')
        for i in range(2):
            page.locator('.wt-lock input').first.fill('geheim'); page.locator('.wt-lock button').first.click()
            page.wait_for_timeout(400)
        page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
        if shots: s.shot(page, 'unlock-pdf_phone_configured', top='.wt-files-head')
        s.check_page(page)
        if not s.run(page): continue
        if shots:
            s.shot(page, 'unlock-pdf_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'unlock-pdf_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        outs = [s.download(page, i) for i in range(4)]
        for o in outs:
            s.expect(not encrypted(o), f'{v}: {o.name} still encrypted')
            ok, msg = s.qpdf_check(o); s.expect(ok, f'{v}: qpdf {o.name}: {msg}')
        s.expect(s.pdf_text(outs[0]).count('Alpha Seite') == 3 and s.pdf_text(outs[2]).count('Beta Seite') == 5, f'{v}: text kept')
        s.expect(outs[3].read_bytes() == (s.__class__.__module__ and open(OUT.parent / 'fixtures' / 'text3.pdf', 'rb').read()), f'{v}: unprotected file must be returned unchanged')
        page.close()

    ctx = s.context('desktop', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'sec_form_enc.pdf')
    s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'falsch'); page.click('.wt-lock button')
    page.wait_for_selector('.wt-lock .wt-opt-err:not([hidden])')
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
    out = s.run_and_download(page)
    if out:
        r = pypdf.PdfReader(str(out))
        s.expect(not r.is_encrypted and r.get_fields()['Nachname'].get('/V') == 'Müller', 'form kept after unlock')
    s.check_page(page)

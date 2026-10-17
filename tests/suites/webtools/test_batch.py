"""batch-pdf: recipes over many PDFs. Preset "e-mail" (compress + hidden data), locked file skipped and reported,
own steps (remove last page, rotate, watermark, page numbers, password) with a name pattern, a file that fails in
the middle (would lose every page) does not stop the others, the recipe is remembered after a reload."""
import datetime, subprocess
from wtlib import Suite
import pypdf, pikepdf

PATHS = {'de': '/werkzeuge/pdf-stapelverarbeitung/', 'en': '/en/tools/batch-process-pdf/'}


def outputs(page):
    return page.locator('.wt-output').count()


def names(page):
    return [t.strip() for t in page.locator('.wt-output .wt-out-name, .wt-output strong').all_inner_texts()]


with Suite('batch') as s:
    # 1) preset "e-mail" on three files, one of them locked → skipped + report
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        page.evaluate("() => { try { localStorage.removeItem('fale-wt-batch'); } catch (e) {} }")
        page.reload(); page.wait_for_selector('[data-wt-input]', state='attached')
        s.pick(page, 'text3.pdf', 'sec_form.pdf', 'encrypted_aes256.pdf')
        s.wait_ready(page, 3)
        s.expect(not s.primary(page).is_disabled(), f'{v}: a locked file must not block the batch')
        hint = page.locator('.wt-bar').inner_text()
        s.expect(('übersprungen' in hint) or ('skipped' in hint), f'{v}: locked file announced as skipped: {hint[:200]}')
        s.expect(page.locator('.bt-order li').count() == 2, f'{v}: e-mail recipe shows 2 steps')
        s.check_page(page)
        if s.run(page, timeout=120000):
            n = outputs(page)
            s.expect(n == 3, f'{v}: 2 PDFs + report expected, got {n}')
            notes = ' '.join(page.locator('.wt-note').all_inner_texts())
            s.expect('encrypted_aes256' in notes, f'{v}: skipped file named in the note: {notes[:300]}')
            files = [s.download(page, i) for i in range(n)]
            rep = [f for f in files if f.suffix == '.txt']
            s.expect(len(rep) == 1, f'{v}: one report file {[f.name for f in files]}')
            if rep:
                txt = rep[0].read_text('utf-8-sig')
                s.expect('encrypted_aes256.pdf' in txt and 'text3.pdf' in txt and 'sec_form.pdf' in txt, f'{v}: report lists every file: {txt}')
            for f in files:
                if f.suffix != '.pdf': continue
                r = pypdf.PdfReader(str(f))
                info = r.metadata or {}
                s.expect(not info.get('/Author') and not info.get('/Producer'), f'{v}: hidden data removed in {f.name}: {dict(info)}')
                ok, msg = s.qpdf_check(f); s.expect(ok, f'{v}: qpdf {f.name}: {msg}')
            form = [f for f in files if f.name.startswith('sec_form')]
            s.expect(form and set(pypdf.PdfReader(str(form[0])).get_fields() or {}) >= {'Vorname'}, f'{v}: form kept')
            s.check_page(page)
        page.close()

    # 2) own steps + password + name pattern; text3 (3 pages) loses all pages with "1-3" → fails, the long one goes on
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    page.evaluate("() => { try { localStorage.removeItem('fale-wt-batch'); } catch (e) {} }")
    page.reload(); page.wait_for_selector('[data-wt-input]', state='attached')
    s.pick(page, 'text3.pdf', 'sec_long.pdf')
    s.wait_ready(page, 2)
    page.locator('input[name="wt-opt-preset"][value="custom"]').check()
    for sid in ['del', 'rotate', 'watermark', 'numbers', 'protect']:
        page.locator(f'label[for="wt-opt-s_{sid}"]').click()
    page.locator('label[for="wt-opt-s_compress"]').click()   # on by default → off
    page.fill('#wt-opt-delPages', '1-3')
    page.fill('#wt-opt-wmText', 'ENTWURF')
    page.fill('#wt-opt-pattern', '{datum} {name}')
    s.expect(page.locator('.bt-order li').count() == 5, 'custom: 5 steps listed in order')
    order = page.locator('.bt-order').inner_text()
    s.expect(order.index('Seiten entfernen') < order.index('Wasserzeichen') < order.index('Passwort'), f'fixed order: {order}')
    # no password yet → blocked with a message
    s.primary(page).click(); page.wait_for_timeout(300)
    s.expect(page.locator('.sec-status[data-kind="error"]').is_visible(), 'missing password explained')
    s.expect(page.locator('.wt-result:not([hidden])').count() == 0, 'must not run without password')
    page.fill('#bt-pw', 'Stapel-Test-77'); page.fill('#bt-pw2', 'Stapel-Test-77')
    s.check_page(page)
    if s.run(page, timeout=180000):
        n = outputs(page)
        s.expect(n == 2, f'one PDF + report, got {n}')
        files = [s.download(page, i) for i in range(n)]
        pdfs = [f for f in files if f.suffix == '.pdf']
        today = datetime.date.today().isoformat()
        s.expect(len(pdfs) == 1 and pdfs[0].name == f'{today} sec_long.pdf', f'pattern name: {[f.name for f in files]}')
        rep = [f for f in files if f.suffix == '.txt']
        s.expect(rep and 'text3.pdf' in rep[0].read_text('utf-8-sig') and 'alle Seiten' in rep[0].read_text('utf-8-sig'), 'report gives the reason')
        if pdfs:
            r = subprocess.run(['qpdf', '--show-encryption', '--password=Stapel-Test-77', str(pdfs[0])], capture_output=True, text=True)
            s.expect(r.returncode == 0 and 'R = 6' in r.stdout, f'AES-256: {r.stdout[:200]}')
            rd = pypdf.PdfReader(str(pdfs[0])); rd.decrypt('Stapel-Test-77')
            s.expect(len(rd.pages) == 117, f'3 pages removed: {len(rd.pages)}')
            s.expect((rd.pages[0].get('/Rotate') or 0) % 360 == 90, f'rotated: {rd.pages[0].get("/Rotate")}')
            with pikepdf.open(str(pdfs[0]), password='Stapel-Test-77') as pk:
                content = b''.join(c.read_bytes() for c in pk.pages[0].obj.Contents) if isinstance(pk.pages[0].obj.Contents, pikepdf.Array) else pk.pages[0].obj.Contents.read_bytes()
            s.expect(b'(ENTWURF) Tj' in content or b'<454E5457555246> Tj' in content, 'watermark text drawn on the page')
            s.expect(s.pdf_info(pdfs[0])['_rc'] != 0, 'must not open without password')
    s.check_page(page)

    # 3) the recipe is remembered (never the password)
    page.reload(); page.wait_for_selector('[data-wt-input]', state='attached')
    s.expect(page.locator('input[name="wt-opt-preset"][value="custom"]').is_checked(), 'preset remembered')
    s.expect(page.locator('#wt-opt-s_watermark').is_checked() and page.input_value('#wt-opt-wmText') == 'ENTWURF', 'steps remembered')
    stored = page.evaluate("() => localStorage.getItem('fale-wt-batch') || ''")
    s.expect('Stapel-Test-77' not in stored, 'password never stored')
    page.close()

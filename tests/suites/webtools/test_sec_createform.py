"""create-pdf-form: detect fields on a flat PDF (underline, label + line, box, square), add every field type by chip,
properties (name, options, default, required, editable), free resize by the corner handle, duplicate names numbered,
real AcroForm output (pypdf: types, options, defaults, flags, date actions, signature field), the result fills in
with fill-pdf-form; existing fields kept; DE/EN × phone/desktop."""
from wtlib import Suite
import pypdf

PATHS = {'de': '/werkzeuge/pdf-formular-erstellen/', 'en': '/en/tools/create-pdf-form/'}
FILL = {'de': '/werkzeuge/pdf-formular-ausfuellen/', 'en': '/en/tools/fill-pdf-form/'}

def chip(page, t):
    page.locator(f'.sec-chip[data-ftype="{t}"]').click()
    page.wait_for_selector('#sec-cf-name')

def props(page, **kw):
    for k, v in kw.items():
        loc = page.locator(f'#sec-cf-{k}')
        if isinstance(v, bool):
            (loc.check if v else loc.uncheck)(force=True)
        elif loc.evaluate('e => e.tagName') == 'SELECT':
            loc.select_option(v)
        else:
            loc.fill(v)
            loc.dispatch_event('change')

with Suite('sec-createform') as s:
    for v in s.variants():
        de = v.lang == 'de'
        shots = v.device == 'phone' and de
        page = s.open(v, PATHS[v.lang])
        if shots: s.shot(page, 'create-pdf-form_phone_initial')
        s.pick(page, 'sec_blank.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('.sec-page canvas')
        # nothing placed → clear message instead of an empty run
        s.primary(page).click()
        page.wait_for_timeout(300)
        s.expect(page.locator('.sec-status').inner_text().strip() != '' and page.locator('.wt-result:not([hidden])').count() == 0, f'{v}: blocked without fields')
        page.locator('[data-detect]').click()
        page.wait_for_function("() => /erkannt|detected/.test(document.querySelector('.sec-status')?.textContent || '')", timeout=20000)
        n_auto = page.locator('.sec-item').count()
        s.expect(n_auto >= 4, f'{v}: ≥4 fields detected ({n_auto})')
        if shots: s.shot(page, 'create-pdf-form_phone_detected', top='.sec-page')
        chip(page, 'dropdown'); props(page, name='Kurs', opts='Bronze\nSilber\nGold')
        props(page, **{'def': 'Silber'})
        props(page, edit=True)
        chip(page, 'radio'); props(page, name='Schwimmer', opts='ja\nnein')
        props(page, **{'def': 'nein'})
        chip(page, 'date'); props(page, name='Geburtsdatum', req=True)
        chip(page, 'sign'); props(page, name='Unterschrift Kunde')
        chip(page, 'check'); props(page, name='Newsletter', **{'def': True})
        chip(page, 'multiline'); props(page, name='Nachricht', max='500', tip='Bitte kurz fassen', size='10')
        chip(page, 'text'); props(page, name='Name')          # same name as the detected field → numbered
        if v.device == 'desktop':
            sel = page.locator('.sec-item.is-sel')
            w0 = sel.bounding_box()['width']
            h = sel.locator('.sec-h-size').bounding_box()
            page.mouse.move(h['x'] + h['width'] / 2, h['y'] + h['height'] / 2)
            page.mouse.down(); page.mouse.move(h['x'] + 80, h['y'] + h['height'] / 2 + 20, steps=6); page.mouse.up()
            b1 = page.locator('.sec-item.is-sel').bounding_box()
            s.expect(b1['width'] > w0 + 50 and b1['height'] > 25, f'{v}: free resize (width {w0:.0f} → {b1["width"]:.0f}, height {b1["height"]:.0f})')
        # undo / redo: an extra field disappears and comes back
        n_before = page.locator('.sec-item').count()
        chip(page, 'text'); page.wait_for_timeout(600)
        page.locator('[data-undo]').click()
        s.expect(page.locator('.sec-item').count() == n_before, f'{v}: undo removes the last field')
        page.locator('[data-redo]').click()
        s.expect(page.locator('.sec-item').count() == n_before + 1, f'{v}: redo brings it back')
        page.locator('[data-undo]').click()
        page.locator('.sec-fld-all summary').click()
        s.expect(page.locator('.sec-fld-list li').count() == n_auto + 7, f'{v}: list of all fields')
        first = page.locator('.sec-fld-list li').first.inner_text()
        s.expect(first.startswith('1. Name'), f'{v}: list in filling order: {first}')
        if shots: s.shot(page, 'create-pdf-form_phone_configured', top='.sec-page')
        s.check_page(page)
        out = s.run_and_download(page)
        if not out: page.close(); continue
        if shots: s.shot(page, 'create-pdf-form_phone_result', top='.wt-result')
        res = page.locator('.wt-result').inner_text()
        s.expect(('durchnummeriert' if de else 'got a number') in res, f'{v}: renamed note')
        ok, msg = s.qpdf_check(out); s.expect(ok, f'{v}: qpdf {msg}')
        r = pypdf.PdfReader(str(out))
        f = r.get_fields()
        names = set(f)
        order = [str(x.get_object().get('/T')) for x in r.trailer['/Root']['/AcroForm']['/Fields']]
        s.expect(order[:3] == ['Name', 'Anschrift', 'Bemerkungen'] and r.pages[0].get('/Tabs') == '/R', f'{v}: tab order row by row {order}')
        s.expect({'Name', 'Name 2', 'Anschrift', 'Bemerkungen', 'Ich stimme zu', 'Kurs', 'Schwimmer', 'Geburtsdatum', 'Unterschrift Kunde', 'Newsletter', 'Nachricht'} <= names, f'{v}: field names {sorted(names)}')
        s.expect(f['Name']['/FT'] == '/Tx' and f['Bemerkungen']['/FT'] == '/Tx' and int(f['Bemerkungen'].get('/Ff', 0)) & 4096, f'{v}: detected text + multiline')
        s.expect(f['Ich stimme zu']['/FT'] == '/Btn' and f['Newsletter'].get('/V') in ('/Yes', '/On'), f'{v}: check boxes, default ticked')
        kurs = f['Kurs']
        s.expect(kurs['/FT'] == '/Ch' and [str(o[0] if isinstance(o, list) else o) for o in kurs['/Opt']] == ['Bronze', 'Silber', 'Gold'] and kurs.get('/V') == 'Silber' and int(kurs.get('/Ff', 0)) & (1 << 18), f'{v}: drop-down {kurs}')
        sw = f['Schwimmer']
        s.expect(sw['/FT'] == '/Btn' and int(sw.get('/Ff', 0)) & (1 << 15) and [str(o) for o in sw['/Opt']] == ['ja', 'nein'] and sw.get('/V') == '/1', f'{v}: radio {sw}')
        gd = f['Geburtsdatum'].indirect_reference.get_object()
        s.expect(int(gd.get('/Ff', 0)) & 2 and int(gd.get('/MaxLen', 0)) == 10 and 'AFDate_FormatEx' in str(gd.get('/AA')), f'{v}: date field required + format {dict(gd)}')
        s.expect(f['Unterschrift Kunde']['/FT'] == '/Sig', f'{v}: signature field')
        msg_f = f['Nachricht'].indirect_reference.get_object()
        s.expect(int(msg_f.get('/MaxLen', 0)) == 500 and str(msg_f.get('/TU')) == 'Bitte kurz fassen', f'{v}: max length + tooltip')
        page.close()
        # the new form fills in with fill-pdf-form
        if v.device == 'desktop':
            fp = s.open(v, FILL[v.lang])
            fp.locator('[data-wt-input]').set_input_files(str(out))
            s.wait_ready(fp, 1)
            fp.wait_for_selector('.sec-form')
            fp.locator('.sec-field', has=fp.locator('label:text-is("Name")')).locator('input').first.fill('Jürgen Weiß')
            o2 = s.run_and_download(fp)
            if o2:
                vals = {k: x.get('/V') for k, x in pypdf.PdfReader(str(o2)).get_fields().items()}
                s.expect(vals.get('Name') == 'Jürgen Weiß' and vals.get('Kurs') == 'Silber', f'{v}: round trip with fill-pdf-form {vals}')
            fp.close()

    # PDF that already has fields: they stay, a duplicate name is numbered
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'sec_form.pdf')
    s.wait_ready(page, 1)
    page.wait_for_selector('.sec-page canvas')
    s.expect('schon' in page.locator('.sec-card').first.inner_text(), 'existing fields mentioned')
    chip(page, 'text'); props(page, name='Vorname')
    out = s.run_and_download(page)
    if out:
        f = pypdf.PdfReader(str(out)).get_fields()
        s.expect('Vorname' in f and 'Vorname 2' in f and f['Nachname'].get('/V') == 'Müller', f'existing kept, new numbered: {sorted(f)}')
        s.expect('unverändert' in page.locator('.wt-result').inner_text(), 'existing-fields note')
    s.check_page(page)

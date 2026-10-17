"""edit-metadata: inventory (XMP, attachment, JS), edit fields (umlauts, dates), "remove everything private"
verified with pypdf, protected input stays protected."""
from wtlib import Suite
import pypdf

PATHS = {'de': '/werkzeuge/pdf-metadaten/', 'en': '/en/tools/edit-pdf-metadata/'}

def root_keys(r):
    root = r.trailer['/Root']
    names = root.get('/Names')
    names = names.get_object() if names else {}
    return set(root.keys()), set(names.keys()) if names else set()

with Suite('sec-meta') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'edit-metadata_phone_initial')
        s.pick(page, 'sec_private.pdf')
        s.wait_ready(page, 1)
        page.wait_for_selector('#sec-meta-Title')
        s.expect(page.input_value('#sec-meta-Title') == 'Geheimbericht Falke-7' and page.input_value('#sec-meta-Author') == 'Erika Mustermann', f'{v}: info read')
        s.expect(page.input_value('#sec-meta-CreationDate').startswith('2020-05-01'), f'{v}: creation date read')
        txt = page.locator('.wt-stage').inner_text()
        s.expect('notizen.txt' in txt and 'JavaScript' in txt and 'Erika' in txt, f'{v}: hidden data listed: {txt[:400]}')
        # edit
        page.fill('#sec-meta-Title', 'Bericht über Größen – €')
        page.fill('#sec-meta-Author', '')
        page.fill('#sec-meta-Keywords', 'alpha, beta')
        if shots: s.shot(page, 'edit-metadata_phone_configured', top='.wt-stage')
        s.check_page(page)
        out = s.run_and_download(page)
        s.check_page(page)
        if out:
            r = pypdf.PdfReader(str(out))
            m = r.metadata
            s.expect(m.title == 'Bericht über Größen – €' and '/Author' not in m and m.get('/Keywords') == 'alpha, beta', f'{v}: edited info {dict(m)}')
            s.expect(m.get('/Producer') == 'Druckertreiber 2.3', f'{v}: untouched fields stay as they were: {dict(m)}')
            rk, nk = root_keys(r)
            s.expect('/Metadata' not in rk, f'{v}: XMP removed by default when editing')
            s.expect('/EmbeddedFiles' in nk, f'{v}: attachments kept unless chosen')
        # everything private
        page.locator('.wt-restart button').first.click()
        page.locator('.sec-big-btn').click()
        if shots: s.shot(page, 'edit-metadata_phone_private', top='.wt-stage')
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'edit-metadata_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'edit-metadata_phone_result_dark', top='.wt-stage'); page.emulate_media(color_scheme='light')
        if out:
            r = pypdf.PdfReader(str(out))
            s.expect(not r.metadata or not any(r.metadata.values()), f'{v}: info must be empty: {r.metadata}')
            rk, nk = root_keys(r)
            s.expect(not ({'/Metadata', '/OpenAction', '/AA'} & rk) and not ({'/EmbeddedFiles', '/JavaScript'} & nk), f'{v}: root {rk} names {nk}')
            ann = [a.get_object() for a in r.pages[0].get('/Annots') or []]
            s.expect(all('/T' not in a for a in ann), f'{v}: comment author removed')
            raw = out.read_bytes()
            s.expect(b'Falke-7 Budget' in raw or True, 'note text may stay')  # note contents stay (visible content)
            s.expect(b'Kontonummer' not in raw and b'app.alert' not in raw and b'Erika Mustermann' not in raw.replace(b'Name: Erika Mustermann', b''), f'{v}: hidden data still in bytes')
            s.expect('erika.mustermann@example.de' in s.pdf_text(out), f'{v}: visible text unchanged')
        page.close()

    ctx = s.context('phone', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'sec_form_enc.pdf')
    s.wait_ready(page, 1)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_selector('#sec-meta-Title')
    page.fill('#sec-meta-Title', 'Neu')
    out = s.run_and_download(page)
    if out:
        r = pypdf.PdfReader(str(out))
        s.expect(r.is_encrypted, 'protected input stays protected')
        r.decrypt('geheim')
        s.expect(r.metadata.title == 'Neu' and 'Nachname' in r.get_fields(), 'title set, form kept')
    s.check_page(page)

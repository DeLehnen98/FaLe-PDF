"""E-mail signature: DE/EN × phone/desktop (CSP, a11y, no horizontal scroll), live preview with tel/mailto/https
links, unsafe profile URL dropped, mandatory details per legal form (GmbH missing → complete), rich copy to the
clipboard (HTML + text), .htm and .txt files, dark preview, logo by URL, nothing stored, no freeze."""
from wtlib import Suite, ORIGIN

P = ('/werkzeuge/e-mail-signatur/', '/en/tools/email-signature-generator/')


def typ(page, sel, text):
    page.fill(sel, text)


with Suite('email-signature') as s:
    for v in s.variants():
        page = s.open(v, P[0 if v.lang == 'de' else 1])
        page.wait_for_selector('#sig-name')
        s.expect(s.primary(page).is_disabled(), f'{v}: nothing to save without a name')
        typ(page, '#sig-name', 'Erika Mustermann'); typ(page, '#sig-title', 'Inhaberin')
        page.wait_for_timeout(150)
        s.expect(not s.primary(page).is_disabled(), f'{v}: save enabled')
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'email_signature_phone', top='#sig-preview')
        s.check_page(page)
        page.close()

    ctx = s.context('desktop', 'de')
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=ORIGIN)
    page = s.open(ctx, P[0])
    page.wait_for_selector('#sig-name')
    for sel, val in [('#sig-name', 'Erika Mustermann'), ('#sig-title', 'Geschäftsführerin'), ('#sig-company', 'Muster Werkstatt GmbH'),
                     ('#sig-phone', '+49 (0) 681 123 45-6'), ('#sig-email', 'erika@muster.de'), ('#sig-web', 'muster.de'),
                     ('#sig-street', 'Hauptstraße 1'), ('#sig-city', '66111 Saarbrücken')]:
        typ(page, sel, val)
    page.locator('.sig-more summary').click()
    typ(page, '#sig-linkedin', 'linkedin.com/in/erika')
    typ(page, '#sig-instagram', 'javascript:alert(1)')
    page.wait_for_timeout(150)
    hrefs = page.eval_on_selector_all('#sig-preview a', 'as => as.map(a => a.getAttribute("href"))')
    s.expect('tel:+49681123456' in hrefs and 'mailto:erika@muster.de' in hrefs and 'https://muster.de/' in hrefs and 'https://linkedin.com/in/erika' in hrefs, f'links {hrefs}')
    s.expect(not any(h.startswith('javascript') for h in hrefs) and 'Instagram' not in page.locator('#sig-preview').inner_text(), 'unsafe URL dropped')
    page.locator('#sig-form').select_option('gmbh')
    page.wait_for_timeout(150)
    note = page.locator('.sig-check').inner_text()
    s.expect('Registergericht' in note and 'Geschäftsführer' in note, f'missing details listed ({note})')
    s.expect('fehlen' in page.locator('.wt-bar').inner_text(), 'bar summary mentions missing details')
    typ(page, '#sig-seat', 'Saarbrücken'); typ(page, '#sig-court', 'Amtsgericht Saarbrücken'); typ(page, '#sig-reg', 'HRB 12345'); typ(page, '#sig-managers', 'Erika Mustermann')
    page.wait_for_timeout(150)
    s.expect('Alle Pflichtangaben' in page.locator('.sig-check').inner_text(), 'complete for GmbH')
    txt = page.locator('#sig-preview').inner_text()
    s.expect('Amtsgericht Saarbrücken, HRB 12345' in txt and 'Geschäftsführung: Erika Mustermann' in txt, f'legal lines in preview ({txt[-200:]!r})')
    # dark preview
    page.locator('#sig-dark').check()
    s.expect('is-dark' in page.locator('.sig-frame').get_attribute('class'), 'dark preview')
    # rich copy
    page.click('#sig-copy')
    page.wait_for_timeout(300)
    clip = page.evaluate("""async () => { const items = await navigator.clipboard.read(); const out = {};
      for (const it of items) for (const t of it.types) out[t] = await (await it.getType(t)).text(); return out; }""")
    s.expect('<table' in clip.get('text/html', '') and 'HRB 12345' in clip.get('text/html', '') and clip.get('text/plain', '').startswith('-- '), f'clipboard html + text ({list(clip)})')
    s.expect('style="' in clip.get('text/html', '') and 'border-left' in clip.get('text/html', ''), 'inline styles in copied HTML')
    if s.run(page):
        htm = s.download(page, 0).read_text('utf-8')
        txtf = s.download(page, 1).read_text('utf-8')
        s.expect(htm.startswith('<!DOCTYPE html>') and '<meta charset="utf-8">' in htm and '<script' not in htm and 'HRB 12345' in htm, 'htm file')
        s.expect('Erika Mustermann' in txtf and 'Amtsgericht Saarbrücken, HRB 12345' in txtf and 'erika@muster.de' in txtf, 'txt file')
        page.locator('.wt-restart button').first.click()
    s.expect(page.evaluate("() => [localStorage.length, sessionStorage.length]") == [0, 0], 'nothing stored')
    s.check_page(page)
    s.record_freeze(page)
    # logo by URL: the user's own address is the one request allowed to leave (served locally here)
    import base64
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
    page.route('https://example.org/logo.png', lambda r: r.fulfill(status=200, content_type='image/png', body=png))
    typ(page, '#sig-logo', 'https://example.org/logo.png')
    page.locator('label', has_text='Logo links').click()
    page.wait_for_timeout(150)
    s.expect(page.locator('#sig-preview img').get_attribute('src') == 'https://example.org/logo.png' and page.locator('#sig-preview td').count() >= 2, 'logo left layout')
    s.fails[:] = [f for f in s.fails if 'example.org/logo.png' not in f]   # entered by the user on purpose
    page.close()

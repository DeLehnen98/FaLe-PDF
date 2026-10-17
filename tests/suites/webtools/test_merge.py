"""merge-pdf: PDFs + images mixed, password, per-file pages, reorder (buttons + touch drag), bookmarks, form fields."""
from wtlib import Suite
from pypdf import PdfReader

PATHS = {'de': '/werkzeuge/pdf-zusammenfuegen/', 'en': '/en/tools/merge-pdf/'}

with Suite('merge-pdf') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'merge_phone_initial')
        s.pick(page, 'text3.pdf')
        s.wait_ready(page, 1)
        s.expect(s.primary(page).is_disabled(), f'{v}: button must be disabled with 1 file (minFiles 2)')
        s.pick(page, 'text5.pdf', 'photo_exif6.jpg', 'form.pdf', 'encrypted_aes256.pdf', 'broken.pdf')
        s.wait_ready(page, 6)
        s.expect(page.locator('.wt-file.is-error').count() == 1, f'{v}: broken.pdf should be marked as error')
        s.expect(s.primary(page).is_disabled(), f'{v}: button must wait for the password')
        page.fill('.wt-lock input', 'falsch'); page.click('.wt-lock button')
        page.wait_for_selector('.wt-lock .wt-opt-err:not([hidden])')
        page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
        s.wait_ready(page, 6)
        page.wait_for_function("() => !document.querySelector('.wt-file.is-locked')")
        # remove the broken file, pages 2-4 of text5
        page.locator('.wt-file.is-error .wt-rm').click()
        card5 = page.locator('.wt-file', has_text='text5.pdf')
        card5.locator('summary').click()
        card5.locator('input.wt-input').fill('2-4')
        # order now: text3, text5, photo, form, encrypted → move photo to the top
        photo = page.locator('.wt-file', has_text='photo_exif6.jpg')
        if v.device == 'phone':
            page.locator('.wt-files-head').scroll_into_view_if_needed()
            grip = photo.locator('.wt-grip')
            box = grip.bounding_box()
            first = page.locator('.wt-file').first.bounding_box()
            page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.mouse.down()
            for i in range(1, 16):
                page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2 - i * (box['y'] - first['y'] + 20) / 15)
            page.mouse.up()
        else:
            photo.locator('button[aria-label*="oben"], button[aria-label*="up"]').click()
            page.locator('.wt-file', has_text='photo_exif6.jpg').locator('button[aria-label*="oben"], button[aria-label*="up"]').click()
        names = page.evaluate("[...document.querySelectorAll('.wt-file .wt-file-name')].map(n => n.textContent)")
        s.expect(names[0] == 'photo_exif6.jpg', f'{v}: photo should be first after reorder, got {names}')
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'merge_phone_files', top='.wt-files-head')
        s.check_page(page)
        out = s.run_and_download(page)
        if v.device == 'phone' and v.lang == 'de':
            s.shot(page, 'merge_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'merge_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if not out:
            continue
        s.expect(('weitere' if v.lang == 'de' else 'more') in out.name, f'{v}: output name {out.name}')
        s.expect(s.pdf_pages(out) == 1 + 3 + 3 + 1 + 3, f'{v}: page count {s.pdf_pages(out)} != 11')
        text = s.pdf_text(out)
        order = [text.find(t) for t in ('Alpha Seite 1', 'Beta Seite 2', 'Beta Seite 4', 'Formular')]
        s.expect(all(o >= 0 for o in order) and order == sorted(order), f'{v}: text order wrong {order}')
        s.expect('Beta Seite 1' not in text and 'Beta Seite 5' not in text, f'{v}: page range 2-4 not applied')
        ok, msg = s.qpdf_check(out)
        s.expect(ok, f'{v}: qpdf --check failed: {msg}')
        r = PdfReader(str(out))
        titles = [o.title for o in r.outline]
        s.expect(titles == ['photo_exif6', 'text3', 'text5', 'form', 'encrypted_aes256'], f'{v}: bookmarks {titles}')
        fields = r.get_fields() or {}
        s.expect('Name' in fields and fields['Name'].get('/V') == 'Ada', f'{v}: form field lost: {list(fields)}')
        w, h = s.page_sizes(out)[0]
        s.expect(abs(w - 595.28) < 1 and abs(h - 841.89) < 1, f'{v}: image page should be portrait A4, got {w}x{h}')
        img = s.render(out, 1, 40)
        top = img.getpixel((img.width // 2, int(img.height * 0.07)))
        s.expect(top[0] > 180 and top[2] < 90, f'{v}: EXIF-rotated photo: expected red at the top, got {top}')
        link = any('/Annots' in p for p in r.pages[1:2])
        s.expect(link, f'{v}: link annotation of text3 page 1 lost')

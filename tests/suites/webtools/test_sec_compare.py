"""compare-pdf: word diff counts, merged/side views with change navigation, visual overlay (red/green),
report PDF content, swapped order, identical files, encrypted input."""
from wtlib import Suite
from uni_testlib import check_unicode_pdf

PATHS = {'de': '/werkzeuge/pdf-vergleichen/', 'en': '/en/tools/compare-pdf/'}

with Suite('sec-compare') as s:
    for v in s.variants():
        page = s.open(v, PATHS[v.lang])
        shots = v.device == 'phone' and v.lang == 'de'
        if shots: s.shot(page, 'compare-pdf_phone_initial')
        s.pick(page, 'sec_v1.pdf', 'sec_v2.pdf')
        s.wait_ready(page, 2)
        page.wait_for_selector('.sec-sum', timeout=30000)
        nums = [int(x) for x in page.locator('.sec-sum strong').all_inner_texts()]
        s.expect(nums[0] == 4, f'{v}: 4 changes expected (3 edits + moved page header), got {nums}')
        s.expect(nums[1] >= 10 and nums[2] >= 3, f'{v}: insert/delete counts {nums}')
        body = page.locator('.sec-diff').inner_text()
        s.expect('820' in page.locator('.sec-diff ins').all_inner_texts().__str__() and '750' in page.locator('.sec-diff del').all_inner_texts().__str__(), f'{v}: 750→820 marked')
        s.expect('Tiefgarage' in ' '.join(page.locator('.sec-diff ins').all_inner_texts()), f'{v}: inserted sentence marked')
        # default view: merged on phone, side by side on desktop
        side = page.locator('.sec-diff-cols.is-side').count() == 1
        s.expect(side == (v.device == 'desktop'), f'{v}: default view side={side}')
        # change navigation
        for _ in range(3): page.locator('.sec-changenav button').nth(1).click()
        s.expect(('3 von 4' if v.lang == 'de' else '3 of 4') in page.locator('.sec-changenav span').inner_text(), f'{v}: navigation counter')
        s.expect(page.locator('.sec-diff .is-cur').count() >= 1, f'{v}: current change highlighted')
        if shots: s.shot(page, 'compare-pdf_phone_configured', top='.sec-sum')
        s.check_page(page)
        # visual view
        page.locator('.sec-seg button').nth(2).click()
        page.wait_for_selector('.sec-visual canvas')
        page.locator('.sec-nav-btn').nth(1).click()
        page.wait_for_function("() => /%/.test(document.querySelector('.sec-visual')?.previousElementSibling?.textContent || '')", timeout=20000)
        red = page.evaluate("""() => { const c = document.querySelector('.sec-visual canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let r = 0, g = 0, a = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i+1] < 80) r++; if (d[i+1] > 140 && d[i] < 80) g++; if (d[i] > 230 && d[i+1] > 120 && d[i+1] < 160 && d[i+2] < 30) a++; } return [r, g, a]; }""")
        s.expect(red[0] > 300 and red[1] > 300 and red[2] > 10000, f'{v}: page 2: red/green text changes + amber colour change {red}')
        if shots: s.shot(page, 'compare-pdf_phone_visual', top='.sec-seg')
        s.check_page(page)
        out = s.run_and_download(page)
        if shots:
            s.shot(page, 'compare-pdf_phone_result', top='.wt-result')
            page.emulate_media(color_scheme='dark'); s.shot(page, 'compare-pdf_phone_result_dark', top='.wt-result'); page.emulate_media(color_scheme='light')
        s.check_page(page)
        if out:
            t = s.pdf_text(out)
            s.expect(('4 Änderungen' in t or '4 changes' in t) and '820' in t and 'Tiefgarage' in t and 'Vermieter.' in t, f'{v}: report text {t[:500]!r}')
            s.expect(s.pdf_pages(out) >= 3, f'{v}: report has visual pages ({s.pdf_pages(out)})')
        page.close()

    # identical files + encrypted input
    ctx = s.context('phone', 'en')
    page = s.open(ctx, PATHS['en'])
    s.pick(page, 'text3.pdf', 'encrypted_aes256.pdf')
    s.wait_ready(page, 2)
    page.fill('.wt-lock input', 'geheim'); page.click('.wt-lock button')
    page.wait_for_selector('.sec-sum', timeout=30000)
    nums = [int(x) for x in page.locator('.sec-sum strong').all_inner_texts()]
    s.expect(nums == [0, 0, 0], f'identical text: {nums}')
    s.check_page(page)
    page.close()

    # swapping order inverts insert/delete
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'sec_v2.pdf', 'sec_v1.pdf')
    s.wait_ready(page, 2)
    page.wait_for_selector('.sec-sum', timeout=30000)
    nums = [int(x) for x in page.locator('.sec-sum strong').all_inner_texts()]
    page.locator('.wt-file').first.locator('.wt-icon-btn').nth(1).click()
    page.wait_for_function("n => { const e = [...document.querySelectorAll('.sec-sum strong')].map(x => +x.textContent); return e.length && e[1] === n[2] && e[2] === n[1]; }", arg=nums, timeout=20000)
    s.check_page(page)

    # Unicode documents (fixtures from uni_fixtures.mjs): the report shows Polish, Greek, Cyrillic, Turkish, € as text
    page = s.open(ctx, PATHS['de'])
    s.pick(page, 'uni_v1.pdf', 'uni_v2.pdf')
    s.wait_ready(page, 2)
    page.wait_for_selector('.sec-sum', timeout=30000)
    out = s.run_and_download(page)
    if out:
        check_unicode_pdf(s, out, ['Ελληνικά', 'Привет', 'Türkçe', 'İğ', '120'], 'compare report')
        rt = page.locator('.wt-result').inner_text()
        s.expect('nicht darstellen' not in rt, f'no replacement note: {rt[:200]!r}')
    s.check_page(page)
    page.close()

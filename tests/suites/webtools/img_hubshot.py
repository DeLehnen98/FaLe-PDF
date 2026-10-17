from wtlib import Suite
with Suite('img-hub') as s:
    for lang, path in [('de', '/werkzeuge/'), ('en', '/en/tools/')]:
        ctx = s.context('phone', lang)
        page = s.open(ctx, path, wait_shell=False)
        page.wait_for_timeout(500)
        s.check_page(page)
        cats = page.evaluate("() => [...document.querySelectorAll('[data-wt-catsec]')].map(x => x.dataset.wtCatsec + ':' + x.querySelectorAll('[data-wt-tool]').length)")
        print(lang, cats)
        if lang == 'de':
            page.locator('[data-wt-catsec="images"]').scroll_into_view_if_needed(); s.shot(page, 'img_hub_phone_images')

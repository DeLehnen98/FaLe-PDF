"""Chain: merge → "Weiter mit: PDF komprimieren" → the merged file is loaded without re-selecting it."""
from wtlib import Suite

with Suite('chain merge→compress') as s:
    for lang, path in (('de', '/werkzeuge/pdf-zusammenfuegen/'), ('en', '/en/tools/merge-pdf/')):
        ctx = s.context('phone', lang)
        page = s.open(ctx, path)
        s.pick(page, 'text3.pdf', 'photos.pdf')
        s.wait_ready(page, 2)
        s.run(page)
        chips = page.locator('.wt-next-chip')
        s.expect(chips.count() == 2, f'{lang}: two "continue with" chips expected (compress, protect)')
        chip = chips.filter(has_text=__import__('re').compile('omprim|ompress'))
        with page.expect_navigation():
            chip.click()
        s.expect('/pdf-komprimieren/' in page.url or '/compress-pdf/' in page.url, f'{lang}: navigated to {page.url}')
        page.wait_for_function("() => document.documentElement.classList.contains('wt-js')")
        s.wait_ready(page, 1)
        name = page.locator('.wt-file .wt-file-name').inner_text()
        s.expect(('weitere' if lang == 'de' else 'more') in name, f'{lang}: handed-off file name {name}')
        s.expect('weiter' not in page.url and 'continue' not in page.url, f'{lang}: hand-off flag should be removed from the URL')
        out = s.run_and_download(page)
        if out:
            s.expect(s.pdf_pages(out) == 6, f'{lang}: compressed merged file should have 6 pages')
            s.expect(out.stat().st_size < 1_500_000, f'{lang}: compressed size {out.stat().st_size}')
        left = page.evaluate("""() => new Promise(r => { const q = indexedDB.open('fale-wt', 1);
            q.onupgradeneeded = () => q.result.createObjectStore('handoff');
            q.onsuccess = () => { const g = q.result.transaction('handoff').objectStore('handoff').get('current'); g.onsuccess = () => r(g.result === undefined); }; })""")
        s.expect(left, f'{lang}: hand-off store must be cleared after use')
        s.check_page(page)

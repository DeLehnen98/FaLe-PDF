from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    for lang in ('de', 'en'):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='de-DE' if lang == 'de' else 'en-US')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.goto('http://localhost:8791/'); pg.wait_for_timeout(1500)
        for r in ('#/einstellungen', '#/ich'):
            pg.evaluate(f"location.hash='{r}'"); pg.wait_for_timeout(1200)
            el = pg.locator('[data-fale-network]')
            if el.count(): break
        el.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
        box = el.bounding_box()
        pg.screenshot(path=f'out_network/fale-pdf-ich-card-{lang}.png', clip={'x': 0, 'y': max(0, box['y'] - 80), 'width': 390, 'height': 260})
        print(lang, el.inner_text().replace('\n', ' | '), errs)
        ctx.close()
    b.close()

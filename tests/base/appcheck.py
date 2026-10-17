from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.goto('http://127.0.0.1:8940/#/start'); pg.wait_for_timeout(2500)
    r = pg.evaluate("""async () => { const d = await import('./js/domains.js'); const s = await import('./js/share/api.js'); const a = await import('./js/ai/config.js');
      const sg = await import('./js/share/signer.js'); await import('./js/smart/family.js');
      return [d.PDF_ORIGIN, d.PDF_HOST, s.PUBLIC_ORIGIN, a.AI_CONFIG.API_BASE_NATIVE, s.linkBase()]; }""")
    print(r)
    hrefs = []
    for route in ['#/mehr', '#/einstellungen', '#/me', '#/ich']:
        pg.goto('http://127.0.0.1:8940/' + route); pg.wait_for_timeout(1200)
        hrefs = pg.eval_on_selector_all('[data-fale-network]', 'els => els.map(e => e.href)')
        if hrefs: print(route, hrefs); break
    print('errors:', errs[:5]); b.close()

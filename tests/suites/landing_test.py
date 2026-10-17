from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b = p.chromium.launch()
    for page_name in ['info.html', 'info-en.html']:
        for (w, h, scheme) in [(360, 740, 'light'), (360, 740, 'dark'), (1280, 900, 'light')]:
            ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=1)
            pg = ctx.new_page()
            reqs = []
            pg.on('request', lambda r: reqs.append(r.url))
            errs = []
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            pg.goto('http://127.0.0.1:8802/' + page_name); pg.wait_for_load_state('networkidle')
            pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
            pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(500)
            info = pg.evaluate("""() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
              wide: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'absolute'; }).map(e => e.tagName + '.' + e.className).slice(0, 5),
              imgsNoAlt: [...document.querySelectorAll('img:not([alt])')].length,
              h1: document.querySelectorAll('h1').length, canon: document.querySelector('link[rel=canonical]').href,
              ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'INVALID'; } }),
              smallTargets: [...document.querySelectorAll('a,button,summary')].filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 24; }).map(e => e.textContent.trim().slice(0, 20)) })""")
            external = [u for u in reqs if not u.startswith('http://127.0.0.1:8802/')]
            print(page_name, w, scheme, json.dumps(info), 'external:', external, 'errors:', errs, 'requests:', len(reqs))
            pg.evaluate("window.scrollTo(0, 0)")
            pg.screenshot(path=f'explore/landing_{page_name[:-5]}_{w}_{scheme}.png', full_page=True)
            ctx.close()
    b.close()

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(); ctx.add_init_script("try{localStorage.setItem('fale-lang','en')}catch(e){}")
    pg=ctx.new_page()
    pg.on('request', lambda r: print(r.method, r.url) if r.method!='GET' else None)
    pg.goto('http://127.0.0.1:9300/#/start'); pg.wait_for_timeout(4000)
    for h in ['#/briefkasten','#/gedaechtnis','#/steuer/2026','#/familie','#/werkzeuge']:
        pg.evaluate(f"location.hash='{h}'"); pg.wait_for_timeout(1500)
    b.close()

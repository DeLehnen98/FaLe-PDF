import base64, json, sys, time
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:9300/'
logs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':1280,'height':900}, locale='de-DE')
    pg=ctx.new_page()
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'pageerror: {e}'))
    pg.add_init_script("try{localStorage.setItem('fale-onboarded','1');localStorage.setItem('fale-onboarding','done');localStorage.setItem('fale-lang','de')}catch(e){}")
    pg.goto(URL+'#/start'); pg.wait_for_timeout(1500)
    data=base64.b64encode(open('corpus/r01.pdf','rb').read()).decode()
    did=pg.evaluate("""async (b64) => { const u = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const lib = await import('/js/library.js'); const d = await lib.importAny(new File([u], 'Stadtwerke.pdf', {type:'application/pdf'}), {quiet:true, silent:true}); return d.id; }""", data)
    pg.goto(URL+'#/briefkasten/neu?doc='+did)
    pg.wait_for_selector('.sm-letter', timeout=20000)
    pg.wait_for_timeout(800)
    pg.screenshot(path='out/dev_letter.png', full_page=True)
    print(pg.evaluate("location.hash"))
    pg.goto(URL+'#/start'); pg.wait_for_timeout(1200); pg.screenshot(path='out/dev_start.png', full_page=False)
    pg.goto(URL+'#/suche?q=Wann%20muss%20ich%20die%20Stadtwerke%20bezahlen%3F'); pg.wait_for_timeout(2500); pg.screenshot(path='out/dev_search.png', full_page=True)
    b.close()
print('\n'.join(logs[:30]))

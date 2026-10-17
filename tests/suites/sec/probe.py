import sys, json, time
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:9404/'
TD='/home/claude/FalePDF/tests/base/testdata'
probs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':1366,'height':860})
    pg=ctx.new_page()
    pg.on('console', lambda m: probs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: probs.append(f'[pageerror] {e}'))
    pg.add_init_script("window.__viol=[];document.addEventListener('securitypolicyviolation',e=>window.__viol.push(e.violatedDirective+' '+e.blockedURI+' '+(e.sample||'')))")
    r=pg.goto(URL); print('csp hdr', (r.headers.get('content-security-policy') or '')[:60])
    pg.wait_for_timeout(1500)
    print('tt', pg.evaluate('window.__faleTT'), 'tt support', pg.evaluate('!!window.trustedTypes'))
    for route in ['#/dateien','#/werkzeuge','#/suche','#/einstellungen','#/start']:
        pg.goto(URL+route); pg.wait_for_timeout(700)
    with pg.expect_file_chooser() as fc:
        pg.click('[data-action=open-file]')
    fc.value.set_files(TD+'/bericht.pdf')
    pg.wait_for_timeout(2500)
    print('url', pg.url)
    print('viol', pg.evaluate('window.__viol'))
    print('tt', pg.evaluate('window.__faleTT'))
    b.close()
for x in probs[:30]: print(x)

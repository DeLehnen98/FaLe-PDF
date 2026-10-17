import os, sys
sys.argv=[sys.argv[0],'none']
SP=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,SP)
import test_native as T
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br=p.chromium.launch(); ctx=br.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='de-DE')
    ctx.add_init_script(T.MOCK_PLUGINS)
    ctx.add_init_script("Object.defineProperty(window,'print',{configurable:true,writable:true,value:function(){ console.log('PRINTCALLED', Error.stackTraceLimit, new Error('x').stack); }})")
    page=ctx.new_page()
    page.on('console', lambda m: print('console', m.text[:800]) if 'PRINT' in m.text else None)
    pdf=open(os.path.join(SP,'testdata','bericht.pdf'),'rb').read()
    page.route('**/_capacitor_file_/**', lambda r: r.fulfill(status=200, body=pdf, headers={'Content-Type':'application/pdf'}))
    page.goto('http://127.0.0.1:8890/')
    page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
    page.wait_for_selector('.pdfViewer .page canvas', timeout=20000)
    page.locator('[data-v="more"]').click()
    page.locator('.menu-layer .menu-item', has_text='Drucken').click()
    page.wait_for_timeout(3000)
    br.close()

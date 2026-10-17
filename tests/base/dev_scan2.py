import os
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__)); TD = os.path.join(SP, 'testdata')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={TD}/cam_doc.y4m'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'])
    page = ctx.new_page()
    page.goto('http://127.0.0.1:8792/#/werkzeug/scannen')
    page.wait_for_function("document.querySelector('.sc-view video') && document.querySelector('.sc-view video').videoWidth > 0", timeout=15000)
    print('video', page.evaluate("[document.querySelector('video').videoWidth, document.querySelector('video').videoHeight]"))
    print('takePhoto', page.evaluate("""async () => { const t = document.querySelector('video').srcObject.getVideoTracks()[0]; try { const b = await new ImageCapture(t).takePhoto(); const bm = await createImageBitmap(b); return [b.size, bm.width, bm.height]; } catch (e) { return 'ERR ' + e.message; } }"""))
    page.locator('[data-shoot]').click()
    page.wait_for_function("document.querySelector('[data-stack] img')", timeout=20000)
    print('thumb', page.evaluate("(() => { const i = document.querySelector('[data-stack] img'); return [i.naturalWidth, i.naturalHeight]; })()"))
    b.close()

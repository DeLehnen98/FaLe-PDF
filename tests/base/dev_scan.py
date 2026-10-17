import os, sys
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(SP, 'out_protools'); TD = os.path.join(SP, 'testdata')
mode = sys.argv[1] if len(sys.argv) > 1 else 'phone'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={TD}/cam_doc.y4m'])
    vp = {'width': 390, 'height': 844} if mode == 'phone' else {'width': 1366, 'height': 860}
    ctx = b.new_context(viewport=vp, device_scale_factor=2 if mode == 'phone' else 1, is_mobile=mode == 'phone', has_touch=mode == 'phone', accept_downloads=True, permissions=['camera'])
    page = ctx.new_page()
    page.on('console', lambda m: print('LOG', m.type, m.text) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print('ERR', e))
    page.goto('http://127.0.0.1:8792/#/werkzeug/scannen')
    page.wait_for_function("document.querySelector('.sc-view video') && document.querySelector('.sc-view video').videoWidth > 0", timeout=15000)
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUT, f'dev_scan_cam_{mode}.png'))
    page.locator('[data-shoot]').click()
    page.wait_for_function("document.querySelector('[data-stack] b')", timeout=20000)
    page.wait_for_function("document.querySelector('[data-stack] img')", timeout=20000)
    # second page via file chooser (Album/Dateien)
    with page.expect_file_chooser() as fc:
        page.locator('[data-gallery]').click()
    fc.value.set_files([os.path.join(TD, 'scan_2_dark.jpg'), os.path.join(TD, 'scan_3_gray.jpg')])
    page.wait_for_selector('.sc-card', timeout=20000)
    page.wait_for_function("Array.from(document.querySelectorAll('.sc-card img')).every(i => i.src && i.naturalWidth > 0)", timeout=20000)
    print('cards', page.locator('.sc-card').count())
    page.screenshot(path=os.path.join(OUT, f'dev_scan_review_{mode}.png'))
    # edit page 1
    page.locator('.sc-card [data-edit]').first.click()
    page.wait_for_selector('.sc-handle')
    page.wait_for_timeout(400)
    hd = page.locator('.sc-handle').first.bounding_box()
    page.mouse.move(hd['x'] + 22, hd['y'] + 22); page.mouse.down(); page.mouse.move(hd['x'] + 40, hd['y'] + 30, steps=5)
    page.screenshot(path=os.path.join(OUT, f'dev_scan_crop_{mode}.png'))
    page.mouse.up()
    page.locator('.screen-foot .btn-primary').click()  # Weiter → filter
    page.wait_for_selector('.sc-result', timeout=20000)
    page.locator('[data-f=bw]').click()
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUT, f'dev_scan_filter_{mode}.png'))
    page.locator('.screen-foot .btn-primary').click()  # Übernehmen
    page.wait_for_selector('.sc-card')
    page.locator('.screen-foot .btn-primary').click()  # PDF speichern
    page.wait_for_selector('.result-card', timeout=30000)
    with page.expect_download() as d: page.locator('.result-card [data-r=dl]').click()
    out = os.path.join(OUT, f'scan_{mode}.pdf'); d.value.save_as(out)
    page.screenshot(path=os.path.join(OUT, f'dev_scan_done_{mode}.png'))
    b.close()
from pypdf import PdfReader
r = PdfReader(out)
print('pages', len(r.pages), [tuple(round(float(x)) for x in pg.mediabox[2:]) for pg in r.pages])

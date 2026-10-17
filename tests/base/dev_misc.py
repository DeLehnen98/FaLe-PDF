import sys
from playwright.sync_api import sync_playwright
from pplus_common import *
ensure_server()
which = sys.argv[1] if len(sys.argv) > 1 else 'all'
with sync_playwright() as p:
    b = launch(p)
    phone = 'phone' in sys.argv
    ctx = context(b, phone=phone); pg = ctx.new_page(); attach(pg, 'dev')
    pg.goto(URL); pg.wait_for_timeout(800)
    if which in ('all', 'qr'):
        goto(pg, '#/werkzeug/qr-erstellen', '.qt-types')
        pg.fill('[name=url]', 'https://fale.dev/pdf?x=1')
        pg.wait_for_timeout(300)
        print(pg.locator('[data-info]').text_content())
        shot(pg, 'dev_qr')
    if which in ('all', 'pp'):
        goto(pg, '#/werkzeug/passfoto', '.pp-tpls')
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-pick]').click()
        fc.value.set_files(os.path.join(TDP, 'portrait.jpg'))
        pg.wait_for_selector('.pp-frame', timeout=10000); pg.wait_for_timeout(500)
        shot(pg, 'dev_pp_adjust')
        pg.locator('[data-tab=bg]').click(); pg.locator('[data-bgmode]').click()
        bb = pg.locator('.pp-frame').bounding_box()
        pg.mouse.click(bb['x'] + 8, bb['y'] + 8); pg.wait_for_timeout(500)
        shot(pg, 'dev_pp_bg')
        pg.locator('.screen-foot .btn-primary').click(); pg.wait_for_selector('[data-sheet] canvas', timeout=10000)
        pg.wait_for_timeout(300)
        shot(pg, 'dev_pp_export')
    if which in ('all', 'img'):
        goto(pg, '#/werkzeug/bildwerkzeuge', '[data-pick]')
        with pg.expect_file_chooser() as fc:
            pg.locator('[data-pick]').click()
        fc.value.set_files(os.path.join(TDP, 'schatten.jpg'))
        pg.wait_for_selector('.it-canvas', timeout=10000)
        pg.locator('[data-tool=shadow]').click(); pg.wait_for_timeout(1500)
        shot(pg, 'dev_img_shadow')
        pg.locator('[data-apply]').click(); pg.wait_for_function("document.querySelector('[data-busy]').hidden", timeout=20000)
        pg.locator('[data-tool=filter]').click(); pg.wait_for_timeout(1500)
        shot(pg, 'dev_img_filter')
        pg.locator('[data-tool=crop]').click(); pg.wait_for_timeout(500)
        shot(pg, 'dev_img_crop')
    if which in ('all', 'sig'):
        goto(pg, '#/werkzeug/signaturen', '.ss-grid')
        pg.locator('.ss-new').first.click()
        pg.wait_for_selector('dialog .sig-pad')
        pg.wait_for_timeout(300)
        bb = pg.locator('dialog .sig-pad').bounding_box()
        pg.mouse.move(bb['x'] + 30, bb['y'] + 100); pg.mouse.down()
        for i in range(30): pg.mouse.move(bb['x'] + 30 + i * 9, bb['y'] + 100 + (20 if i % 2 else -20), steps=2)
        pg.mouse.up()
        shot(pg, 'dev_sig_draw')
        pg.locator('dialog .btn-primary').click(); pg.wait_for_timeout(800)
        pg.locator('.ss-section').nth(2).locator('.ss-new').click()
        pg.wait_for_selector('dialog .ss-stamp-prev canvas'); pg.wait_for_timeout(300)
        pg.locator('dialog [data-preset=eingang]').click(); pg.wait_for_timeout(200)
        shot(pg, 'dev_stamp_designer')
        pg.locator('dialog .btn-primary').click(); pg.wait_for_timeout(800)
        shot(pg, 'dev_sig_library')
    ctx.close(); b.close()
print('\n'.join(console))

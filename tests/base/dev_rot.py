import subprocess, cv2
from playwright.sync_api import sync_playwright
from pplus_common import *
def render(path, page=1):
    out = os.path.join(OUT, 't_rrender')
    subprocess.run(['pdftoppm', '-r', '150', '-f', str(page), '-l', str(page), '-png', '-singlefile', path, out], check=True)
    return cv2.imread(out + '.png')
with sync_playwright() as p:
    b = launch(p); ctx = context(b); pg = ctx.new_page(); attach(pg, 'rot')
    pg.goto(URL); pg.wait_for_timeout(700)
    import_pdfs(pg, [os.path.join(TDP, 'gedreht.pdf')])
    did = doc_id(pg, 'gedreht.pdf')
    goto(pg, '#/werkzeug/qr-erstellen', '.qt-types')
    pg.fill('[name=url]', 'https://fale.dev/rot')
    pg.locator('[data-choose]').click(); pg.wait_for_selector('dialog .pick-item')
    pg.locator(f'dialog input[value="{did}"]').check(); pg.locator('dialog .btn-primary').click()
    pg.wait_for_selector('.qt-mark svg', timeout=15000)
    pg.locator('[data-corner=br]').click()
    pg.locator('[data-apply]').click()
    pg.wait_for_selector('[data-result] .result-card', timeout=20000)
    path = download_from(pg, pg.locator('[data-result] [data-r=dl]'), 'rot_qr.pdf')
    img = render(path)
    h, w = img.shape[:2]
    print('rendered', w, h)
    br = img[int(h*0.6):, int(w*0.6):]
    cv2.imwrite(os.path.join(OUT, 'dbg_rot_br.png'), br)
    val, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.copyMakeBorder(br, 30,30,30,30, cv2.BORDER_CONSTANT, value=(255,255,255)))
    print('decoded bottom-right:', val)
    # crop on rotated page
    goto(pg, f'#/werkzeug/zuschneiden?doc={did}', '.cr-box')
    pg.locator('[data-auto]').click(); pg.wait_for_timeout(1000)
    pg.locator('[data-scope=one]').click()
    pg.locator('.screen-foot .btn-primary').click()
    pg.wait_for_selector('[data-result] .result-card', timeout=20000)
    path = download_from(pg, pg.locator('[data-result] [data-r=dl]'), 'rot_crop.pdf')
    from pypdf import PdfReader
    r = PdfReader(path); print('cropbox rotated page', [round(float(v)) for v in r.pages[0].cropbox], r.pages[0].get('/Rotate'))
    b.close()
print(console)

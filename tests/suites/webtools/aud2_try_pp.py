import os; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite
from PIL import Image
with Suite('aud2-pp') as s:
    page = s.open(s.context('phone', 'de'), '/werkzeuge/passfoto/')
    s.pick(page, 'img/portrait.jpg'); s.wait_ready(page, 1)
    page.wait_for_function("() => document.querySelector('.img-pp-frame').offsetWidth > 100")
    fr = page.locator('.img-pp-frame'); fr.evaluate("e => e.scrollIntoView({block: 'center'})"); page.wait_for_timeout(200)
    b = fr.bounding_box(); cx, cy = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
    z0 = page.locator('#img-pp-zoom').input_value(); sy0 = page.evaluate('scrollY')
    cdp = page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx - 20, 'y': cy, 'id': 1}, {'x': cx + 20, 'y': cy, 'id': 2}]})
    for i in range(1, 10):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx - 20 - i * 6, 'y': cy, 'id': 1}, {'x': cx + 20 + i * 6, 'y': cy, 'id': 2}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(200)
    print('pinch zoom', z0, '->', page.locator('#img-pp-zoom').input_value(), 'scroll', sy0, page.evaluate('scrollY'))
    for out in ('single', 'sheet'):
        page.locator(f'input[name="wt-opt-output"][value="{out}"]').check()
        s.run(page); o = s.download(page, 0); im = Image.open(o)
        print(out, o.name, im.size, im.info.get('dpi'), im.info.get('jfif_density'), im.info.get('jfif_unit'))
        page.locator('.wt-restart button').first.click(); page.wait_for_timeout(300)

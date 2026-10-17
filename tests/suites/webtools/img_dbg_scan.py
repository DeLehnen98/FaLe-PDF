from wtlib import Suite
from PIL import Image
import numpy as np
with Suite('dbg-scan') as s:
    ctx = s.context('desktop', 'en')
    page = s.open(ctx, '/en/tools/scan-to-pdf/')
    s.pick(page, 'img/doc_photo.jpg')
    s.wait_ready(page, 1)
    page.wait_for_selector('.img-scan-img canvas')
    page.wait_for_timeout(500)
    print(page.evaluate("() => [...document.querySelectorAll('.img-scan-handle')].map(h => [h.style.left, h.style.top])"))
    page.locator('input[name="wt-opt-output"][value="jpg"]').check()
    page.locator('input[name="img-scan-filter"][value="original"]').check(force=True)
    s.run(page)
    o = s.download(page, 0)
    im = Image.open(o); print(im.size, im.size[0] / im.size[1])
    im.save('/home/claude/FalePDF/tests/suites/scan_dbg.png')

import os, sys; os.environ.setdefault('WT_PORT', '8800')
from wtlib import Suite
from PIL import Image
# usage: aud2_shots.py out.png WxH path:file,file path:...  (scrolls to .wt-stage if files)
outname = sys.argv[1]; w, h = (int(x) for x in sys.argv[2].split('x'))
items = sys.argv[3:]
imgs = []
with Suite('aud2-shots') as s:
    ctx = s.context('phone', 'de', viewport={'width': w, 'height': h}, device_scale_factor=1, color_scheme='dark' if os.environ.get('DARK') else 'light')
    for it in items:
        path, _, files = it.partition(':')
        files = [f for f in files.split(',') if f]
        page = s.open(ctx, path)
        if files:
            s.pick(page, *files); s.wait_ready(page, len(files), timeout=60000)
            page.wait_for_timeout(1500)
            page.evaluate("() => document.querySelector('.wt-files-sec')?.scrollIntoView({block:'start'})")
        page.wait_for_timeout(500)
        fn = f'out/_s{len(imgs)}.png'; page.screenshot(path=fn); imgs.append(Image.open(fn))
        page.close()
W = sum(i.width for i in imgs) + 10 * (len(imgs) - 1)
m = Image.new('RGB', (W, max(i.height for i in imgs)), 'black'); x = 0
for i in imgs: m.paste(i, (x, 0)); x += i.width + 10
m.save(outname)

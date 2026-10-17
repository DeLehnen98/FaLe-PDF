import sys
from playwright.sync_api import sync_playwright
from PIL import Image
url, name = sys.argv[1], sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 390
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':w,'height':844}, is_mobile=w<600, has_touch=w<600, locale='de-DE')
    pg = ctx.new_page(); pg.goto(url, wait_until='networkidle'); pg.wait_for_timeout(600)
    print('height', pg.evaluate('document.documentElement.scrollHeight'))
    pg.screenshot(path=name+'.png', full_page=True); b.close()
im=Image.open(name+'.png'); W,H=im.size; seg=1700; cols=(H+seg-1)//seg
out=Image.new('RGB',(W*cols+10*(cols-1),min(seg,H)),'white')
for i in range(cols): out.paste(im.crop((0,i*seg,W,min(H,(i+1)*seg))),(i*(W+10),0))
out.save(name+'_grid.png')

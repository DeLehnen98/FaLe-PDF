import sys, os
from PIL import Image, ImageDraw
OUT = 'out_pdfplus'
def montage(names, dest, cols=4, w=390):
    ims = []
    for n in names:
        p = os.path.join(OUT, n + '.png')
        if not os.path.exists(p): continue
        im = Image.open(p).convert('RGB')
        im = im.resize((w, int(im.height * w / im.width)))
        ims.append((n, im))
    if not ims: return
    hmax = max(i.height for _, i in ims)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (w + 10), rows * (hmax + 26)), (90, 90, 90))
    d = ImageDraw.Draw(sheet)
    for k, (n, im) in enumerate(ims):
        x, y = (k % cols) * (w + 10), (k // cols) * (hmax + 26)
        d.text((x + 4, y + 4), n, fill=(255, 255, 255))
        sheet.paste(im, (x, y + 22))
    sheet.save(os.path.join(OUT, dest))
args = sys.argv[1:]
dest = args[0]; cols = int(args[1]); w = int(args[2]); names = args[3:]
montage(names, dest, cols, w)

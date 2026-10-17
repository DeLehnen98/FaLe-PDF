import sys, os
from PIL import Image, ImageDraw
# usage: sheet.py out.png width cols img1 img2 ...
out, W, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
w = W // cols
th = [int(im.height * w / im.width) for im in ims]
rows = (len(ims) + cols - 1) // cols
rh = [max(th[r*cols:(r+1)*cols]) + 18 for r in range(rows)]
sheet = Image.new('RGB', (W, sum(rh)), (120, 120, 120))
d = ImageDraw.Draw(sheet); y = 0
for r in range(rows):
    for c in range(cols):
        i = r*cols + c
        if i >= len(ims): break
        im = ims[i].resize((w - 4, th[i] - 4 if th[i] > 4 else th[i]))
        sheet.paste(im, (c*w + 2, y + 16)); d.text((c*w + 4, y + 2), os.path.basename(files[i])[:40], fill=(255, 255, 255))
    y += rh[r]
sheet.save(out)

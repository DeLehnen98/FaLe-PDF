import sys
from PIL import Image
names = sys.argv[1:]
ims = [Image.open(f'/home/claude/FalePDF/tests/suites/webtools/shots/{n}.png') for n in names]
ims = [i.resize((i.width // 3, i.height // 3)) for i in ims]
m = Image.new('RGB', (sum(i.width for i in ims), max(i.height for i in ims)), 'white'); x = 0
for i in ims: m.paste(i, (x, 0)); x += i.width
m.save('/home/claude/FalePDF/tests/suites/m.png')

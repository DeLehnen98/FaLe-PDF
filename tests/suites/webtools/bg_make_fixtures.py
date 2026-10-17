"""Fixtures for remove-background (agent bg): synthetic photos with an exact ground-truth mask plus
freely licensed real photos from scikit-image's bundled data (astronaut: public domain / NASA;
chelsea (cat): CC0; coffee: CC0)."""
import os, shutil
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).parent / 'fixtures' / 'bg'
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)


def noise_bg(w, h, base, amp, blur):
    n = rng.normal(0, 1, (h // 4 + 1, w // 4 + 1, 3))
    img = Image.fromarray(np.uint8(np.clip(128 + n * 40, 0, 255))).resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(blur))
    a = (np.asarray(img).astype(np.float32) - 128) / 40 * amp
    yy = np.linspace(0, 1, h)[:, None, None]
    grad = np.array(base, np.float32)[None, None, :] * (0.85 + 0.25 * yy)
    return np.clip(grad + a, 0, 255)


def shade(mask, color, light=(-0.5, -0.6)):
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    cy, cx, r = ys.mean(), xs.mean(), max(np.ptp(ys), np.ptp(xs)) / 2
    Y, X = np.mgrid[0:h, 0:w]
    d = ((X - cx) / r * light[0] + (Y - cy) / r * light[1])
    f = np.clip(0.75 + 0.35 * d, 0.35, 1.25)[..., None]
    return np.clip(np.array(color, np.float32)[None, None] * f, 0, 255)


def compose(name, w, h, bg, draw_fn, color, shadow=True):
    m = Image.new('L', (w * 4, h * 4), 0)   # 4× supersampled ground truth
    draw_fn(ImageDraw.Draw(m), 4)
    mask_hi = np.asarray(m, np.float32) / 255
    mask = np.asarray(m.resize((w, h), Image.BOX), np.float32) / 255
    img = bg.copy()
    if shadow:
        sh = Image.fromarray(np.uint8(mask * 255)).filter(ImageFilter.GaussianBlur(w / 60))
        sh = np.roll(np.asarray(sh, np.float32) / 255, (h // 40, w // 50), (0, 1))[..., None]
        img = img * (1 - 0.35 * sh)
    fg = shade(mask > 0.5, color)
    fg = fg + rng.normal(0, 4, fg.shape)
    a = mask[..., None]
    img = img * (1 - a) + fg * a
    Image.fromarray(np.uint8(np.clip(img, 0, 255))).save(OUT / f'{name}.jpg', quality=92)
    Image.fromarray(np.uint8(mask * 255)).save(OUT / f'{name}_gt.png')


W, H = 1600, 1200
# 1) product shot: red mug on a light, slightly textured table/wall
def mug(d, s):
    d.rounded_rectangle([560 * s, 330 * s, 1000 * s, 900 * s], radius=60 * s, fill=255)
    d.ellipse([930 * s, 450 * s, 1170 * s, 760 * s], fill=255)
    d.ellipse([1000 * s, 520 * s, 1100 * s, 690 * s], fill=0)
compose('bg_mug', W, H, noise_bg(W, H, (232, 226, 214), 10, 3), mug, (190, 40, 45))

# 2) toy/ball on grass texture (busy background)
grass = np.asarray(Image.open('/usr/local/lib/python3.13/dist-packages/skimage/data/grass.png').convert('RGB').resize((W, H), Image.BICUBIC), np.float32)
grass = grass * np.array([0.55, 0.85, 0.45]) + 20
def ball(d, s):
    d.ellipse([520 * s, 260 * s, 1160 * s, 900 * s], fill=255)
compose('bg_ball', W, H, grass, ball, (240, 150, 30), shadow=False)

# 3) portrait-format phone photo (3:4), blue bottle on a dark gradient – tall thin shapes
W2, H2 = 1200, 1600
def bottle(d, s):
    d.rounded_rectangle([450 * s, 520 * s, 750 * s, 1380 * s], radius=70 * s, fill=255)
    d.rectangle([545 * s, 300 * s, 655 * s, 560 * s], fill=255)
    d.rounded_rectangle([530 * s, 240 * s, 670 * s, 320 * s], radius=15 * s, fill=255)
compose('bg_bottle', W2, H2, noise_bg(W2, H2, (70, 70, 80), 12, 4), bottle, (40, 110, 220))

# real photos (freely licensed, bundled with scikit-image)
SK = '/usr/local/lib/python3.13/dist-packages/skimage/data/'
for src, dst in [('astronaut.png', 'bg_real_astronaut.jpg'), ('chelsea.png', 'bg_real_cat.jpg'), ('coffee.png', 'bg_real_coffee.jpg')]:
    Image.open(SK + src).convert('RGB').save(OUT / dst, quality=92)
# big phone photo (12 MP) for the memory/speed test: the mug scene upscaled
Image.open(OUT / 'bg_mug.jpg').resize((4000, 3000), Image.BICUBIC).save(OUT / 'bg_mug_12mp.jpg', quality=88)
Image.open(OUT / 'bg_mug_gt.png').resize((4000, 3000), Image.BILINEAR).save(OUT / 'bg_mug_12mp_gt.png')
# custom background image
Image.fromarray(np.uint8(noise_bg(800, 600, (120, 170, 230), 25, 8))).save(OUT / 'bg_backdrop.jpg', quality=90)
print('bg fixtures:', sorted(os.listdir(OUT)))

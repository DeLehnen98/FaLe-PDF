import numpy as np
from PIL import Image
def to_y4m(src, dst, W=960, H=1280, frames=3):
    img = Image.open(src).convert('RGB').resize((W, H))
    ycc = np.asarray(img.convert('YCbCr')).astype(np.uint8)
    Y = ycc[..., 0]; U = ycc[::2, ::2, 1]; V = ycc[::2, ::2, 2]
    with open(dst, 'wb') as f:
        f.write(f'YUV4MPEG2 W{W} H{H} F10:1 Ip A1:1 C420jpeg\n'.encode())
        for _ in range(frames):
            f.write(b'FRAME\n'); f.write(Y.tobytes()); f.write(U.tobytes()); f.write(V.tobytes())
to_y4m('testdata/scan_1_wood.jpg', 'testdata/cam_doc.y4m')
to_y4m('testdata/scan_4_green.jpg', 'testdata/cam_card.y4m')
print('ok')

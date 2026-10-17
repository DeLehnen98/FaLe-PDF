import json, numpy as np, cv2
cases = json.load(open('cases.json'))
ok = 0
for c in cases:
    n = c['size']; m = np.array([int(ch) for ch in c['mods']], dtype=np.uint8).reshape(n, n)
    img = np.where(m == 1, 0, 255).astype(np.uint8)
    img = np.pad(img, 4, constant_values=255)
    scale = max(4, 600 // (n + 8))
    img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    det = cv2.QRCodeDetector()
    val, pts, _ = det.detectAndDecode(img)
    good = val == c['text']
    if not good:
        # try aruco-based detector too
        try:
            d2 = cv2.QRCodeDetectorAruco(); val2, pts2, _ = d2.detectAndDecode(img); good = val2 == c['text']; val = val2
        except Exception as e: pass
    ok += good
    print('OK ' if good else 'BAD', c['ecc'], 'v%d' % c['version'], 'want v%d' % c['want'], 'mask', c['mask'], len(c['text']), '' if good else repr(val[:40]))
print(ok, '/', len(cases))

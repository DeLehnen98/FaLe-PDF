import math
def _seg(f, n):
    return [f(i/(n-1)) for i in range(n)]
def signature(x0, y0, w, h):
    """Handwriting-like 'A. Berger' as a list of strokes in unit box -> screen coords."""
    S = []
    # A: up-stroke, down-stroke, loop crossbar
    S.append(_seg(lambda t: (0.02+0.08*t, 0.95-0.9*t + 0.05*math.sin(t*3)), 18) + _seg(lambda t: (0.10+0.07*t, 0.05+0.9*t), 18)
             + _seg(lambda t: (0.17-0.12*t + 0.03*math.sin(t*math.pi), 0.95-0.35*t - 0.06*math.sin(t*math.pi)), 14)
             + _seg(lambda t: (0.05+0.17*t, 0.6-0.02*t), 12))
    S.append([(0.235, 0.9), (0.24, 0.92), (0.245, 0.9)])  # dot
    # B: stem + two bowls
    B = _seg(lambda t: (0.30+0.01*t, 0.95-0.95*t), 20)
    B += _seg(lambda t: (0.31 + 0.11*math.sin(t*math.pi), 0.0 + 0.45*t), 22)
    B += _seg(lambda t: (0.31 + 0.13*math.sin(t*math.pi), 0.45 + 0.5*t), 22)
    # erger: small waves with varied heights + descender loop for g
    def wave(x_start, x_end, hi, n=24, loops=1.0):
        return _seg(lambda t: (x_start + (x_end-x_start)*t - 0.012*math.sin(t*math.pi*2*loops), 0.92 - hi*abs(math.sin(t*math.pi*loops))), n)
    B += wave(0.33, 0.43, 0.32)            # e
    B += wave(0.43, 0.51, 0.30)            # r
    g = wave(0.51, 0.58, 0.32)
    g += _seg(lambda t: (0.58 - 0.04*math.sin(t*math.pi), 0.92 + 0.45*math.sin(t*math.pi*0.5)*1.0 - 0.0), 10)
    g += _seg(lambda t: (0.54 + 0.05*t, 1.37 - 0.45*t), 12)
    B += g
    B += wave(0.59, 0.69, 0.30)            # e
    B += wave(0.69, 0.78, 0.33)            # r
    B += _seg(lambda t: (0.78 + 0.2*t, 0.92 - 0.25*t*t), 14)  # tail
    S.append(B)
    S.append(_seg(lambda t: (0.28 + 0.66*t, 1.18 - 0.08*math.sin(t*math.pi) - 0.05*t), 26))  # underline swoosh
    return [[(x0 + px*w, y0 + py*h*0.7) for px, py in s] for s in S]
def draw(page, x0, y0, w, h):
    for s in signature(x0, y0, w, h):
        page.mouse.move(*s[0]); page.mouse.down()
        for p in s[1:]: page.mouse.move(*p)
        page.mouse.up()

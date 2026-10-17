"""Contrast check of FaLe design-token pairs (parses styles.css + css/theme-2026.css)."""
import re, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/FalePDF'
css = open(f'{ROOT}/styles.css').read() + open(f'{ROOT}/css/theme-2026.css').read()

def block(sel_regex):
    out = {}
    for m in re.finditer(sel_regex + r'\s*\{([^{}]*)\}', css):
        for k, v in re.findall(r'(--[\w-]+):\s*([^;]+);', m.group(1)):
            out.setdefault(k, v.strip())
    return out
light = {**block(r'(?m)^:root'), }
dark_extra = block(r':root\[data-theme="dark"\]')
dark = {**light, **dark_extra}

def hexrgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def lum(rgb):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def cr(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
def mix(a, b, p):  # color-mix(in srgb, a p%, b)
    return tuple(round(a[i] * p + b[i] * (1 - p)) for i in range(3))
def col(t, name):
    v = t[name] if name.startswith('--') else name
    v = v.strip()
    if v.startswith('var('):
        return col(t, re.match(r'var\((--[\w-]+)', v).group(1))
    return hexrgb(v)

TEXT, LARGE = 4.5, 3.0
def pairs(t):
    c = lambda n: col(t, n)
    P = []
    for fg in ['--text', '--text-2', '--text-3']:
        for bg in ['--bg', '--surface', '--surface-2', '--frame']:
            P.append((f'{fg} on {bg}', c(fg), c(bg), TEXT))
    for fg, bg in [('--primary', '--bg'), ('--primary', '--surface'), ('--primary-strong', '--primary-soft'), ('--on-primary', '--primary'),
                   ('--on-primary', '--primary-strong'), ('--accent', '--surface'), ('--accent', '--bg'), ('--accent', '--accent-soft'),
                   ('--danger', '--surface'), ('--danger', '--danger-soft'), ('--warn', '--warn-soft'), ('--warn', '--surface'),
                   ('--on-marker', '--marker'), ('--text', '--primary-soft'), ('--text-2', '--surface-3'), ('--surface', '--text')]:
        P.append((f'{fg} on {bg}', c(fg), c(bg), TEXT))
    # always-dark ink panels (gradient stops) and toasts
    for stop in ['#2A2290', '#1A1458', '#0E0B2E', '#3A2BA8', '#1E1663', '#0F5F63', '#13305E']:
        P.append((f'#FFFFFF on ink stop {stop}', hexrgb('FFFFFF'), hexrgb(stop), TEXT))
        P.append((f'--ink-text-2 on ink stop {stop}', c('--ink-text-2'), hexrgb(stop), TEXT))
        P.append((f'hero badge #A7F3E7 on {stop}', hexrgb('A7F3E7'), hexrgb(stop), TEXT))
    P.append(('#CDE7F0 (share hero p) on #0F5F63', hexrgb('CDE7F0'), hexrgb('0F5F63'), TEXT))
    P.append(('ink-2 text on white hero button', c('--ink-2'), hexrgb('FFFFFF'), TEXT))
    P.append(('toast text on --toast-bg', hexrgb('F3F2FF'), c('--toast-bg'), TEXT))
    P.append(('toast text on error #5A1730', hexrgb('F3F2FF'), hexrgb('5A1730'), TEXT))
    P.append(('ribbon icon on --toast-bg', c('--ribbon'), c('--toast-bg'), LARGE))
    # icons / large text / UI components (3:1)
    for cat in ['--cat-edit', '--cat-convert', '--cat-organize', '--cat-scan', '--cat-secure', '--cat-read', '--cat-ai', '--star']:
        if cat not in t: continue
        chip_bg = mix(c(cat), c('--surface'), 0.13)
        chip_fg = mix(c(cat), c('--text'), 0.88)
        P.append((f'{cat} icon in its chip', chip_fg, chip_bg, LARGE))
        P.append((f'{cat} on --surface', c(cat), c('--surface'), LARGE))
    P.append(('--border-strong (input edge) on --surface', c('--border-strong'), c('--surface'), 1.0))
    P.append(('--primary focus ring on --surface', c('--primary'), c('--surface'), LARGE))
    P.append(('--ribbon on --frame (nav ribbon)', c('--ribbon'), c('--frame'), 1.0))
    return P

fails = 0
for name, t in [('LIGHT', light), ('DARK', dark)]:
    print(f'== {name}')
    for label, fg, bg, need in pairs(t):
        r = cr(fg, bg)
        ok = r >= need
        if need > 1:
            fails += not ok
        print(f"  {'OK  ' if ok else 'FAIL'} {r:5.2f}:1 (need {need}) {label}")
# dark-mode-specific button text
for label, fg, bg in [('dark text on --danger (dark)', '0D0C21', dark['--danger']), ('dark text on --accent (dark)', '0D0C21', dark['--accent']),
                      ('white on --danger (light)', 'FFFFFF', light['--danger']), ('white on --accent (light)', 'FFFFFF', light['--accent'])]:
    r = cr(hexrgb(fg), hexrgb(bg)); fails += r < TEXT
    print(f"  {'OK  ' if r >= TEXT else 'FAIL'} {r:5.2f}:1 (need 4.5) {label}")
print('FAILURES:', fails)

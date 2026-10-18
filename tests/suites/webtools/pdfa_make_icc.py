# Minimal sRGB ICC v2.1 display profile (own construction from the sRGB primaries, D50-adapted with Bradford –
# the same numbers as IEC 61966-2-1 profiles), for PDF/A OutputIntents (PDF/A-1 needs ICC version 2).
import struct, base64

def s15(x): return struct.pack('>i', int(round(x * 65536)))
def xyz(x, y, z): return b'XYZ ' + b'\0' * 4 + s15(x) + s15(y) + s15(z)
def desc(text):
    t = text.encode('ascii') + b'\0'
    return b'desc' + b'\0' * 4 + struct.pack('>I', len(t)) + t + b'\0' * 4 + b'\0' * 4 + b'\0' * 2 + b'\0' + b'\0' * 67
def text(t): return b'text' + b'\0' * 4 + t.encode('ascii') + b'\0'
def curv():
    vals = []
    for i in range(1024):
        v = i / 1023
        lin = v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
        vals.append(int(round(lin * 65535)))
    return b'curv' + b'\0' * 4 + struct.pack('>I', len(vals)) + b''.join(struct.pack('>H', x) for x in vals)
def pad(b): return b + b'\0' * (-len(b) % 4)

tags = [
    (b'desc', desc('sRGB (FaLe)')),
    (b'cprt', text('No copyright, use freely')),
    (b'wtpt', xyz(0.9642, 1.0, 0.8249)),
    (b'rXYZ', xyz(0.4360747, 0.2225045, 0.0139322)),
    (b'gXYZ', xyz(0.3850649, 0.7168786, 0.0971045)),
    (b'bXYZ', xyz(0.1430804, 0.0606169, 0.7141733)),
    (b'rTRC', curv()),
]
shared = {b'gTRC': b'rTRC', b'bTRC': b'rTRC'}
n = len(tags) + len(shared)
off = 128 + 4 + 12 * n
table, data, where = b'', b'', {}
for sig, body in tags:
    body = pad(body)
    where[sig] = (off + len(data), len(body))
    data += body
for sig, src in shared.items():
    where[sig] = where[src]
for sig in [t[0] for t in tags] + list(shared):
    o, l = where[sig]
    table += sig + struct.pack('>II', o, l)
size = 128 + 4 + len(table) + len(data)
hdr = struct.pack('>I', size) + b'none' + bytes([2, 0x10, 0, 0]) + b'mntr' + b'RGB ' + b'XYZ ' + b'\0' * 12 + b'acsp' + b'\0' * 4 + b'\0' * 4 + b'\0' * 4 + b'\0' * 4 + b'\0' * 8 + struct.pack('>I', 0) + s15(0.9642) + s15(1.0) + s15(0.8249) + b'\0' * 4 + b'\0' * 16 + b'\0' * 28
assert len(hdr) == 128, len(hdr)
prof = hdr + struct.pack('>I', n) + table + data
open('srgb-v2.icc', 'wb').write(prof)
print(len(prof))

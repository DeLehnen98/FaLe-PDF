"""Illustrated placeholder portraits for the example CVs of the Vorlagen-Archiv.

No photos of real people: every portrait is a flat vector bust built from a few shapes (skin tone, hair
style/colour, clothing, background in the brand palette). They are clearly illustrations, so nobody mistakes
them for a real applicant, and they are meant to be replaced by the user's own photo.

avatar_svg(id) -> SVG text (300 x 400, 3:4 like a CV photo). AVATARS lists the ids used by the data files.
make_assets.py renders them to PNG for the CV builder prefill (the CV PDF engine needs a raster image).
"""

SKIN = {  # base, shade
    's1': ('#F6D7C3', '#E9BFA6'), 's2': ('#EDC3A0', '#DCAA85'), 's3': ('#D9A37E', '#C48A64'),
    's4': ('#B97A55', '#A0663F'), 's5': ('#8D5A3B', '#77482D'), 's6': ('#5E3B27', '#4C2F1F'),
}
HAIR = {'black': '#22202B', 'dark': '#3B2A22', 'brown': '#6B4630', 'auburn': '#8E3B24', 'blond': '#D6B06A',
        'grey': '#A7A6AE', 'white': '#E3E1E6', 'redish': '#B5532E'}
BG = {'lilac': ('#E9E7FD', '#D7D3FA'), 'mint': ('#D8F5EF', '#BDEBDF'), 'sand': ('#FDF1D6', '#F6E1B3'),
      'sky': ('#DCEBFF', '#C4DBFA'), 'rose': ('#FCE8EC', '#F7D0D8'), 'stone': ('#E8EAF4', '#D5D9EA')}

# id: (skin, hair style, hair colour, clothing, clothing colour, background, extras)
AVATARS = {
    'a01': ('s1', 'long', 'brown', 'blouse', '#3D34B8', 'lilac', ''),
    'a02': ('s2', 'short', 'dark', 'shirt', '#0F766E', 'mint', ''),
    'a03': ('s4', 'curly', 'black', 'crew', '#C2410C', 'sand', ''),
    'a04': ('s1', 'bob', 'blond', 'blazer', '#334155', 'sky', 'glasses'),
    'a05': ('s5', 'short', 'black', 'polo', '#2B59C3', 'stone', 'beard'),
    'a06': ('s3', 'headscarf', '#6D5A8E', 'blouse', '#0F766E', 'rose', ''),
    'a07': ('s2', 'bun', 'auburn', 'scrubs', '#0E7490', 'mint', ''),
    'a08': ('s1', 'side', 'grey', 'blazer', '#1E293B', 'stone', 'glasses'),
    'a09': ('s6', 'curly', 'black', 'blouse', '#B91C1C', 'sky', ''),
    'a10': ('s3', 'side', 'dark', 'hoodie', '#475569', 'lilac', ''),
    'a11': ('s2', 'ponytail', 'brown', 'polo', '#15803D', 'sand', ''),
    'a12': ('s4', 'bald', 'black', 'shirt', '#F8FAFC', 'mint', 'beard'),
    'a13': ('s1', 'long', 'redish', 'crew', '#0F766E', 'rose', ''),
    'a14': ('s5', 'bun', 'black', 'blazer', '#3D34B8', 'stone', ''),
    'a15': ('s2', 'short', 'blond', 'workwear', '#1D4ED8', 'sand', ''),
    'a16': ('s3', 'bob', 'black', 'blouse', '#7C3AED', 'mint', 'glasses'),
    'a17': ('s1', 'side', 'brown', 'shirt', '#DBEAFE', 'lilac', ''),
    'a18': ('s6', 'short', 'black', 'workwear', '#C2410C', 'stone', ''),
    'a19': ('s2', 'long', 'dark', 'scrubs', '#4338CA', 'sky', ''),
    'a20': ('s4', 'ponytail', 'dark', 'crew', '#0F766E', 'rose', ''),
    'a21': ('s1', 'bald', 'grey', 'blazer', '#334155', 'sand', 'glasses beard'),
    'a22': ('s3', 'curly', 'dark', 'polo', '#B45309', 'mint', ''),
    'a23': ('s2', 'bob', 'white', 'blouse', '#0E7490', 'lilac', 'glasses'),
    'a24': ('s5', 'side', 'black', 'hoodie', '#15803D', 'sky', ''),
}


def _shade(hex_colour, f):
    h = hex_colour.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    if f < 0:
        r, g, b = (round(c * (1 + f)) for c in (r, g, b))
    else:
        r, g, b = (round(c + (255 - c) * f) for c in (r, g, b))
    return f'#{r:02X}{g:02X}{b:02X}'


def _hair_back(style, c):
    if style == 'long':
        return f'<path d="M86 170 C80 110 112 92 150 92 C190 92 222 110 214 170 L226 318 C200 332 100 332 74 318 Z" fill="{c}"/>'
    if style == 'bob':
        return f'<path d="M88 176 C82 110 114 94 150 94 C188 94 220 110 212 176 L216 252 C196 262 104 262 84 252 Z" fill="{c}"/>'
    if style == 'curly':
        blobs = [(104, 150, 30), (120, 116, 32), (150, 102, 34), (182, 116, 32), (198, 150, 30), (96, 190, 24), (204, 190, 24)]
        return ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for x, y, r in blobs)
    if style == 'ponytail':
        return f'<path d="M196 130 C236 140 240 200 226 250 C218 226 208 196 196 176 Z" fill="{c}"/>'
    if style == 'bun':
        return f'<circle cx="150" cy="92" r="26" fill="{c}"/>'
    return ''


def _hair_front(style, c):
    hi = _shade(c, 0.18)
    if style in ('short', 'bald'):
        if style == 'bald':
            return ''
        return (f'<path d="M92 166 C88 116 118 98 150 98 C186 98 214 116 208 166 C200 140 186 128 150 128 C116 128 100 140 92 166 Z" fill="{c}"/>'
                f'<path d="M120 112 C138 104 164 104 180 112" stroke="{hi}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".5"/>')
    if style == 'side':
        return (f'<path d="M92 170 C86 112 120 96 152 96 C190 96 216 118 208 168 C204 146 196 132 176 126 C150 134 116 132 100 142 C96 150 94 160 92 170 Z" fill="{c}"/>'
                f'<path d="M150 104 C166 112 182 116 198 128" stroke="{hi}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".5"/>')
    if style in ('long', 'bob', 'ponytail', 'bun'):
        return f'<path d="M92 172 C88 116 118 100 150 100 C184 100 214 116 208 172 C198 140 176 126 150 124 C130 132 108 146 92 172 Z" fill="{c}"/>'
    if style == 'curly':
        return ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for x, y, r in [(112, 132, 18), (136, 118, 20), (164, 118, 20), (188, 132, 18)])
    return ''


def _clothes(kind, c, skin_shade):
    dark = _shade(c, -0.25)
    light = _shade(c, 0.3)
    base = f'<path d="M30 400 C34 336 76 308 120 298 L180 298 C224 308 266 336 270 400 Z" fill="{c}"/>'
    if kind == 'blazer':
        return (base + f'<path d="M126 298 L150 360 L174 298 Z" fill="#F8FAFC"/>'
                f'<path d="M120 298 L150 370 L128 400 L104 330 Z" fill="{dark}"/><path d="M180 298 L150 370 L172 400 L196 330 Z" fill="{dark}"/>')
    if kind == 'shirt':
        return (base + f'<path d="M150 312 L150 400" stroke="{dark}" stroke-width="2" opacity=".5"/>'
                f'<path d="M122 296 L150 322 L134 334 Z" fill="{light}"/><path d="M178 296 L150 322 L166 334 Z" fill="{light}"/>'
                f'<circle cx="150" cy="352" r="2.5" fill="{dark}" opacity=".6"/><circle cx="150" cy="378" r="2.5" fill="{dark}" opacity=".6"/>')
    if kind == 'polo':
        return (base + f'<path d="M128 298 L150 330 L172 298 Z" fill="{skin_shade}"/>'
                f'<path d="M120 296 L150 330 L136 340 L114 304 Z" fill="{light}"/><path d="M180 296 L150 330 L164 340 L186 304 Z" fill="{light}"/>')
    if kind == 'scrubs':
        return base + f'<path d="M126 298 L150 340 L174 298 Z" fill="{skin_shade}"/><path d="M182 352 h28 v22 h-28 z" fill="{dark}" opacity=".45"/>'
    if kind == 'hoodie':
        return (base + f'<path d="M108 300 C120 326 180 326 192 300" stroke="{dark}" stroke-width="10" fill="none" stroke-linecap="round"/>'
                f'<path d="M138 324 L134 366 M162 324 L166 366" stroke="{light}" stroke-width="3" stroke-linecap="round"/>')
    if kind == 'workwear':
        return (base + f'<path d="M126 298 L150 322 L174 298 Z" fill="{skin_shade}"/>'
                f'<path d="M96 318 L112 400 M204 318 L188 400" stroke="{dark}" stroke-width="10"/>'
                f'<path d="M84 360 H216" stroke="#FACC15" stroke-width="8" opacity=".85"/>')
    if kind == 'blouse':
        return base + f'<path d="M124 298 C134 322 166 322 176 298 Z" fill="{skin_shade}"/><path d="M118 298 C130 330 170 330 182 298" stroke="{light}" stroke-width="5" fill="none"/>'
    # crew neck
    return base + f'<path d="M124 298 C134 316 166 316 176 298 Z" fill="{skin_shade}"/><path d="M122 298 C134 320 166 320 178 298" stroke="{dark}" stroke-width="4" fill="none"/>'


def avatar_svg(aid):
    skin, style, hair, clothes, ccol, bg, extras = AVATARS[aid]
    s0, s1 = SKIN[skin]
    hc = HAIR.get(hair, hair)
    b0, b1 = BG[bg]
    ink = '#2A2438'
    parts = [f'<rect width="300" height="400" fill="{b0}"/>',
             f'<circle cx="250" cy="70" r="120" fill="{b1}" opacity=".7"/><circle cx="30" cy="380" r="90" fill="{b1}" opacity=".5"/>']
    if style == 'headscarf':
        parts.append(f'<path d="M78 190 C70 100 110 80 150 80 C192 80 232 100 222 190 L236 320 C200 336 100 336 64 320 Z" fill="{hc}"/>')
    else:
        parts.append(_hair_back(style, hc))
    parts.append(_clothes(clothes, ccol, s1))
    if style == 'headscarf':
        parts.append(f'<path d="M100 300 C110 330 190 330 200 300 L196 280 L104 280 Z" fill="{hc}"/>')
    parts.append(f'<path d="M128 236 h44 v66 c0 10 -44 10 -44 0 z" fill="{s1}"/>')            # neck
    if style != 'headscarf':
        parts.append(f'<ellipse cx="92" cy="182" rx="10" ry="15" fill="{s1}"/><ellipse cx="208" cy="182" rx="10" ry="15" fill="{s1}"/>')
    parts.append(f'<ellipse cx="150" cy="176" rx="58" ry="70" fill="{s0}"/>')                  # face
    if style == 'headscarf':
        dark = _shade(hc, -0.2)
        parts.append(f'<path d="M84 196 C78 118 112 96 150 96 C190 96 222 118 216 196 C210 140 190 116 150 116 C112 116 90 140 84 196 Z" fill="{hc}"/>'
                     f'<path d="M96 150 C120 112 180 112 204 150" stroke="{dark}" stroke-width="3" fill="none" opacity=".4"/>')
    else:
        parts.append(_hair_front(style, hc))
    if 'beard' in extras:
        bc = hc if hair not in ('white', 'grey') else '#9C9AA3'
        parts.append(f'<path d="M98 186 C100 238 124 250 150 250 C176 250 200 238 202 186 C196 214 180 222 150 222 C120 222 104 214 98 186 Z" fill="{bc}" opacity=".9"/>')
    # face: calm, simple features
    parts.append(f'<path d="M118 160 q12 -7 24 0 M158 160 q12 -7 24 0" stroke="{_shade(hc if style != "headscarf" else "#3B2A22", -0.1)}" stroke-width="4" fill="none" stroke-linecap="round"/>')
    parts.append(f'<ellipse cx="130" cy="180" rx="5" ry="6" fill="{ink}"/><ellipse cx="170" cy="180" rx="5" ry="6" fill="{ink}"/>')
    parts.append(f'<path d="M150 188 q-4 16 4 20" stroke="{s1}" stroke-width="3" fill="none" stroke-linecap="round"/>')
    parts.append(f'<path d="M134 218 q16 12 32 0" stroke="#A1495A" stroke-width="4" fill="none" stroke-linecap="round"/>')
    parts.append(f'<ellipse cx="116" cy="204" rx="10" ry="6" fill="#F08A8A" opacity=".18"/><ellipse cx="184" cy="204" rx="10" ry="6" fill="#F08A8A" opacity=".18"/>')
    if 'glasses' in extras:
        parts.append(f'<g stroke="{ink}" stroke-width="3.5" fill="none"><rect x="111" y="166" width="38" height="28" rx="10"/><rect x="151" y="166" width="38" height="28" rx="10"/><path d="M149 178 h2 M111 176 L94 172 M189 176 L206 172"/></g>')
    body = ''.join(parts)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400" role="img">'
            f'<title>Illustriertes Platzhalter-Porträt</title>{body}</svg>\n')

"""Independent check of booklet order: physically 'read' the printed sheets.

A stack of S landscape sheets is printed duplex (flip on short edge) and folded in the middle. Closed, the
leaves from the front cover are R_0 … R_{S-1} (right halves, outer sheet first), then L_{S-1} … L_0.
A right leaf shows front-right first and back-left on its reverse (short-edge flip mirrors left/right);
a left leaf shows back-right first and front-left on its reverse. For right-to-left binding the book is
read from the other side, i.e. with left and right swapped.
"""


def reading_sequence(sides, rtl=False):
    """sides: [(left, right)] per output page (front, back, front, back …) → page numbers in reading order."""
    S = len(sides) // 2
    if rtl:
        sides = [(r, l) for l, r in sides]
    front = [sides[2 * i] for i in range(S)]
    back = [sides[2 * i + 1] for i in range(S)]
    seq = []
    for i in range(S):
        seq += [front[i][1], back[i][0]]
    for i in reversed(range(S)):
        seq += [back[i][1], front[i][0]]
    return seq


def expected_pages(n, blanks='end'):
    pad = (4 - n % 4) % 4
    pages = list(range(1, n + 1))
    return pages[:-1] + [0] * pad + pages[-1:] if blanks == 'beforeBack' else pages + [0] * pad

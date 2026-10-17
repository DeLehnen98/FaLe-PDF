import sys
sys.path.insert(0, '/home/claude/FalePDF/network/tools/vorlagen')
from avatars import AVATARS, avatar_svg
from playwright.sync_api import sync_playwright
html = '<html><body style="margin:0;display:flex;flex-wrap:wrap;width:1200px">' + ''.join(f'<div style="width:150px;height:200px">{avatar_svg(a).replace("width=\"300\" height=\"400\"", "width=\"150\" height=\"200\"")}</div>' for a in AVATARS) + '</body></html>'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':1200,'height':600})
    pg.set_content(html); pg.screenshot(path='arc/avatars.png', full_page=True); b.close()

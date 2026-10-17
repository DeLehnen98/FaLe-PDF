import sys
from playwright.sync_api import sync_playwright
D='/home/claude/FalePDF/one/icons/'
jobs=[('favicon.svg','icon-192.png',192),('favicon.svg','icon-512.png',512),('favicon.svg','favicon-32.png',32),('mask.svg','icon-maskable-192.png',192),('mask.svg','icon-maskable-512.png',512),('mask.svg','apple-touch-icon.png',180)]
with sync_playwright() as p:
    b=p.chromium.launch()
    for src,out,s in jobs:
        pg=b.new_page(viewport={'width':s,'height':s})
        svg=open(D+src).read()
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width=\"{s}\" height=\"{s}\" ",1)}</body></html>')
        pg.screenshot(path=D+out, omit_background=True)
        pg.close()
    b.close()

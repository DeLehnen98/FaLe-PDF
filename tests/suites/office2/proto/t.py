from playwright.sync_api import sync_playwright
import os
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto('file://'+os.path.abspath('t.html'))
    print(pg.evaluate("""()=>{const a=document.getElementById('a');const rects=()=>{const r=document.createRange();r.selectNodeContents(a);return [...r.getClientRects()].map(x=>Math.round(x.top)+':'+Math.round(x.left))};
    const before=rects();
    a.setAttribute('data-pg','');a.style.setProperty('--pg-h','150px');a.style.setProperty('--pg-shape','polygon(0 30px,100% 30px,100% 70px,0 70px,0 100px,100% 100px,100% 150px,0 150px)');
    const after=rects(); const li=document.getElementById('b'); li.setAttribute('data-pg','');li.style.setProperty('--pg-h','60px');li.style.setProperty('--pg-shape','polygon(0 10px,100% 10px,100% 60px,0 60px)');
    const r=document.createRange();r.selectNodeContents(li);
    return {before, after, h:a.getBoundingClientRect().height, li:[...r.getClientRects()].map(x=>Math.round(x.top)+':'+Math.round(x.left)), lih: li.getBoundingClientRect().height}}"""))
    pg.screenshot(path='t.png')

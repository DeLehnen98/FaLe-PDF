# Demonstrates that the corpus payloads break out with the PRE-FIX code paths (old fontCss / unvalidated theme / unescaped data-ph)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto('http://127.0.0.1:9404/'); pg.wait_for_timeout(1200)
    r = pg.evaluate("""() => {
      const font = 'x\\'" data-q="1"><b data-pwn="207">F</b><i x="';
      const oldFontCss = n => `'${String(n).replace(/'/g, '')}', sans-serif`;
      const theme = '000000"><b data-pwn="208">T</b><i x="';
      const ph = 'ctrTitle"><b data-pwn="304">P</b><i x="';
      const t = document.createElement('template');
      t.innerHTML = `<div style="left:0;font-family:${oldFontCss(font)};">a</div><div style="color:#${theme};">b</div><div data-ph="${ph}">c</div>`;
      const before = Array.from(t.content.querySelectorAll('[data-pwn]')).map(e => e.getAttribute('data-pwn'));
      return before;
    }""")
    print('pre-fix code paths inject:', r)
    b.close()

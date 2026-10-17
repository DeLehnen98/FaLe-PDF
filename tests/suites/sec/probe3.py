from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto('http://127.0.0.1:9404/'); pg.wait_for_timeout(1500)
    pg.evaluate("""() => { setTimeout(() => {
      const out = {};
      try { eval('1'); out.eval = 'ran'; } catch (e) { out.eval = e.name; }
      try { new Function('return 1')(); out.fn = 'ran'; } catch (e) { out.fn = e.name; }
      try { const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.body.appendChild(s); out.inl = 'appended'; } catch (e) { out.inl = e.name; }
      const d = document.createElement('div'); d.innerHTML = '<img src=x onerror="window.__h=1">'; out.html = d.innerHTML; document.body.appendChild(d);
      try { const a = document.createElement('a'); a.href = 'javascript:window.__js=1'; document.body.appendChild(a); a.click(); } catch (e) { out.js = e.name; }
      window.__probe = out; }, 0); }""")
    pg.wait_for_timeout(800)
    print(pg.evaluate("({probe: window.__probe, inl: window.__inl, h: window.__h, js: window.__js})"))
    b.close()

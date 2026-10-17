from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(locale='de-DE'); page = ctx.new_page()
    msgs=[]; page.on('console', lambda m: msgs.append(m.text)); page.on('pageerror', lambda e: msgs.append('ERR '+str(e)))
    page.clock.install(); page.goto('http://127.0.0.1:9406/'); page.wait_for_selector('#view-start .hero')
    page.evaluate("""() => { window.__ev=[]; for (const t of ['pointerdown','keydown','visibilitychange']) document.addEventListener(t, e => window.__ev.push(t), true);
      const st = window.setTimeout; window.__to=[]; window.setTimeout = function(f, ms, ...a){ if (ms >= 60000) window.__to.push(ms); return st.call(this, f, ms, ...a); }; }""")
    page.evaluate("async () => { const v = await import('./js/extras/vault.js'); await v.setupVault('246810'); }")
    page.clock.run_for(4*60*1000)
    print(page.evaluate("[window.__ev.length, window.__ev.slice(0,5), window.__to, localStorage.getItem('fale-vault-autolock')]"))
    print(page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()"))
    print(msgs[:10]); b.close()

from playwright.sync_api import sync_playwright
import csp_compat
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(locale='de-DE'); page = ctx.new_page()
    page.clock.install(); page.goto('http://127.0.0.1:9406/'); page.wait_for_selector('#view-start .hero')
    page.evaluate("async () => { const v = await import('./js/extras/vault.js'); await v.setupVault('246810'); }")
    st = lambda: page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()")
    print('after setup', st())
    page.clock.run_for(4*60*1000); print('2min', st())
    page.clock.run_for(70*1000); print('3m10', st())
    page.clock.run_for(5*60*1000); print('8m', st())
    b.close()

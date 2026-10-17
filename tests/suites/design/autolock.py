import sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE'); page = ctx.new_page()
    page.clock.install(); page.goto(URL); page.wait_for_selector('#view-start .hero')
    page.evaluate("async () => { const v = await import('./js/extras/vault.js'); await v.setupVault('246810'); }")
    print('unlocked', page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()"))
    page.clock.run_for(2 * 60 * 1000)
    print('still', page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()"))
    page.clock.run_for(70 * 1000)
    print('after 3min unlocked?', page.evaluate("async () => (await import('./js/extras/vault.js')).isUnlocked()"))
    b.close()

from playwright.sync_api import sync_playwright
mods = ['/js/icons.js','/js/platform.js','/js/ui.js','/js/pdfcore.js','/js/office/kinds.js','/js/extras/stats.js','/js/db.js','/js/i18n/index.js','/js/i18n/core.js','/js/i18n/en.js','/js/security.js','/js/boot.js','/js/theme.js','/js/viewer.js','/js/views.js','/js/app.js','/js/office/filerow.js','/js/components.js','/js/screen.js','/js/tools/index.js']
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto('http://127.0.0.1:9300/robots.txt')
    for m in mods:
        print(m, pg.evaluate(f"import('{m}').then(()=> 'ok', e => String(e))"))
    b.close()

from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:9300/'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    logs=[]
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'pageerror: {e}'))
    pg.goto(URL+'#/start'); pg.wait_for_timeout(1500)
    for m in ['/js/library.js','/js/smart/extract.js','/js/smart/common.js','/js/smart/inbox.js','/js/smart/memory.js','/js/smart/tax.js','/js/smart/family.js','/js/smart/entry.js']:
        print(m, pg.evaluate(f"import('{m}').then(()=> 'ok', e => String(e))"))
    print('\n'.join(logs[:20]))
    b.close()

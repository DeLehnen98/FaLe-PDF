import os, json
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ['desk', 'phone']:
        phone = mode == 'phone'
        ctx = b.new_context(viewport={'width': 390, 'height': 844} if phone else {'width': 1366, 'height': 860}, has_touch=phone, is_mobile=phone, device_scale_factor=2 if phone else 1, locale='de-DE')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: print('PAGEERR', e))
        pg.on('console', lambda m: print('CONSOLE', m.type, m.text) if m.type in ('error', 'warning') else None)
        pg.goto('http://127.0.0.1:8850/'); pg.wait_for_timeout(1000)
        pg.evaluate("location.hash = '#/neu/tabelle?vorlage=haushaltsbuch'"); pg.wait_for_selector('.sheet-app'); pg.wait_for_timeout(500)
        r = pg.evaluate("""() => { const a = document.querySelector('.sheet-app')._sheetApi;
          a.input('F2', '=LAMBDA(x;x*2)(21)'); a.input('F3', '=TEXTTEILEN("a,b,c";",")'); a.input('F5', '=NORM.S.VERT(1;WAHR)');
          a.note('A4', 'Netto nach Steuern'); a.link('A6', {url: 'https://example.org'}, null);
          a.addCf({ range: 'C4:C9', type: 'bar', bar: 'blue' }); a.addCf({ range: 'B4:B9', type: 'icons', icons: 'arrows' }); a.addCf({ range: 'A4:D9', type: 'formula', f: '$C4<-300', style: 'red' });
          a.select('A4');
          return [a.value('F2'), a.text('F3'), a.text('G3'), a.value('F5'), JSON.stringify(a.cellLink('A6'))]; }""")
        print(mode, r)
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, f'smoke1_{mode}.png'))
        # type a formula to see autocomplete
        pg.evaluate("() => document.querySelector('.sheet-app')._sheetApi.select('B12')")
        pg.locator('#sh-input').click() if not phone else pg.locator('#sh-input').tap()
        pg.keyboard.type('=SVER')
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, f'smoke1_{mode}_sug.png'))
        pg.keyboard.press('Tab'); pg.keyboard.type('A4;')
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, f'smoke1_{mode}_args.png'))
        print('input', pg.locator('#sh-input').input_value())
        pg.keyboard.press('Escape')
        ctx.close()
    b.close()

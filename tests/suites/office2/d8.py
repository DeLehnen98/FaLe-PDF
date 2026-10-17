A = "document.querySelector('.sheet-app')._sheetApi"
pg.evaluate("location.hash = '#/neu/tabelle'"); pg.wait_for_selector('.sheet-app'); pg.wait_for_timeout(300)
try:
    pg.evaluate(f"{A}.input('A1', '5')")
    print('ok1', pg.evaluate(f"{A}.text('A1')"))
except Exception as e: print('E1', str(e)[:500])
pg.locator('.sh-tab').first.click(button='right'); pg.wait_for_timeout(150)
pg.locator('.menu-item', has_text='Duplizieren').click(); pg.wait_for_timeout(200)
try:
    pg.evaluate(f"{A}.input('B1', \"='Tabelle1'!A1*2\")")
    print('ok2', pg.evaluate(f"{A}.text('B1')"), pg.evaluate(f"{A}.wb().sheets.map(s=>s.name)"))
except Exception as e: print('E2', str(e)[:800])
pg.evaluate("location.hash = '#/start'"); pg.wait_for_timeout(400)
print(pg.locator('dialog').count())
if pg.locator('dialog button[value=\"discard\"]').count(): pg.locator('dialog button[value=\"discard\"]').click(); pg.wait_for_timeout(300)
pg.evaluate("location.hash = '#/neu/tabelle'"); pg.wait_for_selector('.sheet-app'); pg.wait_for_timeout(300)
try:
    pg.evaluate(f"{A}.input('A1', '5')")
    print('ok3', pg.evaluate(f"{A}.text('A1')"))
except Exception as e: print('E3', str(e)[:800])

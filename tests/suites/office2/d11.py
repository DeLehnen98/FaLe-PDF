A = "document.querySelector('.sheet-app')._sheetApi"
pg.evaluate("location.hash = '#/neu/tabelle'"); pg.wait_for_selector('.sheet-app'); pg.wait_for_timeout(300)
pg.evaluate(f"{A}.input('A1', 'X')")
pg.evaluate(f"(() => {{ const sh = {A}.sheet(); sh.cells.set(5 * 16384, {{ v: 1 }}); sh.maxR = 5; }})()")
pg.evaluate("location.hash = '#/start'"); pg.wait_for_timeout(400)
if pg.locator('dialog button[value=\"discard\"]').count(): pg.locator('dialog button[value=\"discard\"]').click(); pg.wait_for_timeout(300)
pg.evaluate("location.hash = '#/neu/tabelle'"); pg.wait_for_selector('.sheet-app'); pg.wait_for_timeout(300)
print(pg.evaluate(f"[{A}.sheet().cells.size, {A}.sheet().maxR]"))

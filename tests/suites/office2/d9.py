A = "document.querySelector('.sheet-app')._sheetApi"
pg.evaluate("location.hash = '#/neu/tabelle'"); pg.wait_for_selector('.sheet-app'); pg.wait_for_timeout(300)
t = pg.evaluate(f"""() => {{ const api = {A}; const sh = api.sheet(); const t0 = performance.now();
    for (let r = 0; r < 10000; r++) {{ for (let c = 0; c < 9; c++) sh.cells.set(r * 16384 + c, {{ v: r * 10 + c }}); sh.cells.set(r * 16384 + 9, {{ f: 'SUM(A' + (r + 1) + ':I' + (r + 1) + ')' }}); }}
    sh.maxR = 9999; sh.maxC = 9; const t1 = performance.now(); try {{ api.recalcAll(); }} catch (e) {{ return e.stack; }} const t2 = performance.now(); return [t1 - t0, t2 - t1]; }}""")
print(t)
pg.wait_for_timeout(500)
print(pg.evaluate(f"[{A}.text('J1'), {A}.text('J10000')]"))
try:
    pg.evaluate(f"{A}.input('A5000', '1000000')")
    print(pg.evaluate(f"{A}.text('J5000')"))
except Exception as e: print(str(e)[:1500])

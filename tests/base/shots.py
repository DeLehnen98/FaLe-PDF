import asyncio, sys
from playwright.async_api import async_playwright
S = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1340,"height":860})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        await pg.goto("http://127.0.0.1:8765/")
        await pg.wait_for_timeout(2200)
        await pg.screenshot(path=f"{S}/01_health.png")
        await pg.click("nav a[data-p=clean]"); await pg.wait_for_timeout(500)
        await pg.click("#c-an"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f"{S}/02_clean.png")
        await pg.click("#c-cl"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"{S}/03_modal.png")
        await pg.click("text=Schließen & bereinigen"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f"{S}/04_cleaned.png")
        for pid in ["startup","perf","update","apps","disk","dupes","auto","tools"]:
            await pg.click(f"nav a[data-p={pid}]"); await pg.wait_for_timeout(700)
            if pid == "disk": await pg.click("#d-go"); await pg.wait_for_timeout(1300)
            if pid == "dupes": await pg.click("#x-go"); await pg.wait_for_timeout(1300); await pg.click("#x-auto")
            if pid in ("perf","update"): await pg.wait_for_timeout(900)
            await pg.screenshot(path=f"{S}/p_{pid}.png")
        # forbidden checks
        r = await pg.evaluate("fetch('/api/call',{method:'POST',body:JSON.stringify({fn:'info'})}).then(r=>r.status)")
        print("no-token status:", r)
        print("errors:", errs)
        await b.close()
asyncio.run(main())

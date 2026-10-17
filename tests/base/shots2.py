import asyncio, sys
from playwright.async_api import async_playwright
S = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width":1340,"height":860})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        await pg.goto("http://127.0.0.1:8765/"); await pg.wait_for_timeout(1500)
        await pg.click("nav a[data-p=startup]"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f"{S}/n_startup.png")
        await pg.click("nav a[data-p=gaming]"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f"{S}/n_gaming.png")
        await pg.click("#g-btn"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f"{S}/n_gaming_on.png")
        await pg.click("nav a[data-p=privacy]"); await pg.wait_for_timeout(800); await pg.click("#bl-scan"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f"{S}/n_privacy.png", full_page=True)
        await pg.click("nav a[data-p=undo]"); await pg.wait_for_timeout(800); await pg.screenshot(path=f"{S}/n_undo.png")
        await pg.click("nav a[data-p=clean]"); await pg.wait_for_timeout(600); await pg.click("#c-an"); await pg.wait_for_timeout(1500)
        await pg.click("#c-tbl tbody tr.clickable >> nth=0"); await pg.wait_for_timeout(1000); await pg.screenshot(path=f"{S}/n_details.png")
        await pg.click("text=Schließen"); await pg.click("#c-ck"); await pg.wait_for_timeout(1000); await pg.screenshot(path=f"{S}/n_cookies.png")
        await pg.click("text=Abbrechen")
        await pg.click("nav a[data-p=apps]"); await pg.wait_for_timeout(800)
        await pg.click("#a-tbl .un >> nth=1"); await pg.wait_for_timeout(300); await pg.click(".modal .btn.danger"); await pg.wait_for_timeout(600)
        await pg.click("#a-lo"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f"{S}/n_leftovers.png")
        print("errors:", errs)
        await b.close()
asyncio.run(main())

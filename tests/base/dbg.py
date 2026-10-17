import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width":1340,"height":860})
        pg.on("console", lambda m: print("console:", m.type, m.text))
        await pg.goto("http://127.0.0.1:8765/"); await pg.wait_for_timeout(800)
        await pg.click("nav a[data-p=dupes]"); await pg.wait_for_timeout(800)
        print("path:", await pg.input_value("#x-path"))
        await pg.click("#x-go"); await pg.wait_for_timeout(2000)
        print("status:", await pg.inner_text("#p-dupes .status"))
        print(await pg.inner_text("#toasts"))
        await b.close()
asyncio.run(main())

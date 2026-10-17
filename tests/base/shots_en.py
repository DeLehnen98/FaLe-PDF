"""Englischer Durchlauf: schaltet über den DE|EN-Schalter um und macht Screenshots (Präfix en_)."""
import asyncio, re, sys
from playwright.async_api import async_playwright
S = sys.argv[1]
GERMAN = re.compile(r"[äöüÄÖÜß„]|\b(und|der|die|das|nicht|keine|wird|werden|Dateien|Programme|Einstellungen|Bereinig\w*|Reinigung|Speicher|aktiv|aus|läuft|von|für|mit|Neu|Alle|Starten|Öffnen|Suche\w*|auf|wirst|ist|sind|den|dem|des|zu|ein|eine|im|bei|noch|Tage?|oder|Ordner|Datei|Programm|Verlauf|Startzeit|Leistung|Werbung|Apps? entfernen|jetzt|Bitte|Fehler\w*|Laufwerk\w*|wiederhergestellt|gelöscht|Akku|Neustart|Gesund)\b")
ALLOW = ("Urlaub", "Rechnung", "German", "x64 de", "Mozilla.Firefox.de", "Fabian")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1340, "height": 860})
        errs, hits = [], {}
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        async def scan(name):
            txt = await pg.evaluate("document.body.innerText + '\\n' + [...document.querySelectorAll('[placeholder],[title]')].map(e => (e.placeholder||'') + ' ' + (e.title||'')).join('\\n')")
            bad = [l.strip() for l in txt.splitlines() if GERMAN.search(l) and not any(a in l for a in ALLOW)]
            if bad: hits[name] = bad
        async def shot(name, full=False):
            await scan(name); await pg.screenshot(path=f"{S}/en_{name}.png", full_page=full)
        await pg.goto("http://127.0.0.1:8765/"); await pg.wait_for_timeout(1200)
        await pg.evaluate("localStorage.setItem('fc-page','health')")
        await pg.click("#lang-sw [data-l=en]"); await pg.wait_for_timeout(2600)
        print("html lang:", await pg.evaluate("document.documentElement.lang"))
        await shot("health")
        await pg.click("nav a[data-p=clean]"); await pg.wait_for_timeout(600)
        await pg.click("#c-an"); await pg.wait_for_timeout(1500); await shot("clean")
        await pg.click("#c-cl"); await pg.wait_for_timeout(500); await shot("clean_modal")
        await pg.click("text=Close & clean"); await pg.wait_for_timeout(1500); await shot("cleaned")
        await pg.click("#c-tbl tbody tr.clickable >> nth=0"); await pg.wait_for_timeout(1000); await shot("details")
        await pg.click(".modal >> text=Close"); await pg.click("#c-ck"); await pg.wait_for_timeout(1000); await shot("cookies")
        await pg.click(".modal >> text=Cancel")
        await pg.click("nav a[data-p=startup]"); await pg.wait_for_timeout(1300); await shot("startup")
        await pg.click("nav a[data-p=perf]"); await pg.wait_for_timeout(1600); await shot("perf")
        await pg.click("nav a[data-p=gaming]"); await pg.wait_for_timeout(1300); await shot("gaming")
        await pg.click("#g-btn"); await pg.wait_for_timeout(1300); await shot("gaming_on")
        await pg.click("nav a[data-p=update]"); await pg.wait_for_timeout(1800); await shot("update")
        await pg.click("nav a[data-p=apps]"); await pg.wait_for_timeout(800); await shot("apps")
        await pg.click("#a-tbl .un >> nth=1"); await pg.wait_for_timeout(300); await scan("apps_confirm"); await pg.click(".modal .btn.danger"); await pg.wait_for_timeout(600)
        await pg.click("#a-lo"); await pg.wait_for_timeout(1200); await shot("leftovers")
        await pg.click(".modal >> text=Close")
        await pg.click("nav a[data-p=disk]"); await pg.wait_for_timeout(700); await pg.click("#d-go"); await pg.wait_for_timeout(1300); await shot("disk")
        await pg.click("nav a[data-p=dupes]"); await pg.wait_for_timeout(700); await pg.click("#x-go"); await pg.wait_for_timeout(1300); await pg.click("#x-auto"); await shot("dupes")
        await pg.click("nav a[data-p=privacy]"); await pg.wait_for_timeout(800); await pg.click("#bl-scan"); await pg.wait_for_timeout(1200); await shot("privacy", True)
        await pg.click("nav a[data-p=undo]"); await pg.wait_for_timeout(800); await shot("undo")
        await pg.click("nav a[data-p=auto]"); await pg.wait_for_timeout(800); await shot("auto")
        await pg.click("nav a[data-p=tools]"); await pg.wait_for_timeout(800); await shot("tools")
        miss = await pg.evaluate("[...T_MISS]")
        print("t() misses:", miss)
        # zurück auf Deutsch
        await pg.click("#lang-sw [data-l=de]"); await pg.wait_for_timeout(1500)
        print("back to:", await pg.evaluate("document.documentElement.lang"), await pg.inner_text("nav a[data-p=clean]"))
        for k, v in hits.items(): print("GERMAN?", k, v[:12])
        print("errors:", errs)
        await b.close()
asyncio.run(main())

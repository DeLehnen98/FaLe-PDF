from playwright.sync_api import sync_playwright
import subprocess
files = subprocess.run(['git','-C','/home/claude/FalePDF','ls-files','js'],capture_output=True,text=True).stdout.split()
files += subprocess.run(['git','-C','/home/claude/FalePDF','ls-files','-o','--exclude-standard','js'],capture_output=True,text=True).stdout.split()
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto('http://127.0.0.1:9300/robots.txt')
    for f in files:
        if not f.endswith('.js') or 'worker' in f: continue
        r = pg.evaluate("async (u) => { try { const s = await (await fetch(u)).text(); new Function('return 0'); try { await import(URL.createObjectURL(new Blob(['export default 1;\\n'], {type:'text/javascript'}))); } catch(e) {} return 'ok'; } catch (e) { return String(e); } }", '/'+f)
    # parse check via dynamic import of each module in isolation is costly; use <script type=module> compile check
    for f in files:
        if not f.endswith('.js'): continue
        r = pg.evaluate("""async (u) => { const src = await (await fetch(u)).text(); try { new Function(src.replace(/^\\s*(import|export)\\b[^\\n]*$/gm, '')); return 'ok'; } catch (e) { return String(e); } }""", '/'+f)
        if r != 'ok' and 'missing /' in r: print(f, r)
    b.close()

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    msgs=[]; pg.on('console', lambda m: msgs.append(m.text))
    pg.goto('http://127.0.0.1:8730/werkzeuge/pdf-komprimieren/'); pg.wait_for_timeout(800)
    for code in ["() => { try { const d=new DOMParser().parseFromString('<a xmlns=\"x\"><b/></a>','application/xml'); return 'xml ok '+d.documentElement.localName } catch(e){ return 'xml ERR '+e } }",
                 "() => { try { new DOMParser().parseFromString('<p>x</p>','text/html'); return 'html ok' } catch(e){ return 'html ERR '+e } }",
                 "async () => { const u=URL.createObjectURL(new Blob(['<p style=\"color:red\">hi</p><img src=x>'],{type:'text/html'})); return await new Promise(r=>{const x=new XMLHttpRequest(); x.open('GET',u); x.responseType='document'; x.onload=()=>r('xhr '+x.response.body.innerText); x.onerror=()=>r('xhr err'); x.send();}) }"]:
        print(pg.evaluate(code))
    pg.wait_for_timeout(300); print(msgs)
    b.close()

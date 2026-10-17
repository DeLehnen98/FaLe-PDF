import sys, base64, io, functools, threading, http.server
sys.path.insert(0,'/home/claude/FalePDF/network/tools/vorlagen')
import make_assets as m
from playwright.sync_api import sync_playwright
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(m.Handler, directory=str(m.ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/vorlagen/')
    url=pg.evaluate(m.RENDER, {'id': sys.argv[1], 'width': 1100})
    open('cvbig.png','wb').write(base64.b64decode(url.split(',',1)[1])); b.close()

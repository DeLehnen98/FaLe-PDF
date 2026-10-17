"""Static server for the FaLe PDF source tree on 127.0.0.1:<port> (default 9300).
OCR language data (built into dist/ by the build) is served from ./ocrlang. No caching."""
import http.server, os, sys, functools
ROOT = '/home/claude/FalePDF'
LANG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ocrlang')
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip'}
    def translate_path(self, path):
        p = path.split('?', 1)[0].split('#', 1)[0]
        if p.startswith('/vendor/tesseract/lang/') and os.path.isfile(os.path.join(LANG, os.path.basename(p))):
            return os.path.join(LANG, os.path.basename(p))
        return super().translate_path(path)
    def send_head(self):
        # test-only workaround: raw U+2028/U+2029 inside a regex literal (js/security.js, another agent's file)
        # make Chromium reject the module; serve them escaped until the file is fixed
        p = self.path.split('?', 1)[0]
        if p.endswith('.js'):
            f = self.translate_path(self.path)
            if os.path.isfile(f):
                data = open(f, 'rb').read()
                if b'\xe2\x80\xa8' in data or b'\xe2\x80\xa9' in data:
                    data = data.replace(b'\xe2\x80\xa8', b'\\u2028').replace(b'\xe2\x80\xa9', b'\\u2029')
                    import io
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/javascript')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    return io.BytesIO(data)
        return super().send_head()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 9300
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=ROOT)).serve_forever()

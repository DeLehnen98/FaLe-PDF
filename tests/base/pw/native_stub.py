import sys, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('https://pdf.fale.network/**', lambda r: r.fulfill(status=503, body='{}'))
    page.goto(sys.argv[1] + '/', wait_until='load'); page.wait_for_selector('.gate .gate-card', timeout=20000)
    r = page.evaluate("""async () => {
      const calls = [];
      const mk = name => new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async (o) => { calls.push(name + '.' + String(m));
        if (name === 'FaleBackup' && m === 'state') return { armed: false, user: null, prefs: { on: false, videos: false, wifiOnly: true }, live: {}, work: {}, notifications: 'granted' };
        if (name === 'FaleBackup' && m === 'disarm') return { armed: false };
        if (name === 'FaleMedia' && m === 'checkPermissions') return { media: 'granted', video: true };
        if (name === 'FaleMedia' && m === 'count') return { count: 3 };
        if (name === 'FaleBackup' && m === 'getCheckpoint') return { since: 0, afterId: 0 };
        if (m === 'addListener') return { remove() {} };
        return {}; }) });
      window.Capacitor = { isNativePlatform: () => true, Plugins: { FaleBackup: mk('FaleBackup'), FaleMedia: mk('FaleMedia'), FaleSystem: mk('FaleSystem') } };
      const m = await import('/js/native.js'); m.init();
      const te = new TextEncoder(); const raw = crypto.getRandomValues(new Uint8Array(32));
      const mkKey = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
      const p = await m.armPayload({ userId: '11111111-2222-4333-8444-555555555555', mk: mkKey, deviceId: 'dev_web_1234567890ab', deviceName: 'X', session: { refresh: 'r', user: { id: '1', email: 'e' }, access: 'a', exp: 1 }, account: { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' } });
      const card = m.backupCard(); document.body.append(card); await new Promise(r => setTimeout(r, 300));
      await m.appStopped({ step: 'welcome' });
      return { keys: [p.kek.length, p.dk.length, p.dvk.length], apiBase: p.apiBase, text: card.innerText.slice(0, 200), calls };
    }""")
    print(json.dumps(r, ensure_ascii=False)); print('errors', errs)
    b.close(); sys.exit(1 if errs or r['keys'] != [43, 43, 43] else 0)

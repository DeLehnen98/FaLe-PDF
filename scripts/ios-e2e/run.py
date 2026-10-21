#!/usr/bin/env python3
"""iOS Simulator test for FaLe PDF (runs on the macOS CI runner, see .github/workflows/ios.yml).

  python3 scripts/ios-e2e/run.py <simulator-udid> <bundle-id>

1. Start: launches the app with its console attached; the web app logs "FaLe PDF bereit (ios)" when it is ready.
   Fails on JS errors reported by Capacitor ("[error]") or when the app does not get ready.
2. Open a file: puts fale-e2e-writeback.pdf into the app's Documents (Files app: „Auf meinem iPhone › FaLe PDF“)
   and opens it as a file URL. The native plugin imports it (in place, writable); debug builds then write a marker
   back into the original (js/origin.js selfTest) – the test reads the file and checks the marker.
Results are printed as GitHub annotations (readable without downloading logs) and in ios-e2e-out/.
"""
import os, subprocess, sys, threading, time

UDID, BUNDLE = sys.argv[1], sys.argv[2]
LABEL = sys.argv[3] if len(sys.argv) > 3 else 'iphone'
OUT = 'ios-e2e-out'
os.makedirs(OUT, exist_ok=True)
lines, failed = [], []


def note(ok, title, msg):
    msg = msg.replace('\n', ' ')[:900]
    print(f"::{'notice' if ok else 'error'} title=iOS {LABEL} · {title}::{'OK' if ok else 'FEHLER'}: {msg}", flush=True)
    if not ok:
        failed.append(title)


def sh(*a, check=True, timeout=120):
    try:
        r = subprocess.run(list(a), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        if check:
            raise
        return subprocess.CompletedProcess(list(a), 124, '', f'timeout after {timeout}s')
    if check and r.returncode:
        raise RuntimeError(f"{' '.join(a)} → {r.returncode}: {r.stderr.strip()[:400]}")
    return r


def wait_for(pred, timeout):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.5)
    return False


# ---- 1. start with console
# `script` gives simctl itself a terminal: without it, its output to our pipe is block-buffered and the console
# lines arrive minutes late (or only at exit)
def launch():
    p = subprocess.Popen(['script', '-q', '/dev/null', 'xcrun', 'simctl', 'launch', '--console-pty', '--terminate-running-process', UDID, BUNDLE],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, errors='replace')
    threading.Thread(target=lambda: [lines.append(l.rstrip('\r\n')) for l in p.stdout], daemon=True).start()
    return p


proc = launch()
has = lambda s: any(s in l for l in lines)
ready = wait_for(lambda: has('FaLe PDF bereit'), 180)
if not ready and not [l for l in lines if l.strip()]:
    # the console stream stayed completely silent (busy CI runners: simctl attaches late) – launch once more
    print('::warning::Konsole blieb stumm – App wird ein zweites Mal gestartet', flush=True)
    try:
        proc.terminate()
    except Exception:
        pass
    proc = launch()
    ready = wait_for(lambda: has('FaLe PDF bereit'), 240)
time.sleep(3)
sh('xcrun', 'simctl', 'io', UDID, 'screenshot', f'{OUT}/{LABEL}-start.png', check=False)
# on busy runners the console lines sometimes arrive a few seconds late – count the start message if it is there now
ready = ready or wait_for(lambda: has('FaLe PDF bereit'), 20)
errors = [l for l in lines if '[error]' in l and 'FALE-E2E' not in l]
note(ready, 'Start', 'Web-App bereit' if ready else 'Web-App meldet sich nicht (letzte Zeilen: ' + ' | '.join(lines[-8:]) + ')')
note(not errors, 'JS-Fehler', 'keine' if not errors else ' | '.join(errors[:5]))
shot = os.path.getsize(f'{OUT}/{LABEL}-start.png') if os.path.exists(f'{OUT}/{LABEL}-start.png') else 0
note(shot > 20000, 'Screenshot', f'{shot} Bytes')

# ---- 2. open a file from Documents and write back
try:
    data = sh('xcrun', 'simctl', 'get_app_container', UDID, BUNDLE, 'data').stdout.strip()
    doc = os.path.join(data, 'Documents', 'fale-e2e-writeback.pdf')
    os.makedirs(os.path.dirname(doc), exist_ok=True)
    content = 'BT /F1 24 Tf 72 760 Td (FaLe E2E iOS) Tj ET'
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
            f'<< /Length {len(content)} >>\nstream\n{content}\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    pdf, offs = '%PDF-1.4\n', []
    for i, o in enumerate(objs):
        offs.append(len(pdf)); pdf += f'{i + 1} 0 obj\n{o}\nendobj\n'
    xref = len(pdf)
    pdf += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n' + ''.join(f'{o:010d} 00000 n \n' for o in offs)
    pdf += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'
    open(doc, 'w').write(pdf)
    before = os.path.getsize(doc)
    # 2a. through a URL (like „Öffnen in“) – only a diagnostic: simctl delivery of URLs is not reliable on CI
    r = sh('xcrun', 'simctl', 'openurl', UDID, 'fale-e2e://open?name=fale-e2e-writeback.pdf', check=False, timeout=30)
    imported = wait_for(lambda: has('FaleIncoming: fale-e2e-writeback.pdf'), 15)
    if not imported:
        seen = ' | '.join(l for l in lines if 'notification' in l or 'openURL' in l)[-1500:]
        print(f"::warning title=iOS URL::openurl rc={r.returncode} – kein Import über die URL; gesehen: {seen}")
        # 2b. test builds: a Darwin notification makes the plugin open the file exactly like an „open in place“ URL
        # (sent twice at most: on a busy runner the first notification can arrive before the plugin listens)
        for _ in range(2):
            sh('xcrun', 'simctl', 'spawn', UDID, 'notifyutil', '-p', 'dev.fale.pdf.e2e.open', check=False, timeout=30)
            imported = wait_for(lambda: has('FaleIncoming: fale-e2e-writeback.pdf'), 30)
            if imported:
                break
    if True:
        note(imported, 'Datei öffnen', next((l for l in lines if 'FaleIncoming: fale-e2e-writeback.pdf' in l), 'Datei kam nicht in der App an'))
        if imported:
            ok = wait_for(lambda: has('FALE-E2E write-back ok') or has('FALE-E2E write-back failed'), 40)
            got = open(doc, 'rb').read()
            done = ok and has('FALE-E2E write-back ok') and b'FALE-E2E-WRITEBACK-OK' in got
            note(done, 'Original ersetzen', f'Originaldatei überschrieben ({before} → {len(got)} Bytes)' if done else
                 'nicht überschrieben: ' + ' | '.join(l for l in lines if 'FALE-E2E' in l or 'FaleIncoming' in l)[-600:])
except Exception as e:
    note(False, 'Datei öffnen', str(e))

# ---- 3. screenshot tour (test builds: Documents/fale-e2e-route.txt + Darwin notification → location.hash)
# The screenshots end up in the "FaLe-PDF-iOS-Screenshots" artifact – a look at the app without an iPhone.
try:
    data = sh('xcrun', 'simctl', 'get_app_container', UDID, BUNDLE, 'data').stdout.strip()
    route_file = os.path.join(data, 'Documents', 'fale-e2e-route.txt')
    doc_id = next((l.split('doc=')[1].split(',')[0].strip() for l in lines if 'FALE-E2E self-test: imported doc=' in l), '')
    tour = [('start', '#/start'), ('werkzeuge', '#/werkzeuge'), ('dateien', '#/dateien'), ('vorlagen', '#/vorlagen'),
            ('ki', '#/ki'), ('einstellungen', '#/einstellungen'), ('web-briefpapier', '#/web/overlay-pdf'), ('web-rechner', '#/web/vat-calculator')]
    if doc_id:
        tour += [('pdf-ansicht', f'#/ansicht/{doc_id}'), ('werkzeug-komprimieren', f'#/werkzeug/komprimieren?doc={doc_id}')]
    tour += [('dunkel-start', '#/start'), ('dunkel-werkzeuge', '#/werkzeuge')]
    shots, missing = [], []
    for name, route in tour:
        if name == 'dunkel-start':
            sh('xcrun', 'simctl', 'ui', UDID, 'appearance', 'dark', check=False)
        went = False
        for attempt in range(2):   # a notification can get lost while the app is still busy – send it once more
            mark = len(lines)
            open(route_file, 'w').write(route)
            sh('xcrun', 'simctl', 'spawn', UDID, 'notifyutil', '-p', 'dev.fale.pdf.e2e.go', check=False, timeout=30)
            went = wait_for(lambda: any(f'FALE-E2E route {route} ok' in l for l in lines[mark:]), 20)
            if went:
                break
        time.sleep(3)
        f = f'{OUT}/{LABEL}-{len(shots) + len(missing) + 1:02d}-{name}.png'
        sh('xcrun', 'simctl', 'io', UDID, 'screenshot', f, check=False)
        (shots if went and os.path.exists(f) and os.path.getsize(f) > 20000 else missing).append(name)
    sh('xcrun', 'simctl', 'ui', UDID, 'appearance', 'light', check=False)
    # Apple's text recognition (ios-native/Sources/FaleVisionPlugin.swift via js/ocr/native.js): reads a drawn card
    for attempt in range(2):
        mark = len(lines)
        open(route_file, 'w').write('#/e2e/ocr')
        sh('xcrun', 'simctl', 'spawn', UDID, 'notifyutil', '-p', 'dev.fale.pdf.e2e.go', check=False, timeout=30)
        if wait_for(lambda: any('FALE-E2E ocr apple' in l for l in lines[mark:]), 90):
            break
    ocr_line = next((l for l in reversed(lines) if 'FALE-E2E ocr apple' in l), '')
    note('FALE-E2E ocr apple ok' in ocr_line, 'Apple-Texterkennung', ocr_line.split('FALE-E2E ocr apple', 1)[-1].strip() if ocr_line else 'keine Meldung')
    for wid in ('overlay-pdf', 'vat-calculator'):   # web tools in the app frame (js/webtools/host.js logs when they run)
        ok_w = has(f'FaLe Web-Werkzeug bereit: {wid}')
        note(ok_w, f'Web-Werkzeug {wid}', 'läuft im App-Rahmen' if ok_w else ' | '.join(l for l in lines if 'Web-Werkzeug' in l)[-400:] or 'keine Meldung')
    late = [l for l in lines if '[error]' in l and 'FALE-E2E' not in l and l not in errors]
    note(not missing, 'Rundgang', f'{len(shots)} Screenshots ({LABEL})' + (f', fehlend: {missing}' if missing else ''))
    note(not late, 'JS-Fehler im Rundgang', 'keine' if not late else ' | '.join(late[:5]))
except Exception as e:
    note(False, 'Rundgang', str(e))

if failed:
    tail =[l for l in lines if 'FaleIncoming' in l or 'error' in l.lower() or 'FALE' in l][-12:] or lines[-12:]
    print('::warning title=iOS Konsole::' + ' | '.join(tail).replace('\n', ' ')[:1800])
    # JS console after the import (everything except bridge chatter), for diagnosis without log downloads
    i = next((k for k, l in enumerate(lines) if 'FaleIncoming: fale-e2e-writeback.pdf' in l), max(0, len(lines) - 40))
    js = [l for l in lines if 'pdf.js worker' in l or 'Import fehlgeschlagen' in l] + [l for l in lines[i:] if '⚡️  [' in l or 'Error' in l or 'Exception' in l][:25]
    print('::warning title=iOS JS nach Import::' + ' | '.join(js).replace('\n', ' ')[:3500])
proc.terminate()
open(f'{OUT}/{LABEL}-console.txt', 'w').write('\n'.join(lines))
print(f'{len(lines)} Konsolenzeilen, {len(failed)} Fehler: {failed}')
sys.exit(1 if failed else 0)

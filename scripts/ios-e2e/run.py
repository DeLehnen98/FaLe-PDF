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
OUT = 'ios-e2e-out'
os.makedirs(OUT, exist_ok=True)
lines, failed = [], []


def note(ok, title, msg):
    msg = msg.replace('\n', ' ')[:900]
    print(f"::{'notice' if ok else 'error'} title=iOS {title}::{'OK' if ok else 'FEHLER'}: {msg}", flush=True)
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
proc = subprocess.Popen(['xcrun', 'simctl', 'launch', '--console-pty', '--terminate-running-process', UDID, BUNDLE],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
threading.Thread(target=lambda: [lines.append(l.rstrip('\n')) for l in proc.stdout], daemon=True).start()
has = lambda s: any(s in l for l in lines)
ready = wait_for(lambda: has('FaLe PDF bereit (ios)'), 180)
time.sleep(3)
sh('xcrun', 'simctl', 'io', UDID, 'screenshot', f'{OUT}/start.png', check=False)
errors = [l for l in lines if '[error]' in l and 'FALE-E2E' not in l]
note(ready, 'Start', 'Web-App bereit' if ready else 'Web-App meldet sich nicht (letzte Zeilen: ' + ' | '.join(lines[-8:]) + ')')
note(not errors, 'JS-Fehler', 'keine' if not errors else ' | '.join(errors[:5]))
shot = os.path.getsize(f'{OUT}/start.png') if os.path.exists(f'{OUT}/start.png') else 0
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
        sh('xcrun', 'simctl', 'spawn', UDID, 'notifyutil', '-p', 'dev.fale.pdf.e2e.open', check=False, timeout=30)
        imported = wait_for(lambda: has('FaleIncoming: fale-e2e-writeback.pdf'), 30)
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

if failed:
    tail = [l for l in lines if 'FaleIncoming' in l or 'error' in l.lower() or 'FALE' in l][-12:] or lines[-12:]
    print('::warning title=iOS Konsole::' + ' | '.join(tail).replace('\n', ' ')[:1800])
    # JS console after the import (everything except bridge chatter), for diagnosis without log downloads
    i = next((k for k, l in enumerate(lines) if 'FaleIncoming: fale-e2e-writeback.pdf' in l), max(0, len(lines) - 40))
    js = [l for l in lines if 'pdf.js worker' in l or 'Import fehlgeschlagen' in l] + [l for l in lines[i:] if '⚡️  [' in l or 'Error' in l or 'Exception' in l][:25]
    print('::warning title=iOS JS nach Import::' + ' | '.join(js).replace('\n', ' ')[:3500])
proc.terminate()
open(f'{OUT}/console.txt', 'w').write('\n'.join(lines))
print(f'{len(lines)} Konsolenzeilen, {len(failed)} Fehler: {failed}')
sys.exit(1 if failed else 0)

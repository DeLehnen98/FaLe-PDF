"""AdMob bits of scripts/cap-patch-android.mjs against the fixture Android project (from the native suite)."""
import os, sys, subprocess, tempfile, shutil
import xml.etree.ElementTree as ET
sys.path.insert(0, '/home/claude/FalePDF/tests/base/native'); sys.path.insert(0, '/home/claude/FalePDF/tests/base')
import fixture
APP = '/home/claude/FalePDF'
ok = 0; bad = 0
def check(n, c, i=''):
    global ok, bad
    ok += bool(c); bad += (not c); print(('PASS ' if c else 'FAIL ') + n + ('' if c else f'  [{i}]'))
base = tempfile.mkdtemp(prefix='fale-ai-android-')
andr = os.path.join(base, 'android'); fixture.make_android(andr)
env = dict(os.environ); env.pop('ADMOB_APP_ID', None)
r = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr], capture_output=True, text=True, env=env)
check('patch ok', r.returncode == 0, r.stderr[-500:])
check('own app id from js/ai/config.js, test ads still on (logged)', 'TEST-App-ID' not in r.stdout and 'Test-Anzeigen aktiv' in r.stdout, r.stdout[-300:])
man = os.path.join(andr, 'app/src/main/AndroidManifest.xml')
t = ET.parse(man); A = '{http://schemas.android.com/apk/res/android}'
app = t.getroot().find('application')
metas = {m.get(A + 'name'): m.get(A + 'value') for m in app.findall('meta-data')}
check('APPLICATION_ID meta-data → @string/admob_app_id', metas.get('com.google.android.gms.ads.APPLICATION_ID') == '@string/admob_app_id', metas)
check('DELAY_APP_MEASUREMENT_INIT', metas.get('com.google.android.gms.ads.DELAY_APP_MEASUREMENT_INIT') == 'true')
res = open(os.path.join(andr, 'app/src/main/res/values/fale_admob.xml')).read()
check('admob_app_id = own id from js/ai/config.js', 'ca-app-pub-3002034870890608~3086375405' in res, res)
before = open(man).read()
env['ADMOB_APP_ID'] = 'ca-app-pub-1234567890123456~1234567890'
r = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr], capture_output=True, text=True, env=env)
check('env override', 'ca-app-pub-1234567890123456~1234567890' in open(os.path.join(andr, 'app/src/main/res/values/fale_admob.xml')).read())
check('idempotent manifest', open(man).read() == before and open(man).read().count('APPLICATION_ID') == 1)
env['ADMOB_APP_ID'] = 'kaputt'
r = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-android.mjs'), andr], capture_output=True, text=True, env=env)
check('invalid id rejected', r.returncode != 0)
shutil.rmtree(base)
print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

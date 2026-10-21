"""scripts/cap-patch-ios.mjs against a minimal Capacitor iOS project: Info.plist (valid plist, document types,
open in place, Files sharing, usage texts, AdMob id, versions), storyboard, Podfile, project – and idempotency.
Also: the Swift sources of ios-native/ use the same plugin/method names as js/platform.js and the Android plugin."""
import os, re, sys, subprocess, tempfile, plistlib, shutil, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ios'))
import fixture
sw_inc = open('/home/claude/FalePDF/ios-native/Sources/FaleIncomingPlugin.swift').read()

APP = '/home/claude/FalePDF'
ok = bad = 0
def check(n, c, i=''):
    global ok, bad
    ok += bool(c); bad += (not c); print(('PASS ' if c else 'FAIL ') + n + ('' if c else f'  [{str(i)[:400]}]'))

base = tempfile.mkdtemp(prefix='fale-ios-'); ios = os.path.join(base, 'ios'); app = fixture.make_ios(ios)
env = dict(os.environ); env.pop('ADMOB_IOS_APP_ID', None)
run = lambda e=env: subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-ios.mjs'), ios], capture_output=True, text=True, env=e)
r = run()
check('patch ok', r.returncode == 0, r.stderr[-600:])
info_p = os.path.join(app, 'App/Info.plist')
with open(info_p, 'rb') as f: info = plistlib.load(f)
ver = json.load(open(os.path.join(APP, 'package.json')))['version']
check('valid plist, existing keys kept', info['UIMainStoryboardFile'] == 'Main' and info['CAPACITOR_DEBUG'] == '$(CAPACITOR_DEBUG)' and info['LSRequiresIPhoneOS'] is True)
types = [t for d in info['CFBundleDocumentTypes'] for t in d['LSItemContentTypes']]
check('document types: pdf, docx, xlsx, pptx, csv, txt, md, images', all(t in types for t in ['com.adobe.pdf', 'org.openxmlformats.wordprocessingml.document', 'org.openxmlformats.spreadsheetml.sheet', 'org.openxmlformats.presentationml.presentation', 'public.comma-separated-values-text', 'public.plain-text', 'net.daringfireball.markdown', 'public.jpeg', 'public.png']), types)
check('document types: editor, alternate handler (never takes over the system default)', all(d['CFBundleTypeRole'] == 'Editor' and d['LSHandlerRank'] == 'Alternate' for d in info['CFBundleDocumentTypes']))
check('open in place + Files app sharing', info['LSSupportsOpeningDocumentsInPlace'] is True and info['UIFileSharingEnabled'] is True)
check('usage texts camera / microphone / speech (German, say why)', all(len(info[k]) > 30 for k in ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']))
check('AdMob app id present (test id by default) – the SDK aborts without it', info['GADApplicationIdentifier'] == 'ca-app-pub-3940256099942544~1458002511')
check('arm64, HTTPS only, de/en', info['UIRequiredDeviceCapabilities'] == ['arm64'] and 'NSAppTransportSecurity' not in info and info['CFBundleLocalizations'] == ['de', 'en'])
sb = open(os.path.join(app, 'App/Base.lproj/Main.storyboard')).read()
check('storyboard: plain Capacitor bridge controller', 'customClass="CAPBridgeViewController" customModule="Capacitor"' in sb)
cc = json.load(open(os.path.join(app, 'App/capacitor.config.json')))
check('own plugins in packageClassList (npm plugins kept, no duplicates)', cc['packageClassList'] == ['AdMobPlugin', 'FilesystemPlugin', 'FaleIncomingPlugin', 'FalePrintPlugin', 'FaleVisionPlugin'], cc)
pod = open(os.path.join(app, 'Podfile')).read()
podrel = os.path.relpath(os.path.join(APP, 'ios-native'), app)
check('Podfile: FaleNative pod (path to ios-native/) + iOS 15', f"pod 'FaleNative', :path => '{podrel}'" in pod and "platform :ios, '15.0'" in pod and pod.index('capacitor_pods\n  pod') > 0, pod)
prj = open(os.path.join(app, 'App.xcodeproj/project.pbxproj')).read()
check('project: version from package.json, build number, iOS 15', f'MARKETING_VERSION = {ver};' in prj and 'CURRENT_PROJECT_VERSION = ' + str(sum(int(x) * m for x, m in zip(ver.split('.'), (10000, 100, 1)))) + ';' in prj and 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;' in prj)
snap = {p: open(os.path.join(app, p)).read() for p in ['App/Info.plist', 'App/Base.lproj/Main.storyboard', 'Podfile', 'App.xcodeproj/project.pbxproj', 'App/capacitor.config.json']}
r2 = run()
check('idempotent (second run changes nothing)', r2.returncode == 0 and all(open(os.path.join(app, p)).read() == t for p, t in snap.items()))
e2 = dict(env); e2['ADMOB_IOS_APP_ID'] = 'ca-app-pub-1111111111111111~2222222222'
run(e2)
with open(info_p, 'rb') as f: check('ADMOB_IOS_APP_ID override', plistlib.load(f)['GADApplicationIdentifier'] == 'ca-app-pub-1111111111111111~2222222222')
e3 = dict(env); e3['FALE_E2E'] = '1'
run(e3)
with open(info_p, 'rb') as f: i3 = plistlib.load(f)
check('test build (FALE_E2E=1): fale-e2e URL scheme + FaleE2E flag', i3['CFBundleURLTypes'][0]['CFBundleURLSchemes'] == ['fale-e2e'] and i3['FaleE2E'] is True)
run()
with open(info_p, 'rb') as f: i4 = plistlib.load(f)
check('normal build: no test scheme, no FaleE2E', 'CFBundleURLTypes' not in i4 and 'FaleE2E' not in i4)
check('Swift: test scheme only with the FaleE2E flag, no paths', 'forInfoDictionaryKey: "FaleE2E"' in sw_inc and '!name.contains("/")' in sw_inc)
r3 = subprocess.run(['node', os.path.join(APP, 'scripts/cap-patch-ios.mjs'), os.path.join(base, 'nope')], capture_output=True, text=True)
check('missing project → clear error', r3.returncode != 0 and 'cap add ios' in r3.stderr)

# Swift sources: names match the JS side
sw = {f: open(os.path.join(APP, 'ios-native/Sources', f)).read() for f in os.listdir(os.path.join(APP, 'ios-native/Sources'))}
inc, pr = sw['FaleIncomingPlugin.swift'], sw['FalePrintPlugin.swift']
check('Swift FaleIncoming: jsName + all methods the JS calls', 'jsName = "FaleIncoming"' in inc and all(f'CAPPluginMethod(name: "{m}"' in inc and f'func {m}(_ call: CAPPluginCall)' in inc for m in ['takePending', 'readFile', 'release', 'writeBack', 'setBarColors', 'setSecure']))
check('Swift FaleIncoming: filesReady event, origin token + writable, reject codes like Android', 'notifyListeners("filesReady"' in inc and 'o["origin"] = token' in inc and 'o["writable"] = writable' in inc and all(f'call.reject("{c}", "{c}")' in inc for c in ['unknown', 'readonly', 'failed']))
check('Swift FaleIncoming: security – sources only from caches/writeback and caches/incoming, own private files refused, 100 MB', 'FalePaths.isInside(src, wbDir)' in inc and 'FalePaths.isInside(url, FalePaths.incoming())' in inc and 'addSkipped(name, "blocked")' in inc and '100 * 1024 * 1024' in inc and '".."' in inc)
check('Swift FaleIncoming: coordinated read/write, security-scoped access, bookmark', all(x in inc for x in ['coordinate(readingItemAt:', 'coordinate(writingItemAt:', 'startAccessingSecurityScopedResource()', 'bookmarkData(', 'URL(resolvingBookmarkData:']))
check('Swift FalePrint: printPdf only for files in caches', 'jsName = "FalePrint"' in pr and 'func printPdf(_ call: CAPPluginCall)' in pr and 'FalePaths.isInside(url, FalePaths.caches())' in pr)
vi = sw['FaleVisionPlugin.swift']
check('Swift @objc class names = packageClassList entries', '@objc(FaleIncomingPlugin)' in inc and '@objc(FalePrintPlugin)' in pr and '@objc(FaleVisionPlugin)' in vi)
nat = open(os.path.join(APP, 'js/ocr/native.js')).read()
check('Swift FaleVision: jsName + the methods js/ocr/native.js calls, on-device only (no network)', 'jsName = "FaleVision"' in vi and all(f'CAPPluginMethod(name: "{m}"' in vi and f'func {m}(_ call: CAPPluginCall)' in vi and f'p.{m}(' in nat for m in ['languages', 'recognize'])
      and 'URLSession' not in vi and 'import Vision' in vi and 'VNRecognizeTextRequest' in vi)
check('podspec links Vision', "s.frameworks = 'Vision'" in open(os.path.join(APP, 'ios-native/FaleNative.podspec')).read())
js = open(os.path.join(APP, 'js/platform.js')).read()
used = set(re.findall(r'\bfi\.(\w+)\(', js)) | set(re.findall(r"plugin\('FaleIncoming'\)[^\n]*?\.(\w+)\(", js))
check('every FaleIncoming method used in js/platform.js exists in Swift', used and all(f'name: "{m}"' in inc for m in used), used)
shutil.rmtree(base, ignore_errors=True)
print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

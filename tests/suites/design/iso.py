# Build tree = git HEAD + only the design agent's changes (for isolated testing)
import subprocess, shutil, os, sys
D = os.path.dirname(os.path.abspath(__file__)); R = '/home/claude/FalePDF'; ISO = os.path.join(D, 'iso')
shutil.rmtree(ISO, ignore_errors=True); os.makedirs(ISO)
subprocess.run(f'cd {R} && git archive HEAD | tar -x -C {ISO}', shell=True, check=True)
for f in ['styles.css', 'css/theme-2026.css', 'css/ai.css', 'css/share.css', 'css/account.css', 'css/extras.css', 'css/protools.css', 'js/theme.js']:
    shutil.copy(os.path.join(R, f), os.path.join(ISO, f))
shutil.copytree(os.path.join(R, 'vendor/fonts'), os.path.join(ISO, 'vendor/fonts'))
p = os.path.join(ISO, 'index.html'); s = open(p).read()
s = s.replace('  <link rel="stylesheet" href="css/extras.css">\n', '  <link rel="stylesheet" href="css/extras.css">\n  <link rel="stylesheet" href="css/theme-2026.css">\n')
s = s.replace('  <link rel="stylesheet" href="styles.css">\n', '  <link rel="preload" href="vendor/fonts/bricolage-grotesque/BricolageGrotesque-Bold.woff" as="font" type="font/woff" crossorigin>\n  <link rel="stylesheet" href="styles.css">\n')
open(p, 'w').write(s)
# views.js: apply the design hunks from the working copy (hero, home order, tile class, greetName, licence)
p = os.path.join(ISO, 'js/views.js'); s = open(p).read(); w = open(os.path.join(R, 'js/views.js')).read()
import re
def grab(src, start, end):
    i = src.index(start); j = src.index(end, i); return src[i:j]
old_hero = grab(s, '      <div class="hero">', '      <div class="rem-start" data-rem hidden></div>')
new_hero = grab(w, '      <div class="hero">', '      <div class="rem-start" data-rem hidden></div>')
s = s.replace(old_hero, new_hero)
s = s.replace('''      <div class="ai-start" data-ai-start hidden></div>
      <div class="sh-start" data-share-start hidden></div>
      <div class="acct-start" data-acct-start hidden></div>
''', '')
mid = grab(w, '      <div class="home-more">', '      <div class="month-box" data-month hidden></div>')
s = s.replace('      <div class="month-box" data-month hidden></div>`;', mid + '      <div class="month-box" data-month hidden></div>`;', 1)
s = s.replace("<button class=\"tile ${t.soon ? 'soon' : ''}\" type=\"button\"", "<button class=\"tile ${t.soon ? 'soon' : ''} g-${t.group || ''}\" type=\"button\"")
s = s.replace("  $('[data-greet]', el).textContent = `${greeting()}!`;\n  await renderHomeList();", "  $('[data-greet]', el).textContent = `${greeting()}!`;\n  greetName(el);\n  await renderHomeList();")
fn = grab(w, '// personal greeting:', 'async function renderHomeExtras(el) {')
s = s.replace('async function renderHomeExtras(el) {', fn + 'async function renderHomeExtras(el) {')
lic = grab(w, '        <li>Bricolage Grotesque', '      </ul>')
s = s.replace('vendor/pdfjs</li>\n      </ul>', 'vendor/pdfjs</li>\n' + lic + '      </ul>')
open(p, 'w').write(s)
print(subprocess.run(['node', '--check', p], capture_output=True, text=True).stderr or 'views ok')
print(subprocess.run(f'cd {R} && git diff --no-index --stat {ISO}/js/views.js js/views.js', shell=True, capture_output=True, text=True).stdout[-300:])

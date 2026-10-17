import os, re, json, subprocess
src=''
for root,_,files in os.walk('/home/claude/FalePDF/one/js'):
    if '/shared' in root: continue
    for f in files:
        if f.endswith('.js') and f!='i18n-en.js': src+=open(os.path.join(root,f),encoding='utf-8').read()+'\n'
keys=set(re.findall(r"\bt\(\s*'((?:[^'\\]|\\.)*)'", src))
for m in re.finditer(r"\btp\([^,]+,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'", src): keys.update([m.group(1), m.group(2)])
en=json.loads(subprocess.run(['node','-e',"import('/home/claude/FalePDF/one/js/i18n-en.js').then(m=>console.log(JSON.stringify(m.default)))"],capture_output=True,text=True).stdout)
miss=sorted(k.replace("\\'","'") for k in keys if k.replace("\\'","'") not in en)
print(json.dumps(miss, ensure_ascii=False, indent=0))
print(len(miss))

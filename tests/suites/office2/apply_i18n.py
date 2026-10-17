import json, subprocess, re, sys
exec(open('trans.py').read())
TR.update({
 "[Bild]": "[Image]",
 "Das Bild": "The image",
 "{0}Der Link führt zu {1} – öffne nur Links, denen du vertraust.": "{0}The link leads to {1} – only open links you trust.",
})
ROOT='/home/claude/FalePDF'
miss=json.loads(subprocess.run(['node','scripts/i18n-extract.mjs','--json'],cwd=ROOT,capture_output=True,text=True).stdout)['missing']
keys=[m['key'] for m in miss]
add={k:TR[k] for k in keys if k in TR}
ign=[k for k in keys if k not in TR and k not in ('Bricolage Grotesque – The Bricolage Grotesque Project Authors, SIL Open Font License 1.1 (',)]
p=ROOT+'/js/i18n/en.js'; s=open(p,encoding='utf-8').read()
i=s.index('\n};\n')  # end of the first exported object
lines=''.join(f'\n  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},' for k,v in add.items())
s=s[:i]+'\n  // Office 2 (Textverarbeitung / Tabelle)'+lines+s[i:]
open(p,'w',encoding='utf-8').write(s)
ip=ROOT+'/scripts/i18n-ignore.txt'; t=open(ip,encoding='utf-8').read()
if not t.endswith('\n'): t+='\n'
t+='# Office 2: function names, error values, font names, CSS, identifiers, English/German date names used for parsing\n'+'\n'.join(ign)+'\n'
open(ip,'w',encoding='utf-8').write(t)
print('added',len(add),'ignored',len(ign))
print([k for k in keys if k not in TR and k not in ign])

import {readFileSync} from 'fs'; import {join,dirname,normalize} from 'path';
const roots=process.argv.slice(2); const seen=new Map(); const ext=new Map();
function go(p){ if(seen.has(p))return; if(!p.startsWith('office/')){ext.set(p,(ext.get(p)||0)+1);return;}
 const t=readFileSync(p,'utf8'); const im=[...t.matchAll(/^\s*import\s([\s\S]*?)from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map(m=>[m[2]||m[3], !m[2], (m[1]||'').replace(/\s+/g,' ')]);
 seen.set(p,im.map(([s,d,w])=>(d?'dyn:':'')+s+(s.startsWith('../')?' '+w:'')));
 for(const [s] of im){ go(normalize(join(dirname(p),s))); } }
roots.forEach(go); for(const [k,v] of seen) console.log(k, (readFileSync(k).length/1024|0)+'K', '->', v.join(' | ')); console.log('EXTERNAL',[...ext.keys()]);

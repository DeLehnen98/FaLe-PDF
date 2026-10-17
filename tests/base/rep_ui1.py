from rep import apply
R = [
('<html lang="de">', '<html lang="__LANG__">'),
('''.dot{width:8px;height:8px;border-radius:50%;background:var(--warn);flex:none}.dot.ok{background:var(--acc)}''',
 '''.dot{width:8px;height:8px;border-radius:50%;background:var(--warn);flex:none}.dot.ok{background:var(--acc)}
.lang{display:flex;align-items:center;gap:2px;margin-top:10px;font-size:12px;color:var(--dim)}
.lang button{background:none;border:1px solid transparent;border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--muted);font-size:12px;font-weight:600}
.lang button:hover{color:var(--text);border-color:var(--line)}
.lang button.on{color:var(--acc);background:var(--acc-bg)}'''),
('''    <button class="btn sm" id="adm-btn" style="width:100%;display:none">Als Administrator neu starten</button>
  </div>''',
 '''    <button class="btn sm" id="adm-btn" style="width:100%;display:none">Als Administrator neu starten</button>
    <div class="lang" id="lang-sw"><button data-l="de" title="Deutsch">DE</button><span>|</span><button data-l="en" title="English">EN</button></div>
  </div>'''),
('''const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function human(n){n=Number(n)||0;const u=["B","KB","MB","GB","TB"];let i=0;while(Math.abs(n)>=1024&&i<4){n/=1024;i++}return (i<2?n.toFixed(0):n.toFixed(1)).replace(".",",")+" "+u[i]}
const fmtInt = n => (Number(n)||0).toLocaleString("de-DE");''',
 '''const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// ---------------------------------------------------------------- Sprache
// Der deutsche Text ist der Schlüssel; EN enthält die englische Fassung (siehe unten).
const LANG = "__LANG__" === "en" ? "en" : "de";
const LOC = LANG === "en" ? "en-US" : "de-DE";
document.documentElement.lang = LANG;
const T_MISS = new Set();
function t(s, v) {
  let r = s;
  if (LANG === "en") { if (Object.prototype.hasOwnProperty.call(EN, s)) r = EN[s]; else T_MISS.add(s); }
  if (v) r = r.replace(/\\{(\\w+)\\}/g, (m, k) => (k in v ? String(v[k]) : m));
  return r;
}
const dec = (x, d = 1) => { const s = (Number(x) || 0).toFixed(d); return LANG === "en" ? s : s.replace(".", ","); };
function human(n){n=Number(n)||0;const u=["B","KB","MB","GB","TB"];let i=0;while(Math.abs(n)>=1024&&i<4){n/=1024;i++}return (i<2?n.toFixed(0):dec(n,1))+" "+u[i]}
const fmtInt = n => (Number(n)||0).toLocaleString(LOC);
// Datum aus "TT.MM.JJJJ" (Programmliste) passend zur Sprache anzeigen
const fmtDMY = s => { const m = /^(\\d\\d)\\.(\\d\\d)\\.(\\d{4})$/.exec(s || ""); return m && LANG === "en" ? `${m[2]}/${m[1]}/${m[3]}` : (s || ""); };'''),
('''const fmtDate = t => new Date(t * 1000).toLocaleString("de-DE", {day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"});
const confirmBox = (title, html, ok = "OK", cls = "primary") => modal(title, html, [{text:"Abbrechen", value:false}, {text:ok, value:true, cls}]);''',
 '''const fmtDate = ts => new Date(ts * 1000).toLocaleString(LOC, {day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"});
const confirmBox = (title, html, ok = "OK", cls = "primary") => modal(title, html, [{text:t("Abbrechen"), value:false}, {text:ok, value:true, cls}]);'''),
('''String(x).localeCompare(String(y), "de", {numeric:true})''', '''String(x).localeCompare(String(y), LANG, {numeric:true})'''),
('''${esc(opt.empty || "Keine Einträge")}''', '''${esc(opt.empty || t("Keine Einträge"))}'''),
('''  el.innerHTML = `<header class="ph"><h1>${esc(title)}</h1><p>${esc(sub)}</p></header><div class="pb"></div>`;''',
 '''  el.innerHTML = `<header class="ph"><h1>${esc(t(title))}</h1><p>${esc(t(sub))}</p></header><div class="pb"></div>`;'''),
]
apply("/home/claude/FaLeClean/ui.html", R)

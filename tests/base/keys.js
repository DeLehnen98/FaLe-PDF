// Sammelt alle Übersetzungsschlüssel aus ui.html und vergleicht sie mit EN.
const fs = require("fs");
const src = fs.readFileSync("/home/claude/FaLeClean/ui.html", "utf8");
const js = src.slice(src.indexOf("<script>") + 8, src.lastIndexOf("</script>"));
const STR = /"((?:[^"\\]|\\.)*)"/g;
const dec = s => JSON.parse('"' + s + '"');
const keys = new Set();
const addAll = frag => { for (const m of frag.matchAll(STR)) keys.add(dec(m[1])); };
// t("...") und t(bedingung ? "..." : "...")
for (let i = js.indexOf("t("); i >= 0; i = js.indexOf("t(", i + 2)) {
  const prev = js[i - 1];
  if (prev && /[\w.$]/.test(prev)) continue;
  // passende Klammer suchen, Strings beachten
  let d = 0, j = i + 1, inS = null;
  for (; j < js.length; j++) {
    const c = js[j];
    if (inS) { if (c === "\\") j++; else if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
    if (c === "(") d++; else if (c === ")") { d--; if (!d) break; }
  }
  const inner = js.slice(i + 2, j);
  // nur Strings auf oberster Ebene des ersten Arguments (vor ", {")
  addAll(inner);
}
for (const m of js.matchAll(/\bt:\s*"((?:[^"\\]|\\.)*)"/g)) if (m[1]) keys.add(dec(m[1]));
for (const m of js.matchAll(/empty:\s*([^,}]*?"[^"]*"(?:\s*:\s*"[^"]*")?)/g)) addAll(m[1]);
for (const m of js.matchAll(/\b(?:title|sub):\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(dec(m[1]));
for (const m of js.matchAll(/\btext:\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(dec(m[1]));
for (const m of js.matchAll(/confirmBox\([\s\S]*?,\s*"([^"]+)"(?:,\s*"(?:danger|primary)")?\)\)/g)) keys.add(m[1]);
const nav = js.slice(js.indexOf("const NAV"), js.indexOf("];", js.indexOf("const NAV")));
for (const m of nav.matchAll(/\["\w+","([^"]+)"/g)) keys.add(m[1]);
// EN auswerten
const enSrc = js.slice(js.indexOf("const EN = {"), js.indexOf("};", js.indexOf("const EN = {")) + 2);
let EN = {};
if (enSrc.length > 20) EN = eval("(" + enSrc.slice(11, -1) + ")");
for (const k of [...keys]) if (!/[A-Za-zÄÖÜäöüß]/.test(k) || ["sleep", "wake"].includes(k)) keys.delete(k);
const missing = [...keys].filter(k => !(k in EN) && !["Admin", "Status", "CPU", "Name", "Version", "Cache", "Cookies", "Bloatware", "Registry", "okay", "OK"].includes(k));
const unused = Object.keys(EN).filter(k => !keys.has(k));
if (process.argv[2] === "list") console.log(JSON.stringify([...keys], null, 0));
console.log("keys:", keys.size, "EN:", Object.keys(EN).length);
console.log("MISSING:", JSON.stringify(missing, null, 1));
console.log("UNUSED:", JSON.stringify(unused, null, 1));

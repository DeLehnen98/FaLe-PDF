from rep import apply
p = "/home/claude/FalePDF/tests/base/demo_server.py"
R = [
('''"""Demo-Server mit Fake-Daten, nur zum Testen der Oberfläche."""
import sys, time, random
sys.path.insert(0, "/home/claude/FaLeClean")
import fale_clean as app, falecore as c
GB, MB = 1024**3, 1024**2
app.CALLS["info"] = lambda: {"version": c.VERSION, "admin": False, "windows": True, "psutil": True, "winget": True, "user": "Fabian"}''',
'''"""Demo-Server mit Fake-Daten, nur zum Testen der Oberfläche.
Sprache: DEMO_LANG=de|en (Standard de); umschaltbar über die API set_lang (nur im Speicher)."""
import os, sys, time, random
sys.path.insert(0, "/home/claude/FaLeClean")
import fale_clean as app, falecore as c, fale_i18n as i18n
from fale_i18n import tr
GB, MB = 1024**3, 1024**2
DEMO = {"lang": os.environ.get("DEMO_LANG", "de")}
i18n.set_reader(lambda: DEMO["lang"])
def _set_lang(lang=None):
    DEMO["lang"] = lang if lang in ("de", "en") else None
    i18n.set_lang(DEMO["lang"])
    return i18n.lang()
app.CALLS["set_lang"] = _set_lang
app.CALLS["info"] = lambda: {"version": c.VERSION, "admin": False, "windows": True, "psutil": True, "winget": True, "user": "Fabian", "lang": i18n.lang(), "lang_pref": DEMO["lang"]}'''),
('''            "recs": [{"page":"clean","text":"3,4 GB Datenmüll gefunden – mit „Jetzt optimieren“ entfernen."},
                     {"page":"startup","text":"11 Programme starten mit Windows – unnötige unter „Autostart“ deaktivieren."},
                     {"page":"auto","text":"Automatische Reinigung ist aus – unter „Automatik“ einschalten."},
                     {"page":"admin","text":"Ohne Admin-Rechte werden Systemordner übersprungen."}]}''',
'''            "recs": [{"page":"clean","text":tr("{size} Datenmüll gefunden – mit „Jetzt optimieren“ entfernen.", size=c.human(int(3.4*GB)))},
                     {"page":"startup","text":tr("{n} Programme starten mit Windows – unnötige unter „Autostart“ deaktivieren.", n=11)},
                     {"page":"auto","text":tr("Automatische Reinigung ist aus – unter „Automatik“ einschalten.")},
                     {"page":"admin","text":tr("Ohne Admin-Rechte werden Systemordner übersprungen.")}]}'''),
('''app.CALLS["targets"] = lambda: [{"id":i,"group":g,"label":l,''', '''app.CALLS["targets"] = lambda: [{"id":i,"group":tr(g),"label":tr(l),'''),
('''"note":n,"selected":bool(d),''', '''"note":tr(n) if n else "","selected":bool(d),'''),
('''        out.append({"id":i,"group":t[1],"label":t[2],"files":files,"size":size,"freed":size if done and "Über" not in st else 0,"deleted":files if done else 0,"failed":0,"status":st})''',
 '''        out.append(c.Result(**{"id":i,"group":t[1],"label":t[2],"files":files,"size":size,"freed":size if done and "Über" not in st else 0,"deleted":files if done else 0,"failed":0,"status":st}).public())'''),
('''app.CALLS["startup_list"] = lambda: [{"key":f"k{i}","name":n,"command":cmd,"where":w,''', '''app.CALLS["startup_list"] = lambda: [{"key":f"k{i}","name":n,"command":cmd,"where":tr(w),'''),
('''app.CALLS["default_folders"] = lambda: [{"name":"Benutzerordner","path":"C:\\\\Users\\\\Fabian"},{"name":"Downloads","path":"C:\\\\Users\\\\Fabian\\\\Downloads"},{"name":"Bilder","path":"C:\\\\Users\\\\Fabian\\\\Pictures"},''',
 '''app.CALLS["default_folders"] = lambda: [{"name":tr("Benutzerordner"),"path":"C:\\\\Users\\\\Fabian"},{"name":"Downloads","path":"C:\\\\Users\\\\Fabian\\\\Downloads"},{"name":tr("Bilder"),"path":"C:\\\\Users\\\\Fabian\\\\Pictures"},'''),
('''  "categories":[{"name":n,"size":int(s*GB)}''', '''  "categories":[{"name":tr(n),"size":int(s*GB)}'''),
('''app.CALLS["log_tail"] = lambda: [''', '''app.CALLS["log_tail"] = lambda: [i18n.tr_log(x) for x in ['''),
('''"2026-10-12 18:31:40  Smart-Monitor: chrome geschlossen → 233.0 MB bereinigt"]''', '''"2026-10-12 18:31:40  Smart-Monitor: chrome geschlossen → 233.0 MB bereinigt"]]'''),
('''"group": t[1], "title": t[2], "desc": t[3],''', '''"group": tr(t[1]), "title": tr(t[2]), "desc": tr(t[3]),'''),
('''"label": fx.BLOAT[n][0], "rec": fx.BLOAT[n][1]}''', '''"label": tr(fx.BLOAT[n][0]), "rec": fx.BLOAT[n][1]}'''),
('''"count": 5, "kind": "Programm"}''', '''"count": 5, "kind": tr("Programm")}'''),
('''"count": 3, "kind": "Programm"}''', '''"count": 3, "kind": tr("Programm")}'''),
('''"count": 2, "kind": "Dienst"}''', '''"count": 2, "kind": tr("Dienst")}'''),
('''"best_plan": {"guid": "x", "name": "Ultimative Leistung", "active": False}}''', '''"best_plan": {"guid": "x", "name": "Ultimative Leistung" if i18n.lang() == "de" else "Ultimate Performance", "active": False}}'''),
('''"reason": "Ordner trägt den Programmnamen", "size": 312*MB''', '''"reason": tr("Ordner trägt den Programmnamen"), "size": 312*MB'''),
('''"reason": "Ordner trägt den Programmnamen", "size": 88*MB''', '''"reason": tr("Ordner trägt den Programmnamen"), "size": 88*MB'''),
('''"reason": "Registry-Schlüssel", "size": 0''', '''"reason": tr("Registry-Schlüssel"), "size": 0'''),
('''"label": "Reste von Discord",''', '''"label": c.q_label("Reste von Discord"),'''),
('''"label": "Reinigung 12.10.2026 18:02",''', '''"label": c.q_label("Reinigung 12.10.2026 18:02"),'''),
('''"apps": [{"label": "Candy Crush & Co. (King)",''', '''"apps": [{"label": tr("Candy Crush & Co. (King)"),'''),
('''"bus": "NVMe", "health": "Gesund",''', '''"bus": "NVMe", "health": tr("Gesund"), "state": "ok",'''),
('''"reboot": ["Windows Update"]})[1]''', '''"reboot": [tr("Windows Update")]})[1]'''),
]
apply(p, R)

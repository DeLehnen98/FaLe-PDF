"""Demo-Server mit Fake-Daten, nur zum Testen der Oberfläche.
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
app.CALLS["info"] = lambda: {"version": c.VERSION, "admin": False, "windows": True, "psutil": True, "winget": True, "user": "Fabian", "lang": i18n.lang(), "lang_pref": DEMO["lang"]}
def health(job):
    for s in ["Analysiere: Windows – Temporäre Dateien", "Analysiere: Google Chrome – Cache"]:
        job.set(s); time.sleep(0.4)
    return {"disk": {"total": 476*GB, "free": 61*GB, "drive": "C:\\"}, "ram": {"total": 16*GB, "percent": 71},
            "startup": {"total": 14, "enabled": 11}, "junk": {"size": int(3.4*GB), "files": 18342}, "score": 62,
            "recs": [{"page":"clean","text":tr("{size} Datenmüll gefunden – mit „Jetzt optimieren“ entfernen.", size=c.human(int(3.4*GB)))},
                     {"page":"startup","text":tr("{n} Programme starten mit Windows – unnötige unter „Autostart“ deaktivieren.", n=11)},
                     {"page":"auto","text":tr("Automatische Reinigung ist aus – unter „Automatik“ einschalten.")},
                     {"page":"admin","text":tr("Ohne Admin-Rechte werden Systemordner übersprungen.")}]}
app.TASKS["health"] = health
T = [("win_temp_user","Windows","Temporäre Dateien (Benutzer)",1,0,"Nur Dateien älter als 2 Stunden"),("win_temp_sys","Windows","Temporäre Dateien (System)",1,1,""),
     ("win_inet","Windows","Internet-Cache (Windows/Office)",1,0,""),("win_thumbs","Windows","Miniaturansichten-Cache",0,0,"Explorer baut ihn neu auf"),
     ("win_shader","Windows","DirectX-/Grafik-Shader-Cache",1,0,""),("win_dumps","Windows","Speicherabbilder (Crash-Dumps)",1,0,""),
     ("win_wer","Windows","Windows-Fehlerberichte",1,0,""),("win_update","Windows","Windows-Update-Downloads",0,1,""),("recycle","Windows","Papierkorb leeren",1,0,""),
     ("chrome_cache","Google Chrome","Cache",1,0,""),("chrome_cookies","Google Chrome","Cookies",0,0,"Ausnahmen unter „Cookies behalten“"),("chrome_history","Google Chrome","Verlauf",0,0,""),
     ("edge_cache","Microsoft Edge","Cache",1,0,""),("edge_cookies","Microsoft Edge","Cookies",0,0,"Ausnahmen unter „Cookies behalten“"),("edge_history","Microsoft Edge","Verlauf",0,0,""),
     ("app_discord","Anwendungen","Discord-Cache",1,0,""),("app_steam","Anwendungen","Steam-Webcache",1,0,"")]
app.CALLS["targets"] = lambda: [{"id":i,"group":tr(g),"label":tr(l),"default":bool(d),"admin":bool(a),"browser":"_" in i and not i.startswith("win"),"note":tr(n) if n else "","selected":bool(d),"undo":"cookies" in i or "history" in i} for i,g,l,d,a,n in T]
def fake_res(ids, done):
    out=[]
    for i in ids:
        t=next(x for x in T if x[0]==i); size=random.randint(2*MB, 900*MB); files=random.randint(10,4000)
        st = ("Übersprungen – Programm geöffnet" if done else "Programm geöffnet") if i.startswith("chrome") else ("Admin-Rechte empfohlen" if t[4] and not done else ("Bereinigt" if done else "Bereit"))
        out.append(c.Result(**{"id":i,"group":t[1],"label":t[2],"files":files,"size":size,"freed":size if done and "Über" not in st else 0,"deleted":files if done else 0,"failed":0,"status":st}).public())
    return out
app.TASKS["analyze"] = lambda job, ids: (time.sleep(0.6), fake_res(ids, False))[1]
app.TASKS["clean"] = lambda job, ids, close=None: (time.sleep(0.6), fake_res(ids, True))[1]
app.CALLS["blocking"] = lambda ids: [{"name":"Google Chrome","procs":["chrome.exe"]}] if any(i.startswith("chrome") for i in ids) else []
app.CALLS["startup_list"] = lambda: [{"key":f"k{i}","name":n,"command":cmd,"where":tr(w),"admin":a,"enabled":e} for i,(n,cmd,w,a,e) in enumerate([
  ("Discord",r'"C:\Users\Fabian\AppData\Local\Discord\Update.exe" --processStart Discord.exe',"Registry – Benutzer",False,True),
  ("Spotify",r'"C:\Users\Fabian\AppData\Roaming\Spotify\Spotify.exe" --autostart --minimized',"Registry – Benutzer",False,False),
  ("SecurityHealth",r"%windir%\system32\SecurityHealthSystray.exe","Registry – Alle Benutzer",True,True),
  ("Steam",r'"C:\Program Files (x86)\Steam\steam.exe" -silent',"Registry – Benutzer",False,True),
  ("OneDrive",r'"C:\Program Files\Microsoft OneDrive\OneDrive.exe" /background',"Registry – Benutzer",False,True),
  ("RtkAudUService",r'"C:\Windows\System32\DriverStore\FileRepository\realtek\RtkAudUService64.exe" -background',"Registry – Alle Benutzer",True,True),
  ("Send to OneNote",r"C:\Users\Fabian\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Send to OneNote.lnk","Autostart-Ordner – Benutzer",False,False)])]
app.TASKS["perf_list"] = lambda job: (time.sleep(0.5), [{"name":n,"count":k,"mem":m*MB,"cpu":cp,"stopped":0,"sleeping":s} for n,k,m,cp,s in [
  ("chrome.exe",23,2140,3.4,False),("Discord.exe",7,612,0.8,False),("Spotify.exe",6,388,0.2,True),("Code.exe",11,940,1.1,False),("steamwebhelper.exe",8,301,0.0,False),("OneDrive.exe",1,96,0.0,False)]])[1]
app.CALLS["power_plans"] = lambda: [{"guid":"381b4222-f694-41f0-9685-ff5bb260df2e","name":"Ausbalanciert" if i18n.lang() == "de" else "Balanced","active":True},{"guid":"8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c","name":"Höchstleistung" if i18n.lang() == "de" else "High performance","active":False}]
app.TASKS["updates_scan"] = lambda job: (time.sleep(0.8), [{"name":n,"id":i,"version":v,"available":a,"source":"winget"} for n,i,v,a in [
  ("Mozilla Firefox (x64 de)","Mozilla.Firefox.de","130.0","131.0.2"),("7-Zip 23.01 (x64)","7zip.7zip","23.01","24.08"),("Microsoft Visual Studio Code","Microsoft.VisualStudioCode","1.92.0","1.94.2"),("Python 3.12.4","Python.Python.3.12","3.12.4","3.12.7"),("Node.js LTS","OpenJS.NodeJS.LTS","20.15.0","20.18.0")]])[1]
app.CALLS["programs"] = lambda: [{"key":f"p{i}","name":n,"version":v,"publisher":p,"date":d,"size":s*MB,"cmd":""} for i,(n,v,p,d,s) in enumerate([
  ("7-Zip 23.01 (x64)","23.01","Igor Pavlov","12.03.2024",6),("Discord","1.0.9163","Discord Inc.","02.10.2026",410),("Google Chrome","130.0.6723.59","Google LLC","05.10.2026",0),
  ("Microsoft Visual Studio Code","1.92.0","Microsoft Corporation","20.07.2026",380),("Python 3.12.4 (64-bit)","3.12.4","Python Software Foundation","11.06.2026",112),("Steam","2.10.91.91","Valve Corporation","01.01.2025",0)])]
app.CALLS["drives"] = lambda: [{"path":"C:\\","total":476*GB,"free":61*GB,"fs":"NTFS"},{"path":"D:\\","total":931*GB,"free":402*GB,"fs":"NTFS"}]
app.CALLS["default_folders"] = lambda: [{"name":tr("Benutzerordner"),"path":"C:\\Users\\Fabian"},{"name":"Downloads","path":"C:\\Users\\Fabian\\Downloads"},{"name":tr("Bilder"),"path":"C:\\Users\\Fabian\\Pictures"},{"name":"Videos","path":"C:\\Users\\Fabian\\Videos"}]
app.TASKS["disk_analyze"] = lambda job, path: (time.sleep(0.6), {"total":182*GB,"count":412331,"cancelled":False,
  "folders":[{"name":n,"size":int(s*GB),"files":f,"path":path+"\\"+n} for n,s,f in [("AppData",64.2,210000),("Videos",48.9,312),("Downloads",31.5,1840),("Documents",14.1,9200),("Pictures",12.7,15400),("OneDrive",8.3,3300),("Desktop",2.1,140)]],
  "categories":[{"name":tr(n),"size":int(s*GB)} for n,s in [("Sonstiges",71),("Videos",52),("Archive & Images",22),("Programme",17),("Bilder",13),("Dokumente",5),("Musik",2)]],
  "largest":[{"path":p,"size":int(s*GB)} for p,s in [(path+"\\Videos\\Urlaub 2025 4K.mp4",11.2),(path+"\\Downloads\\Win11_24H2_German_x64.iso",5.8),(path+"\\Videos\\OBS\\2026-09-12 21-04-11.mkv",4.4),(path+"\\Downloads\\ubuntu-24.04-desktop-amd64.iso",5.7)]]})[1]
app.TASKS["dupes_find"] = lambda job, path, min_size: (time.sleep(0.6), [{"size":s,"files":[{"path":p,"mtime":time.time()-random.randint(100000,90000000)} for p in ps]} for s,ps in [
  (int(1.4*GB),[path+"\\Downloads\\Win11_24H2_German_x64.iso", path+"\\Desktop\\ISO\\Win11_24H2_German_x64 (1).iso"]),
  (24*MB,[path+"\\Pictures\\2025\\IMG_4412.HEIC", path+"\\Downloads\\IMG_4412.HEIC", path+"\\OneDrive\\Bilder\\IMG_4412.HEIC"]),
  (8*MB,[path+"\\Documents\\Rechnung_2026_09.pdf", path+"\\Downloads\\Rechnung_2026_09(1).pdf"])]])[1]
app.CALLS["automation_get"] = lambda: {"schedule":{"enabled":True,"freq":"weekly","day":"SUN","time":"12:00"},"monitor":{"browser_clean":True,"browser_items":["cache"],"junk_enabled":False,"junk_threshold_mb":1024,"autostart":True},"schedule_active":True,"monitor_running":True}
app.CALLS["log_tail"] = lambda: [i18n.tr_log(x) for x in ["2026-10-12 12:00:03  Reinigung: 812.4 MB freigegeben (win_temp_user, win_inet, chrome_cache)","2026-10-12 12:00:03  Geplante Reinigung abgeschlossen: 812.4 MB","2026-10-12 18:31:40  Smart-Monitor: chrome geschlossen → 233.0 MB bereinigt"]]

import falextras as fx
app.TASKS["details"] = lambda job, id: [{"path": f"C:\\Users\\Fabian\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache\\Cache_Data\\f_{i:06x}", "size": 9_000_000 // (i+1)} for i in range(40)]
app.TASKS["cookie_domains"] = lambda job: {"domains": [{"domain": d, "count": c} for d, c in [("google.com", 84), ("youtube.com", 51), ("amazon.de", 33), ("doubleclick.net", 29), ("github.com", 12), ("paypal.com", 9)]], "keep": ["google.com", "github.com"]}
app.CALLS["cookie_keep_set"] = lambda domains: domains
def tw():
    return {"autofix": True, "list": [{"id": t[0], "group": tr(t[1]), "title": tr(t[2]), "desc": tr(t[3]), "rec": t[4], "admin": any(o[0]=="HKLM" for o in t[5]), "can": not any(o[0]=="HKLM" for o in t[5]), "on": i % 3 == 0, "explorer": t[6], "backed_up": False} for i, t in enumerate(fx.TWEAKS)]}
app.CALLS["tweaks"] = tw
app.TASKS["bloat_list"] = lambda job: (time.sleep(0.4), [{"name": n, "full": n+"_1.0_x64__8wekyb3d8bbwe", "family": n+"_8wekyb3d8bbwe", "label": tr(fx.BLOAT[n][0]), "rec": fx.BLOAT[n][1]} for n in ["Clipchamp.Clipchamp","Microsoft.BingNews","Microsoft.GetHelp","Microsoft.MicrosoftSolitaireCollection","Microsoft.WindowsFeedbackHub","Microsoft.Copilot","Microsoft.YourPhone","SpotifyAB.SpotifyMusic"]])[1]
app.TASKS["boot_info"] = lambda job: {"boots": [{"time": f"2026-10-{13-i:02d}T07:12:00Z", "total": t, "main": int(t*0.55), "post": int(t*0.45)} for i, t in enumerate([48200, 52100, 46900, 61300, 44800, 50200, 49700])], "slow": [{"name": "Microsoft OneDrive", "file": "OneDrive.exe", "max": 8400, "count": 5, "kind": tr("Programm")}, {"name": "Steam Client Bootstrapper", "file": "steam.exe", "max": 5200, "count": 3, "kind": tr("Programm")}, {"name": "Realtek Audio Service", "file": "RtkAudUService64.exe", "max": 2100, "count": 2, "kind": tr("Dienst")}], "error": "", "fast_startup": True, "uptime_s": 15000}
app.CALLS["gaming_get"] = lambda: {"active": False, "auto": True, "games": ["valorant.exe", "cs2.exe"], "apps": ["chrome.exe", "Spotify.exe"], "prev_plan": "", "suspended": [], "by_auto": False, "since": 0, "plans": [], "best_plan": {"guid": "x", "name": "Ultimative Leistung" if i18n.lang() == "de" else "Ultimate Performance", "active": False}}
app.TASKS["running_apps"] = lambda job: ["chrome.exe", "Discord.exe", "Spotify.exe", "Code.exe", "steamwebhelper.exe", "OneDrive.exe"]
app.CALLS["gaming_save"] = lambda apps, games, auto: {"apps": apps, "games": games, "auto": auto}
app.TASKS["gaming_toggle"] = lambda job, on: {"active": on, "since": time.time(), "suspended": ["chrome.exe","Spotify.exe"], "by_auto": False}
app.TASKS["leftovers_scan"] = lambda job, name, publisher="": [{"kind": "dir", "path": "C:\\Users\\Fabian\\AppData\\Roaming\\Discord", "reason": tr("Ordner trägt den Programmnamen"), "size": 312*MB, "checked": True}, {"kind": "dir", "path": "C:\\Users\\Fabian\\AppData\\Local\\Discord", "reason": tr("Ordner trägt den Programmnamen"), "size": 88*MB, "checked": True}, {"kind": "reg", "path": "HKCU\\Software\\Discord", "reason": tr("Registry-Schlüssel"), "size": 0, "checked": True}]
app.CALLS["uninstall"] = lambda key: True
app.CALLS["undo_list"] = lambda: {"days": 7, "stats": {"freed_total": int(23.6*GB), "cleanings": 14}, "sessions": [{"id": "a", "label": c.q_label("Reste von Discord"), "time": time.time()-3600, "expires": time.time()+6*86400, "count": 1840, "size": 400*MB, "sample": ["C:\\Users\\Fabian\\AppData\\Roaming\\Discord\\settings.json", "C:\\Users\\Fabian\\AppData\\Local\\Discord\\app.ico"]}, {"id": "b", "label": c.q_label("Reinigung 12.10.2026 18:02"), "time": time.time()-86400, "expires": time.time()+5*86400, "count": 12, "size": 64*MB, "sample": ["C:\\Users\\Fabian\\Downloads\\ChromeSetup.exe", "C:\\Users\\Fabian\\Downloads\\vlc-3.0.20-win64.exe"]}], "apps": [{"label": tr("Candy Crush & Co. (King)"), "family": "king.com.CandyCrushSaga_kgqvnymyfvs32", "time": time.time()-7200}]}
app.TASKS["system_status"] = lambda job: (time.sleep(0.5), {"battery": {"design_mwh": 76000, "full_mwh": 58520, "health": 77, "cycles": 412, "name": "", "maker": "ASUS"}, "disks": [{"name": "Samsung SSD 980 PRO 1TB", "media": "SSD", "bus": "NVMe", "health": tr("Gesund"), "state": "ok", "size": 1000204886016}], "security": {"av": [{"name": "Avast Antivirus", "active": True, "uptodate": True}, {"name": "Windows Defender", "active": False, "uptodate": True}], "firewall": {"Domain": True, "Private": True, "Public": True}}, "reboot": [tr("Windows Update")]})[1]
_sl = app.CALLS["startup_list"]
app.CALLS["startup_list"] = lambda: [dict(x, impact_ms={"Discord": 32932, "Steam": 5200, "OneDrive": 8400}.get(x["name"], 0)) for x in _sl()]
app.serve(open_window=False, port=8765)

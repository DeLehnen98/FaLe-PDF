import sys, os, time, tempfile, threading
sys.path.insert(0, "/home/claude/FaLeClean")
import falecore as c
from pathlib import Path

# 1) collect/clean with temp tree
root = Path(tempfile.mkdtemp(prefix="fc_test_")) / "a" / "b"
(root/"sub/deeper").mkdir(parents=True)
for i,p in enumerate(["x.tmp","sub/y.log","sub/deeper/z.bin"]):
    (root/p).write_bytes(b"0"*(1000*(i+1)))
old = root/"sub/y.log"; os.utime(old, (time.time()-10*3600,)*2)
link_target = Path(tempfile.mkdtemp(prefix="fc_keep_")); (link_target/"keep.txt").write_text("keep")
os.symlink(link_target, root/"lnk")
t = c.Target("t","G","L", c._dirs(root))
items, roots = c.collect(t); print("collect:", len(items), sum(items.values()))
t2 = c.Target("t2","G","L", c._dirs(root), min_age_h=2)
print("min_age:", list(map(os.path.basename, c.collect(t2)[0])))
c.TARGET_MAP["t"] = t
res = c.clean(["t"]); print("clean:", res[0].public())
print("remaining:", sorted(str(p.relative_to(root)) for p in root.rglob("*")))
print("symlink target safe:", (link_target/"keep.txt").exists())

# 2) winget parse
sample = """   - \n   \\ \nName                               ID                           Version      Available    Source
------------------------------------------------------------------------------------------------------------------------
Mozilla Firefox (x64 de)           Mozilla.Firefox.de           130.0        131.0.2      winget
7-Zip 23.01 (x64)                  7zip.7zip                    23.01        24.08        winget
Microsoft Visual Studio Code       Microsoft.VisualStudioCode   1.92.0       1.94.2       winget
Some Very Long Application Name …  Vendor.SomeVeryLongApplicat… 1.0          2.0          winget
3 upgrades available.
"""
for r in c.parse_winget_table(sample): print("winget:", r)
de = sample.replace("Name  ","Name  ").replace("Available","Verfügbar").replace("Source","Quelle")
print("de rows:", len(c.parse_winget_table(de)))

# 3) split_command
for s in ['MsiExec.exe /I{12345678-ABCD-1234-ABCD-1234567890AB}', '"C:\\Program Files\\Foo\\unins000.exe" /SILENT',
          'C:\\Program Files\\Bar App\\uninstall.exe --remove', 'rundll32.exe dfshim.dll,ShArpMaintain x']:
    print("split:", c.split_command(s))

# 4) disk analyze & dupes
d = Path(tempfile.mkdtemp(prefix="fc_dup_"))
(d/"one").mkdir(); (d/"two").mkdir()
data = os.urandom(200_000)
(d/"one/a.mp4").write_bytes(data); (d/"two/a copy.mp4").write_bytes(data); (d/"two/other.mp4").write_bytes(os.urandom(200_000))
(d/"small.txt").write_bytes(b"x"*10); (d/"small2.txt").write_bytes(b"x"*10)
ev = threading.Event()
r = c.disk_analyze(str(d), print, ev); print("disk:", r["total"], r["count"], r["folders"][:2], r["categories"])
g = c.find_duplicates(str(d), 5, print, ev); print("dupes:", [(x["size"], [os.path.basename(f["path"]) for f in x["files"]]) for x in g])

# 5) settings + health
c.DATA_DIR = Path(tempfile.mkdtemp()); c.SETTINGS_FILE = c.DATA_DIR/"s.json"; c.LOG_FILE=c.DATA_DIR/"log.txt"
s = c.load_settings(); s["targets"]=["win_temp_user"]; c.save_settings(s); print("saved sel:", c.saved_selection())
h = c.health_check(); print("health score:", h["score"], [x["page"] for x in h["recs"]])
print("perf groups:", len(c.perf_list()))
print("schedule apply (linux):", c.schedule_apply({"enabled": True}))
print("targets:", [t.id for t in c.TARGETS])

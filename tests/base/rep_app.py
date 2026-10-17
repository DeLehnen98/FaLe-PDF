from rep import apply
R = [
('''import falecore as core
import falextras as fx
''', '''import falecore as core
import fale_i18n as i18n
import falextras as fx
from fale_i18n import tr
'''),
('''            "user": os.environ.get("USERNAME", "")}''',
 '''            "user": os.environ.get("USERNAME", ""), "lang": i18n.lang(), "lang_pref": i18n.preference()}


@call
def set_lang(lang=None):
    """Sprache der Oberfläche: "de", "en" oder None/"auto" (= Windows-Sprache)."""
    if lang not in ("de", "en", "auto", None):
        raise ValueError(tr("Unbekannte Sprache"))
    pref = lang if lang in ("de", "en") else None
    s = core.load_settings()
    s["lang"] = pref
    core.save_settings(s)
    i18n.set_lang(pref)
    return i18n.lang()'''),
('''        job.set("Schließe Programme …")''', '''        job.set(tr("Schließe Programme …"))'''),
('''        raise RuntimeError("winget wurde nicht gefunden. Installiere den „App-Installer“ aus dem Microsoft Store.")
    job.set("Suche nach Updates (winget) …")''',
 '''        raise RuntimeError(tr("winget wurde nicht gefunden. Installiere den „App-Installer“ aus dem Microsoft Store."))
    job.set(tr("Suche nach Updates (winget) …"))'''),
('''        raise ValueError("Unbekannte Aktion")''', '''        raise ValueError(tr("Unbekannte Aktion"))'''),
('''    out = [{"name": "Benutzerordner", "path": str(h)}]''', '''    out = [{"name": tr("Benutzerordner"), "path": str(h)}]'''),
('''            out.append({"name": n, "path": str(h / sub)})''', '''            out.append({"name": tr(n), "path": str(h / sub)})'''),
('''        raise ValueError("Ordner nicht gefunden")''', '''        raise ValueError(tr("Ordner nicht gefunden"))'''),
('''    ok, msg = core.schedule_apply(s["schedule"])''', '''    ok, msg = core.schedule_apply(s["schedule"])  # Meldung bereits übersetzt (bzw. von schtasks)'''),
('''    return core.log_tail(300)''', '''    return [i18n.tr_log(line) for line in core.log_tail(300)]'''),
('''    raise ValueError("Unbekanntes Werkzeug")''', '''    raise ValueError(tr("Unbekanntes Werkzeug"))'''),
('''    job.set("Lese installierte Apps …")''', '''    job.set(tr("Lese installierte Apps …"))'''),
('''    job.set("Lese Windows-Ereignisanzeige …")''', '''    job.set(tr("Lese Windows-Ereignisanzeige …"))'''),
('''    job.set("Prüfe Akku, Laufwerke und Virenschutz …")''', '''    job.set(tr("Prüfe Akku, Laufwerke und Virenschutz …"))'''),
('''    job.set("Suche Reste …")''', '''    job.set(tr("Suche Reste …"))'''),
('''            html = resource("ui.html").read_text(encoding="utf-8").replace("__TOKEN__", TOKEN)''',
 '''            html = (resource("ui.html").read_text(encoding="utf-8").replace("__TOKEN__", TOKEN)
                    .replace("__LANG__", i18n.lang()))'''),
('''    print(f"{core.APP_NAME} läuft auf {url}", flush=True)''', '''    print(tr("{app} läuft auf {url}", app=core.APP_NAME, url=url), flush=True)'''),
('''help="Reinigung mit gespeicherter Auswahl")''', '''help=tr("Reinigung mit gespeicherter Auswahl"))'''),
('''help="Smart-Monitor im Hintergrund")''', '''help=tr("Smart-Monitor im Hintergrund"))'''),
('''help="Aufgabenplanung/Autostart auf aktuellen Pfad setzen")''', '''help=tr("Aufgabenplanung/Autostart auf aktuellen Pfad setzen"))'''),
('''help="nur Server starten")''', '''help=tr("nur Server starten"))'''),
]
apply("/home/claude/FaLeClean/fale_clean.py", R)

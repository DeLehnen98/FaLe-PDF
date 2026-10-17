from rep import apply
R = [
('''from falecore import IS_WIN, log, load_settings, save_settings, run, sysexe''',
 '''from falecore import IS_WIN, log, load_settings, save_settings, run, sysexe
from fale_i18n import tr'''),
('''    return [{"id": t[0], "group": t[1], "title": t[2], "desc": t[3], "rec": t[4],''',
 '''    return [{"id": t[0], "group": tr(t[1]), "title": tr(t[2]), "desc": tr(t[3]), "rec": t[4],'''),
('''        raise ValueError("Unbekannte Einstellung")''', '''        raise ValueError(tr("Unbekannte Einstellung"))'''),
('''def bloat_list() -> list[dict]:
    if not IS_WIN:''',
'''def bloat_list() -> list[dict]:
    """Gefundene Bloatware mit Anzeigenamen in der aktiven Sprache."""
    out = [dict(b, label=tr(b["label"])) for b in _bloat_list_raw()]
    return sorted(out, key=lambda x: (not x["rec"], x["label"].lower()))


def _bloat_list_raw() -> list[dict]:
    if not IS_WIN:'''),
('''    known = {b["full"]: b for b in bloat_list()}''', '''    known = {b["full"]: b for b in _bloat_list_raw()}  # deutsche Namen speichern'''),
('''        on_line(f"Entferne {b['label']} …")''', '''        on_line(tr("Entferne {label} …", label=tr(b['label'])))'''),
('''            on_line(f"✔ {b['label']} entfernt")''', '''            on_line(tr("✔ {label} entfernt", label=tr(b['label'])))'''),
('''            on_line(f"✖ {b['label']}: {(r.stderr or r.stdout).strip()[:200]}")''',
 '''            on_line(f"✖ {tr(b['label'])}: {(r.stderr or r.stdout).strip()[:200]}")'''),
('''    return list(reversed(load_settings().get("removed_apps", [])))[:50]''',
 '''    return [dict(a, label=tr(a.get("label", ""))) for a in reversed(load_settings().get("removed_apps", []))][:50]'''),
('''        out["error"] = f"Ereignisse nicht lesbar ({e})"''', '''        out["error"] = tr("Ereignisse nicht lesbar ({e})", e=e)'''),
('''                consider(c, "Ordner trägt den Programmnamen")''', '''                consider(c, tr("Ordner trägt den Programmnamen"))'''),
('''                            consider(cc, f"Ordner im Herstellerordner „{c.name}“")''',
 '''                            consider(cc, tr("Ordner im Herstellerordner „{name}“", name=c.name))'''),
('''                        found.append({"kind": "reg", "path": f"{hname}\\\\{sub}\\\\{n}", "reason": "Registry-Schlüssel",''',
 '''                        found.append({"kind": "reg", "path": f"{hname}\\\\{sub}\\\\{n}", "reason": tr("Registry-Schlüssel"),'''),
('''                                                      "reason": f"Registry unter „{n}“", "size": 0, "checked": True})''',
 '''                                                      "reason": tr("Registry unter „{name}“", name=n), "size": 0, "checked": True})'''),
('''_MEDIA = {''', '''_HEALTH_STATE = {"Gesund": "ok", "Warnung": "warn", "Fehlerhaft": "bad"}
_MEDIA = {'''),
('''    for d in rows:
        out.append({"name": str(d.get("FriendlyName") or "Laufwerk").strip(),
                    "media": _MEDIA.get(d.get("MediaType"), str(d.get("MediaType") or "")),
                    "bus": _BUS.get(d.get("BusType"), str(d.get("BusType") or "")),
                    "health": _HEALTH.get(d.get("HealthStatus"), str(d.get("HealthStatus"))),
                    "size": int(d.get("Size") or 0)})''',
'''    for d in rows:
        health = _HEALTH.get(d.get("HealthStatus"), str(d.get("HealthStatus")))
        out.append({"name": str(d.get("FriendlyName") or tr("Laufwerk")).strip(),
                    "media": _MEDIA.get(d.get("MediaType"), str(d.get("MediaType") or "")),
                    "bus": _BUS.get(d.get("BusType"), str(d.get("BusType") or "")),
                    "health": tr(health), "state": _HEALTH_STATE.get(health, "unknown"),
                    "size": int(d.get("Size") or 0)})'''),
('''            why.append(label)''', '''            why.append(tr(label))'''),
('''def boot_info_cached() -> dict:
    """Liest die Startzeit (als Admin) und merkt sie sich – damit sie auch ohne Admin sichtbar bleibt."""
    b = boot_info()''',
'''def boot_info_cached() -> dict:
    """Startzeit mit übersetzten Arten (Programm/Treiber/Dienst) für die Oberfläche."""
    b = _boot_info_cached()
    b["slow"] = [dict(x, kind=tr(x.get("kind", ""))) for x in b.get("slow", [])]
    return b


def _boot_info_cached() -> dict:
    """Liest die Startzeit (als Admin) und merkt sie sich – damit sie auch ohne Admin sichtbar bleibt."""
    b = boot_info()'''),
]
apply("/home/claude/FaLeClean/falextras.py", R)

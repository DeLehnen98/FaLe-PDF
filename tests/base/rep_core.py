from rep import apply
R = [
('from typing import Callable, Iterable\n',
 'from typing import Callable, Iterable\n\nimport fale_i18n as i18n\nfrom fale_i18n import tr, tr_any, fmt_int\n'),
('VERSION = "1.3.0"', 'VERSION = "1.4.0"'),
('''def human(n: float) -> str:
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}".replace(".", ",")
        n /= 1024
    return f"{n:.1f} TB"''',
'''def human(n: float, lng: str | None = None) -> str:
    """Größe lesbar formatieren; lng=None → aktive Sprache ("de" mit Komma, "en" mit Punkt)."""
    n = float(n)
    de = (lng or i18n.lang()) != "en"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            if unit in ("B", "KB"):
                return f"{n:.0f} {unit}"
            s = f"{n:.1f} {unit}"
            return s.replace(".", ",") if de else s
        n /= 1024
    return f"{n:.1f} TB"'''),
('on_line(f"Befehl nicht gefunden: {cmd[0]}")', 'on_line(tr("Befehl nicht gefunden: {cmd}", cmd=cmd[0]))'),
('on_line("Abgebrochen.")', 'on_line(tr("Abgebrochen."))'),
('raise PermissionError("Einstellungen konnten nicht gespeichert werden")',
 'raise PermissionError(tr("Einstellungen konnten nicht gespeichert werden"))'),
('''_SLOCK = threading.RLock()''',
'''i18n.set_reader(lambda: load_settings().get("lang"))

_SLOCK = threading.RLock()'''),
('''    def public(self) -> dict:
        return {"id": self.id, "group": self.group, "label": self.label, "default": self.default,
                "admin": self.admin, "browser": bool(self.browser), "note": self.note,''',
'''    def public(self) -> dict:
        return {"id": self.id, "group": tr(self.group), "label": tr(self.label), "default": self.default,
                "admin": self.admin, "browser": bool(self.browser), "note": tr(self.note) if self.note else "",'''),
('''    status: str = ""

    def public(self) -> dict:
        return self.__dict__.copy()''',
'''    status: str = ""  # immer deutsch (intern); public() übersetzt

    def public(self) -> dict:
        d = self.__dict__.copy()
        d["group"], d["label"] = tr(self.group), tr(self.label)
        d["status"] = tr_any(self.status)
        d["state"] = status_state(self.status)
        return d


def status_state(s: str) -> str:
    """Sprachunabhängige Einordnung eines (deutschen) Status: "ok", "warn" oder ""."""
    if re.search(r"Bereinigt|Geleert|Bereit", s):
        return "ok"
    if re.search(r"Übersprungen|geöffnet|Admin|Fehl", s):
        return "warn"
    return ""'''),
('''        out.append({"id": m["id"], "label": m["label"], "time": m["time"],''',
'''        out.append({"id": m["id"], "label": q_label(m["label"]), "time": m["time"],'''),
('''def q_restore(sid: str) -> dict:''',
'''def q_label(label: str) -> str:
    """Name eines Quarantäne-Vorgangs in der aktiven Sprache (gespeichert wird deutsch)."""
    m = re.fullmatch(r"Reinigung (\\d\\d)\\.(\\d\\d)\\.(\\d{4}) (\\d\\d:\\d\\d)", label)
    if m:
        d, mo, y, hm = m.groups()
        return tr("Reinigung {date}", date=f"{mo}/{d}/{y} {hm}" if i18n.lang() == "en" else f"{d}.{mo}.{y} {hm}")
    return tr_any(label)


def q_restore(sid: str) -> dict:'''),
('''            progress(f"Analysiere: {t.group} – {t.label}")''',
'''            progress(tr("Analysiere: {group} – {label}", group=tr(t.group), label=tr(t.label)))'''),
('''            progress(f"Bereinige: {t.group} – {t.label}")''',
'''            progress(tr("Bereinige: {group} – {label}", group=tr(t.group), label=tr(t.label)))'''),
('''    log(f"Reinigung: {human(total)} freigegeben''', '''    log(f"Reinigung: {human(total, 'de')} freigegeben'''),
('''    for pat, label in ((r"^MicrosoftEdgeAutoLaunch_", "Microsoft Edge (startet im Hintergrund)"),
                       (r"^GoogleChromeAutoLaunch_", "Google Chrome (startet im Hintergrund)"),
                       (r"^BraveSoftware.*AutoLaunch", "Brave (startet im Hintergrund)")):
        if re.match(pat, name):
            return label''',
'''    for pat, label in ((r"^MicrosoftEdgeAutoLaunch_", "Microsoft Edge"),
                       (r"^GoogleChromeAutoLaunch_", "Google Chrome"),
                       (r"^BraveSoftware.*AutoLaunch", "Brave")):
        if re.match(pat, name):
            return tr("{name} (startet im Hintergrund)", name=label)'''),
('''                              "where": where, "admin": admin, "enabled": _approved(hive, sub, name)})''',
'''                              "where": tr(where), "admin": admin, "enabled": _approved(hive, sub, name)})'''),
('''                          "where": where, "admin": admin, "enabled": _approved(hive, "StartupFolder", p.name)})''',
'''                          "where": tr(where), "admin": admin, "enabled": _approved(hive, "StartupFolder", p.name)})'''),
('''    if not root_p.is_dir():
        raise ValueError("Ordner nicht gefunden")''',
'''    if not root_p.is_dir():
        raise ValueError(tr("Ordner nicht gefunden"))'''),
('''        raise ValueError(f"Kein Zugriff: {e}")''', '''        raise ValueError(tr("Kein Zugriff: {e}", e=e))'''),
('''        name = ent.name if is_dir else "(Dateien direkt in diesem Ordner)"''',
'''        name = ent.name if is_dir else _DIRECT'''),
('''                progress(f"{count:,} Dateien · {human(total)}".replace(",", "."))''',
'''                progress(tr("{count} Dateien · {size}", count=fmt_int(count), size=human(total)))'''),
('''        "folders": sorted(({"name": k, "size": v[0], "files": v[1], "path": v[2]} for k, v in children.items()),
                          key=lambda x: -x["size"]),
        "categories": sorted(({"name": k, "size": v} for k, v in cats.items()), key=lambda x: -x["size"]),''',
'''        "folders": sorted(({"name": tr(k) if k == _DIRECT else k, "size": v[0], "files": v[1], "path": v[2]}
                           for k, v in children.items()), key=lambda x: -x["size"]),
        "categories": sorted(({"name": tr(k), "size": v} for k, v in cats.items()), key=lambda x: -x["size"]),'''),
('''_EXT2CAT = {e: c for c, exts in CATEGORIES.items() for e in exts}''',
'''_EXT2CAT = {e: c for c, exts in CATEGORIES.items() for e in exts}
_DIRECT = "(Dateien direkt in diesem Ordner)"'''),
('''        bi.lpszTitle = "Ordner auswählen"''', '''        bi.lpszTitle = tr("Ordner auswählen")'''),
('''                                    progress(f"{n:,} Dateien gefunden …".replace(",", "."))''',
'''                                    progress(tr("{n} Dateien gefunden …", n=fmt_int(n)))'''),
('''                progress(f"Vergleiche Inhalte … {done}/{total}")''',
'''                progress(tr("Vergleiche Inhalte … {done}/{total}", done=done, total=total))'''),
('''        return False, "Nur unter Windows verfügbar"''', '''        return False, tr("Nur unter Windows verfügbar")'''),
('''        return True, "Geplante Reinigung ist aus."''', '''        return True, tr("Geplante Reinigung ist aus.")'''),
('''        return False, "Ungültige Uhrzeit"''', '''        return False, tr("Ungültige Uhrzeit")'''),
('''                log(f"Smart-Monitor: {bid} geschlossen → {human(sum(r.freed for r in res))} bereinigt")''',
'''                log(f"Smart-Monitor: {bid} geschlossen → {human(sum(r.freed for r in res), 'de')} bereinigt")'''),
('''            log(f"Smart-Monitor: Schwelle überschritten → {human(sum(r.freed for r in res))} bereinigt")''',
'''            log(f"Smart-Monitor: Schwelle überschritten → {human(sum(r.freed for r in res), 'de')} bereinigt")'''),
('''    log(f"Geplante Reinigung abgeschlossen: {human(sum(r.freed for r in res))}")''',
'''    log(f"Geplante Reinigung abgeschlossen: {human(sum(r.freed for r in res), 'de')}")'''),
('''    ps = "Checkpoint-Computer -Description 'FaLe Clean' -RestorePointType 'MODIFY_SETTINGS'; if($?){'Wiederherstellungspunkt erstellt.'}"''',
'''    done = tr("Wiederherstellungspunkt erstellt.").replace("'", "''")
    ps = "Checkpoint-Computer -Description 'FaLe Clean' -RestorePointType 'MODIFY_SETTINGS'; if($?){'" + done + "'}"'''),
('''        on_line("Ungültiges Laufwerk")''', '''        on_line(tr("Ungültiges Laufwerk"))'''),
('''    on_line(f"Überschreibe freien Speicher auf {d}: (das dauert lange) …")''',
'''    on_line(tr("Überschreibe freien Speicher auf {d}: (das dauert lange) …", d=d))'''),
('''        on_line("Temporäre Füll-Dateien entfernt.")''', '''        on_line(tr("Temporäre Füll-Dateien entfernt."))'''),
('''        on_line("Aktualisiere alle Programme …")''', '''        on_line(tr("Aktualisiere alle Programme …"))'''),
# Gesundheitscheck
('''        recs.append(("clean", f"{human(out['junk']['size'])} Datenmüll gefunden – mit „Jetzt optimieren“ entfernen."))''',
'''        recs.append(("clean", tr("{size} Datenmüll gefunden – mit „Jetzt optimieren“ entfernen.",
                                 size=human(out['junk']['size']))))'''),
('''        recs.append(("disk", f"Laufwerk {SYSDRIVE} ist zu {100 - free_pct:.0f} % voll – Speicheranalyse zeigt die größten Platzfresser."))''',
'''        recs.append(("disk", tr("Laufwerk {drive} ist zu {pct} % voll – Speicheranalyse zeigt die größten Platzfresser.",
                                drive=SYSDRIVE, pct=f"{100 - free_pct:.0f}")))'''),
('''        recs.append(("startup", f"{out['startup']['enabled']} Programme starten mit Windows – unnötige unter „Autostart“ deaktivieren."))''',
'''        recs.append(("startup", tr("{n} Programme starten mit Windows – unnötige unter „Autostart“ deaktivieren.",
                                   n=out['startup']['enabled'])))'''),
('''        recs.append(("perf", f"Arbeitsspeicher zu {out['ram']['percent']:.0f} % belegt – Hintergrund-Apps im Leistungsoptimierer schlafen legen."))''',
'''        recs.append(("perf", tr("Arbeitsspeicher zu {pct} % belegt – Hintergrund-Apps im Leistungsoptimierer schlafen legen.",
                                pct=f"{out['ram']['percent']:.0f}")))'''),
('''        recs.append(("auto", "Automatische Reinigung ist aus – unter „Automatik“ einschalten."))''',
'''        recs.append(("auto", tr("Automatische Reinigung ist aus – unter „Automatik“ einschalten.")))'''),
('''            recs.append(("clean", f"{human(dl[0].size)} alte Installationsdateien ({dl[0].files} Setups) liegen in deinen Downloads – unter „Reinigung → Privatsphäre“ auswählbar, 7 Tage wiederherstellbar."))''',
'''            recs.append(("clean", tr("{size} alte Installationsdateien ({n} Setups) liegen in deinen Downloads – unter „Reinigung → Privatsphäre“ auswählbar, 7 Tage wiederherstellbar.",
                                     size=human(dl[0].size), n=dl[0].files)))'''),
('''        recs.append(("restart", f"Dein PC läuft seit {up // 86400} Tagen ohne echten Neustart. Ein Neustart (Start → Neu starten) gibt Arbeitsspeicher frei und schließt Updates ab – „Herunterfahren“ reicht wegen Schnellstart nicht."))''',
'''        recs.append(("restart", tr("Dein PC läuft seit {days} Tagen ohne echten Neustart. Ein Neustart (Start → Neu starten) gibt Arbeitsspeicher frei und schließt Updates ab – „Herunterfahren“ reicht wegen Schnellstart nicht.",
                                   days=up // 86400)))'''),
('''            recs.append(("privacy", f"{len(off)} empfohlene Privatsphäre-Einstellungen sind aus – z. B. „{off[0]['title']}“."))''',
'''            recs.append(("privacy", tr("{n} empfohlene Privatsphäre-Einstellungen sind aus – z. B. „{title}“.",
                                       n=len(off), title=off[0]['title'])))'''),
('''        recs.append(("admin", "Ohne Admin-Rechte werden Systemordner übersprungen."))''',
'''        recs.append(("admin", tr("Ohne Admin-Rechte werden Systemordner übersprungen.")))'''),
]
apply("/home/claude/FaLeClean/falecore.py", R)

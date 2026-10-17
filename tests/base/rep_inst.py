from rep import apply
R = [
('''VERSION = "1.3.0"''', '''VERSION = "1.4.0"'''),
('''FILES = ["fale_clean.py", "falecore.py", "falextras.py", "wproc.py", "ui.html", "FaLeClean.ico", "LIESMICH.md"]''',
 '''FILES = ["fale_clean.py", "falecore.py", "falextras.py", "fale_i18n.py", "wproc.py", "ui.html", "FaLeClean.ico",
         "LIESMICH.md", "README.md"]'''),
('''def box(text: str, flags: int = MB_ICONINFO) -> int:''',
 '''def _ui_lang() -> str:
    """Windows-Anzeigesprache: Deutsch → "de", alles andere → "en"."""
    try:
        return "de" if (int(ctypes.windll.kernel32.GetUserDefaultUILanguage()) & 0x3FF) == 0x07 else "en"
    except Exception:
        return "en"


LANG = _ui_lang() if os.name == "nt" else ("de" if os.environ.get("LANG", "").lower().startswith("de") else "en")


def L(de: str, en: str) -> str:
    """Text in der Sprache von Windows."""
    return de if LANG == "de" else en


def box(text: str, flags: int = MB_ICONINFO) -> int:'''),
('''        box("Es fehlen Dateien: " + ", ".join(missing) +
            "\\n\\nBitte die ZIP-Datei zuerst komplett entpacken (Rechtsklick → „Alle extrahieren…“) "
            "und dann Installieren.pyw im entpackten Ordner starten.", MB_ICONERROR)
        return
    if sys.version_info < (3, 9):
        box("FaLe Clean benötigt Python 3.9 oder neuer.", MB_ICONERROR)
        return
    update = INSTALL_DIR.exists()
    if box(f"{APP} {VERSION} {'aktualisieren' if update else 'installieren'}?\\n\\n"
           f"Zielordner:\\n{INSTALL_DIR}\\n\\nEs werden Verknüpfungen im Startmenü und auf dem Desktop angelegt.",
           MB_YESNO | MB_ICONQUESTION) != IDYES:
        return''',
 '''        box(L("Es fehlen Dateien: ", "Files are missing: ") + ", ".join(missing) +
            L("\\n\\nBitte die ZIP-Datei zuerst komplett entpacken (Rechtsklick → „Alle extrahieren…“) "
              "und dann Installieren.pyw im entpackten Ordner starten.",
              "\\n\\nPlease extract the whole ZIP file first (right-click → “Extract All…”) "
              "and then run Installieren.pyw from the extracted folder."), MB_ICONERROR)
        return
    if sys.version_info < (3, 9):
        box(L("FaLe Clean benötigt Python 3.9 oder neuer.", "FaLe Clean requires Python 3.9 or later."), MB_ICONERROR)
        return
    update = INSTALL_DIR.exists()
    if update:
        q = L(f"{APP} {VERSION} aktualisieren?", f"Update {APP} to {VERSION}?")
    else:
        q = L(f"{APP} {VERSION} installieren?", f"Install {APP} {VERSION}?")
    if box(q + L(f"\\n\\nZielordner:\\n{INSTALL_DIR}\\n\\nEs werden Verknüpfungen im Startmenü und auf dem Desktop angelegt.",
                 f"\\n\\nDestination folder:\\n{INSTALL_DIR}\\n\\nShortcuts will be created in the Start menu and on the desktop."),
           MB_YESNO | MB_ICONQUESTION) != IDYES:
        return'''),
('''            create_shortcut(lnk, pyw, f'"{script}"', str(INSTALL_DIR), icon, "System-Cleaner & Optimierer")''',
 '''            create_shortcut(lnk, pyw, f'"{script}"', str(INSTALL_DIR), icon,
                            L("System-Cleaner & Optimierer", "System cleaner & optimizer"))'''),
('''    msg = f"{APP} wurde {'aktualisiert' if update else 'installiert'}.\\n\\n" \\
          "Du findest es im Startmenü und auf dem Desktop. Deinstallieren kannst du es über " \\
          "Einstellungen → Apps → Installierte Apps."
    if errors:
        msg += "\\n\\nHinweis – Verknüpfung konnte nicht erstellt werden:\\n" + "\\n".join(errors)
    box(msg + "\\n\\nMit OK wird FaLe Clean gestartet.")''',
 '''    if update:
        msg = L(f"{APP} wurde aktualisiert.", f"{APP} has been updated.")
    else:
        msg = L(f"{APP} wurde installiert.", f"{APP} has been installed.")
    msg += L("\\n\\nDu findest es im Startmenü und auf dem Desktop. Deinstallieren kannst du es über "
             "Einstellungen → Apps → Installierte Apps.",
             "\\n\\nYou'll find it in the Start menu and on the desktop. You can uninstall it via "
             "Settings → Apps → Installed apps.")
    if errors:
        msg += L("\\n\\nHinweis – Verknüpfung konnte nicht erstellt werden:\\n",
                 "\\n\\nNote – a shortcut couldn't be created:\\n") + "\\n".join(errors)
    box(msg + L("\\n\\nMit OK wird FaLe Clean gestartet.", "\\n\\nClick OK to start FaLe Clean."))'''),
('''    if box(f"{APP} vollständig entfernen?\\n\\nEinstellungen, Protokoll, geplante Reinigung und "
           "Smart-Monitor werden ebenfalls entfernt.", MB_YESNO | MB_ICONQUESTION) != IDYES:''',
 '''    if box(L(f"{APP} vollständig entfernen?\\n\\nEinstellungen, Protokoll, geplante Reinigung und "
             "Smart-Monitor werden ebenfalls entfernt.",
             f"Completely remove {APP}?\\n\\nSettings, log, scheduled cleanup and "
             "smart monitor will be removed as well."), MB_YESNO | MB_ICONQUESTION) != IDYES:'''),
('''    box(f"{APP} wurde entfernt.")''', '''    box(L(f"{APP} wurde entfernt.", f"{APP} has been removed."))'''),
('''        print("Dieser Installer ist nur für Windows.")''', '''        print(L("Dieser Installer ist nur für Windows.", "This installer only works on Windows."))'''),
('''        box(f"Unerwarteter Fehler:\\n{e}\\n\\n{traceback.format_exc()[-1500:]}", MB_ICONERROR)''',
 '''        box(L("Unerwarteter Fehler:", "Unexpected error:") + f"\\n{e}\\n\\n{traceback.format_exc()[-1500:]}", MB_ICONERROR)'''),
]
apply("/home/claude/FaLeClean/Installieren.pyw", R)

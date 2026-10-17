# Tests

Automatische Tests für FaLe PDF, die FaleNetwork-Seiten (Werkzeuge, Vorlagen), FaLe One und die API.
Bis Oktober 2026 lagen sie nur in temporären Arbeitsordnern; jetzt sind sie hier versioniert.

- `suites/` – die aktuellen Testreihen
  - `webtools/` – alle Browser-Werkzeuge auf fale.network (`./run_all.sh`, startet seinen Server selbst)
  - `sec/` – Sicherheit: XSS, CSP, API-Fuzzing, Konto, KI, Teilen (`./run_all.sh`; Server siehe Kopf der Dateien)
    – die Browser-Tests in `sec/` sind die aktuellen Fassungen (laufen unter der echten CSP); gleichnamige
      ältere Kopien eine Ebene höher nutzen teils `wait_for_function` mit Text und scheitern an der CSP
  - `design/` – Design-/Pro-Werkzeuge der App (`./isotest.sh` baut eine Kopie der App und testet sie)
  - `smart/`, `office2-4/`, `one/`, `de_suites/`, `arc*/` – Assistenten, Office, FaLe One, deutsche UI, Vorlagen
  - `test_network.py` – FaleNetwork-Startseiten (`python3 -m http.server 8803` im Ordner `network/`)
  - `test_account.py`, `test_ai.py`, `test_share.py`, … – Konto, KI, Teilen (Harness-Dateien `*_harness.mjs`)
  - `network_before/` – Vergleichsstand der Seiten für die Änderungs-Prüfung; nach gewollten Änderungen neu kopieren
- `base/` – die ersten Testreihen der PDF-App (Kern, Pro-Werkzeuge, PDF+, Office, Android-Brücke) und ihre Testdaten

## Voraussetzungen

- Repo liegt unter `/home/claude/FalePDF` (die Pfade in den Tests sind darauf ausgelegt)
- Python 3 mit Playwright (Chromium), Node 20+, `qpdf`; Hilfsbibliotheken unter `/opt/npm-tools/node_modules`
- Konto-Tests laufen gegen `suites/acct/account_harness.mjs 8804`, das eine lokale PostgreSQL mit den echten
  Migrationen braucht (Postgres als normaler Benutzer starten, nicht als root)

## Testdaten

Kleine Testdateien (`testdata/`, `officedata/`) sind eingecheckt. Die Testdateien der Werkzeuge (`webtools/fixtures/`)
und große Dateien erzeugen die `*make_fixtures*`- bzw. `make_*.py`-Skripte (`run_all.sh` macht das automatisch). Welche großen Dateien nicht eingecheckt sind,
steht in `.skipped-big-fixtures.txt`. Fremde Beispiel-PDFs (`webtools/fixtures/real/`) sind bewusst nicht im
Repo; `test_realworld.py`, `test_org_gray.py` und `test_aud1_offline_all.py` brauchen sie und schlagen ohne sie fehl
(Stand 17.10.2026 mit den Dateien: alle 85 Werkzeug-Reihen grün).

Ergebnisse (`out*/`, Logs, Screenshots) werden nicht eingecheckt (`.gitignore`). Der Ordner `tests/` wird nie
ausgeliefert (`scripts/vercel-build.mjs` überspringt ihn).

# KI-Assistent, Werbevideos und FaLe Plus einrichten

Diese Anleitung ist für dich als Betreiber. Sie erklärt Schritt für Schritt, was du einmalig einrichten musst.
Ohne diese Schritte zeigt die App freundlich „KI kommt bald“ bzw. „FaLe Plus ist bald verfügbar“ –
alle anderen Funktionen laufen ganz normal.

## Wie das Ganze funktioniert (kurz)

```
App (Handy/Browser) ──► /api/ai (Vercel, Projekt „fale-pdf“) ──► KI-Anbieter (Standard: Anthropic Claude)
                              │
                              └──► Supabase „fale-pdf-ai“ (Frankfurt): nur Zähler, keine Inhalte
```

- Die App schickt nur den Text, den die Nutzerin für eine Aufgabe auswählt. Der Server speichert **keine Inhalte**
  und protokolliert keine Eingaben – nur Zähler (pseudonyme Geräte-Kennung, gehashte IP, Anzahl pro Tag, 30 Tage).
- **Kontingent:** 2 Anfragen pro Gerät und Tag inklusive (`FREE_DAILY`). Danach freiwillig: pro Werbevideo +2
  (`REWARD_BONUS`), höchstens 10 Videos pro Tag (`REWARD_MAX_PER_DAY`). FaLe Plus: bis 200 pro Tag (`PLUS_DAILY`).
  Pro Netzwerk (IP) höchstens 40 inklusive Anfragen pro Tag (`IP_DAILY`) gegen Missbrauch.
- **Hartes Monatsbudget:** `AI_MONTHLY_BUDGET_EUR` (Standard **10 €**). Vor jeder Anfrage reserviert der Server
  die geschätzten Höchstkosten, danach wird abgerechnet. Ist das Budget erreicht, antwortet die App mit
  „KI-Kontingent für diesen Monat aufgebraucht“ – **auch für FaLe-Plus-Kunden** (solange es noch keine Einnahmen gibt).
  Am 1. des Monats geht es automatisch weiter.

## Was schon erledigt ist

- Supabase-Projekt **fale-pdf-ai** (eu-central-1): Tabellen `ai_usage`, `ai_ip`, `ai_budget`, `ai_rewards`,
  `plus_entitlements` mit Row Level Security (keine Freigaben für anonyme Zugriffe) und geschützte Funktionen
  (nur mit Server-Geheimnis aufrufbar). Datei: `supabase/migrations/20261014120000_fale_ai_counters.sql`.
- In Vercel (Projekt **fale-pdf**, Production + Preview) eingetragen: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `FALE_RPC_SECRET`, `FALE_TOKEN_SECRET`, `FALE_IP_SALT` (die letzten drei als „Sensitive“ – nicht mehr lesbar).

## Schritt 1 – Löschfrist in Supabase aktivieren (einmalig, 2 Minuten)

1. <https://supabase.com/dashboard> → Projekt **fale-pdf-ai** → links **SQL Editor** → „New query“.
2. Den kompletten Inhalt von `supabase/migrations/20261014120100_fale_ai_retention.sql` hineinkopieren → **Run**.
3. Erwartet: „Success“. Damit werden alte Zähler nach 30 Tagen gelöscht (täglich per `pg_cron`) und FaLe Plus kann
   gespeichert werden. (Falls `pg_cron` fehlt: Database → Extensions → **pg_cron** aktivieren und erneut ausführen.)

## Schritt 2 – KI-Anbieter: API-Schlüssel + Ausgabenlimit (zweites Sicherheitsnetz)

Standard ist **Anthropic (Claude)**, Modell `claude-haiku-5-5` (günstiges Haiku-Modell; änderbar mit `AI_MODEL`).

1. Konto anlegen: <https://console.anthropic.com> (Firmen- oder Privatkonto).
2. **Billing**: Guthaben aufladen (Prepaid, z. B. 10 USD). Prepaid ist bereits ein hartes Limit.
3. **Limits**: unter *Settings → Limits* ein **monatliches Ausgabenlimit** setzen (z. B. 12 USD). So ist auch bei
   einem Fehler in unserer Zählung nie mehr weg als dort eingestellt.
4. **API Keys** → *Create Key* → Name „fale-pdf-vercel“ → Schlüssel kopieren (beginnt mit `sk-ant-…`, wird nur einmal angezeigt).
5. Bitte die aktuellen **Datenschutz-/Datennutzungsbedingungen** des Anbieters lesen (Speicherdauer, kein Training
   mit API-Daten, Auftragsverarbeitungsvertrag/DPA, Drittland USA) und die Angaben in `datenschutz.html`
   Abschnitt 7 sowie ggf. `AI_PROVIDER_PRIVACY_NOTE` (Text im Einwilligungsdialog) anpassen.

## Schritt 3 – Variablen in Vercel eintragen

<https://vercel.com> → Projekt **fale-pdf** → **Settings → Environment Variables** → „Add New“.
Für jede Variable: *Environments* = **Production** und **Preview**. Geheimnisse als **Sensitive** markieren.

| Variable | Wert | Pflicht? |
|---|---|---|
| `ANTHROPIC_API_KEY` | der Schlüssel aus Schritt 2 (**Sensitive**) | ja |
| `AI_PRICE_IN_USD_PER_MTOK` | Preis pro 1 Mio. **Eingabe**-Tokens in USD laut <https://www.anthropic.com/pricing> für dein Modell | ja (Standard 1.0 = absichtlich zu hoch) |
| `AI_PRICE_OUT_USD_PER_MTOK` | Preis pro 1 Mio. **Ausgabe**-Tokens in USD | ja (Standard 5.0 = absichtlich zu hoch) |
| `USD_EUR` | Euro pro 1 US-Dollar, z. B. `0.92` | empfohlen (Standard 0.95) |
| `AI_MONTHLY_BUDGET_EUR` | Monatsbudget in Euro | optional (Standard 10) |
| `AI_MODEL` | anderes Modell, z. B. ein neueres Haiku | optional |
| `FREE_DAILY`, `REWARD_BONUS`, `REWARD_MAX_PER_DAY`, `PLUS_DAILY`, `IP_DAILY` | Kontingente (siehe oben) | optional |
| `ADMOB_REWARDED_AD_UNITS` | deine Rewarded-Anzeigenblock-ID(s), kommagetrennt (Schritt 4) | empfohlen |
| `ADS_ENABLED` | `false` schaltet Werbevideos ab | optional |
| `GOOGLE_PLAY_SA_JSON` | kompletter Inhalt der Dienstkonto-JSON-Datei (Schritt 5, **Sensitive**) | für FaLe Plus |
| `PLUS_LIFETIME_PRODUCTS` | IDs der Einmalkäufe „für immer“, kommagetrennt | optional (Standard `fale_plus_lifetime`) |
| `AI_PROVIDER_PRIVACY_NOTE` | eigener Datenschutz-Satz für den Einwilligungsdialog | optional |

**Danach neu deployen** (Deployments → letzter Eintrag → „Redeploy“) – Variablen gelten erst für neue Deployments.
Test: <https://pdf.fale.network/app/#/ki> → statt „KI kommt bald“ erscheint „Cloud-KI einrichten“.

Anderer Anbieter? `AI_PROVIDER=openai_compat` + `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`, `AI_MODEL`, `AI_PROVIDER_LABEL`
(jeder OpenAI-kompatible Dienst, z. B. ein EU-Anbieter) oder `AI_PROVIDER=gemini` + `GEMINI_API_KEY` + `AI_MODEL`.
Dann Preise und Datenschutzerklärung entsprechend anpassen.

## Schritt 4 – AdMob (Werbevideos, nur Android-App)

Bis du das erledigt hast, nutzt die App Googles **Test-IDs** (Testanzeigen, keine Einnahmen).

1. <https://admob.google.com> → Konto anlegen (Zahlungsprofil, Steuerinfos).
2. **Apps → App hinzufügen** → Android → (noch nicht im Play Store: „Nein“, später verknüpfen) → Name „FaLe PDF“.
   Notiere die **App-ID** (`ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY`).
3. **Anzeigenblöcke → Anzeigenblock hinzufügen → „Mit Prämie“ (Rewarded)**: Name „KI-Bonus“,
   Prämie **3**, Prämienartikel „KI-Anfragen“.
   Unter **Serverseitige Bestätigung** die Callback-URL eintragen:
   `https://fale-pdf.vercel.app/api/admob-ssv` → „Bestätigen“ (der Test-Aufruf muss „OK“ ergeben).
   Notiere die **Anzeigenblock-ID** (`ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ`).
   Zusätzlich für das Werbebanner (`js/banner.js`): **Anzeigenblock hinzufügen → Banner** (adaptiv) → Name z. B.
   „Banner Hauptseiten“ → Anzeigenblock-ID notieren (`ca-app-pub-XXXXXXXXXXXXXXXX/BBBBBBBBBB`).
4. **Datenschutz und Messaging → DSGVO**: eine Einwilligungsnachricht erstellen und **veröffentlichen**
   (Sprachen Deutsch + Englisch, Datenschutzerklärung-URL eintragen). Ohne veröffentlichte Nachricht erscheint in der
   EU kein Einwilligungsdialog und es werden keine Anzeigen ausgeliefert.
5. In `js/ai/config.js` eintragen (eine Stelle für alles):
   ```js
   ADMOB_APP_ID: 'ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY',
   ADMOB_REWARDED_ID: 'ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ',
   ADMOB_BANNER_ID: 'ca-app-pub-XXXXXXXXXXXXXXXX/BBBBBBBBBB',
   ADMOB_TESTING: false,
   ```
   Die App-ID landet beim Android-Build automatisch im Manifest (`scripts/cap-patch-android.mjs`).
6. In Vercel `ADMOB_REWARDED_AD_UNITS` = die Anzeigenblock-ID setzen (der Server akzeptiert dann nur Prämien für diesen Block).
7. Optional: `app-ads.txt` laut AdMob-Anleitung auf deiner Website hinterlegen.

**Wichtig:** Niemals echte Anzeigen selbst anklicken oder „durchspielen“ – zum Testen immer Test-IDs bzw. dein Gerät
in AdMob als **Testgerät** eintragen. Sonst droht die Sperre des AdMob-Kontos.

## Schritt 5 – FaLe Plus (Abo über Google Play)

1. Play Console → **Einrichtung → Zahlungsprofil** (Händlerkonto) anlegen, falls noch nicht geschehen.
2. Eine Version der App mit dem Billing-Plugin muss in einem Test-Track hochgeladen sein (sonst lassen sich keine Abos anlegen).
3. **Monetarisieren → Produkte → Abos → Abo erstellen**:
   - Produkt-ID `fale_plus_monthly`, Name „FaLe Plus (monatlich)“ → **Basis-Abo** mit ID `monthly`,
     automatisch verlängernd, 1 Monat, Preis **2,99 €** → aktivieren.
   - Produkt-ID `fale_plus_yearly`, Name „FaLe Plus (jährlich)“ → Basis-Abo `yearly`, 1 Jahr, **24,99 €** → aktivieren.
   (IDs müssen exakt so heißen – sie stehen in `js/ai/config.js` und `PLUS_PRODUCTS`.)
3b. **Monetarisieren → Produkte → In-App-Produkte → Produkt erstellen** (Einmalkäufe):
   - `fale_plus_lifetime`, Name „FaLe Plus für immer“, Vorschlag **39,99 €** → aktivieren. Ein Kauf gilt dauerhaft
     (der Server prüft ihn über die Products-API; andere IDs per `PLUS_LIFETIME_PRODUCTS`, kommagetrennt).
   - Danke-Beiträge (ohne Gegenleistung, werden sofort „verbraucht“ und können erneut gegeben werden):
     `fale_tip_small` „Kleiner Dank“ **1,99 €**, `fale_tip_medium` „Großer Dank“ **4,99 €**, `fale_tip_large` „Riesiger Dank“ **9,99 €**.
     Ohne diese Produkte blendet die App den Bereich „Einfach Danke sagen“ einfach aus.
4. **Dienstkonto für die Kaufprüfung**:
   - <https://console.cloud.google.com> → Projekt anlegen → **APIs & Dienste → Bibliothek** →
     „Google Play Android Developer API“ **aktivieren**.
   - **IAM → Dienstkonten → Dienstkonto erstellen** (z. B. „fale-plus-verify“) → **Schlüssel → JSON** herunterladen.
   - Play Console → **Nutzer und Berechtigungen → Neue Nutzer einladen** → die E-Mail des Dienstkontos →
     App-Berechtigung für FaLe PDF: „Finanzdaten ansehen“ und „Bestellungen und Abos verwalten“.
   - Den **kompletten Inhalt** der JSON-Datei in Vercel als `GOOGLE_PLAY_SA_JSON` (**Sensitive**) eintragen → neu deployen.
   - Die JSON-Datei danach sicher löschen (nicht ins Repo!).
5. Testen mit einem **Lizenz-Testkonto** (Play Console → Einstellungen → Lizenztests): Abo, „für immer“, Danke-Beitrag (zweimal hintereinander), „Käufe wiederherstellen“, Erinnerung vor der Verlängerung.

## Schritt 6 – Datenschutzerklärung und Store

- `datenschutz.html` Abschnitte 7–9: Platzhalter `[KI-ANBIETER …]`, Hosting, Supabase-Region, AdMob prüfen/ausfüllen.
- `store/data-safety.md` (Datensicherheit), `store/listing-*.md` („Enthält Werbung“, „In-App-Käufe“) in die Play Console übernehmen.
- Checkliste: `store/RELEASE-CHECKLIST.md` Abschnitt A2.

## Von Test-IDs auf echte IDs umstellen – Kurzfassung

1. `js/ai/config.js`: `ADMOB_APP_ID`, `ADMOB_REWARDED_ID`, `ADMOB_BANNER_ID` ersetzen, `ADMOB_TESTING: false`.
2. Vercel: `ADMOB_REWARDED_AD_UNITS` setzen, neu deployen.
3. App neu bauen (Commit → GitHub Actions) → in der Build-Ausgabe darf „TEST-App-ID aktiv“ nicht mehr stehen.

## Fehlersuche

| Anzeige in der App | Ursache |
|---|---|
| „KI kommt bald“ | `ANTHROPIC_API_KEY` fehlt oder kein Redeploy; oder Supabase-/Server-Variablen fehlen |
| „KI-Kontingent für diesen Monat aufgebraucht“ | Monatsbudget erreicht (Supabase-Tabelle `ai_budget`) – ggf. `AI_MONTHLY_BUDGET_EUR` erhöhen |
| „Die KI ist gerade nicht erreichbar“ | Anbieter-Fehler, Guthaben leer oder Limit beim Anbieter erreicht |
| Werbevideo lädt nicht | keine DSGVO-Nachricht veröffentlicht, Einwilligung abgelehnt, oder neuer Anzeigenblock (bis zu 1 h Wartezeit) |
| Video gesehen, aber kein +3 | SSV-Callback-URL im Anzeigenblock fehlt/falsch; Vercel-Logs von `/api/admob-ssv` prüfen |
| „FaLe Plus ist bald verfügbar“ | `GOOGLE_PLAY_SA_JSON` fehlt oder Plugin nicht im Build |

Kontrollblick in Supabase (SQL Editor): `select * from ai_budget;` zeigt reservierte und verbrauchte USD des Monats.

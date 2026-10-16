# FaLe-Konto & FaLe Sync – Einrichtung (Schritt für Schritt)

Das FaLe-Konto ist **freiwillig**: FaLe PDF funktioniert ohne Konto vollständig. Mit Konto gibt es
**FaLe Sync** (Ende-zu-Ende-verschlüsselt) sowie **FaLe Plus und KI-Kontingent pro Konto** auf allen Geräten.
Solange `ACCOUNTS_ENABLED` in Vercel nicht gesetzt ist, zeigt die App „Das FaLe-Konto kommt bald“
und blendet die Konto-Karte auf „Ich“ aus – nichts davon ist für Nutzer sichtbar oder aktiv.

## 0. Überblick

```
App (Web/Android)                                   Supabase "fale-pdf-ai" (eu-central-1, Frankfurt)
 ├─ Anmeldung: E-Mail + 6-stelliger Code ─────────▶ Auth  (/auth/v1/otp, /verify, /token, /logout)
 ├─ FaLe Sync (verschlüsselt auf dem Gerät) ──────▶ PostgREST-RPCs sync_* (RLS / auth.uid())
 │                                                 Storage-Bucket "sync" (privat, RLS: nur <uid>/…)
 └─ /api/account, /api/ai, /api/plus-verify ───────▶ Vercel-Funktionen (prüfen nur das Access-Token)
```

* Schlüssel: Zufälliger 256-bit-**Master-Key** pro Konto, erzeugt auf dem ersten Gerät. Auf dem Server nur
  **verschlüsselt** (AES-256-GCM) mit einem aus dem **Sync-Passwort** abgeleiteten Schlüssel (PBKDF2-SHA256,
  600 000 Runden) und mit dem ausdruckbaren **Wiederherstellungsschlüssel** (256 bit, 14×4 Zeichen Base32 mit
  Prüfsumme). Pro Eintrag ein eigener Schlüssel (HKDF), Dateien in 4-MiB-Teilen (AES-GCM).
* Der Server sieht: zufällige IDs, Art (Datei/Ordnerliste/…), Größe, Versionen, Zeitpunkte, Prüfsumme des
  Chiffretexts. **Nicht**: Namen, Inhalte, Passwort, Schlüssel.
* Wir haben **keinen Service-Role-Key** im Einsatz. Konto löschen: unsere API löscht die Storage-Dateien mit dem
  Token der Nutzerin, dann alle Zeilen über eine Funktion mit `FALE_RPC_SECRET`; den Auth-Nutzer löscht dieselbe
  Funktion, sofern die Datenbankrolle das darf (bei Supabase normalerweise ja) – sonst siehe Abschnitt 8.

## 1. Datenbank-Migrationen

Neu: `supabase/migrations/20261014180000_fale_account_sync.sql` (Tabellen, RLS, Bucket `sync`, Policies, RPCs)
und `20261014180100_fale_account_sync_cron.sql` (Aufräumen, pg_cron täglich 03:41).
Sie werden beim Push auf `main` automatisch vom Workflow **DB migrate** angewendet (Secret `SUPABASE_DB_URL`).
Prüfen: GitHub → Actions → „DB migrate“ grün; Supabase → Table Editor: `sync_items`, `sync_keys`, `sync_blobs`,
`devices`, `plus_accounts`; Storage → Bucket `sync` (privat, Dateigröße 4 194 332 Byte, `application/octet-stream`).
Die Migrationen setzen die Share-Migration (`fale_rate`) und `private.fale_check` (AI-Counter) voraus – beide sind
im Repository und laufen vorher.

## 2. Supabase → Authentication → URL Configuration

* **Site URL:** `https://fale-pdf.vercel.app` (später `https://pdf.fale.network`)
* **Redirect URLs** (für Google-Anmeldung und Links in E-Mails; der Code-Login braucht keine):
  * `https://fale-pdf.vercel.app/**`
  * `https://localhost/**` (Android-App, Capacitor)
  * `https://pdf.fale.network/**` (schon vor der Umstellung eintragen – siehe `docs/DOMAINS-SWITCH.md`)
  * optional für Tests: `http://localhost:*/**`

## 3. Supabase → Authentication → Sign In / Providers → Email

* **Email** aktivieren, **„Confirm email“ an** (der Code bestätigt die Adresse).
* **Allow new users to sign up: an** (Neuanmeldung = erster Code).
* **Email OTP Length: 6** · **Email OTP Expiration: 600** Sekunden (10 Minuten).
* **Secure email change: an**. Passwort-Login wird von der App nicht benutzt
  („Leaked password protection“ ist damit nicht relevant).

## 4. E-Mail-Vorlagen (Authentication → Emails → Templates)

Neue Nutzer bekommen die Vorlage **„Confirm signup“**, bestehende **„Magic Link“**. **Beide** müssen den Code
`{{ .Token }}` enthalten (sonst kommt nur ein Link, den die Android-App nicht öffnen kann).
Supabase-Vorlagen sind nicht pro Sprache – deshalb zweisprachig:

**Betreff (beide Vorlagen):** `Dein FaLe-Code: {{ .Token }} / Your FaLe code`

**Inhalt (beide Vorlagen):**

```html
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:auto;color:#15172F">
  <h2 style="margin:0 0 12px">FaLe-Konto</h2>
  <p>Dein Anmeldecode für FaLe:</p>
  <p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:16px 0;color:#3B37A0">{{ .Token }}</p>
  <p>Gib ihn in der App ein. Er gilt 10 Minuten. Wenn du das nicht warst, ignoriere diese E-Mail – ohne den Code
     passiert nichts.</p>
  <hr style="border:none;border-top:1px solid #E0E3EE;margin:20px 0">
  <p style="color:#4F5475">Your FaLe sign-in code is <b>{{ .Token }}</b>. Enter it in the app – it is valid for
     10 minutes. If this wasn't you, just ignore this email.</p>
  <p style="color:#8086A6;font-size:12px">FaLe · fale.network · Datenschutz: https://fale-pdf.vercel.app/datenschutz.html</p>
</div>
```

Die Vorlagen „Change Email Address“ und „Reauthentication“ ebenfalls mit `{{ .Token }}` und demselben Text
anpassen; „Invite user“ und „Reset Password“ werden nicht benutzt.

## 5. Eigener E-Mail-Versand (Pflicht vor dem Livegang)

Der eingebaute Supabase-Versand schickt **nur an Mitglieder des Supabase-Teams** und nur wenige Mails pro
Stunde. Für echte Nutzer: Custom SMTP, z. B. **Resend** mit der Domain `fale.network`.

1. resend.com → Konto → **Domains → Add Domain** → `fale.network`, **Region: EU (Ireland)**.
2. DNS-Einträge bei deinem Domain-Anbieter anlegen – **die exakten Werte zeigt Resend an**, typischerweise:
   | Typ | Name | Wert |
   |---|---|---|
   | TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3…` (DKIM-Schlüssel von Resend) |
   | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (Priorität 10) |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@fale.network` (später `p=quarantine`) |
   Warten, bis Resend „Verified“ zeigt (meist Minuten, max. 48 h).
3. Resend → **API Keys → Create** (Berechtigung „Sending access“, nur Domain `fale.network`).
4. Supabase → Authentication → **Emails → SMTP Settings → Enable Custom SMTP**:
   * Sender email: `konto@fale.network` · Sender name: `FaLe`
   * Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: *der API-Key aus Schritt 3*
     (wird nur in Supabase gespeichert – nicht in Vercel, nicht im Repository).
5. Test: in der App (Vorschau-Deployment mit `ACCOUNTS_ENABLED=1`) mit einer Adresse **außerhalb** des
   Supabase-Teams anmelden; der Code muss in < 1 Minute ankommen (auch Spam-Ordner prüfen).

## 6. Rate Limits & Schutz (Authentication → Rate Limits / Attack Protection)

* **Emails sent:** mit Custom SMTP z. B. `100` pro Stunde (Standard 30). Zusätzlich gilt fest: ein Code pro
  Adresse höchstens alle 60 s (die App zeigt einen Countdown).
* **Token verifications** (Codes prüfen): Standard `30` pro 5 Minuten pro IP lassen.
* **Token refreshes:** Standard (`150` pro 5 Minuten pro IP) lassen.
* Optional später **CAPTCHA** (Turnstile/hCaptcha) – die App schickt derzeit kein Captcha-Token mit
  (müsste in `js/account/auth.js` → `sendCode` ergänzt werden).
* Unsere eigenen Endpunkte (`/api/account`) zählen zusätzlich pro Konto und IP-Hash und Tag
  (`ACCOUNT_DAILY`, Standard 200; `ACCOUNT_IP_DAILY`, Standard 400).

## 7. JWT-Signaturschlüssel (empfohlen)

Supabase → Project Settings → **JWT Keys**: auf **asymmetrische Schlüssel (ECC P-256 / ES256)** umstellen
(„Migrate JWT secret“ → neuen Schlüssel erzeugen → „Rotate“). Dann prüft unsere API Tokens lokal über
`/auth/v1/.well-known/jwks.json` (schneller, ohne Anfrage pro Aufruf). Ohne Umstellung (HS256) fragt die API
`/auth/v1/user` – funktioniert ebenso, nur langsamer. Beides ist eingebaut.

## 8. Vercel → Project „fale-pdf“ → Environment Variables

| Variable | Wert | Hinweis |
|---|---|---|
| `SUPABASE_URL` | `https://mcjgkhisuquuxteyumrf.supabase.co` | schon für KI/Teilen gesetzt |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_IcROV4X…` | öffentlich (geht auch an die App) |
| `FALE_RPC_SECRET`, `FALE_TOKEN_SECRET`, `FALE_IP_SALT` | – | schon gesetzt (KI) |
| **`ACCOUNTS_ENABLED`** | `1` | **Livegang-Schalter** – erst nach Schritt 1–6 setzen, dann neu deployen |
| `AUTH_GOOGLE_ENABLED` | `1` | erst nach Schritt 9 |
| `SUPABASE_SERVICE_ROLE_KEY` | *(geheim, optional)* | nur falls „Konto löschen“ den Auth-Nutzer nicht selbst löschen kann (`auth_deleted=false` in `private.fale_account_deletions`). Als „Sensitive“ anlegen. |
| `ACCOUNT_DAILY` / `ACCOUNT_IP_DAILY` | `200` / `400` | optional |

Speicher-Kontingente stehen **in der Datenbank** (nicht in Vercel), damit sie serverseitig gelten:
```sql
select * from private.fale_sync_config;                                          -- ansehen
update private.fale_sync_config set value = 2147483648 where key = 'free_bytes'; -- z. B. 2 GB gratis
update private.fale_sync_config set value = 21474836480 where key = 'plus_bytes';-- 20 GB mit Plus
```
Weitere Schlüssel: `chunk_bytes` (nicht ändern – muss zum Bucket-Limit passen), `max_pending`, `max_items`,
`max_meta_bytes`, `tombstone_days`.

## 9. Google-Anmeldung (später)

1. Google Cloud Console → APIs & Services → **OAuth-Zustimmungsbildschirm** (extern, App-Name „FaLe“,
   Datenschutz-URL, Domain `fale.network`) → **Anmeldedaten → OAuth-Client-ID → Webanwendung**.
2. Autorisierte Weiterleitungs-URI: `https://mcjgkhisuquuxteyumrf.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → **Google**: Client-ID + Secret eintragen, aktivieren.
4. Vercel: `AUTH_GOOGLE_ENABLED=1`. Der Button erscheint dann **nur in der Web-Version** (Google erlaubt keine
   Anmeldung in eingebetteten WebViews; für die Android-App wäre ein nativer Google-Login nötig).

## 10. Konto löschen – was passiert

1. App → `/api/account?a=delete` mit dem Access-Token (frisch bei Supabase geprüft).
2. API löscht mit **dem Token der Nutzerin** alle Storage-Objekte unter `<uid>/` (RLS erlaubt das nur ihr).
3. `public.fale_account_delete` (mit `FALE_RPC_SECRET`) löscht `sync_items`, `sync_blobs`, `sync_keys`, `devices`,
   `plus_accounts` und versucht `delete from auth.users` (Sitzungen enden damit).
4. Ergebnis steht in `private.fale_account_deletions` (`auth_deleted`, `remaining_objects`), wird 30 Tage nach
   Abschluss gelöscht. Prüfen (z. B. monatlich):
   ```sql
   select * from private.fale_account_deletions where done_at is null;
   ```
   Falls `auth_deleted = false`: Supabase → Authentication → Users → Nutzer (ID) löschen **oder**
   `SUPABASE_SERVICE_ROLE_KEY` setzen. Falls `remaining_objects > 0`: Storage → `sync` → Ordner `<uid>` löschen.
   Die App verspricht: „Konto und alle Daten werden innerhalb von 30 Tagen vollständig gelöscht.“

## 11. Livegang – Checkliste

- [ ] Migrationen angewendet (Schritt 1), Bucket `sync` vorhanden
- [ ] URL Configuration, Email-Provider, OTP 6-stellig/600 s (Schritt 2–3)
- [ ] Vorlagen mit `{{ .Token }}` (Schritt 4)
- [ ] Custom SMTP verifiziert, Testmail an externe Adresse angekommen (Schritt 5)
- [ ] Rate Limits gesetzt (Schritt 6); optional JWT-Keys ES256 (Schritt 7)
- [ ] `datenschutz.html`: Platzhalter in Abschnitt 11 (Supabase, E-Mail-Dienst, AV-Verträge) ausgefüllt
- [ ] Play Console: Data-Safety-Antworten aus `store/data-safety.md` (E-Mail, Nutzer-ID, Löschlink)
- [ ] Vercel: `ACCOUNTS_ENABLED=1` → Redeploy → auf zwei Geräten testen (Anmelden, Sync einrichten,
      Datei auf Gerät A → erscheint auf B, Wiederherstellungsschlüssel, Abmelden, Konto löschen)

## 12. Sicherheits-Checkliste (Review)

- [x] **RLS auf jeder neuen Tabelle** (`devices`, `plus_accounts`, `sync_keys`, `sync_items`, `sync_blobs`):
      nur `SELECT` der eigenen Zeilen für `authenticated`; keine Insert/Update/Delete-Rechte → Schreiben nur über
      `SECURITY DEFINER`-Funktionen mit `auth.uid()` und `set search_path = ''`; `anon` hat keinerlei Zugriff.
      Private Tabellen (`private.*`) ohne Rechte für `anon`/`authenticated`. (Automatisch geprüft in den SQL-Tests.)
- [x] **Storage:** Bucket privat; Policies nur für den eigenen Ordner `<uid>/`; Upload nur in reservierte Slots
      (`sync_reserve` prüft das Kontingent); keine Update-Policy (Teile sind unveränderlich); Größen- und
      MIME-Limit am Bucket; `sync_commit` prüft Anzahl und Bytes der hochgeladenen Teile.
- [x] **Kein Service-Key** in der App oder im Repository; optionaler `SUPABASE_SERVICE_ROLE_KEY` nur als
      geheime Vercel-Variable und nur für das Löschen des Auth-Nutzers.
- [x] **Rate Limits:** OTP/Verify/Refresh durch Supabase Auth (Schritt 6); `/api/account` pro Konto + IP-Hash;
      bestehende KI-/Teilen-Limits unverändert.
- [x] **Schlüssel verlassen das Gerät nie unverschlüsselt:** Master-Key nur gewrappt (AES-GCM, AAD = Nutzer-ID);
      auf dem Gerät als **nicht exportierbarer** `CryptoKey` in IndexedDB; Passwort und Wiederherstellungsschlüssel
      werden nie gesendet (in den E2E-Tests geprüft: keine Klartexte, Namen, Passwörter oder Schlüssel in
      Anfragen oder im Speicher).
- [x] **Keine Klartext-Namen serverseitig:** Pfade `<uid>/<zufällige Blob-ID>/<n>`, Item-IDs zufällig bzw. per HKDF
      aus dem Master-Key abgeleitet (Ordnerliste, Tags, Profil …).
- [x] **Konstante Vergleichszeit:** Token-/Secret-Vergleiche über `crypto.timingSafeEqual` (`security.js`) bzw.
      SHA-256-Vergleich in der Datenbank (`private.fale_check`); JWT-Signaturen per `crypto.verify`.
- [x] **Access-Token-Prüfung** serverseitig: JWKS (ES256/RS256: Signatur, `iss`, `aud`, `role`, `exp`) oder
      `/auth/v1/user`; Ergebnis höchstens 60 s gecacht; vor „Konto löschen“ immer frisch geprüft.
- [x] **Abmelden/Widerruf:** Abmelden löscht Refresh-Token, Master-Key und Sync-Daten auf dem Gerät; ein in der
      Geräteliste abgemeldetes Gerät verliert seine Sitzung (`auth.sessions`) und löscht seine Schlüssel beim
      nächsten Kontakt.
- [ ] Offene Punkte: CAPTCHA für Code-Anforderung (optional), Google-Login in der Android-App (nativ),
      DPA/AV-Vertrag mit Supabase und Resend.

## 13. Lokal testen

Siehe Scratchpad-Tests: `acct/test_sql.mjs` (PostgreSQL 16 mit Supabase-Stub), `acct/test_account_api.mjs`
und `test_account.py` (Playwright, Harness `acct/account_harness.mjs` auf Port 8804/8805 mit Mock-Auth/
-Storage, der die **echten** SQL-Funktionen und RLS-Policies in PostgreSQL ausführt).

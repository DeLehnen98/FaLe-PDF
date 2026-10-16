# FaLe Mail – Server, Betrieb und Produktplan

FaLe Mail ist der eigene E-Mail-Dienst des FaleNetwork auf `fale.network`: privat, EU-gehostet, ohne Drittanbieter.
Dieses Dokument beschreibt den Server (wie er sich selbst einrichtet), den Betrieb ohne SSH und den Produktplan.

| Teil | Ort |
|---|---|
| Cloud-init (zum Einfügen beim Server-Anlegen) | `mail/cloud-init.yaml` – **generiert** von `mail/tools/build.mjs` |
| Erststart-Skript, Agent (GitOps, Status, Backup) | `mail/server/firstboot.sh`, `mail/server/fale-mail-agent.py` |
| Deklarative Stalwart-Konfiguration (per GitOps angewendet) | `mail/config/stalwart.ndjson`, `mail/config/versions.json`, `mail/config/MANIFEST.sha256` |
| Kopplung Handy ↔ Server, versiegelte Geheimnisse | `mail/web/index.html` (wird unter `https://mail.fale.network/fale/` ausgeliefert), `mail/tools/seal.mjs` |
| DNS in Vercel | `scripts/mail-dns.mjs` |
| Überwachung ohne SSH | `mail/tools/monitor.mjs`, `.github/workflows/mail-monitor.yml` |
| MTA-STS-Policy (für die Network-Site) | `mail/mta-sts/mta-sts.txt` |
| Tests | `mail/test/` (`node --test 'mail/test/*.test.mjs'`, `python3 -m unittest discover -s mail/test`) |

## 1. Entscheidungen (Stand 16.10.2026)

**Mailserver: [Stalwart](https://stalw.art) v0.16.25** (Release 05.10.2026) + `stalwart-cli` 1.0.13.
Rust, ein einziges Binary: SMTP (MTA + Submission), IMAP4, JMAP (Mail/Kontakte/Kalender), CalDAV/CardDAV,
eingebauter Spamfilter (Regeln, DNSBL, Bayes-Klassifikator), DKIM/ARC/SPF/DMARC/DANE/MTA-STS/TLS-RPT, ACME,
Web-Admin, JMAP-API für alles. Lizenz: **AGPL-3.0 oder SELv2 (dual)** – wir nutzen die AGPL-Variante
unverändert; solange wir Stalwart nicht modifizieren, entstehen keine Quelltext-Pflichten (bei Änderungen:
Quelltext der Änderungen für Nutzer bereitstellen). Enterprise-Features (SELv2) brauchen wir nicht.
Alternativen (Postfix+Dovecot+Rspamd, Mailcow, Maddy) wären mehr bewegliche Teile ohne JMAP-first-API; Stalwart
passt am besten zu „FaLe One spricht JMAP“ und „alles deklarativ per GitOps“.

Seit 0.16 ist Stalwart **deklarativ**: `config.json` enthält nur den Datenspeicher (RocksDB), alles andere sind
Objekte in der Datenbank, die per JMAP-API bzw. `stalwart-cli apply` (NDJSON-Plan mit `upsert`/`update`/`destroy`)
gesetzt werden. Genau das nutzt unser GitOps-Agent. Lokal verifiziert (Linux x86_64, Ports isoliert): Bootstrap
ohne Web-Assistent, Anlegen der Postfächer, Anwenden von `mail/config/stalwart.ndjson` (idempotent),
Listener 25/465/587/993/443, Auslieferung von `status.json` über HTTPS, automatische DKIM-Schlüssel (Ed25519 + RSA,
Rotation alle 90 Tage), Offline-Export für Backups.

Installation: offizielles Release-Binary von GitHub, **per SHA-256 gepinnt** (Hashes in `mail/config/versions.json`,
gegen die Release-Seiten geprüft; Releases sind zusätzlich per Sigstore signiert). Kein Docker: ein Binary +
systemd ist kleiner, und Ports/Capabilities sind einfacher abzusichern.

**Server: Hetzner Cloud CX33, Standort Nürnberg (nbg1) oder Falkenstein (fsn1)** – 4 vCPU, 8 GB RAM, 80 GB NVMe,
20 TB Traffic, IPv4 + IPv6: **8,99 €/Monat netto inkl. IPv4** (≈ 10,70 € brutto; Preise nach der Anpassung vom
15.06.2026, Stand Sept. 2026). Gründe: Cloud-init-Feld direkt im (mobil nutzbaren) Web-Konsole, Reverse-DNS pro IP in
der Konsole, stündliche Abrechnung, deutsche Rechenzentren, AVV nach DSGVO. ARM-Alternative CAX21 (10,99 €) wird von
der Cloud-init ebenfalls unterstützt.

| Anbieter | Port 25 ausgehend | Reverse DNS | Bemerkung |
|---|---|---|---|
| **Hetzner Cloud** | gesperrt (25 und 465) – Freischaltung per *Limit-Anfrage*, sobald das Konto ≥ 1 Monat alt und die erste Rechnung bezahlt ist; Einzelfallentscheidung. 587 ist offen. | Konsole → Server → Networking → IP → „Reverse DNS bearbeiten“ | empfohlen; Empfang (eingehend 25) funktioniert sofort |
| netcup (VPS 1000 G12: 4 vCPU/8 GB, ≈ 10,37 € brutto) | laut Community offen – **nicht verifiziert** | im Server Control Panel | kein Cloud-init-Feld beim Bestellen bekannt → Selbsteinrichtung schwieriger |
| IONOS | standardmäßig gesperrt; Freischaltung per Anruf beim Support, nachdem FQDN, PTR und SPF gesetzt sind | Cloud Panel | |
| OVH | offen, mit Spam-Überwachung | Kundencenter → IP → Reverse | Sperre nur nach Spam-Erkennung |

Konsequenz für Hetzner: Der Server kann vom ersten Tag an **empfangen**; **Versand** an fremde Server geht erst nach
der Freischaltung. Phase 0 (Login-Codes über den eigenen Server) startet deshalb nach der Freischaltung; bis dahin
bleibt Resend aktiv. Der Status (`port25Outbound`) zeigt, wann es so weit ist.

## 2. Server anlegen – Schritte auf dem Handy

1. <https://console.hetzner.cloud> öffnen, anmelden (Konto mit 2FA), Projekt **FaleNetwork** anlegen/öffnen.
2. **Server hinzufügen**:
   - Standort **Nürnberg** (oder Falkenstein) · Image **Ubuntu 24.04** · Typ **Shared vCPU → x86 (Intel/AMD) → CX33**
   - Netzwerk: **Öffentliche IPv4** und **IPv6** aktiviert lassen
   - SSH-Schlüssel: **keinen** auswählen (SSH wird ohnehin deaktiviert; das Root-Passwort, das Hetzner dann per
     E-Mail schickt, wird beim ersten Start gesperrt)
   - Backups (Hetzner, +20 %): optional, empfohlen als zweite Sicherung
   - **Cloud config**: den kompletten Inhalt von `mail/cloud-init.yaml` einfügen
     (auf GitHub die Datei öffnen → „Raw“ → alles markieren → kopieren). Die Datei enthält **keine Geheimnisse**.
   - Name: `mail` → **Kostenpflichtig erstellen**.
3. IP-Adressen notieren (Server → Übersicht). Die IPv4 ist **nicht geheim** und darf in den Chat.
4. **Reverse DNS**: Server → Networking → bei der IPv4 „…“ → *Reverse DNS bearbeiten* → `mail.fale.network`.
   Dasselbe für die IPv6 – als Adresse die `…::1` des zugewiesenen /64 eintragen (die zeigt auch `status.json`).
5. Etwa 5–10 Minuten warten, dann **zügig** (Stalwart versucht das Let's-Encrypt-Zertifikat mit Wiederholungen,
   braucht dafür aber `mail.fale.network` im DNS) das DNS einrichten lassen – Assistent oder Workflow:
   `node scripts/mail-dns.mjs --status-url https://<IPv4>/fale/status.json --insecure --apply`
   (alternativ legt der Assistent die Einträge über das Vercel-MCP an – `--json` zeigt die Sollwerte).
6. Nach ≤ 1 h: `https://mail.fale.network/fale/` öffnen → Abschnitt „Dieses Handy koppeln“ (s. §4).
7. **Port 25 freischalten lassen** (nach 1 Monat + erster bezahlter Rechnung): Hetzner-Konsole → Support/Limits →
   Limit-Anfrage „Mail-Ports 25/465 freischalten“. Begründung (Vorschlag): *„Eigener Mailserver für die Domain
   fale.network (Transaktionsmails, Postfächer für eigene Nutzer, kein Massenversand). PTR mail.fale.network,
   SPF/DKIM/DMARC gesetzt, Abuse-Kontakt abuse@fale.network, ausgehende Ratenlimits aktiv.“*

## 3. Was beim ersten Start automatisch passiert

`firstboot.sh` (von cloud-init einmal gestartet, Log `/var/log/fale-mail-firstboot.log`):

1. **Härtung**: Paket-Updates, `unattended-upgrades` mit automatischem Neustart 04:30, Firewall (ufw): eingehend
   nur **25, 465, 587, 993, 443**. Port 80 bleibt zu – Zertifikate kommen per **TLS-ALPN-01 über 443**;
   4190/110/143/995 sind zu. **SSH wird entfernt**, Root gesperrt. Kernel-Sysctls gehärtet.
2. **Eigener validierender Resolver** (unbound): DNSSEC → DANE aktiv; DNS-Blocklisten (Spamhaus) funktionieren
   nur mit eigenem Resolver.
3. **Stalwart + CLI** aus den gepinnten Releases, SHA-256-geprüft; Dienst unter eigenem Benutzer mit systemd-Sandbox.
4. **Geheimnisse entstehen auf dem Server** (nur für root lesbar, verlassen ihn nie unverschlüsselt):
   Admin-Passwort, Postfach-Passwörter (`postmaster@`, `konto@`), restic-Backup-Passwort, Versiegelungs-Schlüssel
   (P-256). DKIM-Schlüssel erzeugt Stalwart selbst.
5. **Bootstrap** ohne Web-Assistent (`Bootstrap`-Objekt per CLI), dann Normalbetrieb.
6. Postfächer: `postmaster@` (Aliase `abuse@`, `hostmaster@`, `security@`, `hallo@`, `dmarc-reports@`,
   `tls-reports@`) und `konto@` (Absender für Login-Codes; Aliase `notfall@`, `noreply@`).
7. **GitOps-Agent** zieht `mail/config` + `mail/web` aus `main` und wendet sie an (Listener, Let's-Encrypt-ACME,
   Domain-Einstellungen, Aufwärm-Ratenlimits, HSTS, Status-Seite). Danach systemd-Timer:
   GitOps alle 10 min, Status alle 15 min, Backup täglich 03:30.

## 4. Betrieb ohne SSH und ohne Geheimnisse im Chat

### Vertrauensmodell (GitOps)
- Der Server holt **nur Branch `main`** von `github.com/DeLehnen98/FaLe-PDF` über HTTPS, nur **fast-forward**
  (History-Umschreibungen werden abgelehnt und im Status gemeldet).
- Jede Datei unter `mail/config` und `mail/web` muss zu `mail/config/MANIFEST.sha256` passen (keine fehlenden,
  keine zusätzlichen Dateien). `node mail/tools/build.mjs` erzeugt Manifest und Cloud-init; CI prüft mit `--check`.
- Der Plan darf nur Objekttypen von einer **Allowlist** ändern, die im Agenten (also in der Cloud-init, nicht im
  Repo) steht: keine Konten, Passwörter, API-Schlüssel, Rollen, Verzeichnisse, Hooks, Routen; kein Open Relay;
  keine geheimen Felder; Web-Bundles nur aus lokalem Pfad oder von `github.com/stalwartlabs`.
- Upgrades: nur auf Versionen aus `versions.json`, nur offizielle stalwartlabs-Release-URLs, nur nach SHA-256-Prüfung,
  **nie Downgrade**, automatischer Rollback, wenn der Dienst nicht hochkommt.
- Optional streng: `/etc/fale-mail/allowed_signers` (SSH-Signaturschlüssel) → nur noch signierte Commits werden
  angewendet. Leer = aus (Standard, weil Commits vom Handy/aus Claude-Sitzungen nicht mit einem Owner-Schlüssel
  signiert sind).
- Ehrliche Grenze: Wer auf `main` pushen darf, kann die erlaubte Konfiguration ändern und sich per Kopplungsdatei
  (s. u.) Admin-Zugang verschaffen. **Schreibrechte am Repo = Mail-Admin.** Deshalb: 2FA auf GitHub, Branch-Schutz
  für `main` empfohlen. Der Agent-Code selbst aktualisiert sich nicht aus dem Repo (Änderungen am Agenten → Server
  neu aufsetzen oder später signiertes Update).

### Status ohne SSH
`https://mail.fale.network/fale/status.json` (öffentlich, nichts Geheimes; vom Agenten geprüft): Versionen,
Zertifikat (Aussteller, Ablauf, SANs), Queue-Größe, Plattenbelegung, IPv4/IPv6, PTR, Blocklisten-Ergebnis,
Port-25-Test, DKIM-Selektoren + öffentliche Schlüssel, komplette Zonendatei-Empfehlung von Stalwart, GitOps-Stand
(Commit, Fehler), Backup-Stand, öffentlicher Versiegelungs-Schlüssel.

Der Workflow **Mail monitor** (alle 6 h + manuell) liest das, prüft DNS (über 1.1.1.1/9.9.9.9) gegen die Sollwerte,
TLS auf 443/465/993 und die MTA-STS-Policy und meldet per `::notice/::warning/::error`. Fehler → roter Lauf →
GitHub-Benachrichtigung. Ohne Server: nur ein Hinweis, kein Fehler. Repo-Variablen/Secrets: siehe Kopf der Workflow-Datei.

### <a id="pairing"></a>Kopplung: Zugangsdaten aufs Handy (einmalig)
1. `https://mail.fale.network/fale/` öffnen → „Schlüssel erzeugen“. Das Schlüsselpaar entsteht **im Browser**;
   der private Teil bleibt nicht-exportierbar in IndexedDB dieses Handys.
2. „In GitHub speichern“ öffnet GitHub mit vorausgefüllter Datei `mail/config/pairing/owner.json` (nur der
   öffentliche Schlüssel) → „Commit changes“.
3. Der Agent veröffentlicht binnen ~10 min `/fale/pairing/owner.json`: Admin-Passwort, Postfach-Passwörter
   (`postmaster@`, `konto@`) und das restic-Passwort – **verschlüsselt** (ECDH P-256 + HKDF-SHA256 + AES-256-GCM,
   Format `fale-seal-1`) nur für diesen Schlüssel.
4. „Zugangsdaten abholen“ → entschlüsselt lokal → in den Passwort-Manager übernehmen. Danach kann
   `mail/config/pairing/owner.json` gelöscht werden (Bundle verschwindet beim nächsten Lauf).

Admin-Oberfläche: `https://mail.fale.network/admin` (Benutzer `admin`). Dort ein persönliches Admin-Konto mit 2FA
anlegen und das `admin`-Notfallkonto nur für den Agenten lassen.

### <a id="backups"></a>Backups (optional, später)
Verschlüsselt mit **restic** (AES-256, Passwort auf dem Server erzeugt und per Kopplung beim Owner hinterlegt) in
einen **S3-kompatiblen EU-Bucket** (z. B. Hetzner Object Storage fsn1/nbg1). Ablauf täglich 03:30: Stalwart kurz
stoppen → `stalwart --export` (konsistent, Sekunden bis Minuten; sendende Server stellen später zu) → starten →
`restic backup` → Aufbewahrung 7 täglich / 5 wöchentlich / 12 monatlich.
Zugangsdaten setzen, ohne dass sie durch den Chat gehen:
1. Bucket + Zugangsschlüssel beim Anbieter anlegen.
2. `https://mail.fale.network/fale/` → „Backup-Zugang versiegeln“ → Felder ausfüllen → „Versiegeln“.
   Verschlüsselt wird im Browser mit dem öffentlichen Server-Schlüssel aus `status.json`.
3. „In GitHub speichern“ → `mail/config/sealed/backup.json` (nur Chiffretext) committen.
4. Der Agent entschlüsselt, legt `/etc/fale-mail/backup.env` (root, 0600) an; `status.json` → `backup` zeigt den Stand.
Wiederherstellung: neuen Server mit derselben Cloud-init → restic-Snapshot holen → `stalwart --import`.

## 5. DNS (Vercel DNS)

`scripts/mail-dns.mjs` liest `status.json` und gleicht nur **eigene** Einträge ab (andere Apex-TXT, Website-A/CNAME,
`resend._domainkey`, fremde CAA bleiben unberührt). Standard = Plan; `--apply` schreibt, `--prune` löscht rotierte
Stalwart-DKIM-Selektoren und fremde Apex-MX. Token aus `VERCEL_TOKEN`, Team `team_RORTRNxCPjEZkE9WHaPcyQRu`.

| Name | Typ | Wert |
|---|---|---|
| `mail` | A / AAAA | Server-IPv4 / -IPv6 |
| `@` | MX | `10 mail.fale.network` |
| `@` | TXT | `v=spf1 mx ~all` (nach Abschalten von Resend-Absendern auf der Apex ggf. `-all`) |
| `mail` | TXT | `v=spf1 a -all` (HELO-Identität) |
| `<selector>._domainkey` | TXT | je Stalwart-DKIM-Schlüssel (Ed25519 + RSA) aus `status.json` |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc-reports@fale.network; adkim=r; aspf=r` → nach 2–4 Wochen sauberer Berichte `--dmarc quarantine`, später `reject` |
| `_smtp._tls` | TXT | `v=TLSRPTv1; rua=mailto:tls-reports@fale.network` |
| `mta-sts` | CNAME | `cname.vercel-dns.com` (Policy liegt auf der Network-Site, s. u.) |
| `_mta-sts` | TXT | `v=STSv1; id=<Hash der Policy>` (ändert sich automatisch mit der Policy) |
| `autoconfig`, `autodiscover` | CNAME | `mail.fale.network` (Stalwart beantwortet Thunderbird-/Outlook-Autokonfiguration) |
| `_submissions._tcp` / `_submission._tcp` / `_imaps._tcp` / `_jmap._tcp` / `_autodiscover._tcp` | SRV | `0 1 465/587/993/443/443 mail.fale.network` |
| `@` | CAA | `0 issue "letsencrypt.org"` (nur ergänzt, falls fehlt) |

DKIM rotiert alle 90 Tage: mit Repo-Variable `MAIL_DNS_AUTO_APPLY=true` + Secret `VERCEL_TOKEN` gleicht der
Monitor-Workflow neue Selektoren automatisch ab; sonst meldet er die Abweichung als Fehler.

**MTA-STS über die Network-Site (später, `network/` jetzt nicht ändern)** – genau diese Schritte:
1. Datei `network/.well-known/mta-sts.txt` anlegen, Inhalt **bytegleich** zu `mail/mta-sts/mta-sts.txt`.
2. Vercel → Projekt `fale-network` → Domains → `mta-sts.fale.network` hinzufügen (ohne Weiterleitung).
3. Optional in `network/vercel.json` einen Header-Eintrag für `/.well-known/mta-sts.txt` mit
   `Content-Type: text/plain; charset=utf-8` (Vercel liefert `.txt` ohnehin als `text/plain`).
4. Prüfen: `curl https://mta-sts.fale.network/.well-known/mta-sts.txt` (der Monitor prüft das ebenfalls).
5. Nach 2–4 Wochen ohne TLS-Fehlerberichte: in beiden Dateien `mode: enforce`, `max_age: 604800`, Variable
   `MAIL_MTA_STS=enforce`, DNS-Abgleich laufen lassen.

## 6. Architektur und Produkt

```
FaLe One (Browser/App) ──JMAP über HTTPS (CORS, Bearer/App-Passwort)──▶ mail.fale.network:443 (Stalwart)
        │                                                                     ▲   │ SMTP 25 ein/aus, 465/587, IMAP 993
        └─ FaLe-Konto (Supabase) ─▶ Vercel-API api/mail/* ──Provisioning-API──┘   │
                                                                              RocksDB (lokal) ─▶ restic ─▶ EU-S3
```

### Provisioning FaLe-Konto ↔ Postfach (Design)
- Neuer Endpunkt in der Vercel-API (`api/mail/…`): legt beim Freischalten eines FaLe-Kontos ein Stalwart-Konto
  `<name>@fale.network` an, setzt Quota, Aliase, MaskedEmail-Limits, sperrt/löscht beim Kontolöschen.
- Zugang zur Stalwart-Admin-API **ohne Geheimnis im Chat** – dieselbe Kopplung wie beim Handy:
  1. Ein einmaliger Admin-Schritt im Browser erzeugt ein P-256-Schlüsselpaar; den privaten JWK trägt der Owner
     selbst als Vercel-Env `MAIL_PAIRING_KEY` (sensitive) ein, den öffentlichen als
     `mail/config/pairing/backend.json` (`role: "backend"`) ins Repo.
  2. Der Agent legt dafür ein eigenes Konto `provisioner` mit **eingeschränkter Rolle** an (nur Konten der Domain
     `fale.network` anlegen/ändern, keine Server-Einstellungen), erzeugt dessen Zugangsdaten **auf dem Server**
     und veröffentlicht sie versiegelt unter `/fale/pairing/backend.json`.
  3. Die Vercel-API lädt und entschlüsselt das Bundle beim Kaltstart; Rotation = Datei neu committen.
  Stand: Rolle `backend` ist im Agenten vorgesehen, aber noch nicht aktiviert (Phase 1).
- Absicherung zusätzlich: Ratenbegrenzung in Stalwart (`Http.rateLimitAuthenticated`), Audit-Log, Alarm bei
  vielen Neuanlagen.

### FaLe One spricht JMAP
- JMAP (RFC 8620/8621) direkt aus dem Browser gegen `https://mail.fale.network/jmap` – Push über EventSource/
  WebSocket, Blobs, Suche, Sieve, Identitäten, MaskedEmail.
- CORS: Stalwart `Http.usePermissiveCors` bzw. gezielte `responseHeaders` für `https://one.fale.network`
  (Bearer-Token statt Cookies → kein CSRF-Risiko). Wird per GitOps aktiviert, sobald Phase 2 startet.
- Auth: kein Mail-Passwort im Client. Nach FaLe-Konto-Login holt die App über unsere API ein **geräte­bezogenes
  App-Passwort/Token** (vom Provisioning-Konto erzeugt, widerrufbar, in FaLe One E2E-verschlüsselt gespeichert).
  Später: Stalwart als OAuth/OIDC-Client gegen FaLe-Konto. Klassische Mail-Apps: IMAP/SMTP mit App-Passwort.

### Verschlüsselung ruhender Mails
Stalwart kann eingehende Nachrichten **beim Speichern mit dem öffentlichen OpenPGP- oder S/MIME-Schlüssel des
Nutzers verschlüsseln** (Konto-Einstellung `encryptionAtRest`, Schlüssel als `PublicKey`-Objekt; global erlaubt per
`Email.encryptAtRest`, Standard an; `encryptOnAppend` verschlüsselt auch per IMAP/JMAP abgelegte Mails wie
„Gesendet“). Danach kann der Server die Inhalte nicht mehr lesen. Plan für FaLe One: Schlüsselpaar entsteht im
Client und hängt an der bestehenden FaLe-Konto-Schlüsselhierarchie (wie FaLe Drive); hochgeladen wird nur der
öffentliche Schlüssel; Entschlüsselung + Volltextsuche im Client. Trade-offs: Server-Volltextsuche entfällt,
Spamfilter läuft vor der Verschlüsselung (bleibt wirksam), Metadaten (Absender, Betreff je nach Modus,
Zeitpunkte) bleiben für Zustellung sichtbar.

### Aliase pro Shop
Stalwart unterstützt **JMAP MaskedEmail** (Fastmail-kompatibel; Felder `forDomain`, `url`, `description`,
`expiresAt`, `enabled`). Pro Shop eine Zufallsadresse (z. B. `xk7q2m@alias.fale.network`), in FaLe One sichtbar
mit Shop-Name, abschaltbar bei Spam oder Datenleck. Umsetzung: Alias-Domain als zweite Stalwart-Domain (MX + SPF/DKIM
für die Subdomain), `Email.maxMaskedAddresses` per GitOps von 5 auf z. B. 200 erhöhen.

### Spam- und Missbrauchsschutz
- **Invite-only-Beta**, Postfächer nur für verifizierte FaLe-Konten; keine offene Registrierung.
- Ausgehende Ratenlimits (bereits aktiv, `mail/config/stalwart.ndjson`): 60/h pro Absender, 100/h pro
  Empfängerdomain, 300/Tag gesamt in der Aufwärmphase. Für neue Konten zusätzlich niedrigere Limits über
  Ausdrücke (Phase 1, mit Stalwart-Ausdrücken auf Konto/Rolle; vor Aktivierung testen).
- Ausgehende Mails durch den Spamfilter (Inhalt + URL-Reputation) – Konfiguration in Phase 1 prüfen und testen.
- Kein Open Relay (vom Agenten erzwungen), DKIM+SPF+DMARC, ARC, MTA-STS, TLS-RPT, DANE.
- `abuse@`/`postmaster@` werden gelesen; Feedback-Loops anmelden: Google Postmaster Tools, Microsoft SNDS/JMRP,
  Yahoo CFL. Blocklisten-Prüfung läuft im Status (Spamhaus ZEN, Barracuda, SpamCop, PSBL).
- Fernmeldegeheimnis: Spam **beim SMTP-Empfang ablehnen** oder in „Junk“ zustellen – nie still löschen (s. §7).

### IP-Aufwärmplan
Vorab: IP gegen Blocklisten prüfen (Status) – ist sie vorbelastet, Server neu anlegen (neue IP), **bevor** gesendet
wird. PTR, SPF, DKIM, DMARC müssen stimmen (Monitor grün).

| Woche | Volumen/Tag | Inhalt |
|---|---|---|
| 1 | ≤ 50 | nur Login-Codes/Benachrichtigungen an Leute, die sie angefordert haben |
| 2 | ≤ 150 | + Beta-Postfächer (Person-zu-Person) |
| 3–4 | ≤ 500 | Limits in `stalwart.ndjson` schrittweise anheben |
| ab 5 | nach Bedarf | Gmail/Microsoft-Postmaster-Daten beobachten; DMARC → `quarantine` |

Nie Newsletter/Massenmails über diese IP. Bounces und Beschwerden wöchentlich ansehen.

## 7. Rechtliche Checkliste – **alle Punkte von einer Anwältin/einem Anwalt prüfen lassen**
- **TKG § 5 – Meldepflicht** bei der Bundesnetzagentur: E-Mail für Dritte ist ein nummernunabhängiger
  interpersoneller Telekommunikationsdienst → Meldung vor Start der öffentlichen Beta (Online-Formular der BNetzA).
- **TKG-Pflichten** prüfen: Auskunftsersuchen (Bestandsdaten), Überwachungs-Pflichten nach TKG/TKÜV (Schwellenwerte
  nach Teilnehmerzahl), Sicherheitskonzept, Meldung von Sicherheitsvorfällen.
- **TDDDG** (früher TTDSG) **§ 3 Fernmeldegeheimnis**: Inhalte/Umstände der Kommunikation nur soweit nötig verarbeiten;
  Spamfilterung mit Einwilligung bzw. Ablehnung beim Empfang; Löschen zugestellter Mail ohne Einwilligung kann
  strafbar sein (§ 206 StGB).
- **DSGVO**: Datenschutzerklärung (Mail-Teil), Verzeichnis der Verarbeitungstätigkeiten, TOMs, Löschkonzept
  (Logs, Backups 12 Monate), **AV-Vertrag mit Hetzner** (Server + Object Storage), Betroffenenrechte, DPIA prüfen.
- **Impressum** (DDG § 5) auf `fale.network` – bereits vorhanden, Mail-Dienst ergänzen; Kontakt `hallo@`.
- **RFC 2142**: `abuse@`, `postmaster@`, `hostmaster@`, `security@` sind eingerichtet (Postfach `postmaster`).
- **Nutzungsbedingungen + Acceptable-Use-Policy** (kein Spam, Sperrrecht, Limits), Kündigung/Datenexport.
- **BFSG** (Barrierefreiheit für elektronische Kommunikationsdienste seit 28.06.2025): Ausnahme für
  Kleinstunternehmen prüfen; Web-Oberflächen trotzdem barrierearm bauen.

## 8. Kosten (netto, Monat)
| Posten | Betrag |
|---|---|
| Hetzner CX33 inkl. IPv4 | 8,99 € |
| Hetzner-Backups (+20 %, optional) | 1,80 € |
| Object Storage für restic (optional) | ca. 5–6 € (Preis bei Buchung prüfen) |
| Domain `fale.network` | vorhanden |
| **Summe** | **≈ 9–17 €** |

## 9. Fahrplan
- **Phase 0 – Server + Transaktionsmails**: Server anlegen, DNS, Kopplung, Port 25 freischalten lassen, Aufwärmen.
  Danach Supabase *Custom SMTP* auf `mail.fale.network:465`, Benutzer `konto@fale.network` (Passwort aus dem
  Kopplungs-Bundle, vom Owner selbst im Supabase-Dashboard eingetragen); `api/_lib/notify.js` bekommt einen
  `smtp`-Provider statt Resend. Resend-DNS-Einträge (`resend._domainkey`, `send`) danach entfernen.
- **Phase 1 – Shop-Aliase (Weiterleitung)**: Provisioning-API + Backend-Kopplung, MaskedEmail-Aliase auf
  Alias-Domain, Weiterleitung an die bestehende Adresse des Nutzers, Abschalten per Klick; Limits für neue Konten.
- **Phase 2 – Volles Postfach in FaLe One**: JMAP-Client (Lesen, Schreiben, Suche, Push), Verschlüsselung ruhender
  Mails mit Client-Schlüssel, App-Passwörter für IMAP-Apps, Quotas, Datenexport.
- **Phase 3 – E2E zwischen FaLe-Nutzern, Scam-Warnungen, Papierkram-Autopilot**: automatische Schlüsselverteilung
  (WKD/Autocrypt) für E2E zwischen FaLe-Nutzern, Betrugs-/Phishing-Hinweise (Absender-Reputation, Lookalike-Domains,
  „Mom and Dad Covered“-Modus), Rechnungen/Briefe erkennen und in FaLe Drive ablegen – Auswertung im Client.

## 10. Aktualisieren und Prüfen
- Neue Stalwart-Version: Hashes von der Release-Seite in `mail/config/versions.json` eintragen →
  `node mail/tools/build.mjs` → committen. Der Agent aktualisiert beim nächsten Lauf (ohne Downgrade, mit Rollback).
- Konfig ändern: `mail/config/stalwart.ndjson` bearbeiten (Format: `stalwart-cli apply`, NDJSON) →
  `node mail/tools/build.mjs` → committen.
- Tests: `node --test 'mail/test/*.test.mjs' && python3 -m unittest discover -s mail/test` (laufen auch im Workflow).
- Notfall-Zugriff (ohne SSH, Root ist gesperrt): Hetzner-Konsole → Server → *Rescue* aktivieren → Neustart →
  *Konsole* (Web-VNC) mit dem dort angezeigten Rescue-Passwort; Daten liegen unter `/var/lib/stalwart`.

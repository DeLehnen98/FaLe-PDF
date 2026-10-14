# Sicherheit / Security

## Sicherheitslücke melden

Bitte melde Sicherheitslücken **nicht** über öffentliche Issues. Nutze stattdessen die private Meldung
über GitHub: **Security → Report a vulnerability** in diesem Repository
(`https://github.com/DeLehnen98/FaLe-PDF/security/advisories/new`).

Hilfreich sind: betroffene Version / URL, Schritte zum Nachstellen, erwartete und tatsächliche Wirkung
und, falls vorhanden, eine Beispieldatei (PDF, DOCX …). Wir bestätigen den Eingang in der Regel
innerhalb von 7 Tagen und melden uns mit einer Einschätzung und einem Zeitplan für die Behebung.
Bitte gib uns bis zur Veröffentlichung einer Korrektur angemessen Zeit (in der Regel 90 Tage).

Im Rahmen: die Web-App (`fale-pdf.vercel.app`), die Android-App, die Serverfunktionen unter `api/`
und die Datenbank-Migrationen unter `supabase/`. Nicht im Rahmen: Denial-of-Service durch reine
Last, Social Engineering, Angriffe, die ein bereits entsperrtes, gerootetes Gerät voraussetzen.

Bitte teste nur mit eigenen Konten und eigenen Daten und greife nicht auf Daten anderer zu.

## Reporting a vulnerability (English)

Please do **not** open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** (`/security/advisories/new`). Include the affected version/URL,
reproduction steps and impact. We aim to acknowledge within 7 days and ask for coordinated disclosure
(typically 90 days). Only test against your own accounts and data.

## Weitere Dokumente / More

- Bedrohungsmodell und Schutzmaßnahmen / threat model: [`docs/SECURITY.md`](docs/SECURITY.md)
- Sicherheits-Audit / audit report: [`docs/SECURITY-AUDIT-2026-10.md`](docs/SECURITY-AUDIT-2026-10.md)
- `/.well-known/security.txt` (RFC 9116)

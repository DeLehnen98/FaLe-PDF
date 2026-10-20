# „Brief per Post“ – Einrichtung (Schritt für Schritt)

FaLe druckt, kuvertiert und verschickt einen Brief für die Nutzerin – als normalen Brief, **Einschreiben Einwurf**
oder **Einschreiben** (Inland) bzw. als Brief ins Ausland. Gedruckt wird bei **LetterXpress**, bezahlt über
**Stripe Checkout** (Karte, PayPal, Google Pay, Apple Pay – je nachdem, was du im Stripe-Dashboard einschaltest).

Solange LetterXpress und Stripe **nicht** eingerichtet sind, ist in der Produktion nichts davon sichtbar: Die App
fragt den Server, bekommt „nicht eingerichtet“ und blendet „Per Post senden“ aus. Ohne Zugangsdaten läuft
außerhalb der Produktion (Vercel-Preview, lokal) alles im **Testmodus** mit Probe-Druckerei und Probe-Zahlung.

> Warum nicht Google-Play-Abrechnung? Für **physische Waren und Dienstleistungen** (Druck + Porto) *darf* Google
> Play Billing nicht genutzt werden – dafür ist ein externer Zahlungsanbieter wie Stripe vorgesehen.

## 0. So läuft ein Auftrag

```
App: Adresse + Versandart → PDF mit Adressblatt (DIN 5008 B, Fensterkuvert DIN lang)
 └─ POST /api/post?a=create  ─▶ Server prüft Seiten/Größe/Preis, legt den Auftrag an (PDF nur bis zur Übergabe gespeichert)
                                └─ Stripe Checkout-Sitzung ─▶ Nutzerin bezahlt im Browser
 Stripe-Webhook (oder die Statusabfrage der App) ─▶ Server holt die Zahlung SELBST bei Stripe ab (nie dem Webhook-Inhalt trauen)
                                └─ PDF an LetterXpress (POST /v3/printjobs) → PDF wird bei uns sofort gelöscht
 Statusabfrage ─▶ LetterXpress-Status + Sendungsnummer (Einschreiben) → „Verschickt“, „Sendung verfolgen“
 Übergabe scheitert ─▶ automatische Rückerstattung über Stripe
```

Unbezahlte Aufträge werden nach 24 Stunden gelöscht, die Auftragsdaten **ohne Briefinhalt** nach 180 Tagen.

## 1. Preise

Endpreise inkl. 19 % MwSt. (Standard, in `api/_lib/postal.js` → `DEFAULT_PRICES`):

| | Preis |
|---|---|
| Brief Inland (bis 3 Blatt inkl. Adressblatt) | 1,99 € |
| Einschreiben Einwurf | 4,99 € |
| Einschreiben (gegen Unterschrift) | 5,49 € |
| Brief ins Ausland | 2,99 € |
| jedes weitere Blatt | + 0,10 € |
| farbig | + 0,50 € |

* **Schutz vor Verlust:** Vor jedem Auftrag fragt der Server bei LetterXpress den echten Preis ab
  (`GET /v3/price`). Liegt unser Preis nicht mindestens bei *Kosten × 1,19 + Stripe-Gebühr (1,5 % + 0,25 €) +
  Mindestmarge* (Standard 0,40 €), wird er automatisch angehoben (auf …9 Cent gerundet). Die App zeigt dann
  „Neuer Preis“ und fragt nach.
* Eigene Preise: Umgebungsvariable `POST_PRICES` (JSON in Cent), z. B.
  `{"base":219,"r1":300,"r2":350,"intlBase":329,"perSheet":10,"color":50,"includedSheets":3}`.
* Prüfe die Preise einmal mit deinem LetterXpress-Tarif (Kundenkonto → Preise) und passe sie an.

## 2. LetterXpress-Konto (machst du selbst)

1. Geschäftskonto anlegen: <https://www.letterxpress.de> → Registrieren (als Unternehmen / Gewerbe).
2. **Auftragsverarbeitungsvertrag (AVV)** im Kundenkonto abschließen (Datenschutz, Art. 28 DSGVO).
3. Guthaben aufladen (LetterXpress rechnet über Guthaben ab).
4. Im Kundenkonto unter **API** den API-Schlüssel erzeugen und den **Benutzernamen** notieren.
5. **Testmodus** von LetterXpress zuerst nutzen (`LXP_MODE=test`) – Aufträge werden angenommen, aber nicht gedruckt.
6. ⚠️ **Adressfenster prüfen:** Das Adressblatt setzt die Anschrift nach DIN 5008 Form B (Fenster 20 mm von links,
   45 mm von oben). Ich konnte die genaue Fensterposition von LetterXpress nicht online bestätigen. Schicke im
   Testmodus einen Brief und prüfe die Vorschau im Kundenkonto – oder frag den Support kurz, ob DIN 5008 B passt.

## 3. Stripe-Konto (machst du selbst)

1. Konto anlegen: <https://dashboard.stripe.com/register> → Unternehmensdaten, Bankkonto, Identität.
2. **Zahlungsmethoden** einschalten: Einstellungen → Zahlungen → Zahlungsmethoden → Karten, **PayPal**,
   **Google Pay**, **Apple Pay** (optional Klarna, SEPA-Lastschrift). Die App nutzt Stripe Checkout, das alle
   eingeschalteten Methoden automatisch anbietet.
3. **Geheimen Schlüssel** kopieren: Entwickler → API-Schlüssel → „Geheimer Schlüssel“ (`sk_test_…` zum Testen,
   später `sk_live_…`). Besser: einen **eingeschränkten Schlüssel** (`rk_…`) mit nur diesen Rechten anlegen:
   *Checkout Sessions: Schreiben*, *Events: Lesen*, *Refunds: Schreiben*, *Payment Intents: Lesen*.
4. **Webhook** anlegen: Entwickler → Webhooks → Endpunkt hinzufügen
   * URL: `https://pdf.fale.network/api/post?a=webhook` (deine App-Domain)
   * Ereignisse: `checkout.session.completed` und `checkout.session.async_payment_succeeded`
   * Ein Webhook-Signaturgeheimnis brauchst du **nicht**: Der Server holt jedes Ereignis mit deinem Schlüssel
     noch einmal direkt bei Stripe ab und vertraut dem gesendeten Inhalt nie.
   * Auch ohne Webhook funktioniert es (die App fragt den Status ab), der Webhook macht es nur schneller und
     sicher, falls die App nach dem Bezahlen geschlossen wird.
5. Belege: Einstellungen → Kunden-E-Mails → „Erfolgreiche Zahlungen“ einschalten (Stripe schickt die Quittung).

## 4. Datenbank-Migration (Supabase) – erledigt

`supabase/migrations/20261020200000_fale_post.sql` (Tabelle `post_jobs`, RPCs `fale_post_*`, Aufräumfunktion) wurde
beim Push automatisch vom GitHub-Workflow „DB migrate“ angewendet („1 neue Migration(en) angewendet“). Nichts zu tun.

## 5. Vercel-Umgebungsvariablen (trägst du selbst ein)

Vercel → Projekt → Settings → Environment Variables (Production, optional Preview):

| Variable | Wert |
|---|---|
| `LXP_USER` | dein LetterXpress-Benutzername |
| `LXP_APIKEY` | dein LetterXpress-API-Schlüssel (**geheim**) |
| `LXP_MODE` | `test` zum Ausprobieren, danach `live` |
| `STRIPE_SECRET_KEY` | `sk_test_…` / `rk_test_…`, später `sk_live_…` / `rk_live_…` (**geheim**) |
| `POST_PRICES` | optional, siehe Abschnitt 1 |
| `POST_MIN_MARGIN_CENTS` | optional, Mindestgewinn pro Brief in Cent (Standard 40) |
| `POST_MAX_PAGES` | optional, max. Blatt inkl. Adressblatt (Standard 10) |
| `POST_ENABLED` | optional `false` = Notschalter, schaltet den Briefversand sofort ab |

Nach dem Speichern **neu deployen** (Deployments → Redeploy).

## 6. Testen vor dem Start

1. `LXP_MODE=test` + Stripe-Testschlüssel: In der App einen Brief schreiben → „Per Post senden“ → Testkarte
   `4242 4242 4242 4242`, beliebiges künftiges Datum, beliebige Prüfziffer.
2. App zeigt „Bezahlt – wird übergeben“ → „In der Druckerei“. Im LetterXpress-Kundenkonto erscheint der
   Testauftrag – **Adressfenster in der Vorschau prüfen** (Abschnitt 2.6).
3. Abbruch testen: Auftrag anlegen, nicht bezahlen → „Abbrechen“.
4. Danach `LXP_MODE=live` und Stripe-Live-Schlüssel setzen, redeployen, **einen echten Brief an dich selbst**
   schicken (normal + Einschreiben Einwurf) und Zustellung + Sendungsverfolgung prüfen.

## 7. Rechtliches (bitte prüfen lassen)

* **Datenschutzerklärung:** Abschnitt 11 „Briefe per Post verschicken“ ist ergänzt – die gelb markierten
  Platzhalter (Firmenname/Anschrift von LetterXpress laut AVV, Stripe-Gesellschaft laut Vertrag) ausfüllen.
* **AGB / Leistungsbeschreibung** für den Briefversand (Preis, Leistung, Laufzeit, Haftung für Postlaufzeiten,
  keine Rechtsberatung). Noch nicht erstellt – bitte von einem Anwalt oder einem AGB-Generator (z. B. Händlerbund,
  IT-Recht Kanzlei) erstellen lassen.
* **Widerrufsrecht:** Bei Dienstleistungen, die sofort nach Bezahlung vollständig erbracht werden, kann das
  Widerrufsrecht erlöschen, wenn die Verbraucherin vorher ausdrücklich zustimmt (§ 356 Abs. 4 BGB). Lass klären,
  ob dafür vor dem Bezahlen ein Häkchen nötig ist – ich baue es dann ein.
* **Umsatzsteuer / Gewerbe:** Einnahmen sind gewerblich; Rechnungen/Belege kommen über Stripe. Mit deinem
  Steuerberater klären (Kleinunternehmer ja/nein – die Preise sind als Brutto mit 19 % kalkuliert).
* **Schriftform:** Briefe, die eine Unterschrift mit Stift brauchen (z. B. Kündigung Wohnung/Arbeitsvertrag),
  bietet die App bewusst **nicht** zum Versand an und erklärt, warum.

## 8. Notfall

* Briefversand sofort abschalten: `POST_ENABLED=false` setzen und redeployen.
* Zahlung ohne Versand: Die App erstattet automatisch, wenn LetterXpress den Auftrag ablehnt. Sonst in Stripe →
  Zahlungen → Erstatten. Die Auftragsnummer steht in den Metadaten der Zahlung (`job`).

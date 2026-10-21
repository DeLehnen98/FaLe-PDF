# Marktrecherche FaLe PDF – Oktober 2026

Stand: 21.10.2026 · Volles Dokument (inkl. LeafChecker): https://claude.ai/artifact/FSJi23CnKJo7V3Rt2yPB4B

**Kernaussage:** Text bearbeiten, Umwandeln, Stapelverarbeitung und KI kosten bei allen großen Anbietern Geld. Wirklich gratis und ohne Limits ist nur PDF24, und das online nur mit Upload auf deren Server. FaLe PDF positioniert sich deshalb so: **alles gratis, ohne Konto, ohne Wasserzeichen, Verarbeitung auf dem Gerät.**

## Konkurrenz

| Anbieter | Gratis | Kostet Geld | Preis |
| --- | --- | --- | --- |
| [Adobe Acrobat Reader](https://adapty.io/paywall-library/adobe-acrobat-reader-edit-pdf/) | Ansehen, Kommentieren, Ausfüllen, Unterschreiben | Text bearbeiten, Umwandeln, KI | Mobil 12,99 $/Monat oder 69,99 $/Jahr |
| [Xodo](https://www.capterra.com/p/210439/Xodo/pricing/) | Mobile App, im Web mit Tageslimits | Stapelverarbeitung, KI | Pro ab 9,99 $/Monat |
| [PDFelement](https://aiproductivity.ai/pricing/wondershare-pdfelement/) | Nur 14 Tage Test | Alles | 79,99 $/Jahr |
| [Foxit](https://dupple.com/pricing/foxit) | Nur 14 Tage Test | Alles | 129,99 $/Jahr |
| [iLovePDF / Smallpdf](https://www.codaone.ai/compare/ilovepdf-vs-smallpdf) | Wenige Aufgaben pro Tag, Upload auf deren Server | Unbegrenzt | 7–12 $/Monat |
| [PDF24](https://tools.pdf24.org/en/faq) | Alles, mit Werbung; Desktop-Version offline | – | 0 € |
| [WPS Office](https://uk.trustpilot.com/review/wps.com?page=9) | Mit Werbung | Pro | Trustpilot 1,6 von 5 |

## Was Nutzer hassen → was wir anders machen

1. **Paywall für einfache Dinge.** Zitat zu Acrobat: „Falsely advertised as free! I just wanted to edit a document“ ([Reviews](https://grand-screen.com/apps/adobe-acrobat-reader-edit-pdf/reviews/)). → Bearbeiten, Zusammenfügen und Komprimieren sind bei uns gratis.
2. **Abo-Fallen.** WPS hat doppelt abgebucht, Smallpdf nach dem Test ohne klaren Hinweis ([Trustpilot](https://ca.trustpilot.com/review/smallpdf.com)). → Klar gekennzeichnetes, optionales Abo; Kündigen mit einem Tipp.
3. **Werbung und Popups**, bei WPS sogar für zahlende Nutzer. → Werbung nur freiwillig als Belohnungsvideo.
4. **Wasserzeichen und Limits** („Upgrade to remove“, 10 MB, 2 Aufgaben pro Tag). → Keine Wasserzeichen, keine Limits.
5. **Datenschutz:** Verträge und Arztbriefe landen auf fremden Servern. → Dateien verlassen das Gerät nicht.
6. **Aufgebläht, unnötige KI, Update-Zwang** ([Adobe Community](https://community.adobe.com/questions-9/bloated-inefficient-product-cancelling-subscription-1300380)). → Schlank bleiben; KI nur auf Wunsch.
7. **Anmeldezwang und komplizierte Oberfläche.** → Kein Konto nötig; Bedienung so einfach, dass jeder sie versteht.

## Meistgewünschte Funktionen

- Zusammenfügen, Teilen, Komprimieren, Drehen, Sortieren – ohne Wasserzeichen, ohne Konto, offline
- Text bearbeiten und nach Word umwandeln (bei Adobe und Xodo kostenpflichtig)
- Ausfüllen, Unterschreiben, Markieren; Scannen mit der Kamera, Texterkennung (OCR), Dunkelmodus, Tempo bei großen Dateien

## Bausteine und Lizenzen

Der aktuelle Stand in `vendor/` (pdfjs, pdf-lib, tesseract, jszip, docx) passt zu dieser Liste. Eine AGPL-Abhängigkeit wurde nicht gefunden.

| Baustein | Wofür | Lizenz |
| --- | --- | --- |
| [pdf.js](https://github.com/mozilla/pdf.js) | Anzeigen | Apache-2.0 ✔ |
| [PDFium](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE) | Natives Anzeigen auf Android und Windows | BSD-3 / Apache-2.0 ✔ |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Zusammenfügen, Formulare, Unterschrift als Bild | MIT ✔ – kann vorhandenen Seitentext **nicht** bearbeiten |
| [qpdf](https://github.com/qpdf/qpdf) | Zusammenfügen, Teilen, Verschlüsseln | Apache-2.0 ✔ |
| [tesseract.js](https://github.com/naptha/tesseract.js) | Texterkennung im Browser | Apache-2.0 ✔ |
| [ML Kit Document Scanner](https://developers.google.com/ml-kit/vision/doc-scanner) | Scannen auf Android ohne Kamera-Berechtigung | Google SDK – Kosten prüfen |
| MuPDF / PyMuPDF | – | **AGPL – meiden**, sonst müsste die ganze App offengelegt werden |
| [Stirling-PDF](https://fossies.org/linux/Stirling-PDF/LICENSE) | Code zum Lesen und Lernen | Kern unter MIT, `proprietary`-Ordner **nicht** übernehmen |

**Brief per Post:** [Pingen](https://www.pingen.com/de/preise/) kostet für 1 Seite nach Deutschland ca. 1,34 $ in Schwarz-Weiß inkl. Porto, API ohne Grundgebühr. [LetterXpress](https://letterxpress.de/briefe-uebertragen/api) bietet eine REST-API mit Guthaben. Für die USA gibt es [Lob](https://lob.com/pricing), ab 0,83 $ pro Brief.

## To-dos

- [ ] Werbeversprechen: „Gratis, kein Konto, kein Wasserzeichen, deine Dateien verlassen das Handy nicht“
- [ ] Echtes Text-Bearbeiten als eigenes Thema planen (pdf-lib kann es nicht; pdf.js als Referenz durchlesen)
- [ ] Brief per Post: Pingen-Sandbox testen, Endpreis mit Aufschlag kalkulieren
- [ ] Prüfen, ob ML Kit kostenlos ist; Store-Bewertungen von Xodo und WPS nachschauen
- [ ] REA-Check vor jedem Release (siehe unten)

## REA-Check (auf dem Laptop mit Claude Code + REA)

- „Verlässt eine geöffnete PDF jemals das Gerät? Gibt es Analytics- oder Crash-SDKs, die Dateinamen oder Inhalte senden?“
- „Steckt im fertigen Build irgendwo eine AGPL-Bibliothek?“
- „Finde hart codierte API-Keys oder Server-URLs, die man aus der APK ziehen könnte.“

## Rechtsrahmen (kein Rechtsrat)

- **Erlaubt:** Programme beobachten, untersuchen und testen, um ihre Ideen zu verstehen ([§ 69d Abs. 3 UrhG](https://www.gesetze-im-internet.de/urhg/__69d.html)).
- **Dekompilieren** ist nur für Interoperabilität erlaubt, nicht für ein „im Wesentlichen ähnliches Programm“ ([§ 69e UrhG](https://www.gesetze-im-internet.de/urhg/__69e.html)). Acrobat zu dekompilieren, um es nachzubauen, ist damit nicht gedeckt.
- **Verboten:** fremden Code, Texte und Assets übernehmen.

# E-Rechnung prüfen

`./setup.sh` lädt die offiziellen Prüfwerkzeuge nach `vendor/` (nicht eingecheckt):
EN-16931-Schematron (CEN), XRechnung-Schematron (KoSIT), Saxon-HE und Mustang (ZUGFeRD + PDF/A-3 über veraPDF).

- `python3 validate.py rechnung.xml [--xrechnung]` – Geschäftsregeln (EN 16931, optional XRechnung 3.0)
- `java XsdValidate.java <schema.xsd> rechnung.xml` – Schema (CII: `vendor/en16931/cii/schema/…/CrossIndustryInvoice_100pD16B.xsd`)
- `java -jar vendor/mustang-cli.jar --action validate --source rechnung.pdf` – ZUGFeRD-PDF komplett (PDF/A-3 + XML)

`webtools/test_new_einvoice.py` nutzt alle drei für die Rechnungen aus „Rechnung schreiben“.

// Formular-Lotse: offline glossary of common form terms (German authority and contract forms, plus the English
// words for the same personal data). A field's label is matched here first – instantly and without internet –
// and explained in plain words. The German term and explanation are shown through the app's translation layer
// (js/i18n), so people see them in their own language; only labels nobody knows go to the cloud AI, and only
// when the person asks for it.
//
//   lookup('Geb.-Datum')  → { id: 'geburtsdatum', term: 'Geburtsdatum', explain: '…', kind: 'date', lang: 'de' }
//
// kind tells the wizard how to ask: name | date | place | zip | id | number | money | iban | mail | phone |
// free (words that may need translating into the form's language) | text | choice | sign.

/** Labels/names → plain lowercase words (ä → ae, ß → ss, punctuation → spaces, camelCase split). */
export function norm(s) {
  return String(s || '')
    .replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
/** Numbering in front of a label („1.2 Name“, „a) Name“) is not part of the meaning. */
const unnumber = t => String(t || '').replace(/^\s*(?:(?:\d+(?:\.\d+)*[.)]?|[a-hA-H][).]|[ivxIVX]+[.)])\s*)+(?=\S)/, '');

// [id, German pattern, English pattern | null, term, explanation, kind, example]
// Order matters: more specific entries first („Ort, Datum“ before „Ort“, „Geburtsname“ before „Name“).
const G = [
  // ---- signature and date
  ['ortdatum', /\bort\b.*\bdatum\b|\bdatum\b.*\bort\b/, /place.*\bdate\b|\bdate\b.*place/, 'Ort, Datum', 'Der Ort, an dem du unterschreibst, und das heutige Datum.', 'placedate', ''],
  ['unterschrift_vertreter', /unterschrift.*(erziehungsberecht|sorgeberecht|gesetzl|vertret|eltern|vormund|betreu)/, /signature.*(parent|guardian|representative)/, 'Unterschrift der Eltern oder des Vertreters', 'Hier unterschreibt, wer für die Person handeln darf – bei Kindern zum Beispiel die Eltern.', 'sign', ''],
  ['unterschrift', /unterschrift|unterzeichn/, /signature|\bsigned\b|\bsign here\b/, 'Unterschrift', 'Hier unterschreibst du mit deinem Namen – am Ende mit dem Finger oder einer gespeicherten Unterschrift.', 'sign', ''],
  ['antragsdatum', /antragsdatum|datum der antragstellung|antrag vom/, /date of application|application date/, 'Antragsdatum', 'Der Tag, an dem du den Antrag stellst – meistens heute.', 'date', ''],
  ['einreisedatum', /einreisedatum|einreise am|datum der einreise|eingereist am/, /date of entry|entry date/, 'Einreisedatum', 'Der Tag, an dem du nach Deutschland gekommen bist.', 'date', ''],
  ['einzugsdatum', /einzugsdatum|einzug am|zuzugsdatum|tag des einzugs|eingezogen am|datum des einzugs/, /move in date|moving date|date of moving/, 'Einzugsdatum', 'Der Tag, an dem du in die Wohnung eingezogen bist.', 'date', ''],
  ['auszugsdatum', /auszugsdatum|auszug am|tag des auszugs|datum des auszugs/, /move out date/, 'Auszugsdatum', 'Der Tag, an dem du aus der Wohnung ausgezogen bist.', 'date', ''],
  ['beschaeftigt_seit', /beschaeftigt seit|beschaeftigungsbeginn|eintrittsdatum|taetig seit/, /employed since|employment start/, 'Beschäftigt seit', 'Seit wann du dort arbeitest.', 'date', ''],
  ['ausstellungsdatum', /ausstellungsdatum|ausgestellt am/, /date of issue|issue date|issued on/, 'Ausstellungsdatum', 'Der Tag, an dem das Dokument ausgestellt wurde. Er steht auf dem Dokument.', 'date', ''],
  ['gueltig_bis', /gueltig bis|ablaufdatum|gueltigkeitsdatum/, /expiry|expiration|valid until|valid thru/, 'Gültig bis', 'Bis zu diesem Tag gilt das Dokument. Er steht auf dem Dokument.', 'date', ''],
  ['geburtsdatum', /geburtsdatum|geburtstag|geboren am|geb datum|gebdatum|^geb am$/, /date of birth|birth ?date|\bdob\b/, 'Geburtsdatum', 'Der Tag, an dem du geboren bist.', 'date', '12.03.1961'],
  ['zeitraum_von', /^(von|ab|ab dem|beginn|zeitraum von|gueltig ab|beginn am)$/, /^(from|start date|starting)$/, 'Von / Beginn', 'Ab welchem Tag es gelten soll.', 'date', ''],
  ['zeitraum_bis', /^(bis|bis zum|ende|zeitraum bis|ende am)$/, /^(to|until|end date)$/, 'Bis / Ende', 'Bis zu welchem Tag es gelten soll.', 'date', ''],
  ['datum', /^(datum|datum heute|heutiges datum|tagesdatum)$/, /^(date|today s date|todays date)$/, 'Datum', 'Das heutige Datum.', 'date', ''],

  // ---- person
  ['geburtsname', /geburtsname|geb name|maedchenname|familienname bei geburt/, /birth ?name|maiden name|name at birth/, 'Geburtsname', 'Dein Familienname bei der Geburt – wichtig, wenn er sich zum Beispiel durch Heirat geändert hat.', 'name', ''],
  ['geburtsort', /geburtsort|geboren in/, /place of birth|birth ?place|city of birth/, 'Geburtsort', 'Die Stadt oder der Ort, in dem du geboren bist.', 'place', ''],
  ['geburtsland', /geburtsland|geburtsstaat/, /country of birth/, 'Geburtsland', 'Das Land, in dem du geboren bist.', 'free', ''],
  ['name', /^(name|ihr name|name des antragstellers|name der antragstellerin|vor und (nach|zu|familien)name|name vorname|nachname vorname|familienname vorname|vollstaendiger name)$/, /^(name|full name|your name)$/, 'Name', 'Dein Name, so wie er im Ausweis steht. Gibt es ein eigenes Feld für den Vornamen, gehört hier nur der Familienname hin.', 'name', ''],
  ['vorname', /vorname|rufname/, /first ?name|given ?names?|forename/, 'Vorname', 'Dein Vorname. Hast du mehrere, schreib alle so, wie sie im Ausweis stehen.', 'name', ''],
  ['nachname', /nachname|familienname|zuname/, /last ?name|surname|family ?name/, 'Familienname', 'Dein Nachname, so wie er im Ausweis steht.', 'name', ''],
  ['kontoinhaber', /kontoinhaber/, /account holder|account name/, 'Kontoinhaber', 'Der Name der Person, der das Bankkonto gehört.', 'name', ''],
  ['antragsteller', /antragsteller|antragstellende person/, /applicant/, 'Antragsteller', 'Das bist du – die Person, die den Antrag stellt.', 'name', ''],
  ['geschlecht', /geschlecht/, /\bsex\b|gender/, 'Geschlecht', 'Männlich, weiblich oder divers – so wie es in deinen Papieren steht.', 'choice', ''],
  ['maennlich', /^(maennlich|mann|m)$/, /^male$/, 'männlich', 'Für Männer und Jungen.', 'choice', ''],
  ['weiblich', /^(weiblich|frau|w)$/, /^female$/, 'weiblich', 'Für Frauen und Mädchen.', 'choice', ''],
  ['divers', /^(divers|d)$/, /^(diverse|non binary|other)$/, 'divers', 'Wenn in deinen Papieren weder männlich noch weiblich steht.', 'choice', ''],
  ['staatsangehoerigkeit', /staatsangehoerigkeit|staatsbuergerschaft|nationalitaet/, /nationality|citizenship/, 'Staatsangehörigkeit', 'Das Land, dessen Pass du hast. Hast du mehrere, gib alle an.', 'free', ''],
  ['familienstand', /familienstand/, /marital status|civil status/, 'Familienstand', 'Ob du ledig, verheiratet, geschieden oder verwitwet bist.', 'choice', ''],
  ['ledig', /^ledig$/, /^(single|never married)$/, 'ledig', 'Du warst noch nie verheiratet.', 'choice', ''],
  ['verheiratet', /^verheiratet$/, /^married$/, 'verheiratet', 'Du bist verheiratet.', 'choice', ''],
  ['geschieden', /^geschieden$/, /^divorced$/, 'geschieden', 'Deine Ehe wurde vor Gericht beendet.', 'choice', ''],
  ['verwitwet', /^verwitwet$/, /^widowed$/, 'verwitwet', 'Dein Ehepartner ist gestorben.', 'choice', ''],
  ['getrennt', /getrennt lebend|dauernd getrennt/, /^separated$/, 'getrennt lebend', 'Ihr seid noch verheiratet, wohnt aber nicht mehr zusammen.', 'choice', ''],
  ['lebenspartnerschaft', /lebenspartnerschaft/, /civil partnership|registered partnership/, 'eingetragene Lebenspartnerschaft', 'Eine offiziell eingetragene Partnerschaft, wie sie es vor 2017 für gleichgeschlechtliche Paare gab.', 'choice', ''],
  ['titel', /akademischer grad|doktorgrad|^titel$/, /^title$|academic degree/, 'Titel', 'Nur ein akademischer Titel wie „Dr.“ – sonst leer lassen.', 'text', ''],
  ['anrede', /^anrede$/, /^salutation$/, 'Anrede', 'Wie man dich anspricht, zum Beispiel „Herr“ oder „Frau“.', 'choice', ''],
  ['religion', /religion|konfession|bekenntnis/, /religion|denomination/, 'Religion', 'Deine Religionsgemeinschaft, zum Beispiel „ev.“ oder „rk.“ – oder „keine“. Wichtig für die Kirchensteuer.', 'free', ''],
  ['muttersprache', /muttersprache|erstsprache/, /native language|mother tongue|first language/, 'Muttersprache', 'Die Sprache, die du als Kind zuerst gelernt hast.', 'free', ''],
  ['alter', /^alter$|^alter in jahren$/, /^age$/, 'Alter', 'Wie alt du bist, in Jahren.', 'number', ''],
  ['koerpergroesse', /koerpergroesse|groesse in cm/, /^height$/, 'Körpergröße', 'Wie groß du bist, in Zentimetern.', 'number', '172'],
  ['augenfarbe', /augenfarbe/, /eye colou?r/, 'Augenfarbe', 'Die Farbe deiner Augen, zum Beispiel blau oder braun.', 'free', ''],

  // ---- documents
  ['ausweisnr', /personalausweis ?(nr|nummer)|ausweis ?(nr|nummer)|ausweisnummer|dokumentennummer/, /id (card )?(no|number)|identity card number|document number/, 'Ausweisnummer', 'Die Nummer auf deinem Ausweis (Buchstaben und Ziffern, auf der Vorderseite oben rechts).', 'id', ''],
  ['passnr', /reisepass ?(nr|nummer)|pass ?(nr|nummer)|passnummer/, /passport (no|number)/, 'Passnummer', 'Die Nummer deines Reisepasses. Sie steht auf der Seite mit dem Foto.', 'id', ''],
  ['aufenthaltstitel', /aufenthaltstitel|aufenthaltserlaubnis|aufenthaltsstatus|niederlassungserlaubnis/, /residence permit|residence title|residence status/, 'Aufenthaltstitel', 'Die Erlaubnis, in Deutschland zu leben (Karte oder Aufkleber im Pass) – mit ihrer Art und Nummer.', 'free', ''],
  ['behoerde_ausstellend', /ausstellende behoerde|ausgestellt (von|durch)/, /issuing authority|issued by/, 'Ausstellende Behörde', 'Das Amt, das dein Dokument ausgestellt hat. Es steht auf dem Dokument.', 'free', ''],

  // ---- address
  ['bisherige_anschrift', /bisherige (anschrift|wohnung|adresse)|fruehere (anschrift|adresse|wohnung)|alte (anschrift|adresse)|letzte anschrift/, /previous address|former address/, 'Bisherige Anschrift', 'Die Adresse, an der du vor dem Umzug gewohnt hast.', 'place', ''],
  ['plzort', /\bplz\b.*\bort\b|postleitzahl.*\b(ort|wohnort)\b|plz ?wohnort/, /(zip|postcode|postal code).*(city|town)/, 'PLZ und Ort', 'Die Postleitzahl und dein Wohnort.', 'place', '10115 Berlin'],
  ['strassenr', /strasse.*(nr|hausnummer)|strasse und hausnummer/, /street.*(no|number)|address line 1/, 'Straße und Hausnummer', 'Deine Straße mit Hausnummer.', 'place', 'Hauptstraße 12'],
  ['plz', /\bplz\b|postleitzahl/, /\bzip\b|postcode|postal code/, 'Postleitzahl (PLZ)', 'Die Zahl vor dem Ortsnamen – in Deutschland fünf Ziffern.', 'zip', '10115'],
  ['hausnr', /hausnummer|haus ?nr|\bhnr\b/, /house number|building number/, 'Hausnummer', 'Die Nummer deines Hauses, auch mit Buchstaben wie „12a“.', 'id', ''],
  ['strasse', /strasse|\bstr\b/, /\bstreet\b/, 'Straße', 'Die Straße, in der du wohnst.', 'place', ''],
  ['adresszusatz', /adresszusatz|anschriftenzusatz|^zusatz$|\bc o\b/, /address line 2|care of/, 'Adresszusatz', 'Nur wenn nötig: zum Beispiel „bei Müller“ oder „Hinterhaus“, damit die Post ankommt.', 'place', ''],
  ['postfach', /postfach/, /p ?o ?box/, 'Postfach', 'Nur wenn du ein Postfach hast – sonst leer lassen.', 'id', ''],
  ['hauptwohnsitz', /hauptwohnsitz|hauptwohnung/, /main residence|primary residence/, 'Hauptwohnsitz', 'Die Wohnung, in der du die meiste Zeit lebst.', 'place', ''],
  ['nebenwohnsitz', /nebenwohnsitz|nebenwohnung|zweitwohnsitz/, /second(ary)? residence/, 'Nebenwohnsitz', 'Eine weitere Wohnung, zum Beispiel am Arbeitsort.', 'place', ''],
  ['wohnungsgeber', /wohnungsgeber|vermieter/, /landlord/, 'Vermieter / Wohnungsgeber', 'Die Person oder Firma, von der du die Wohnung hast. Sie bestätigt deinen Einzug.', 'name', ''],
  ['anschrift', /^(anschrift|adresse|wohnanschrift|meldeanschrift|wohnadresse|postanschrift)$|vollstaendige anschrift|aktuelle anschrift|jetzige anschrift/, /^(address|home address|current address|postal address)$/, 'Anschrift', 'Deine Adresse: Straße, Hausnummer, Postleitzahl und Ort.', 'place', ''],
  ['bundesland', /bundesland/, null, 'Bundesland', 'Dein Bundesland, zum Beispiel „Bayern“ oder „Saarland“.', 'place', ''],
  ['ort', /^(ort|wohnort|stadt|gemeinde|wohnsitz)$/, /^(city|town)$/, 'Ort', 'Die Stadt oder Gemeinde, in der du wohnst.', 'place', ''],
  ['land', /^(land|staat|wohnland|wohnsitzstaat)$/, /^(country|country of residence)$/, 'Land', 'Das Land, in dem du wohnst.', 'free', ''],

  // ---- contact
  ['mobil', /mobil|handy/, /mobile|cell ?phone/, 'Handynummer', 'Deine Handynummer.', 'phone', ''],
  ['telefon', /telefon|\btel\b|rufnummer|festnetz/, /phone|telephone/, 'Telefonnummer', 'Eine Nummer, unter der man dich tagsüber erreicht.', 'phone', ''],
  ['email', /\be ?mail|email/, /\be ?mail|email/, 'E-Mail-Adresse', 'Deine E-Mail-Adresse mit @.', 'mail', 'name@beispiel.de'],
  ['fax', /\bfax\b|telefax|faxnummer|fax ?nr/, /\bfax\b/, 'Faxnummer', 'Nur wenn du ein Faxgerät hast – sonst leer lassen.', 'phone', ''],

  // ---- money
  ['iban', /\biban\b/, /\biban\b/, 'IBAN (Kontonummer)', 'Deine Kontonummer. In Deutschland beginnt sie mit DE und hat 22 Zeichen. Sie steht auf der Bankkarte oder im Online-Banking.', 'iban', ''],
  ['bic', /\bbic\b|swift/, /\bbic\b|swift/, 'BIC', 'Der Code deiner Bank (8 oder 11 Zeichen). Bei deutschen Konten oft nicht nötig.', 'id', ''],
  ['kontonummer', /kontonummer|konto ?nr/, /account (no|number)/, 'Kontonummer', 'Heute ist damit meistens die IBAN gemeint (beginnt mit DE).', 'iban', ''],
  ['bankleitzahl', /bankleitzahl|\bblz\b/, /sort code|routing number/, 'Bankleitzahl', 'Die alte 8-stellige Nummer der Bank. Heute steckt sie in der IBAN.', 'id', ''],
  ['bank', /kreditinstitut|geldinstitut|name der bank|^bank$|bankverbindung|bankname/, /^bank$|bank name/, 'Bank', 'Der Name deiner Bank, zum Beispiel „Sparkasse Saarbrücken“.', 'text', ''],
  ['kaltmiete', /kaltmiete|grundmiete|nettokaltmiete/, /base rent|net rent/, 'Kaltmiete', 'Die Miete ohne Heizung und ohne Nebenkosten.', 'money', ''],
  ['warmmiete', /warmmiete|gesamtmiete|bruttowarmmiete/, /total rent/, 'Warmmiete', 'Die ganze Miete mit Heizung und Nebenkosten.', 'money', ''],
  ['nebenkosten', /nebenkosten|betriebskosten/, /utilities|service charges/, 'Nebenkosten', 'Kosten zusätzlich zur Miete, zum Beispiel für Wasser, Müll oder Hausmeister.', 'money', ''],
  ['heizkosten', /heizkosten/, /heating costs?/, 'Heizkosten', 'Was du für die Heizung bezahlst.', 'money', ''],
  ['miete', /^miete|miethoehe/, /^rent\b/, 'Miete', 'Was du jeden Monat für die Wohnung bezahlst.', 'money', ''],
  ['brutto', /brutto/, /\bgross\b/, 'Brutto', 'Der Betrag vor Abzug von Steuern und Sozialabgaben.', 'money', ''],
  ['netto', /netto/, /\bnet\b/, 'Netto', 'Der Betrag, der nach allen Abzügen wirklich ausgezahlt wird.', 'money', ''],
  ['einkommen', /einkommen|einkuenfte|verdienst|\blohn\b|gehalt/, /income|salary|wages?\b/, 'Einkommen', 'Das Geld, das du bekommst, zum Beispiel Lohn, Rente oder Unterhalt – meistens pro Monat.', 'money', ''],
  ['vermoegen', /vermoegen|ersparnisse|sparguthaben/, /\bassets\b|savings/, 'Vermögen', 'Was du besitzt: Erspartes, Wertpapiere, Auto oder Grundstücke.', 'money', ''],
  ['kindergeld', /kindergeld/, /child benefit/, 'Kindergeld', 'Geld vom Staat für Kinder. Es kommt von der Familienkasse.', 'money', ''],
  ['elterngeld', /elterngeld/, /parental (allowance|benefit)/, 'Elterngeld', 'Geld für Eltern in der ersten Zeit nach der Geburt eines Kindes.', 'money', ''],
  ['unterhalt', /unterhalt/, /alimony|maintenance|child support/, 'Unterhalt', 'Geld, das ein Elternteil oder früherer Partner regelmäßig zahlt oder bekommt.', 'money', ''],
  ['buergergeld', /buergergeld|arbeitslosengeld ii|\balg ii\b|grundsicherung|sozialhilfe/, /welfare|social assistance/, 'Bürgergeld / Grundsicherung', 'Geld vom Jobcenter oder Sozialamt zum Leben, wenn das eigene Geld nicht reicht.', 'money', ''],
  ['arbeitslosengeld', /arbeitslosengeld|\balg\b/, /unemployment benefit/, 'Arbeitslosengeld', 'Geld von der Agentur für Arbeit, wenn du deine Arbeit verloren hast.', 'money', ''],
  ['wohngeld', /wohngeld/, /housing benefit/, 'Wohngeld', 'Ein Zuschuss vom Staat zur Miete.', 'money', ''],
  ['rente', /\brente\b|altersrente|\bpension\b/, /pension|retirement/, 'Rente', 'Geld, das du im Alter oder bei Erwerbsminderung bekommst.', 'money', ''],
  ['betrag', /^betrag|betrag in euro|^summe$|^gesamtbetrag$|geldbetrag/, /^amount|^sum$|^total$/, 'Geldbetrag', 'Eine Geldsumme in Euro.', 'money', '120,50'],

  // ---- numbers from letters and cards
  ['steuerid', /steuer ?id|identifikationsnummer|steuerliche identifikation|\bidnr\b/, /tax id|taxpayer identification/, 'Steuer-ID', 'Deine persönliche 11-stellige Nummer vom Finanzamt. Sie steht auf dem Steuerbescheid oder der Lohnabrechnung.', 'id', ''],
  ['steuernummer', /steuernummer|steuer ?nr/, /tax (no|number)/, 'Steuernummer', 'Die Nummer, unter der dich dein Finanzamt führt. Sie steht auf dem Steuerbescheid.', 'id', ''],
  ['versichertennr', /versichertennummer|krankenversichertennummer|versicherten ?nr/, /insurance (no|number)|member(ship)? id/, 'Versichertennummer', 'Deine Nummer bei der Krankenkasse. Sie steht auf deiner Gesundheitskarte und beginnt mit einem Buchstaben.', 'id', ''],
  ['svnr', /sozialversicherungsnummer|rentenversicherungsnummer|versicherungsnummer|sv ?nummer|rv ?nummer/, /social security number|national insurance/, 'Sozialversicherungsnummer', 'Deine Rentenversicherungsnummer (12 Zeichen). Sie steht auf dem Sozialversicherungsausweis.', 'id', ''],
  ['krankenkasse', /krankenkasse|krankenversicherung/, /health insurance/, 'Krankenkasse', 'Wo du krankenversichert bist, zum Beispiel „AOK“ oder „TK“.', 'text', ''],
  ['kundennummer', /kundennummer|kunden ?nr/, /customer (no|number|id)/, 'Kundennummer', 'Deine Nummer bei dieser Firma. Sie steht auf Briefen oder Rechnungen von ihr.', 'id', ''],
  ['bgnummer', /bg ?nummer|nummer der bedarfsgemeinschaft|bedarfsgemeinschaftsnummer/, null, 'BG-Nummer', 'Die Nummer deiner Bedarfsgemeinschaft beim Jobcenter. Sie steht im Bescheid.', 'id', ''],
  ['kassenzeichen', /kassenzeichen/, null, 'Kassenzeichen', 'Die Nummer für deine Zahlung an das Amt. Sie steht im Bescheid – bei Überweisungen immer angeben.', 'id', ''],
  ['aktenzeichen', /aktenzeichen|geschaeftszeichen|\baz\b|\bgz\b|unser zeichen|ihr zeichen/, /reference (no|number)|file number|case number/, 'Aktenzeichen', 'Die Nummer deines Vorgangs beim Amt. Sie steht oben in Briefen vom Amt.', 'id', ''],
  ['vertragsnummer', /vertragsnummer|vertrags ?nr|policen ?nummer|versicherungsschein ?nummer/, /contract (no|number)|policy (no|number)/, 'Vertragsnummer', 'Die Nummer deines Vertrags. Sie steht im Vertrag oder auf Rechnungen.', 'id', ''],
  ['rechnungsnummer', /rechnungsnummer|rechnungs ?nr/, /invoice (no|number)/, 'Rechnungsnummer', 'Die Nummer, die oben auf der Rechnung steht.', 'id', ''],
  ['mitgliedsnummer', /mitglieds ?(nummer|nr)/, /membership (no|number)/, 'Mitgliedsnummer', 'Deine Nummer als Mitglied, zum Beispiel im Verein.', 'id', ''],
  ['zaehlernummer', /zaehlernummer|zaehler ?nr/, /meter (no|number)/, 'Zählernummer', 'Die Nummer auf deinem Strom-, Gas- oder Wasserzähler.', 'id', ''],
  ['zaehlerstand', /zaehlerstand/, /meter reading/, 'Zählerstand', 'Die Zahl, die dein Zähler gerade anzeigt.', 'number', ''],
  ['kennzeichen', /kfz kennzeichen|amtliches kennzeichen|^kennzeichen$/, /licen[cs]e plate|registration (no|number)/, 'Kfz-Kennzeichen', 'Das Nummernschild deines Autos.', 'id', ''],

  // ---- work and education
  ['arbeitgeber', /arbeitgeber|beschaeftigungsstelle|^firma$|^unternehmen$|^betrieb$/, /employer|^company$/, 'Arbeitgeber', 'Die Firma oder Person, bei der du arbeitest.', 'text', ''],
  ['ausbildung', /berufsausbildung|ausbildung|studium|berufsabschluss/, /vocational training|apprenticeship|\bdegree\b/, 'Ausbildung', 'Was du gelernt oder studiert hast.', 'free', ''],
  ['beruf', /beruf|taetigkeit|berufsbezeichnung/, /occupation|profession|job title/, 'Beruf / Tätigkeit', 'Deine Arbeit, zum Beispiel „Verkäuferin“ oder „Rentner“.', 'free', ''],
  ['arbeitszeit', /arbeitszeit|wochenstunden|stunden pro woche|stunden woechentlich/, /hours per week|working hours/, 'Arbeitszeit', 'Wie viele Stunden du pro Woche arbeitest.', 'number', ''],
  ['selbststaendig', /selbststaendig|freiberuflich|gewerbetreibend/, /self ?employed|freelance/, 'Selbstständig', 'Du arbeitest auf eigene Rechnung und bist nicht angestellt.', 'choice', ''],
  ['schulabschluss', /schulabschluss|schulbildung/, /school leaving|education level/, 'Schulabschluss', 'Dein höchster Schulabschluss, zum Beispiel „Hauptschulabschluss“ oder „Abitur“.', 'free', ''],

  // ---- family and representatives
  ['ehepartner', /ehepartner|ehegatte|ehefrau|ehemann/, /spouse|husband|\bwife\b/, 'Ehepartner', 'Die Person, mit der du verheiratet bist.', 'name', ''],
  ['partner', /lebenspartner|lebensgefaehrt|\bpartner(in)?\b/, /\bpartner\b/, 'Partner', 'Die Person, mit der du in einer festen Beziehung zusammenlebst.', 'name', ''],
  ['kinder_anzahl', /anzahl (der )?kinder|kinderzahl/, /number of children/, 'Anzahl der Kinder', 'Wie viele Kinder du hast – oder wie viele bei dir leben, je nach Frage.', 'number', ''],
  ['haushalt', /haushaltsangehoerige|haushaltsmitglieder|personen im haushalt|im haushalt lebende/, /household members/, 'Personen im Haushalt', 'Alle, die mit dir in der Wohnung leben und zusammen wirtschaften.', 'free', ''],
  ['bedarfsgemeinschaft', /bedarfsgemeinschaft/, null, 'Bedarfsgemeinschaft', 'Alle Personen, die zusammen wohnen und füreinander einstehen, zum Beispiel Partner und Kinder.', 'free', ''],
  ['erziehungsberechtigt', /erziehungsberechtigt|sorgeberechtigt|^eltern$/, /parents?\b|guardian/, 'Erziehungsberechtigte', 'Die Eltern oder die Person, die für das Kind sorgen darf.', 'name', ''],
  ['gesetzlicher_vertreter', /gesetzliche[rn]? vertret|\bbetreuer|vormund/, /legal representative/, 'Gesetzlicher Vertreter', 'Wer rechtlich für eine Person handeln darf, zum Beispiel Eltern oder ein Betreuer.', 'name', ''],
  ['bevollmaechtigt', /bevollmaechtigt|vollmacht/, /authori[sz]ed representative|power of attorney/, 'Bevollmächtigte Person', 'Jemand, dem du erlaubst, für dich zu handeln – mit schriftlicher Vollmacht.', 'name', ''],

  // ---- the application itself
  ['begruendung', /begruendung|grund des antrags|^grund$|^anlass$/, /^reason|purpose of/, 'Begründung', 'Warum du das beantragst – in ein paar einfachen Sätzen.', 'free', ''],
  ['zweck', /verwendungszweck|^zweck$/, /payment reference|^purpose$/, 'Verwendungszweck', 'Wofür etwas gedacht ist. Bei Überweisungen ist es der Text für den Empfänger.', 'free', ''],
  ['bemerkungen', /bemerkung|anmerkung|^sonstiges$|ergaenzende angaben|zusaetzliche angaben|^hinweise?$/, /remarks|comments|^notes$|additional information/, 'Bemerkungen', 'Platz für alles, was du zusätzlich sagen möchtest. Darf leer bleiben.', 'free', ''],
  ['anlagen', /^anlagen?$|beigefuegt|nachweise/, /attachments|enclosures|supporting documents/, 'Anlagen', 'Papiere, die du mitschickst, zum Beispiel Kopien vom Ausweis oder Gehaltsnachweise.', 'free', ''],
  ['einwilligung', /einwilligung|einverstanden|zustimmung|datenschutz/, /\bconsent\b|i agree/, 'Einwilligung', 'Mit dem Kreuz sagst du, dass du einverstanden bist. Lies vorher, womit.', 'choice', ''],
  ['erklaerung', /versichere|wahrheitsgemaess|richtigkeit der angaben|nach bestem wissen|erklaerung zur richtigkeit/, /truthful|true and correct|declare that/, 'Erklärung zur Richtigkeit', 'Du bestätigst, dass alle Angaben stimmen. Falsche Angaben können Folgen haben.', 'choice', ''],
  ['zutreffendes', /zutreffendes ankreuzen|bitte ankreuzen/, /tick (as )?appropriate|check all that apply/, 'Zutreffendes ankreuzen', 'Mach ein Kreuz bei allem, was für dich stimmt.', 'choice', ''],
  ['ja', /^ja$/, /^yes$/, 'ja', 'Ankreuzen, wenn es zutrifft.', 'choice', ''],
  ['nein', /^nein$/, /^no$/, 'nein', 'Ankreuzen, wenn es nicht zutrifft.', 'choice', ''],
  ['behoerde', /^behoerde$|zustaendige stelle|dienststelle|^amt$/, /^(authority|agency)$/, 'Behörde', 'Das Amt, an das der Antrag geht.', 'text', ''],
  ['sachbearbeiter', /sachbearbeiter|ansprechpartner/, /case worker|contact person/, 'Sachbearbeiter', 'Die Person beim Amt, die deinen Fall bearbeitet.', 'name', ''],
];

export const ENTRIES = G.map(([id, de, en, term, explain, kind, ex]) => ({ id, de, en, term, explain, kind, ex }));
const BY_ID = new Map(ENTRIES.map(e => [e.id, e]));
export const entry = id => BY_ID.get(id) || null;

const QUAL = /\b(des|der|vom|von der|fuer das|fuer den|fuer die) (kindes|kinder|kinds|ehepartners|ehegatten|ehefrau|ehemannes|partners|partnerin|lebenspartners|lebenspartnerin|mutter|vaters|eltern|vertreters|vertreterin|bevollmaechtigten|verstorbenen|kontoinhabers|antragstellers|antragstellerin|person)\b|\b(of|of the|of your) (child|spouse|partner|mother|father|parent|guardian|applicant|deceased)\b|\b(child|spouse|partner|mother|father|parent|guardian) s\b|\b(kind|ehepartner|ehegatte|partner|partnerin|mutter|vater) ?\d?$/;

/**
 * The glossary entry for a label (or field name).
 * @returns {{id, term, explain, kind, ex, lang: 'de'|'en'|null}|null}  lang null = both languages match
 */
export function lookup(label) {
  const t = norm(unnumber(label));
  if (!t || t.length > 90) return null;
  for (const e of ENTRIES) {
    const de = e.de.test(t), en = !!e.en && e.en.test(t);
    if (de || en) {
      // „Vorname des Kindes“: the explanation speaks to the person („Dein …“) – here someone else is meant
      const other = /^(dein|deine|du|das bist du)\b/i.test(e.explain) && e.kind !== 'sign' && QUAL.test(t);
      return { id: e.id, term: e.term, explain: e.explain, kind: e.kind, ex: e.ex, lang: de && en ? null : de ? 'de' : 'en', other };
    }
  }
  return null;
}

/** Generic names like „Text1“, „Textfeld 12“, „f1_03[0]“, „topmostSubform[0].Page1[0].TextField1[0]“ carry no meaning. */
export function isGeneric(name) {
  const last = String(name || '').split('.').pop().replace(/\[\d+\]/g, '');
  const t = norm(last).replace(/^(txt|tf|cb|chk|rb|dd|cmb|fld|fd)(?=\s|$)\s*/, '');
  if (!t) return true;
  if (/^(text|textfeld|textfield|textbox|feld|field|untitled|form|fill|eingabe|eingabefeld|checkbox|kontrollkaestchen|kontrollfeld|optionsfeld|optionsschaltflaeche|radio|radiobutton|button|schaltflaeche|kombinationsfeld|combobox|dropdown|listbox|listenfeld|liste|auswahl|choice|group|gruppe|unterschrift|signature|sig)\d*$/.test(t.replace(/\s+/g, ''))) return true;
  if (/^[a-z]{0,3}\s*\d+(\s*\d+)*$/.test(t)) return true; // f1 03, p2 17, 12
  return !/[a-z]{3}/.test(t);
}

/** A readable form of a field name („txtGeburtsDatum“ → „Geburts Datum“) – '' for generic names. */
export function prettyName(name) {
  if (isGeneric(name)) return '';
  const last = String(name).split('.').pop().replace(/\[\d+\]/g, '').replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2').replace(/[_]+/g, ' ').trim();
  return last.replace(/^(txt|tf|cb|chk|rb|dd|cmb|fld)\s+/i, '');
}

/** Does this kind of answer get translated into the form's language? (Names, numbers, dates and addresses never.) */
export const translatable = kind => kind === 'free' || !kind;

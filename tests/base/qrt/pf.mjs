import { matchProfile } from '/home/claude/FalePDF/js/tools/profilefill.js';
const p = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg', hausnummer: '5', plz: '66111', ort: 'Saarbrücken', land: 'Deutschland', email: 'max@example.de', telefon: '0681 1', geburtsdatum: '01.02.1990', geburtsort: 'Trier', firma: 'FaLe', steuernummer: '12/345' };
const names = ['Vorname', 'Nachname', 'Straße', 'PLZ / Ort', 'E-Mail', 'Telefon', 'Datum', 'Ort, Datum', 'Name', 'Text1', 'Geburtsdatum', 'Geburtsort', 'Hausnr.', 'Land', 'Bundesland', 'Firma', 'Steuer-ID', 'Anschrift', 'Wohnort', 'Postleitzahl', 'Unterschrift', 'Ich stimme zu'];
for (const n of names) console.log(n.padEnd(14), JSON.stringify(matchProfile(n, '', p, names)));

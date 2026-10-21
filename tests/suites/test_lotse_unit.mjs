// Formular-Lotse – pure parts: glossary (js/forms/glossary.js), labels next to fields, grouping of check boxes,
// date formats (js/forms/fields.js). Run: node tests/suites/test_lotse_unit.mjs
import { lookup, isGeneric, prettyName, translatable, ENTRIES, norm } from '../../js/forms/glossary.js';
import { nearbyLabel, groupChecks, formatDate, todayIn } from '../../js/forms/fields.js';

let ok = 0, bad = 0;
const check = (name, cond, info = '') => { if (cond) ok++; else bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || !info ? '' : `  [${String(info).slice(0, 300)}]`)); };

// ---- glossary: real labels from German and English forms
const CASES = [
  ['Familienname', 'nachname'], ['Name, Vorname', 'name'], ['Familienname, Vorname', 'name'], ['Vorname(n)', 'vorname'], ['Rufname', 'vorname'],
  ['Geb.-Datum', 'geburtsdatum'], ['Geburtsdatum (TT.MM.JJJJ)', 'geburtsdatum'], ['geboren am', 'geburtsdatum'], ['Date of birth', 'geburtsdatum'],
  ['Geburtsort', 'geburtsort'], ['Geburtsname', 'geburtsname'], ['Staatsangehörigkeit(en)', 'staatsangehoerigkeit'], ['Nationality', 'staatsangehoerigkeit'],
  ['Straße und Hausnummer', 'strassenr'], ['Straße, Nr.', 'strassenr'], ['Str.', 'strasse'], ['PLZ / Ort', 'plzort'], ['Postleitzahl', 'plz'], ['Wohnort', 'ort'],
  ['Bisherige Anschrift', 'bisherige_anschrift'], ['Anschrift', 'anschrift'], ['Telefon (mobil)', 'mobil'], ['Tel.', 'telefon'], ['E-Mail', 'email'], ['Faxnummer', 'fax'],
  ['IBAN', 'iban'], ['BIC', 'bic'], ['Kontoinhaber/in', 'kontoinhaber'], ['Kreditinstitut', 'bank'], ['Steuerliche Identifikationsnummer', 'steuerid'], ['Steuer-ID', 'steuerid'],
  ['Steuernummer', 'steuernummer'], ['Rentenversicherungsnummer', 'svnr'], ['Krankenversichertennummer', 'versichertennr'], ['Krankenkasse', 'krankenkasse'],
  ['Kassenzeichen', 'kassenzeichen'], ['BG-Nummer', 'bgnummer'], ['Aktenzeichen', 'aktenzeichen'], ['Kundennummer', 'kundennummer'],
  ['Familienstand', 'familienstand'], ['ledig', 'ledig'], ['verheiratet', 'verheiratet'], ['geschieden', 'geschieden'], ['verwitwet', 'verwitwet'], ['dauernd getrennt lebend', 'getrennt'],
  ['Geschlecht', 'geschlecht'], ['männlich', 'maennlich'], ['weiblich', 'weiblich'], ['divers', 'divers'],
  ['Ort, Datum', 'ortdatum'], ['Datum, Ort', 'ortdatum'], ['Datum', 'datum'], ['Unterschrift', 'unterschrift'], ['Unterschrift des Antragstellers', 'unterschrift'],
  ['Unterschrift der/des Erziehungsberechtigten', 'unterschrift_vertreter'], ['Signature', 'unterschrift'],
  ['Kaltmiete', 'kaltmiete'], ['Nebenkosten', 'nebenkosten'], ['Rente', 'rente'], ['Miete', 'miete'], ['Bruttoeinkommen', 'brutto'], ['Nettoeinkommen', 'netto'],
  ['Arbeitgeber', 'arbeitgeber'], ['Beruf', 'beruf'], ['Berufsausbildung', 'ausbildung'], ['Ausgeübte Tätigkeit', 'beruf'],
  ['Begründung', 'begruendung'], ['Bemerkungen', 'bemerkungen'], ['Einzugsdatum', 'einzugsdatum'], ['Wohnungsgeber', 'wohnungsgeber'],
  ['Ich versichere, dass alle Angaben richtig sind', 'erklaerung'], ['Ich bin mit der Verarbeitung meiner Daten einverstanden', 'einwilligung'],
  ['1.2 Familienname', 'nachname'], ['a) Vorname', 'vorname'], ['IV. Bemerkungen', 'bemerkungen'], ['Betrag in Euro', 'betrag'], ['Faxnummer', 'fax'],
  ['ja', 'ja'], ['nein', 'nein'], ['Yes', 'ja'], ['Passport number', 'passnr'], ['Aufenthaltstitel', 'aufenthaltstitel'], ['Kfz-Kennzeichen', 'kennzeichen'],
];
const wrong = CASES.filter(([l, id]) => { const r = lookup(l); return !r || r.id !== id; }).map(([l, id]) => `${l} → ${(lookup(l) || {}).id} (want ${id})`);
check(`glossary: ${CASES.length} real labels map to the right entry`, !wrong.length, wrong.join('; '));
check('glossary: unknown labels stay unknown (→ AI on request)', ['Mietstufe der Gemeinde', 'Höhe der Zuwendung', 'Text1', ''].every(l => !lookup(l)));
check('glossary: „Versicherer“ is not the declaration of truth', !lookup('Versicherer') && !lookup('Name des Versicherers') && lookup('Ich versichere die Richtigkeit meiner Angaben').id === 'erklaerung');
check('glossary: language of the label', lookup('Geburtsdatum').lang === 'de' && lookup('Date of birth').lang === 'en' && lookup('IBAN').lang === null);
check('glossary: „… des Kindes“ is marked as someone else', lookup('Vorname des Kindes').other === true && lookup("Child's first name").other === true && !lookup('Vorname').other && !lookup('Unterschrift des Kindes').other);
check('glossary: every entry has a term, an explanation and a kind', ENTRIES.every(e => e.term && e.explain && e.kind && e.de instanceof RegExp));
check('glossary: ids are unique', new Set(ENTRIES.map(e => e.id)).size === ENTRIES.length);
const selfMiss = ENTRIES.filter(e => !['zeitraum_von', 'zeitraum_bis'].includes(e.id)).filter(e => { const r = lookup(e.term); return !r || r.id !== e.id; }).map(e => `${e.term} → ${(lookup(e.term) || {}).id}`);
check('glossary: each term finds its own entry (no entry hides another)', !selfMiss.length, selfMiss.join('; '));
check('glossary: explanations are short (≤ 160 characters, one idea)', ENTRIES.every(e => e.explain.length <= 160), ENTRIES.filter(e => e.explain.length > 160).map(e => e.id).join(', '));
check('glossary: norm()', norm('Geb.-Datum') === 'geb datum' && norm('txtGeburtsDatum') === 'txt geburts datum' && norm('Straße') === 'strasse');
check('glossary: very long labels are not matched (sentences)', !lookup('Name '.repeat(30)));

// ---- generic names
check('generic names carry no meaning', ['Text1', 'Textfeld 12', 'f1_03[0]', 'topmostSubform[0].Page1[0].TextField1[0]', 'Check Box12', 'Kontrollkästchen 3', 'Group1', 'Kombinationsfeld2', 'Radio Button 3', '12'].every(isGeneric));
check('meaningful names are kept', !isGeneric('Vorname') && !isGeneric('geburtsdatum') && !isGeneric('txtGeburtsDatum') && prettyName('txtGeburtsDatum') === 'Geburts Datum' && prettyName('Text7') === '');
check('translatable: free text yes, names/numbers/dates no', translatable('free') && translatable(null) && !translatable('name') && !translatable('date') && !translatable('id') && !translatable('text'));

// ---- labels next to fields (viewport coordinates, y down)
const it = (str, x, y, size = 10) => ({ str, x, x1: x + str.length * size * 0.5, y, top: y - size, size });
const items = [
  it('Familienname:', 50, 106), it('Geburtsdatum', 200, 145, 8), it('Hinweis', 400, 300),
  it('Familienstand:', 50, 206), it('ledig', 218, 206), it('verheiratet', 303, 206), it('Begründung', 50, 260), it('des', 108, 260), it('Antrags:', 126, 260),
  it('Name', 202, 340, 7),
];
const field = { x: 200, y: 92, w: 300, h: 20 };
check('label: text left of the field', nearbyLabel(items, field, 'left') === 'Familienname', nearbyLabel(items, field, 'left'));
check('label: text above the field (words joined)', nearbyLabel(items, { x: 50, y: 266, w: 450, h: 58 }, 'above') === 'Begründung des Antrags', nearbyLabel(items, { x: 50, y: 266, w: 450, h: 58 }, 'above'));
check('label: small caption inside the box', nearbyLabel(items, { x: 200, y: 330, w: 250, h: 30 }, 'inside') === 'Name', nearbyLabel(items, { x: 200, y: 330, w: 250, h: 30 }, 'inside'));
check('label: right of a box, stops at the next box', nearbyLabel(items, { x: 200, y: 196, w: 13, h: 13 }, 'right', { stopX: 285 }) === 'ledig');
check('label: nothing far away', nearbyLabel(items, { x: 600, y: 600, w: 50, h: 20 }, 'left') === '' && nearbyLabel([], field, 'left') === '');
check('label: exclusions are skipped', nearbyLabel(items, { x: 200, y: 196, w: 13, h: 13 }, 'left', { exclude: new Set(['Familienstand:']) }) === '');

// ---- check boxes in a row → one question
const box = (name, x, y, lab, extra = {}) => ({ id: name, type: 'check', names: [name], page: 1, rect: { x, y, w: 13, h: 13 }, optLabel: lab, gloss: lookup(lab), value: false, required: false, rule: { required: false }, ...extra });
const qs = [
  { id: 'T1', type: 'text', names: ['T1'], page: 1, rect: field },
  box('C1', 200, 196, 'ledig'), box('C2', 285, 196, 'verheiratet', { value: true }), box('C3', 370, 196, 'geschieden'),
  box('C9', 50, 400, 'Ich versichere, dass alle Angaben richtig sind und ich keine weiteren Einkünfte habe.'),
  box('D1', 200, 500, 'ja'), box('D2', 200, 520, 'nein'),
];
const g = groupChecks(qs, () => items);
const fam = g.find(q => q.type === 'checks' && q.names.includes('C1'));
check('groups: a row of boxes becomes one question with its label', fam && fam.names.join() === 'C1,C2,C3' && fam.label === 'Familienstand' && fam.gloss && fam.gloss.id === 'familienstand', fam && JSON.stringify({ n: fam.names, l: fam.label }));
check('groups: ticked boxes are the answer', fam && fam.value.join() === 'C2' && fam.initial.join() === 'C2');
check('groups: a long consent sentence stays its own yes/no question', g.some(q => q.id === 'C9' && q.type === 'check'));
check('groups: boxes in a column form a group too', g.some(q => q.type === 'checks' && q.names.join() === 'D1,D2'));
check('groups: other fields stay in order', g[0].id === 'T1' && g.length === 4, g.map(q => q.id).join());

// ---- dates
check('date: short forms become the form\'s format', formatDate('12.3.61') === '12.03.1961' && formatDate('1961-03-12') === '12.03.1961' && formatDate('3/12/1961', 'mm/dd/yyyy') === '03/12/1961' && formatDate('12.03.1961', 'yyyy-mm-dd') === '1961-03-12');
check('date: impossible dates and words are not changed', formatDate('31.02.2020') === null && formatDate('morgen') === null && formatDate('12.3.1961', 'mmm d, yyyy') === null);
check('date: today', /^\d{2}\.\d{2}\.\d{4}$/.test(todayIn()) && todayIn() === formatDate(new Date().toLocaleDateString('sv-SE')));

console.log(`\n${ok}/${ok + bad} passed`);
process.exit(bad ? 1 : 0);

// Matching form fields to the user's profile ("Aus meinem Profil"). Pure helpers.
// Profile keys: vorname, nachname, strasse, hausnummer, plz, ort, land, email, telefon,
// geburtsdatum, geburtsort, firma, steuernummer (all optional strings).

const norm = s => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const v = (p, k) => {
  const s = p && typeof p[k] === 'string' ? p[k].trim() : '';
  // dates from <input type=date> are stored as YYYY-MM-DD → German format
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};
const join = (...parts) => parts.filter(Boolean).join(' ').trim();
const today = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Rules in priority order: [test(normalised text), label, value(profile, ctx)].
 * ctx.hasSeparate(key) tells whether the form has its own field for that part.
 */
const RULES = [
  [t => /^(datum|date|heute|datum heute)$/.test(t), 'Datum (heute)', () => today()],
  [t => /\bort\b.*\bdatum\b|\bdatum\b.*\bort\b|ortdatum/.test(t), 'Ort, Datum', p => (v(p, 'ort') ? `${v(p, 'ort')}, ${today()}` : '')],
  [t => /geburtsdatum|geburtstag|geb datum|gebdatum|date of birth|birth ?date|\bdob\b|geboren am/.test(t), 'Geburtsdatum', p => v(p, 'geburtsdatum')],
  [t => /geburtsort|place of birth|birth ?place|geboren in/.test(t), 'Geburtsort', p => v(p, 'geburtsort')],
  [t => /steuer ?(nummer|nr|id|identifikations)|tax ?(id|number)|steuerid/.test(t), 'Steuernummer', p => v(p, 'steuernummer')],
  [t => /e ?mail|email|mail adresse/.test(t), 'E-Mail', p => v(p, 'email')],
  [t => /telefon|\btel\b|phone|handy|mobil|rufnummer/.test(t), 'Telefon', p => v(p, 'telefon')],
  [t => /\bplz\b.*\bort\b|postleitzahl.*ort|plz ?ort|zip.*city/.test(t), 'PLZ und Ort', p => join(v(p, 'plz'), v(p, 'ort'))],
  [t => /\bplz\b|postleitzahl|\bzip\b|postal ?code|postcode/.test(t), 'PLZ', p => v(p, 'plz')],
  [t => /strasse.*(nr|hausnummer)|street.*number/.test(t), 'Straße und Hausnummer', p => join(v(p, 'strasse'), v(p, 'hausnummer'))],
  [t => /hausnummer|haus ?nr|^nr$|\bhnr\b|house ?number/.test(t), 'Hausnummer', p => v(p, 'hausnummer')],
  [t => /strasse|\bstr\b|street/.test(t), 'Straße', (p, ctx) => (ctx.hasSeparate('hausnummer') ? v(p, 'strasse') : join(v(p, 'strasse'), v(p, 'hausnummer')))],
  [t => /^(adresse|anschrift|address|wohnanschrift)$|vollstaendige anschrift/.test(t), 'Anschrift', p => [join(v(p, 'strasse'), v(p, 'hausnummer')), join(v(p, 'plz'), v(p, 'ort'))].filter(Boolean).join(', ')],
  [t => /bundesland/.test(t), null, () => ''],
  [t => /\bland\b|country|staat(?!sang)/.test(t), 'Land', p => v(p, 'land')],
  [t => /wohnort|\bort\b|\bstadt\b|\bcity\b|gemeinde/.test(t), 'Ort', p => v(p, 'ort')],
  [t => /firma|unternehmen|company|arbeitgeber|organisation|organization|betrieb/.test(t), 'Firma', p => v(p, 'firma')],
  [t => /vorname|first ?name|given ?name|rufname/.test(t), 'Vorname', p => v(p, 'vorname')],
  [t => /nachname|familienname|last ?name|surname|zuname/.test(t), 'Nachname', p => v(p, 'nachname')],
  // „Name“ next to its own „Vorname“ field means the family name (usual on German forms)
  [t => /^name$/.test(t), 'Name', (p, ctx) => (ctx.hasSeparate('vorname') ? v(p, 'nachname') : join(v(p, 'vorname'), v(p, 'nachname')))],
  [t => /^(ihr name|vollstaendiger name|full name|antragsteller(in)?|unterzeichner(in)?|name des antragstellers|kontoinhaber(in)?)$|^vor und nachname$/.test(t), 'Name', p => join(v(p, 'vorname'), v(p, 'nachname'))],
  [t => /^name vorname$|^nachname vorname$|^familienname vorname$/.test(t), 'Name, Vorname', p => [v(p, 'nachname'), v(p, 'vorname')].filter(Boolean).join(', ')],
];

const SEP_TESTS = {
  hausnummer: t => /hausnummer|haus ?nr|^nr$|\bhnr\b/.test(t),
  vorname: t => /^vorname$|^vorname[n]? \d*$|first ?name|given ?name|rufname/.test(t),
};

/**
 * Find the profile value for a field.
 * @param {string} name   field name
 * @param {string} label  tooltip / alternate name (optional)
 * @param {object} profile
 * @param {string[]} allNames  all field names of the form (to detect separate parts)
 * @returns {{label: string, value: string}|null}
 */
export function matchProfile(name, label, profile, allNames = []) {
  if (!profile) return null;
  const ctx = { hasSeparate: k => allNames.some(n => SEP_TESTS[k] && SEP_TESTS[k](norm(n))) };
  for (const text of [norm(label), norm(name)]) {
    if (!text) continue;
    // generic names like "Text1" carry no meaning
    if (/^(text|textfeld|feld|field|untitled)\s*\d*$/.test(text)) continue;
    for (const [test, lab, val] of RULES) {
      if (!test(text)) continue;
      if (!lab) return null;
      const value = val(profile, ctx);
      return value ? { label: lab, value } : null;
    }
  }
  return null;
}

/** Profile values for free-text placement (menu entries). */
export function profileMenuItems(p) {
  const items = [
    ['Name', join(v(p, 'vorname'), v(p, 'nachname'))],
    ['Firma', v(p, 'firma')],
    ['Straße', join(v(p, 'strasse'), v(p, 'hausnummer'))],
    ['PLZ und Ort', join(v(p, 'plz'), v(p, 'ort'))],
    ['Anschrift', [join(v(p, 'strasse'), v(p, 'hausnummer')), join(v(p, 'plz'), v(p, 'ort'))].filter(Boolean).join(', ')],
    ['Land', v(p, 'land')],
    ['E-Mail', v(p, 'email')],
    ['Telefon', v(p, 'telefon')],
    ['Geburtsdatum', v(p, 'geburtsdatum')],
    ['Geburtsort', v(p, 'geburtsort')],
    ['Steuernummer', v(p, 'steuernummer')],
    ['Ort, Datum', v(p, 'ort') ? `${v(p, 'ort')}, ${today()}` : ''],
  ];
  return items.filter(([, val]) => val).map(([label, value]) => ({ label, value }));
}

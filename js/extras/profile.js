// Eigene Daten zum automatischen Ausfüllen (Briefe, Formulare, Unterschriften).
// Gespeichert ausschließlich lokal in IndexedDB (settings → 'profile'). Kein Konto, kein Upload.
//
// Contract (used by other modules, e.g. tools/sign.js):
//   export async function getProfile()  → object with the fields below, or null when nothing is filled in
//   export const profileRoute = '#/profil'
import * as db from '../db.js';

export const profileRoute = '#/profil';

export const PROFILE_FIELDS = [
  { id: 'vorname', label: 'Vorname', group: 'person', auto: 'given-name' },
  { id: 'nachname', label: 'Nachname', group: 'person', auto: 'family-name' },
  { id: 'strasse', label: 'Straße', group: 'adresse', auto: 'address-line1' },
  { id: 'hausnummer', label: 'Hausnummer', group: 'adresse', auto: 'off', short: true },
  { id: 'plz', label: 'PLZ', group: 'adresse', auto: 'postal-code', short: true, mode: 'numeric' },
  { id: 'ort', label: 'Ort', group: 'adresse', auto: 'address-level2' },
  { id: 'land', label: 'Land', group: 'adresse', auto: 'country-name', placeholder: 'Deutschland' },
  { id: 'email', label: 'E-Mail', group: 'kontakt', auto: 'email', type: 'email' },
  { id: 'telefon', label: 'Telefon', group: 'kontakt', auto: 'tel', type: 'tel' },
  { id: 'geburtsdatum', label: 'Geburtsdatum', group: 'person', auto: 'bday', type: 'date' },
  { id: 'geburtsort', label: 'Geburtsort', group: 'person', auto: 'off' },
  { id: 'firma', label: 'Firma (optional)', group: 'beruf', auto: 'organization' },
  { id: 'steuernummer', label: 'Steuernummer (optional)', group: 'beruf', auto: 'off' },
  { id: 'ustid', label: 'USt-IdNr. (optional)', group: 'beruf', auto: 'off' },
  { id: 'iban', label: 'IBAN (für Rechnungen, optional)', group: 'beruf', auto: 'off' },
  { id: 'bic', label: 'BIC (optional)', group: 'beruf', auto: 'off' },
  { id: 'bank', label: 'Bank (optional)', group: 'beruf', auto: 'off' },
];

const KEY = 'profile';
let cache;

/** @returns {Promise<object|null>} */
export async function getProfile() {
  if (cache === undefined) {
    try { cache = await db.getSetting(KEY, null); } catch { cache = null; }
  }
  if (!cache || typeof cache !== 'object') return null;
  const out = {};
  let any = false;
  for (const f of PROFILE_FIELDS) {
    const v = cache[f.id] == null ? '' : String(cache[f.id]).trim();
    out[f.id] = v;
    if (v) any = true;
  }
  return any ? out : null;
}

export async function setProfile(values) {
  const clean = {};
  for (const f of PROFILE_FIELDS) clean[f.id] = values && values[f.id] != null ? String(values[f.id]).trim().slice(0, 200) : '';
  clean.updatedAt = Date.now();
  await db.setSetting(KEY, clean);
  cache = clean;
  return clean;
}

export async function clearProfile() {
  await db.setSetting(KEY, null);
  cache = null;
}

// ---- helpers for letters & forms ----
export function fullName(p) { return p ? [p.vorname, p.nachname].filter(Boolean).join(' ') : ''; }
export function streetLine(p) { return p ? [p.strasse, p.hausnummer].filter(Boolean).join(' ') : ''; }
export function cityLine(p) { return p ? [p.plz, p.ort].filter(Boolean).join(' ') : ''; }
/** Address lines (name, street, city, country if not Germany). */
export function addressLines(p, { withCompany = false } = {}) {
  if (!p) return [];
  const lines = [];
  if (withCompany && p.firma) lines.push(p.firma);
  if (fullName(p)) lines.push(fullName(p));
  if (streetLine(p)) lines.push(streetLine(p));
  if (cityLine(p)) lines.push(cityLine(p));
  if (p.land && !/^(deutschland|germany|de)$/i.test(p.land)) lines.push(p.land);
  return lines;
}
export function formatBirthDate(p) {
  if (!p || !p.geburtsdatum) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.geburtsdatum);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : p.geburtsdatum;
}

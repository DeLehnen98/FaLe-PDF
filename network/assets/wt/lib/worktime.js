// Working-time maths for the Arbeitszeitrechner (pure, unit-tested in calc_unit.mjs). All times in minutes.
// German Working Hours Act (ArbZG): § 3 max. 8 h a day (10 h if balanced out), § 4 breaks – more than 6 h of
// work need 30 min, more than 9 h need 45 min, in blocks of at least 15 min –, § 5 at least 11 h rest between
// two working days.

/** "7:30", "07.30", "7,30", "730", "7", "7,5" (half past), "19 Uhr" → minutes after midnight; NaN if unusable. */
export function parseTime(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(/\s*(uhr|h)$/, '');
  if (!t) return NaN;
  let h, m;
  // two digits after ":" "." or "," are minutes (7,30 typed on a phone keypad means 7:30), one digit is a
  // fraction of an hour (7,5 → 7:30)
  let r = /^(\d{1,2})[:.,](\d{2})$/.exec(t);
  if (r) { h = +r[1]; m = +r[2]; }
  else if ((r = /^(\d{1,2})[.,](\d)$/.exec(t))) { h = +r[1]; m = +r[2] * 6; }
  else if ((r = /^(\d{3,4})$/.exec(t))) { h = +r[1].slice(0, -2); m = +r[1].slice(-2); }
  else if ((r = /^(\d{1,2})$/.exec(t))) { h = +r[1]; m = 0; }
  else return NaN;
  if (h === 24 && m === 0) return 1440;
  return h < 24 && m < 60 ? h * 60 + m : NaN;
}

/** Duration "45", "0:45", "1:30", "1,5 h" → minutes (a bare number is minutes); NaN if unusable. */
export function parseDuration(s) {
  const t = String(s ?? '').trim().toLowerCase();
  if (!t) return 0;
  let r = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (r) return +r[2] < 60 ? +r[1] * 60 + +r[2] : NaN;
  if ((r = /^(\d+(?:[.,]\d+)?)\s*(h|std\.?|stunden?)$/.exec(t))) return Math.round(parseFloat(r[1].replace(',', '.')) * 60);
  if ((r = /^(\d+)\s*(min\.?|m)?$/.exec(t))) return +r[1];
  return NaN;
}

/** Minimum break the law requires for `presence` minutes between start and end (§ 4 ArbZG), chosen so that
 *  the remaining working time stays legal: 6:20 at work → 20 min (then 6:00 worked, no break due),
 *  7:00 → 30 min, 9:40 → 40 min (9:00 worked), 10:00 → 45 min. */
export function legalBreak(presence) {
  if (presence <= 360) return 0;
  if (presence <= 390) return presence - 360;
  if (presence <= 570) return 30;
  if (presence <= 585) return presence - 540;
  return 45;
}

/** h:mm (−1:05 for negatives). */
export const hhmm = min => {
  const s = min < 0 ? '−' : '', a = Math.round(Math.abs(min));
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
};
/** Decimal hours rounded to two places ("Industrieminuten"): 7:45 → 7.75. */
export const decimal = min => Math.round((min / 60) * 100) / 100;

/**
 * One day. row: { start, end, pause } as typed. opts.autoBreak: deduct at least the legal break.
 * → { ok, presence, pause, legal, net, overnight, notes: [{ level, de, en }] } (ok false + notes when unusable).
 */
export function dayCalc(row, { autoBreak = true } = {}) {
  const s = parseTime(row.start), e = parseTime(row.end), p = parseDuration(row.pause);
  if (!String(row.start ?? '').trim() && !String(row.end ?? '').trim()) return { ok: false, empty: true, notes: [] };
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, notes: [{ level: 'warn', de: 'Uhrzeit nicht erkannt – z. B. 7:30 eingeben.', en: 'Time not recognised – enter e.g. 7:30.' }] };
  if (!Number.isFinite(p) || p < 0) return { ok: false, notes: [{ level: 'warn', de: 'Pause nicht erkannt – Minuten (30) oder 0:30 eingeben.', en: 'Break not recognised – enter minutes (30) or 0:30.' }] };
  const overnight = e <= s && !(s === e && s === 0);
  const presence = (overnight ? e + 1440 : e) - s;
  if (p >= presence) return { ok: false, notes: [{ level: 'warn', de: 'Die Pause ist so lang wie die ganze Zeit.', en: 'The break is as long as the whole time.' }] };
  const legal = legalBreak(presence);
  const pause = autoBreak ? Math.max(p, legal) : p;
  const net = presence - pause;
  const notes = [];
  if (overnight) notes.push({ level: 'info', de: 'Über Mitternacht gerechnet.', en: 'Counted across midnight.' });
  if (p < legal) {
    notes.push(autoBreak
      ? { level: 'info', de: `Gesetzliche Mindestpause: ${legal} Min. – statt ${p} Min. abgezogen.`, en: `Legal minimum break: ${legal} min – deducted instead of ${p} min.` }
      : { level: 'warn', de: `Zu wenig Pause: Bei ${hhmm(presence - p)} Arbeit sind mindestens ${presence - p > 540 ? 45 : 30} Min. Pause vorgeschrieben.`, en: `Too little break: ${hhmm(presence - p)} of work requires at least ${presence - p > 540 ? 45 : 30} min break (German law).` });
  }
  if (pause > 0 && pause < 15) notes.push({ level: 'info', de: 'Pausen zählen erst ab 15 Minuten am Stück als Ruhepause.', en: 'Breaks only count as rest breaks from 15 minutes in one go.' });
  if (net > 600) notes.push({ level: 'warn', de: 'Mehr als 10 Stunden: Das erlaubt das Arbeitszeitgesetz nur in Ausnahmen.', en: 'More than 10 hours: the German Working Hours Act only allows this in exceptional cases.' });
  else if (net > 480) notes.push({ level: 'info', de: 'Mehr als 8 Stunden: zulässig, wenn es im Schnitt von 6 Monaten bei 8 Stunden bleibt.', en: 'More than 8 hours: allowed if the average over 6 months stays at 8 hours.' });
  return { ok: true, start: s, end: e, presence, pause, legal, net, overnight, notes };
}

/** Rest between two days: end of `a` (date ISO + result) → start of `b`. Minutes, or null. */
export function restBetween(aDate, a, bDate, b) {
  if (!a?.ok || !b?.ok) return null;
  const dayMs = 86400000;
  const gapDays = Math.round((Date.parse(bDate + 'T12:00:00Z') - Date.parse(aDate + 'T12:00:00Z')) / dayMs);
  const aEnd = a.start + a.presence;   // may exceed 1440 (overnight)
  return gapDays * 1440 + b.start - aEnd;
}

/**
 * The whole sheet. rows: [{ date, kind: 'work'|'vacation'|'sick'|'holiday'|'off', start, end, pause }],
 * target: minutes per working day (vacation, sick days and holidays count as target met).
 */
export function sheetCalc(rows, { target = 480, autoBreak = true } = {}) {
  const out = rows.map(r => ({ ...r, res: (r.kind || 'work') === 'work' ? dayCalc(r, { autoBreak }) : { ok: false, empty: true, notes: [] } }));
  let net = 0, should = 0, credited = 0, days = 0;
  for (const r of out) {
    const k = r.kind || 'work';
    if (k === 'work' && r.res.ok) { net += r.res.net; should += target; days++; }
    else if (k === 'vacation' || k === 'sick' || k === 'holiday') { credited += target; should += target; }
  }
  // § 5: rest between consecutive worked days
  for (let i = 1; i < out.length; i++) {
    const rest = restBetween(out[i - 1].date, out[i - 1].res, out[i].date, out[i].res);
    if (rest != null && rest >= 0 && rest < 660) out[i].res.notes.push({ level: 'warn', de: `Nur ${hhmm(rest)} Ruhezeit seit dem Vortag – vorgeschrieben sind 11 Stunden.`, en: `Only ${hhmm(rest)} rest since the day before – 11 hours are required (German law).` });
  }
  return { rows: out, net, credited, should, days, balance: net + credited - should };
}

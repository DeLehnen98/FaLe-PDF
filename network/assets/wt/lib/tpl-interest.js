// Late-payment interest for the payment reminder. Pure functions, unit-tested (scratchpad tpl_units.mjs).
// German page: base rate (Basiszinssatz, user-editable) + 5 points (consumers) or + 9 points (businesses),
// counted per day (actual days / 365). English page: one annual rate typed by the user.

/** Default base rate shown on the German page – the user must check it (it changes on 1 Jan / 1 Jul). */
export const BASE_RATE = { rate: 1.52, since: '2026-07-01' };

const day = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
/** Days of default: from the day after `due` up to and including `until` (0 if not overdue). */
export function daysLate(due, until) {
  const a = day(due), b = day(until);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Interest in cents (rounded) for `cents` at `ratePct` % per year over `days` days (act/365). */
export const interestCents = (cents, ratePct, days) => (cents > 0 && ratePct > 0 && days > 0 ? Math.round(cents * ratePct / 100 * days / 365) : 0);

/** Annual rate: base + 5 (consumer) or + 9 (business) percentage points. Never below 0. */
export const lateRate = (base, b2b) => Math.max(0, Math.round(((Number(base) || 0) + (b2b ? 9 : 5)) * 1000) / 1000);

/**
 * Totals of a reminder.
 * invoices: [{no, date, due, cents, paidCents}]; opts: { interest: bool, rate (annual %), until (ISO), flatFee: cents per invoice (B2B 40 €), fee: cents }
 * → { rows: [{…, open, days, interest}], open, interest, flat, fee, total }
 */
export function reminderTotals(invoices, { interest = false, rate = 0, until = '', flatFee = 0, fee = 0 } = {}) {
  const rows = invoices.map(r => {
    const open = Math.max(0, (r.cents || 0) - (r.paidCents || 0));
    const days = daysLate(r.due, until);
    return { ...r, open, days, interest: interest ? interestCents(open, rate, days) : 0 };
  });
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const openSum = sum('open'), int = sum('interest');
  const flat = flatFee ? flatFee * rows.filter(r => r.open > 0 && r.days > 0).length : 0;
  return { rows, open: openSum, interest: int, flat, fee: fee || 0, total: openSum + int + flat + (fee || 0) };
}

// GENERATED – synced copy of js/tools/passphoto.js (TEMPLATES + sheetLayout only) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
/** Formats with guide bands (mm from the top edge). */
export const TEMPLATES = [
  { id: 'de', label: 'Biometrisch (DE)', desc: 'Pass, Personalausweis, Schengen-Visum', w: 35, h: 45, crown: [3, 7.5], chin: [37, 41.5], eyes: [17.5, 23], head: [32, 36], bio: true },
  { id: 'us', label: 'Visum USA (2×2″)', desc: '51 × 51 mm, Kopf 25–35 mm', w: 50.8, h: 50.8, crown: [3.5, 10], chin: [31.5, 41], eyes: [15.9, 22.2], head: [25.4, 34.9], bio: true },
  { id: 'bew46', label: 'Bewerbung 4 × 6', desc: '40 × 60 mm', w: 40, h: 60, crown: [4, 9.5], chin: [28, 36], eyes: [15.5, 22], head: [24, 31] },
  { id: 'bew4560', label: 'Bewerbung 45 × 60', desc: '45 × 60 mm', w: 45, h: 60, crown: [4, 9.5], chin: [29, 37], eyes: [16, 22.5], head: [25, 32] },
];

/** Best grid of photos on a 10 × 15 cm sheet (either orientation), ≤ maxCount. */
export function sheetLayout(t, maxCount = 6) {
  let best = null;
  for (const [SW, SH] of [[150, 100], [100, 150]]) {
    for (const gap of [4, 3, 2]) {
      const cols = Math.floor((SW - 6 + gap) / (t.w + gap)), rows = Math.floor((SH - 6 + gap) / (t.h + gap));
      let n = cols * rows;
      if (n < 1) continue;
      let c = cols, r = rows;
      while (c * r > maxCount) { if (c >= r && c > 1) c--; else r--; }
      n = c * r;
      if (!best || n > best.n || (n === best.n && gap > best.gap)) best = { SW, SH, cols: c, rows: r, gap, n };
    }
  }
  return best;
}

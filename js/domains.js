// FaLe PDF – public origins in ONE place. Flipping to the custom domains = changing the three
// constants below (+ the static files listed in docs/DOMAINS-SWITCH.md). Import-free on purpose.
//
// The web app itself always uses location.origin for its own API calls and links, so these values only
// matter for the Android app (API base, links it hands out), PDF footers and cross-links to sister sites.

/** Primary public origin of the FaLe PDF web app + /api.  FLIP → 'https://pdf.fale.network' */
export const PDF_ORIGIN = 'https://pdf.fale.network';
/** Primary origin of the FaleNetwork site.  FLIP → 'https://fale.network' */
export const NETWORK_ORIGIN = 'https://fale.network';
/** Primary origin of the FaLe One web app.  FLIP → 'https://faleone.com' */
export const ONE_ORIGIN = 'https://faleone.com';

/** Host name shown in texts (e.g. the footer of a signature protocol page). */
export const PDF_HOST = new URL(PDF_ORIGIN).host;

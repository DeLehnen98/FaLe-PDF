// Rewarded video ads (Android app only) via @capacitor-community/admob (plugin name "AdMob").
// Voluntary: only started when the user taps "Werbevideo ansehen". The Google Mobile Ads SDK and
// the EU consent flow (Google UMP) are initialised lazily at that moment – never at app start.
// The reward itself is granted by the SERVER after Google's signed SSV callback (custom_data =
// this device's signed token); the app only refreshes its quota afterwards.
import { plugin, isNative, platformName } from '../platform.js';
import { AI_CONFIG } from './config.js';
import * as C from './client.js';

const userErr = msg => Object.assign(new Error(msg), { userMessage: msg });
const EV = { Rewarded: 'onRewardedVideoAdReward', Dismissed: 'onRewardedVideoAdDismissed', FailedToShow: 'onRewardedVideoAdFailedToShow', FailedToLoad: 'onRewardedVideoAdFailedToLoad' };

function admob() {
  const p = isNative() ? plugin('AdMob') : null;
  if (!p) throw userErr('Werbevideos gibt es nur in der Android-App.');
  return p;
}

let initP = null;
let consentInfo = null;
async function init() {
  if (!initP) {
    initP = (async () => {
      const p = admob();
      await p.initialize({ initializeForTesting: !!AI_CONFIG.ADMOB_TESTING });
      try {
        consentInfo = await p.requestConsentInfo();
        if (consentInfo && consentInfo.status === 'REQUIRED' && consentInfo.isConsentFormAvailable) consentInfo = await p.showConsentForm();
      } catch (e) { console.warn('UMP-Einwilligung nicht verfügbar', e); consentInfo = null; }
      return p;
    })().catch(e => { initP = null; throw e; });
  }
  return initP;
}

async function on(p, name, cb) {
  try { const r = p.addListener(name, cb); return (r && typeof r.then === 'function') ? await r : r; } catch { return null; }
}

/** Ad consent status for the settings screen (native only). */
export function adsAvailable() { return isNative() && platformName() !== 'ios' && !!plugin('AdMob'); } // iOS: no ads for now

/** Re-open the UMP privacy options form ("Werbe-Einwilligung ändern"). */
export async function showAdPrivacyOptions() {
  const p = await init();
  await p.showPrivacyOptionsForm();
  try { consentInfo = await p.requestConsentInfo(); } catch {}
}

/**
 * Show one rewarded ad. → { rewarded, credited, bonus }
 * rewarded: the user watched it; credited: the server already confirmed the reward.
 */
export async function showRewardedAd() {
  const token = await C.ensureToken();
  const before = (C.cachedQuota() || {}).rewarded || 0;
  const p = await init();
  if (consentInfo && consentInfo.canRequestAds === false) {
    throw userErr('Ohne deine Zustimmung kann gerade kein Werbevideo geladen werden. Du kannst die Werbe-Einwilligung in den KI-Einstellungen ändern.');
  }
  // personalised ads only when UMP says so (consent obtained or not required) – otherwise non-personalised
  const npa = !consentInfo || !['OBTAINED', 'NOT_REQUIRED'].includes(consentInfo.status);
  const handles = [];
  let settle;
  const outcome = new Promise(res => { settle = res; });
  handles.push(await on(p, EV.Rewarded, () => settle('rewarded')));
  handles.push(await on(p, EV.Dismissed, () => setTimeout(() => settle('dismissed'), 400))); // reward event may arrive just before
  handles.push(await on(p, EV.FailedToShow, () => settle('failed')));
  try {
    await p.prepareRewardVideoAd({ adId: AI_CONFIG.ADMOB_REWARDED_ID, isTesting: !!AI_CONFIG.ADMOB_TESTING, npa, ssv: { customData: C.rewardCustomData(token) } });
    const shown = Promise.resolve(p.showRewardVideoAd()).then(() => 'rewarded', () => 'failed');
    const result = await Promise.race([outcome, shown]);
    if (result === 'failed') throw userErr('Das Werbevideo konnte nicht angezeigt werden. Bitte versuche es später.');
    if (result !== 'rewarded') return { rewarded: false, credited: false };
    // wait for the server-side verification (Google calls our server, usually within seconds)
    let credited = false;
    for (let i = 0; i < 8 && !credited; i++) {
      await new Promise(r => setTimeout(r, i ? 1500 : 700));
      try { const q = await C.refreshQuota(); credited = !!q && (q.rewarded || 0) > before; } catch {}
    }
    return { rewarded: true, credited, bonus: (C.cachedQuota() || {}).bonus || 2 };
  } catch (e) {
    if (e && e.userMessage) throw e;
    console.warn('AdMob', e);
    throw userErr('Gerade ist kein Werbevideo verfügbar. Bitte versuche es später noch einmal.');
  } finally {
    handles.forEach(hd => { try { hd && hd.remove && hd.remove(); } catch {} });
  }
}

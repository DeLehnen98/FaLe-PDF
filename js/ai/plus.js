// „FaLe Plus“ – optional subscription (Google Play Billing in the Android app) via
// @capgo/native-purchases (plugin name "NativePurchases"). Purchases are verified on our server
// (/api/plus-verify → Google Play Developer API); prices come from the Play Console.
// Web: not purchasable for now.
import { plugin, isNative } from '../platform.js';
import { AI_CONFIG } from './config.js';
import * as C from './client.js';

const userErr = msg => Object.assign(new Error(msg), { userMessage: msg });
const SUBS = 'subs';

function store() {
  const p = isNative() ? plugin('NativePurchases') : null;
  if (!p) throw userErr('FaLe Plus kann derzeit nur in der Android-App abgeschlossen werden.');
  return p;
}

export function plusPurchasableHere() { return isNative() && !!plugin('NativePurchases'); }

/** Products with localized prices from Google Play. */
export async function loadProducts() {
  const p = store();
  try {
    const ok = await p.isBillingSupported();
    if (ok && ok.isBillingSupported === false) throw userErr('Google Play Billing ist auf diesem Gerät nicht verfügbar.');
  } catch (e) { if (e.userMessage) throw e; }
  const { products = [] } = await p.getProducts({ productIdentifiers: AI_CONFIG.PLUS_PRODUCTS.map(x => x.id), productType: SUBS }) || {};
  return AI_CONFIG.PLUS_PRODUCTS.map(cfg => {
    const prod = products.find(x => (x.identifier || x.productIdentifier) === cfg.id && (!x.planIdentifier || x.planIdentifier === cfg.plan)) || products.find(x => (x.identifier || x.productIdentifier) === cfg.id);
    return prod ? { ...cfg, price: prod.priceString || '', title: prod.title || '', offerToken: prod.offerToken || undefined } : null;
  }).filter(Boolean);
}

async function verify(productId, purchaseToken) {
  if (!purchaseToken) throw userErr('Der Kauf konnte nicht bestätigt werden.');
  const r = await C.callApi('/api/plus-verify', { productId, purchaseToken });
  await C.refreshQuota().catch(() => null);
  return r;
}

/** Buy a subscription. Resolves { active, expiresAt } or throws with a user message. */
export async function buy(prod) {
  const p = store();
  let tx;
  try {
    tx = await p.purchaseProduct({ productIdentifier: prod.id, planIdentifier: prod.plan, offerToken: prod.offerToken, productType: SUBS, quantity: 1 });
  } catch (e) {
    if (/cancel/i.test(String((e && (e.message || e.code)) || ''))) return { active: false, cancelled: true };
    throw userErr('Der Kauf konnte nicht abgeschlossen werden.');
  }
  return verify(prod.id, tx && tx.purchaseToken);
}

/** Restore: re-verify every subscription Google Play knows for this account. */
export async function restore() {
  const p = store();
  const { purchases = [] } = await p.getPurchases({ productType: SUBS }) || {};
  let active = null;
  for (const tx of purchases) {
    const id = tx.productIdentifier;
    if (!AI_CONFIG.PLUS_PRODUCTS.some(x => x.id === id) || !tx.purchaseToken) continue;
    try { const r = await verify(id, tx.purchaseToken); if (r.active) active = r; } catch (e) { console.warn(e); }
  }
  return active || { active: false };
}

export async function manage() {
  try { await store().manageSubscriptions(); } catch (e) { if (e.userMessage) throw e; throw userErr('Die Abo-Verwaltung von Google Play konnte nicht geöffnet werden.'); }
}

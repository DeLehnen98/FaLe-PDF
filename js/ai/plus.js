// „FaLe Plus" – optional, in the Android app via Google Play Billing (@capgo/native-purchases, plugin name
// "NativePurchases"): monthly / yearly subscription or ONE payment for ever (in-app product), plus voluntary
// tips (consumable products). Purchases are verified on our server (/api/plus-verify → Google Play Developer
// API); prices come from the Play Console. Fair billing: no trial that turns into a subscription, cancelling
// is one tap away, and a reminder can announce the next renewal three days ahead.
// Web: not purchasable for now.
import { plugin, isNative, scheduleNotification, cancelNotification } from '../platform.js';
import { AI_CONFIG } from './config.js';
import * as C from './client.js';
import { t, locale } from '../i18n/index.js';

const userErr = msg => Object.assign(new Error(msg), { userMessage: msg });
const SUBS = 'subs', INAPP = 'inapp';
const INFO = 'fale-plus-info', REMIND = 'fale-plus-remind', SUPPORT = 'fale-supporter';
const REMINDER_ID = 'plus-renewal';
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function store() {
  const p = isNative() ? plugin('NativePurchases') : null;
  if (!p) throw userErr('FaLe Plus kann derzeit nur in der Android-App abgeschlossen werden.');
  return p;
}

export function plusPurchasableHere() { return isNative() && !!plugin('NativePurchases'); }

async function billingOk(p) {
  try {
    const ok = await p.isBillingSupported();
    if (ok && ok.isBillingSupported === false) throw userErr('Google Play Billing ist auf diesem Gerät nicht verfügbar.');
  } catch (e) { if (e.userMessage) throw e; }
}
const idOf = x => x.identifier || x.productIdentifier;

/** Plus products with localized prices: subscriptions + the one-time "für immer" product. */
export async function loadProducts() {
  const p = store();
  await billingOk(p);
  const { products = [] } = await p.getProducts({ productIdentifiers: AI_CONFIG.PLUS_PRODUCTS.map(x => x.id), productType: SUBS }) || {};
  const subs = AI_CONFIG.PLUS_PRODUCTS.map(cfg => {
    const prod = products.find(x => idOf(x) === cfg.id && (!x.planIdentifier || x.planIdentifier === cfg.plan)) || products.find(x => idOf(x) === cfg.id);
    return prod ? { ...cfg, kind: SUBS, price: prod.priceString || '', title: prod.title || '', offerToken: prod.offerToken || undefined } : null;
  }).filter(Boolean);
  let life = null;
  const L = AI_CONFIG.PLUS_LIFETIME;
  if (L) {
    try {
      const { products: inapp = [] } = await p.getProducts({ productIdentifiers: [L.id], productType: INAPP }) || {};
      const prod = inapp.find(x => idOf(x) === L.id);
      if (prod) life = { ...L, kind: INAPP, price: prod.priceString || '', title: prod.title || '' };
    } catch (e) { console.warn('Einmalkauf nicht verfügbar', e); }
  }
  return life ? [...subs, life] : subs;
}

/** Tips with localized prices ([] when none are set up in the Play Console). */
export async function loadTips() {
  const p = store();
  await billingOk(p);
  const { products = [] } = await p.getProducts({ productIdentifiers: AI_CONFIG.TIPS.map(x => x.id), productType: INAPP }) || {};
  return AI_CONFIG.TIPS.map(cfg => { const prod = products.find(x => idOf(x) === cfg.id); return prod ? { ...cfg, kind: INAPP, price: prod.priceString || '' } : null; }).filter(Boolean);
}

async function verify(productId, purchaseToken) {
  if (!purchaseToken) throw userErr('Der Kauf konnte nicht bestätigt werden.');
  const r = await C.callApi('/api/plus-verify', { productId, purchaseToken });
  await C.refreshQuota().catch(() => null);
  if (r && r.active) await remember({ product: r.product || productId, expiresAt: r.expiresAt || null, renews: !!r.renews, lifetime: !!r.lifetime });
  return r;
}

/** Buy a subscription or the one-time product. Resolves { active, expiresAt, lifetime } or throws with a user message. */
export async function buy(prod) {
  const p = store();
  const type = prod.kind === INAPP ? INAPP : SUBS;
  let tx;
  try {
    tx = await p.purchaseProduct(type === SUBS
      ? { productIdentifier: prod.id, planIdentifier: prod.plan, offerToken: prod.offerToken, productType: SUBS, quantity: 1 }
      : { productIdentifier: prod.id, productType: INAPP, quantity: 1 });
  } catch (e) {
    if (/cancel/i.test(String((e && (e.message || e.code)) || ''))) return { active: false, cancelled: true };
    throw userErr('Der Kauf konnte nicht abgeschlossen werden.');
  }
  if (tx && /pending|^2$/i.test(String(tx.purchaseState ?? ''))) return { active: false, pending: true };
  return verify(prod.id, tx && tx.purchaseToken);
}

/** Restore: re-verify every Plus purchase Google Play knows for this account (subscriptions and "für immer"). */
export async function restore() {
  const p = store();
  let active = null;
  const known = [...AI_CONFIG.PLUS_PRODUCTS.map(x => x.id), ...(AI_CONFIG.PLUS_LIFETIME ? [AI_CONFIG.PLUS_LIFETIME.id] : [])];
  for (const productType of [INAPP, SUBS]) {
    let purchases = [];
    try { ({ purchases = [] } = await p.getPurchases({ productType }) || {}); } catch (e) { console.warn(e); continue; }
    for (const tx of purchases) {
      const id = tx.productIdentifier;
      if (!known.includes(id) || !tx.purchaseToken) continue;
      try { const r = await verify(id, tx.purchaseToken); if (r.active && (!active || r.lifetime)) active = r; } catch (e) { console.warn(e); }
    }
    if (active && active.lifetime) break;
  }
  return active || { active: false };
}

/** A tip: bought and consumed right away (so it can be given again). → { thanked, cancelled } */
export async function tip(prod) {
  const p = store();
  let tx;
  try { tx = await p.purchaseProduct({ productIdentifier: prod.id, productType: INAPP, quantity: 1 }); } catch (e) {
    if (/cancel/i.test(String((e && (e.message || e.code)) || ''))) return { thanked: false, cancelled: true };
    throw userErr('Das hat leider nicht geklappt. Es wurde nichts abgebucht.');
  }
  if (tx && /pending|^2$/i.test(String(tx.purchaseState ?? ''))) return { thanked: false, pending: true };
  try { if (tx && tx.purchaseToken) await p.consumePurchase({ purchaseToken: tx.purchaseToken }); } catch (e) { console.warn('consume', e); }
  const n = (ls.get(SUPPORT, 0) || 0) + 1;
  ls.set(SUPPORT, n);
  return { thanked: true, count: n };
}
export const supporterCount = () => ls.get(SUPPORT, 0) || 0;

export async function manage() {
  try { await store().manageSubscriptions(); } catch (e) { if (e.userMessage) throw e; throw userErr('Die Abo-Verwaltung von Google Play konnte nicht geöffnet werden.'); }
}

// ---------------------------------------------------------------- renewal reminder (fair billing)
export const plusInfo = () => ls.get(INFO, null);
export const reminderOn = () => ls.get(REMIND, true) !== false;

/** When the reminder fires: three days before a renewing subscription is charged again, 10:00. null if none. */
export function reminderTime(info, now = Date.now()) {
  if (!info || info.lifetime || !info.renews || !info.expiresAt) return null;
  const end = new Date(info.expiresAt);
  if (!Number.isFinite(+end)) return null;
  const at = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 3, 10, 0, 0);
  return +at > now ? at : null;
}

async function remember(info) {
  ls.set(INFO, info);
  await syncReminder();
}

/** Schedule or cancel the renewal reminder to match the stored subscription and the user's choice. */
export async function syncReminder() {
  const info = plusInfo();
  const at = reminderOn() ? reminderTime(info) : null;
  try {
    if (!at) { await cancelNotification(REMINDER_ID); return false; }
    const day = new Date(info.expiresAt).toLocaleDateString(locale());
    return await scheduleNotification({ id: REMINDER_ID, at, title: t('FaLe Plus verlängert sich bald'), body: t('Am {day} wird dein Abo verlängert. Tippe hier, wenn du es behalten oder kündigen möchtest.', { day }), route: '#/ki/plus' });
  } catch (e) { console.warn('Erinnerung', e); return false; }
}

export async function setReminder(on) {
  ls.set(REMIND, !!on);
  return syncReminder();
}

'use strict';
// Server configuration for the FaLe PDF cloud-AI backend. Everything comes from environment
// variables (Vercel → Project → Settings → Environment Variables). See store/AI-SETUP.md.
//
// Nothing here is a secret by itself; secrets are only read from process.env at request time.

const env = (k) => String(process.env[k] == null ? '' : process.env[k]).trim();
const num = (k, def, { min = -Infinity, max = Infinity } = {}) => {
  const v = parseFloat(env(k).replace(',', '.'));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
};
const int = (k, def, lim) => Math.round(num(k, def, lim));
const bool = (k, def) => { const v = env(k).toLowerCase(); return v ? ['1', 'true', 'yes', 'on', 'ja'].includes(v) : def; };

// Default provider privacy notes. Shown in the consent dialog. The owner MUST verify these
// against the provider's current terms (and can override them with AI_PROVIDER_PRIVACY_NOTE).
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    company: 'Anthropic, PBC, USA',
    note: 'Laut den kommerziellen API-Bedingungen von Anthropic werden über die API gesendete Inhalte standardmäßig nicht zum Training der Modelle verwendet und nur befristet gespeichert (z. B. zur Missbrauchserkennung).',
  },
  openai_compat: {
    label: 'KI-Anbieter',
    company: 'siehe Datenschutzerklärung',
    note: 'Die Verarbeitung beim KI-Anbieter richtet sich nach dessen Bedingungen (siehe Datenschutzerklärung).',
  },
  gemini: {
    label: 'Google (Gemini)',
    company: 'Google Ireland Ltd. / Google LLC',
    note: 'Laut den Bedingungen der kostenpflichtigen Gemini API verwendet Google die Inhalte nicht zur Verbesserung seiner Produkte. Bei der kostenlosen Stufe kann das anders sein.',
  },
  mock: { label: 'Test-Anbieter', company: 'lokal', note: 'Testmodus – es werden keine Daten an einen KI-Anbieter gesendet.' },
};

// Public URLs in ONE place (docs/DOMAINS-SWITCH.md). PRIMARY_* is what the API puts into links/e-mails; the
// env variables PUBLIC_APP_URL / FALE_ONE_URL override it without a code change.
//   FLIP → PRIMARY_APP_URL = 'https://pdf.fale.network', PRIMARY_ONE_URL = 'https://faleone.com'
const PRIMARY_APP_URL = 'https://fale-pdf.vercel.app';
const PRIMARY_ONE_URL = 'https://fale-one.vercel.app';
// CORS allow-lists: old AND new origins, so nothing breaks before, during or after the domain switch.
// (www.fale.network and www.faleone.com only redirect, so they never send API requests.)
const DEFAULT_ORIGINS = ['https://fale-pdf.vercel.app', 'https://pdf.fale.network', 'https://fale.network',
  'https://localhost', 'http://localhost', 'capacitor://localhost'];
// FaLe One (Drive + Fotos) web app origins. FALE_ONE_ORIGINS (comma-separated) replaces this default list.
const DEFAULT_ONE_ORIGINS = ['https://fale-one.vercel.app', 'https://faleone.com', 'https://one.fale.network'];
const urlEnv = (k, def) => (/^https:\/\/[a-z0-9.-]+(:\d{2,5})?\/?$/i.test(env(k)) ? env(k) : def).replace(/\/+$/, '');
/** Public base URL of the FaLe PDF web app (no trailing slash). */
const publicAppUrl = () => urlEnv('PUBLIC_APP_URL', PRIMARY_APP_URL);
/** Public base URL of the FaLe One web app (no trailing slash). */
const publicOneUrl = () => urlEnv('FALE_ONE_URL', PRIMARY_ONE_URL);
const oneOrigins = () => (env('FALE_ONE_ORIGINS') ? env('FALE_ONE_ORIGINS').split(',') : DEFAULT_ONE_ORIGINS)
  .map(s => s.trim().replace(/\/+$/, '')).filter(s => /^https:\/\/[a-z0-9.-]+(:\d{2,5})?$/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/.test(s));

function getConfig() {
  const provider = (env('AI_PROVIDER') || 'anthropic').toLowerCase();
  const p = PROVIDERS[provider] || PROVIDERS.openai_compat;
  const cfg = {
    provider,
    providerLabel: env('AI_PROVIDER_LABEL') || p.label,
    providerCompany: env('AI_PROVIDER_COMPANY') || p.company,
    providerNote: env('AI_PROVIDER_PRIVACY_NOTE') || p.note,
    anthropicKey: env('ANTHROPIC_API_KEY'),
    anthropicBase: env('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com',
    openaiBase: env('OPENAI_COMPAT_BASE_URL').replace(/\/+$/, ''),
    openaiKey: env('OPENAI_COMPAT_API_KEY'),
    geminiKey: env('GEMINI_API_KEY'),
    // Default model: a current cheap Haiku-class model. Override with AI_MODEL.
    model: env('AI_MODEL') || (provider === 'gemini' ? 'gemini-2.5-flash-lite' : provider === 'openai_compat' ? '' : 'claude-haiku-5-5'),
    providerTimeoutMs: int('AI_PROVIDER_TIMEOUT_MS', 45000, { min: 5000, max: 280000 }),
    // Prices: USD per million tokens. Defaults are deliberately HIGH (conservative) so that the
    // monthly cap triggers early rather than late if the owner forgets to set the real prices.
    priceInUsdPerMTok: num('AI_PRICE_IN_USD_PER_MTOK', 1.0, { min: 0 }),
    priceOutUsdPerMTok: num('AI_PRICE_OUT_USD_PER_MTOK', 5.0, { min: 0 }),
    // EUR per 1 USD (e.g. 0.92). Default slightly high = conservative.
    usdEur: num('USD_EUR', 0.95, { min: 0.1, max: 10 }),
    monthlyBudgetEur: num('AI_MONTHLY_BUDGET_EUR', 10, { min: 0, max: 100000 }),
    freeDaily: int('FREE_DAILY', 5, { min: 0, max: 1000 }),
    rewardBonus: int('REWARD_BONUS', 3, { min: 0, max: 100 }),
    rewardMaxPerDay: int('REWARD_MAX_PER_DAY', 3, { min: 0, max: 50 }),
    plusDaily: int('PLUS_DAILY', 200, { min: 1, max: 100000 }),
    ipDaily: int('IP_DAILY', 40, { min: 1, max: 100000 }),
    registerIpDaily: int('REGISTER_IP_DAILY', 30, { min: 1, max: 100000 }),
    adsEnabled: bool('ADS_ENABLED', true),
    adsRequireSsv: bool('ADS_REQUIRE_SSV', true),
    tokenSecret: env('FALE_TOKEN_SECRET'),
    ipSalt: env('FALE_IP_SALT'),
    rpcSecret: env('FALE_RPC_SECRET'),
    supabaseUrl: env('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseKey: env('SUPABASE_PUBLISHABLE_KEY'),
    store: (env('FALE_STORE') || 'supabase').toLowerCase(),
    timeZone: env('FALE_TIME_ZONE') || 'Europe/Berlin',
    allowedOrigins: [...DEFAULT_ORIGINS, ...oneOrigins(), ...env('AI_ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean)],
    publicAppUrl: publicAppUrl(), // links handed out by the API (see PRIMARY_APP_URL)
    publicOneUrl: publicOneUrl(),
    playPackage: env('PLAY_PACKAGE_NAME') || 'dev.fale.pdf',
    playSaJson: env('GOOGLE_PLAY_SA_JSON'),
    plusProducts: (env('PLUS_PRODUCTS') || 'fale_plus_monthly,fale_plus_yearly').split(',').map(s => s.trim()).filter(Boolean),
    admobKeysUrl: env('ADMOB_VERIFIER_KEYS_URL') || 'https://www.gstatic.com/admob/reward/verifier-keys.json',
    admobRewardUnits: env('ADMOB_REWARDED_AD_UNITS').split(',').map(s => s.trim()).filter(Boolean),
    maxBodyBytes: int('AI_MAX_BODY_BYTES', 200000, { min: 10000, max: 4000000 }),
    // FaLe-Konto (optional account) + FaLe Sync – see store/ACCOUNT-SETUP.md
    accountsEnabled: bool('ACCOUNTS_ENABLED', false), // switch on after custom SMTP is set up in Supabase
    authGoogle: bool('AUTH_GOOGLE_ENABLED', false), // Google sign-in (needs the Google provider in Supabase Auth)
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'), // OPTIONAL secret: lets account deletion remove the auth user immediately
    accountDaily: int('ACCOUNT_DAILY', 200, { min: 1, max: 100000 }),
    accountIpDaily: int('ACCOUNT_IP_DAILY', 400, { min: 1, max: 100000 }),
  };
  cfg.monthlyBudgetUsd = cfg.usdEur > 0 ? cfg.monthlyBudgetEur / cfg.usdEur : 0;
  return cfg;
}

function providerConfigured(cfg) {
  switch (cfg.provider) {
    // provider base URLs come from env only (never from requests); API keys travel over https only
    case 'anthropic': return !!(cfg.anthropicKey && cfg.model && /^https:\/\//i.test(cfg.anthropicBase));
    case 'openai_compat': return !!(cfg.openaiBase && /^https:\/\//i.test(cfg.openaiBase) && cfg.openaiKey && cfg.model);
    case 'gemini': return !!(cfg.geminiKey && cfg.model);
    case 'mock': return process.env.VERCEL_ENV !== 'production'; // test provider – never on production
    default: return false;
  }
}

function storeConfigured(cfg) {
  // the in-memory store is for tests only – never accept it on a production deployment
  if (cfg.store === 'memory') return process.env.VERCEL_ENV !== 'production';
  return !!(cfg.supabaseUrl && cfg.supabaseKey && cfg.rpcSecret && cfg.rpcSecret.length >= 32);
}

/** Core server secrets present? (token HMAC + IP salt) */
function secretsConfigured(cfg) {
  return !!(cfg.tokenSecret && cfg.tokenSecret.length >= 32 && cfg.ipSalt && cfg.ipSalt.length >= 16);
}

function plusConfigured(cfg) {
  if (!cfg.playSaJson) return false;
  try { const j = JSON.parse(cfg.playSaJson); return !!(j.client_email && j.private_key); } catch { return false; }
}

/** FaLe-Konto switched on and the public Supabase settings present? (no secret needed on the client side) */
function accountConfigured(cfg) {
  return !!(cfg.accountsEnabled && cfg.supabaseUrl && cfg.supabaseKey);
}

module.exports = { getConfig, providerConfigured, storeConfigured, secretsConfigured, plusConfigured, accountConfigured, PROVIDERS, DEFAULT_ORIGINS, DEFAULT_ONE_ORIGINS, PRIMARY_APP_URL, PRIMARY_ONE_URL, publicAppUrl, publicOneUrl };

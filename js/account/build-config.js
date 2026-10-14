// Public FaLe-Konto settings, written at build time by scripts/vercel-build.mjs from the Vercel environment
// (ACCOUNTS_ENABLED, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AUTH_GOOGLE_ENABLED) – no secrets.
// null = unknown (source checkout / native build without these variables): the app then asks
// /api/account?a=config, but only when the user opens the account screen.
export default null;

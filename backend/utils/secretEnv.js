// utils/secretEnv.js
// Centralized accessor for required secret environment variables.
// Replaces hardcoded fallback secrets (e.g. 'beautysavage-gift-card-secret') with
// an explicit failure: if the primary variable (and its optional fallback) are
// absent, the app refuses to operate instead of silently using a public, known key.
//
// A fallback to SESSION_SECRET is preserved where it was the historical effective
// key (SESSION_SECRET is mandatory at boot via utils/session.js), so removing the
// hardcoded literal does NOT change the key actually used by existing data — it
// only removes the insecure last-resort constant.

/**
 * Return a required secret from the environment.
 * @param {string} name primary env var name
 * @param {{ fallback?: string }} [opts] optional fallback env var name
 * @returns {string} the trimmed secret value
 * @throws {Error} if neither the primary nor the fallback variable is set
 */
export function requireSecret(name, { fallback } = {}) {
  const primary = String(process.env[name] || '').trim();
  if (primary) return primary;

  if (fallback) {
    const fallbackValue = String(process.env[fallback] || '').trim();
    if (fallbackValue) return fallbackValue;
  }

  const hint = fallback ? ` (or ${fallback})` : '';
  throw new Error(
    `${name}${hint} is required and was not found in the environment. ` +
      'Refusing to continue with an insecure default.'
  );
}

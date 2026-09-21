import crypto from 'node:crypto';

/**
 * Coffre-fort applicatif des secrets IntegratedAPI.
 *
 * Chiffrement symétrique AUTHENTIFIÉ (AES-256-GCM) : les clés d'API tierces
 * (Stripe, Yousign…) doivent être récupérées en clair côté serveur pour appeler
 * le fournisseur — un hachage serait inutilisable. GCM ajoute un tag
 * d'authentification qui détecte toute altération du ciphertext (base corrompue,
 * mauvaise clé) : `decryptSecret` échoue alors explicitement plutôt que de
 * renvoyer des octets erronés.
 *
 * Clé maître : variable d'environnement INTEGRATED_API_ENCRYPTION_KEY
 * (hex 64 caractères = 32 octets = 256 bits). DISTINCTE de JWT_SECRET, jamais
 * stockée en base, jamais envoyée au frontend. Générer avec :
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommandé pour GCM
const KEY_ENV = 'INTEGRATED_API_ENCRYPTION_KEY';
const KEY_HEX_LENGTH = 64; // 32 octets en hexadécimal

/**
 * Sentinelle « credential non rempli ». Les entrées de catalogue seedées portent
 * cette valeur (chiffrée) tant qu'un DEV n'a pas saisi la vraie clé. Détectée par
 * PRÉFIXE pour permettre des variantes descriptives (__UNFILLED_STRIPE_SK__).
 * Permet de distinguer « champ absent » de « champ seedé mais pas configuré » et
 * de refuser tout appel réseau avec un placeholder (principe « fail loud »).
 */
export const UNFILLED_SENTINEL = '__UNFILLED__';

export function isUnfilledSentinel(value) {
  return typeof value === 'string' && value.startsWith('__UNFILLED');
}

let cachedKey = null;

/**
 * Charge et met en cache la clé maître. Lève une erreur explicite si absente ou
 * mal formée — jamais de clé par défaut silencieuse.
 */
function loadKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `[crypto] ${KEY_ENV} manquant : impossible de (dé)chiffrer les secrets IntegratedAPI.`
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length !== KEY_HEX_LENGTH) {
    throw new Error(
      `[crypto] ${KEY_ENV} invalide : attendu ${KEY_HEX_LENGTH} caractères hexadécimaux ` +
        `(32 octets / 256 bits). Générer avec : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))".`
    );
  }
  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
}

/** Réinitialise le cache de clé (tests uniquement). */
export function _resetKeyCache() {
  cachedKey = null;
}

/**
 * Valide la présence et le format de la clé maître SANS lever d'exception.
 * Appelé au boot. Vérifie aussi qu'elle diffère de JWT_SECRET (rayon d'explosion).
 * @returns {{ ok: boolean, message: string }}
 */
export function validateEncryptionKey() {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    return { ok: false, message: `${KEY_ENV} absent` };
  }
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length !== KEY_HEX_LENGTH) {
    return {
      ok: false,
      message: `${KEY_ENV} mal formé (attendu ${KEY_HEX_LENGTH} caractères hex)`,
    };
  }
  if (process.env.JWT_SECRET && raw === process.env.JWT_SECRET) {
    return { ok: false, message: `${KEY_ENV} ne doit pas être identique à JWT_SECRET` };
  }
  return { ok: true, message: `${KEY_ENV} présent et valide` };
}

/**
 * Chiffre une chaîne. Format de sortie : "ivB64.authTagB64.ciphertextB64".
 * L'IV est aléatoire À CHAQUE appel (réutiliser un IV avec la même clé casserait
 * GCM) : deux encryptSecret("x") produisent donc deux résultats différents.
 */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new Error('[crypto] encryptSecret attend une chaîne.');
  }
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

/**
 * Déchiffre une valeur au format "iv.authTag.ciphertext". Lève si le format est
 * invalide (≠ 3 segments) ou si le tag d'authentification ne correspond pas
 * (clé erronée ou ciphertext altéré).
 */
export function decryptSecret(payload) {
  const key = loadKey();
  const parts = String(payload).split('.');
  if (parts.length !== 3) {
    throw new Error('[crypto] Format chiffré invalide (attendu iv.authTag.ciphertext).');
  }
  const [ivB64, authTagB64, encB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Masque un secret pour l'affichage : ne conserve que les 4 derniers caractères.
 * Ex. maskSecret("sk_live_abcd1234") -> "••••••••8K2P"-like -> "••••1234".
 * On travaille à partir des 4 derniers caractères stockés en clair (lastFour) ;
 * la valeur complète n'est jamais rechargée pour l'affichage.
 */
export function maskFromLastFour(lastFour) {
  const tail = String(lastFour || '').slice(-4);
  return `${'•'.repeat(12)}${tail}`;
}

/** Derniers 4 caractères en clair d'une valeur (pour l'affichage masqué). */
export function lastFourOf(value) {
  return String(value || '').slice(-4);
}

/** Génère une clé maître hex valide (utilitaire pour scripts/docs). */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

export default {
  UNFILLED_SENTINEL,
  isUnfilledSentinel,
  validateEncryptionKey,
  encryptSecret,
  decryptSecret,
  maskFromLastFour,
  lastFourOf,
  generateEncryptionKey,
};

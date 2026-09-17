import crypto from 'node:crypto';

import GiftCard from '../../models/GiftCard.js';

/**
 * M13 — Service QR carte cadeau.
 *
 * Principe de sécurité (RÈGLE ABSOLUE) : le QR ne contient JAMAIS le code secret complet,
 * ni le mot de passe, ni aucune valeur monétaire. Il transporte uniquement :
 *   - une version de payload (pour faire évoluer le format) ;
 *   - un TOKEN OPAQUE aléatoire qui ne révèle rien et ne sert qu'à RETROUVER la carte côté backend.
 *
 * Côté base on ne stocke que le HASH du token (`qrTokenHash`), jamais le token en clair :
 * un dump base ne permet donc pas de régénérer un QR valide.
 */

export const GIFT_CARD_QR_CURRENT_VERSION = 1;
const QR_PREFIX = 'BSGC'; // Beauty Savage Gift Card
const QR_SEPARATOR = '.';
const QR_TOKEN_BYTES = 32;

/** Hash stable (sha256 hex) d'un token opaque — c'est ce qui est persisté sur la carte. */
export function hashGiftCardQrToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Génère un nouveau token opaque + son hash + la version courante.
 * @returns {{ token: string, tokenHash: string, version: number }}
 */
export function generateGiftCardQrToken() {
  const token = crypto.randomBytes(QR_TOKEN_BYTES).toString('base64url');
  return {
    token,
    tokenHash: hashGiftCardQrToken(token),
    version: GIFT_CARD_QR_CURRENT_VERSION
  };
}

/**
 * Construit la chaîne encodée DANS le QR : `BSGC.v1.<token>`.
 * Aucune donnée sensible (code/mot de passe/montant) n'y figure.
 * @param {{ token: string, version?: number }} params
 * @returns {string}
 */
export function generateGiftCardQrPayload({ token, version = GIFT_CARD_QR_CURRENT_VERSION } = {}) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    throw new Error('Token QR manquant.');
  }
  return [QR_PREFIX, `v${Number(version) || GIFT_CARD_QR_CURRENT_VERSION}`, normalizedToken].join(QR_SEPARATOR);
}

/**
 * Décode une chaîne QR → { version, token } ou null si format invalide.
 * @param {string} payload
 * @returns {{ version: number, token: string } | null}
 */
export function parseGiftCardQrPayload(payload) {
  const raw = String(payload || '').trim();
  if (!raw) return null;
  const parts = raw.split(QR_SEPARATOR);
  if (parts.length !== 3) return null;
  const [prefix, versionPart, token] = parts;
  if (prefix !== QR_PREFIX) return null;
  if (!/^v\d+$/.test(versionPart)) return null;
  const version = Number(versionPart.slice(1));
  const normalizedToken = String(token || '').trim();
  if (!Number.isFinite(version) || version <= 0 || !normalizedToken) return null;
  return { version, token: normalizedToken };
}

/**
 * Génère le data URL (image PNG base64) du QR pour un payload donné.
 * Utilise la librairie open-source `qrcode` (import dynamique pour éviter de charger la lib
 * tant qu'aucun QR n'est demandé, et pour rester compatible ESM).
 * @param {string} payload
 * @param {object} [options]
 * @returns {Promise<string>} data:image/png;base64,...
 */
export async function generateGiftCardQrDataUrl(payload, options = {}) {
  const normalized = String(payload || '').trim();
  if (!normalized) {
    throw new Error('Payload QR manquant.');
  }
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(normalized, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: Number(options.width) || 240,
    color: {
      dark: options.dark || '#000000',
      light: options.light || '#FFFFFF'
    }
  });
}

/**
 * Retrouve une carte cadeau à partir d'un payload QR scanné.
 * Hash le token et cherche par `qrTokenHash`. Renvoie null si introuvable / format invalide.
 * @param {string} payload
 * @param {object} [opts]
 * @param {boolean} [opts.lean]
 * @returns {Promise<import('mongoose').Document | object | null>}
 */
export async function resolveGiftCardFromQrPayload(payload, { lean = false } = {}) {
  const parsed = parseGiftCardQrPayload(payload);
  if (!parsed) return null;
  const tokenHash = hashGiftCardQrToken(parsed.token);
  if (!tokenHash) return null;
  const query = GiftCard.findOne({ qrTokenHash: tokenHash });
  return lean ? query.lean() : query;
}

/**
 * (Ré)attribue un token QR à une carte (mutation en mémoire, save laissé à l'appelant).
 * Renvoie le token EN CLAIR (à n'utiliser que pour générer immédiatement le payload/QR, jamais persisté).
 * @param {import('mongoose').Document} card
 * @returns {{ token: string, payload: string, version: number }}
 */
export function rotateGiftCardQrToken(card) {
  if (!card) throw new Error('Carte manquante pour la rotation du token QR.');
  const { token, tokenHash, version } = generateGiftCardQrToken();
  card.qrTokenHash = tokenHash;
  card.qrPayloadVersion = version;
  return { token, payload: generateGiftCardQrPayload({ token, version }), version };
}

export default {
  GIFT_CARD_QR_CURRENT_VERSION,
  hashGiftCardQrToken,
  generateGiftCardQrToken,
  generateGiftCardQrPayload,
  parseGiftCardQrPayload,
  generateGiftCardQrDataUrl,
  resolveGiftCardFromQrPayload,
  rotateGiftCardQrToken
};

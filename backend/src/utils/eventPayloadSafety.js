import crypto from 'node:crypto';
import { EVENT_ERROR_CODES } from './domainEventConstants.js';

/**
 * Garde-fou de confidentialité des payloads d'événements.
 *
 * Un événement est PERSISTÉ et RELU (routes DEV, Manager, futurs exports). Il est
 * donc un vecteur de fuite : tout ce qui y entre doit être sûr par construction,
 * et non « sûr parce que l'appelant a fait attention ».
 *
 * La liste des clés interdites est CENTRALE et testée. On REFUSE plutôt que de
 * filtrer silencieusement : un filtrage muet laisserait croire que la donnée a
 * été transmise, et masquerait une erreur d'appel.
 */

export class EventPayloadError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'EventPayloadError';
    this.code = code;
    this.meta = meta;
  }
}

/**
 * Clés interdites dans un payload, à n'importe quelle profondeur.
 *
 * Comparaison sur la clé NORMALISÉE (minuscules, séparateurs retirés) : `api_key`,
 * `apiKey`, `API-KEY` et `apikey` sont la même chose. La correspondance est par
 * SOUS-CHAÎNE — `stripeSecretKey` contient `secret`, donc il est refusé.
 */
export const FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
  'apikey',
  'secret',
  'password',
  'passwd',
  'token',
  'otp',
  'authorization',
  'cookie',
  'html',
  'rawpayload',
  'credential',
  'privatekey',
  'accesskey',
  'sessionid',
  'bearer',
]);

/** Profondeur maximale d'imbrication. Au-delà : refus. */
export const MAX_PAYLOAD_DEPTH = 5;
/** Taille maximale du payload sérialisé (octets). */
export const MAX_PAYLOAD_BYTES = 8_192;
/** Nombre maximal de clés/éléments, toutes profondeurs confondues. */
export const MAX_PAYLOAD_NODES = 200;

/** Normalise une clé pour la comparaison : minuscules, sans séparateurs. */
export function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** La clé est-elle interdite ? (comparaison par sous-chaîne sur la forme normalisée) */
export function isForbiddenKey(key) {
  const normalized = normalizeKey(key);
  return FORBIDDEN_PAYLOAD_KEYS.some((forbidden) => normalized.includes(forbidden));
}

/**
 * Valide un payload en profondeur. Lève `EventPayloadError` au premier problème.
 *
 * Accepte uniquement des valeurs JSON simples : objets, tableaux, chaînes,
 * nombres finis, booléens, null et Date. Tout le reste (fonction, Error, ObjectId
 * brut, Map, undefined…) est refusé : sérialiser un objet d'erreur complet
 * embarquerait une stack, et un objet fournisseur brut embarquerait n'importe quoi.
 */
export function assertSafePayload(payload, { maxDepth = MAX_PAYLOAD_DEPTH, maxBytes = MAX_PAYLOAD_BYTES } = {}) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new EventPayloadError(EVENT_ERROR_CODES.INVALID_PAYLOAD, 'Le payload doit être un objet simple.');
  }

  let nodes = 0;

  const walk = (value, depth, path) => {
    if (depth > maxDepth) {
      throw new EventPayloadError(
        EVENT_ERROR_CODES.PAYLOAD_TOO_DEEP,
        `Payload trop imbriqué (profondeur > ${maxDepth}) à « ${path || 'racine'} ».`,
        { path }
      );
    }
    if (value === null) return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        nodes += 1;
        assertNodeBudget(path);
        walk(value[i], depth + 1, `${path}[${i}]`);
      }
      return;
    }
    if (value instanceof Date) return;

    const type = typeof value;
    if (type === 'string' || type === 'boolean') return;
    if (type === 'number') {
      if (!Number.isFinite(value)) {
        throw new EventPayloadError(EVENT_ERROR_CODES.INVALID_PAYLOAD, `Nombre non fini à « ${path} ».`, { path });
      }
      return;
    }
    if (type !== 'object') {
      // fonction, symbol, bigint, undefined…
      throw new EventPayloadError(
        EVENT_ERROR_CODES.INVALID_PAYLOAD,
        `Valeur non sérialisable (${type}) à « ${path} ».`,
        { path }
      );
    }

    // Objet non littéral (Error, Map, ObjectId, classe…) : refus explicite.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new EventPayloadError(
        EVENT_ERROR_CODES.INVALID_PAYLOAD,
        `Objet non littéral (${value.constructor?.name || 'inconnu'}) à « ${path || 'racine'} » : ne jamais sérialiser un objet fournisseur ou une erreur.`,
        { path }
      );
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isForbiddenKey(key)) {
        throw new EventPayloadError(
          EVENT_ERROR_CODES.SENSITIVE_KEY,
          `Clé sensible interdite dans un événement : « ${childPath} ».`,
          { path: childPath, key }
        );
      }
      nodes += 1;
      assertNodeBudget(childPath);
      walk(child, depth + 1, childPath);
    }
  };

  const assertNodeBudget = (path) => {
    if (nodes > MAX_PAYLOAD_NODES) {
      throw new EventPayloadError(
        EVENT_ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Payload trop volumineux (> ${MAX_PAYLOAD_NODES} nœuds) à « ${path} ».`,
        { path }
      );
    }
  };

  walk(payload, 1, '');

  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new EventPayloadError(EVENT_ERROR_CODES.INVALID_PAYLOAD, 'Payload non sérialisable en JSON.');
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxBytes) {
    throw new EventPayloadError(
      EVENT_ERROR_CODES.PAYLOAD_TOO_LARGE,
      `Payload trop volumineux (${bytes} > ${maxBytes} octets).`,
      { bytes }
    );
  }
  return payload;
}

/**
 * Masque une adresse e-mail pour l'audit : `support@exemple.fr` → `s***@exemple.fr`.
 *
 * Le domaine reste lisible (c'est lui qui porte l'information de délivrabilité),
 * la boîte ne l'est plus. À utiliser dès que l'adresse complète n'est pas
 * indispensable à la trace.
 */
export function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0) return value ? '***' : '';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = local[0] || '';
  return `${head}***@${domain}`;
}

/**
 * Empreinte courte et stable d'une valeur, pour une CLÉ D'IDEMPOTENCE.
 *
 * Une clé d'idempotence est persistée : y mettre une adresse en clair la stockerait
 * là où personne ne pense à regarder. Masquer ne convient pas non plus — `s***@x.fr`
 * vaut pour `support@x.fr` ET `sam@x.fr`, ce qui dédupliquerait à tort deux faits
 * distincts. Une empreinte préserve l'unicité sans conserver la donnée.
 *
 * Ce n'est PAS un secret : c'est une clé technique, pas une protection
 * cryptographique contre une attaque par dictionnaire.
 */
export function keyHash(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16);
}

/**
 * Message d'erreur sûr : jamais l'objet d'erreur, jamais la stack, toujours borné.
 */
export function safeErrorMessage(message, max = 300) {
  if (typeof message !== 'string') return '';
  const clean = message.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

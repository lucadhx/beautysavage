import SystemConfiguration from '../../models/SystemConfiguration.js';
import { normalizeDomainUrl } from './systemUrlValidation.js';

// S1 — Service de configuration système (singleton DB) + cache mémoire.
// Le cache est lu SYNCHRONEMENT par le DomainResolver (aucun appel DB dans le métier).
// Il est chargé au boot (loadSystemConfigurationCache) et rafraîchi à chaque écriture.

const SINGLETON_KEY = 'global';

/** @type {object|null} Snapshot lean du document singleton (null = non chargé). */
let cachedConfig = null;

/** Renvoie le snapshot caché (lean) ou null si non chargé. Lecture SYNCHRONE. */
export function getCachedSystemConfiguration() {
  return cachedConfig;
}

/** Vide le cache (forçant un rechargement DB au prochain getSystemConfiguration). */
export function invalidateSystemConfigurationCache() {
  cachedConfig = null;
}

function toSnapshot(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return obj;
}

/**
 * Récupère (ou crée) le document singleton. Idempotent.
 * @returns {Promise<object>} document mongoose
 */
export async function getOrCreateSystemConfigurationDoc() {
  const doc = await SystemConfiguration.findOneAndUpdate(
    { key: SINGLETON_KEY },
    { $setOnInsert: { key: SINGLETON_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc;
}

/**
 * Charge le singleton en cache (à appeler au boot). Tolérant aux erreurs : en cas
 * d'échec DB, laisse le cache à null (le DomainResolver bascule alors sur l'env).
 * @returns {Promise<object|null>} snapshot
 */
export async function loadSystemConfigurationCache() {
  try {
    const doc = await getOrCreateSystemConfigurationDoc();
    cachedConfig = toSnapshot(doc);
    return cachedConfig;
  } catch (error) {
    console.warn('[systemConfiguration] chargement cache impossible — fallback env :', error?.message || error);
    return null;
  }
}

/**
 * Renvoie la configuration (depuis le cache si dispo, sinon get-or-create + cache).
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<object>} snapshot
 */
export async function getSystemConfiguration(opts = {}) {
  if (!opts.force && cachedConfig) return cachedConfig;
  return (await loadSystemConfigurationCache()) || {};
}

function assignIfDefined(target, source, key) {
  if (source && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
    target[key] = source[key];
  }
}

/**
 * Met à jour le singleton (merge par section) avec validation des URLs de domaine.
 * @param {object} patch
 * @param {{ updatedBy?: any }} [opts]
 * @returns {Promise<{ ok: true, config: object } | { ok: false, error: string }>}
 */
export async function updateSystemConfiguration(patch = {}, opts = {}) {
  const doc = await getOrCreateSystemConfigurationDoc();

  // 🌐 Domaines — validation HTTPS / pas de slash final. Chaîne vide = effacement (fallback env).
  if (patch.domains && typeof patch.domains === 'object') {
    for (const field of ['panelUrl', 'vitrineUrl']) {
      if (Object.prototype.hasOwnProperty.call(patch.domains, field)) {
        const raw = patch.domains[field];
        const trimmed = String(raw == null ? '' : raw).trim();
        if (trimmed === '') {
          doc.domains[field] = '';
        } else {
          const res = normalizeDomainUrl(trimmed, {
            label: field === 'panelUrl' ? 'URL du panel' : 'URL de la vitrine'
          });
          if (!res.ok) return { ok: false, error: res.error };
          doc.domains[field] = res.value;
        }
      }
    }
  }

  // 🏢 Institut
  if (patch.institute && typeof patch.institute === 'object') {
    const i = patch.institute;
    assignIfDefined(doc.institute, i, 'name');
    assignIfDefined(doc.institute, i, 'email');
    assignIfDefined(doc.institute, i, 'phone');
    assignIfDefined(doc.institute, i, 'siret');
    if (i.address && typeof i.address === 'object') {
      for (const f of ['line1', 'line2', 'city', 'postalCode', 'country']) {
        assignIfDefined(doc.institute.address, i.address, f);
      }
    }
  }

  // 🌍 Localisation
  if (patch.localization && typeof patch.localization === 'object') {
    for (const f of ['timezone', 'language', 'currency']) {
      assignIfDefined(doc.localization, patch.localization, f);
    }
  }

  // 💰 Fiscalité
  if (patch.tax && typeof patch.tax === 'object') {
    if (patch.tax.defaultVatRate !== undefined) {
      const rate = Number(patch.tax.defaultVatRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return { ok: false, error: 'Taux de TVA invalide (0–100).' };
      }
      doc.tax.defaultVatRate = rate;
    }
    assignIfDefined(doc.tax, patch.tax, 'vatMention');
  }

  // 🔧 Système
  if (patch.system && typeof patch.system === 'object') {
    assignIfDefined(doc.system, patch.system, 'platformName');
  }

  // ⚠️ Maintenance
  if (patch.maintenance && typeof patch.maintenance === 'object') {
    if (patch.maintenance.enabled !== undefined) {
      doc.maintenance.enabled = Boolean(patch.maintenance.enabled);
    }
    assignIfDefined(doc.maintenance, patch.maintenance, 'message');
  }

  doc.updatedAt = new Date();
  if (opts.updatedBy) doc.updatedBy = opts.updatedBy;

  await doc.save();
  cachedConfig = toSnapshot(doc);
  return { ok: true, config: cachedConfig };
}

/**
 * Seed idempotent depuis le .env : ne remplit QUE les champs encore vides.
 * Permet de préserver la parité de comportement après retrait des variables du .env
 * (les valeurs migrent une fois en base, puis le .env peut être nettoyé).
 * @returns {Promise<object>} snapshot
 */
export async function seedSystemConfigurationFromEnv() {
  const doc = await getOrCreateSystemConfigurationDoc();
  let dirty = false;

  const env = process.env;
  const setIfEmpty = (obj, key, value) => {
    const current = obj[key];
    if ((current === undefined || current === null || String(current).trim() === '') && value && String(value).trim() !== '') {
      obj[key] = String(value).trim();
      dirty = true;
    }
  };

  // 🌐 Domaines — administrés au panel Dev (Paramètres Système). Plus aucun seed depuis l'env
  // (ni APP_BASE_URL ni NGROK_DOMAIN) : au premier boot, le DomainResolver retombe sur localhost.

  // 🏢 Institut
  setIfEmpty(doc.institute, 'name', env.INSTITUTE_NAME);
  setIfEmpty(doc.institute, 'email', env.INVOICE_CONTACT_EMAIL || env.MAIL_FROM);
  setIfEmpty(doc.institute, 'siret', env.INSTITUTE_SIRET);
  setIfEmpty(doc.institute.address, 'line1', env.INSTITUTE_ADDRESS_LINE1);
  setIfEmpty(doc.institute.address, 'city', env.INSTITUTE_CITY);
  setIfEmpty(doc.institute.address, 'postalCode', env.INSTITUTE_POSTAL_CODE);
  setIfEmpty(doc.institute.address, 'country', env.INSTITUTE_COUNTRY);

  // 💰 Fiscalité
  setIfEmpty(doc.tax, 'vatMention', env.INSTITUTE_VAT_MENTION);

  // 🔧 Système
  setIfEmpty(doc.system, 'platformName', env.PLATFORM_NAME);

  if (dirty) {
    doc.updatedAt = new Date();
    await doc.save();
  }
  cachedConfig = toSnapshot(doc);
  return cachedConfig;
}

// ---------------------------------------------------------------------------
// Accesseurs SYNCHRONES de configuration métier (cache → fallback env).
// IMPORTANT : ils n'imposent AUCUN défaut métier — chaque site d'appel conserve
// sa propre valeur par défaut historique → comportement strictement préservé.
// ---------------------------------------------------------------------------

function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// S1B — Le fallback .env de la config institut/fiscalité est INTERDIT en production.
// La prod doit lire SystemConfiguration (sinon chaque générateur applique son défaut
// historique). En dev/test, l'ancienne variable .env reste un fallback de migration.
function envFallback(name) {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') return undefined;
  return process.env[name];
}

/** Nom de l'institut (config → [dev] INSTITUTE_NAME → ''). */
export function resolveInstituteName() {
  const inst = getCachedSystemConfiguration()?.institute;
  return pick(inst?.name, envFallback('INSTITUTE_NAME'));
}

/** E-mail de contact institut (config → [dev] INVOICE_CONTACT_EMAIL → MAIL_FROM → ''). */
export function resolveInstituteEmail() {
  const inst = getCachedSystemConfiguration()?.institute;
  return pick(inst?.email, envFallback('INVOICE_CONTACT_EMAIL'), envFallback('MAIL_FROM'));
}

/** SIRET institut (config → [dev] INSTITUTE_SIRET → ''). */
export function resolveInstituteSiret() {
  const inst = getCachedSystemConfiguration()?.institute;
  return pick(inst?.siret, envFallback('INSTITUTE_SIRET'));
}

/** Téléphone institut (config → ''). */
export function resolveInstitutePhone() {
  const inst = getCachedSystemConfiguration()?.institute;
  return pick(inst?.phone);
}

/** Adresse institut (champ par champ, config → [dev] INSTITUTE_* → ''). */
export function resolveInstituteAddress() {
  const addr = getCachedSystemConfiguration()?.institute?.address || {};
  return {
    line1: pick(addr.line1, envFallback('INSTITUTE_ADDRESS_LINE1')),
    line2: pick(addr.line2),
    city: pick(addr.city, envFallback('INSTITUTE_CITY')),
    postalCode: pick(addr.postalCode, envFallback('INSTITUTE_POSTAL_CODE')),
    country: pick(addr.country, envFallback('INSTITUTE_COUNTRY'))
  };
}

/** Mention TVA (config → [dev] INSTITUTE_VAT_MENTION → ''). */
export function resolveVatMention() {
  const tax = getCachedSystemConfiguration()?.tax;
  return pick(tax?.vatMention, envFallback('INSTITUTE_VAT_MENTION'));
}

/** Nom de la plateforme éditrice (config → [dev] PLATFORM_NAME → ''). */
export function resolvePlatformName() {
  const sys = getCachedSystemConfiguration()?.system;
  return pick(sys?.platformName, envFallback('PLATFORM_NAME'));
}

/**
 * S1B — Agrégateur officiel des informations institut (source unique).
 * Utilisé par les générateurs (factures, reçus, cartes cadeaux, attestations, mails).
 * Chaque champ peut être vide → le site d'appel applique son libellé par défaut.
 * @returns {{ name, email, phone, siret, address:{line1,line2,city,postalCode,country}, vatMention }}
 */
export function getInstituteInfo() {
  return {
    name: resolveInstituteName(),
    email: resolveInstituteEmail(),
    phone: resolveInstitutePhone(),
    siret: resolveInstituteSiret(),
    address: resolveInstituteAddress(),
    vatMention: resolveVatMention()
  };
}

import { IntegratedApi } from '../models/IntegratedApi.model.js';
import { activeProviders, defaultBaseUrl, MODE_VALUES } from '../utils/integratedApiCatalog.js';
import { validateEncryptionKey } from '../utils/integratedApiCrypto.js';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Valide la clé maître de chiffrement au démarrage.
 *  - PROD : fail-closed (le serveur refuse de démarrer si la clé est absente ou
 *    mal formée) — aligné sur la philosophie fail-closed d'ENV.
 *  - TEST : avertissement non bloquant (l'environnement de travail peut démarrer
 *    sans clé ; toute opération crypto échouera alors explicitement au runtime).
 */
export function validateEncryptionKeyAtBoot() {
  const { ok, message } = validateEncryptionKey();
  if (ok) {
    /**
     * LE CONSTAT EST RENDU, PLUS SEULEMENT JOURNALISÉ.
     *
     * Le succès s'écrivait ici, en direct, et l'appelant n'en savait rien : le
     * résumé de démarrage ne pouvait donc pas le compter. Rendre le verdict
     * permet au rapport d'amorçage de porter la preuve — sans rien changer au
     * comportement fail-closed ci-dessous, qui reste la seule décision de
     * cette fonction.
     */
    return { ok: true, message, blocking: false };
  }
  if (config.isProd) {
    // Fail-closed : on lève. server.js (start().catch) journalise et arrête le
    // process — plus propre qu'un process.exit enfoui dans le bootstrap.
    throw new Error(
      `[CRYPTO] ${message}. INTEGRATED_API_ENCRYPTION_KEY est obligatoire en PROD ` +
        `(hex 64 caractères, distincte de JWT_SECRET).`
    );
  }
  return {
    ok: false,
    blocking: false,
    message:
      `${message}. Les opérations sur les secrets IntegratedAPI échoueront ` +
      `tant que INTEGRATED_API_ENCRYPTION_KEY n'est pas définie.`,
  };
}

/**
 * MIGRATION idempotente : `environments` -> `modes` + `activeMode` par défaut.
 *
 * Sépare le MODE fournisseur de l'ENV applicatif. Renomme le champ SANS
 * déchiffrer/réchiffrer (les credentials chiffrés sont conservés intégralement),
 * et fixe `activeMode='TEST'` par défaut pour les fournisseurs existants (sûr).
 * Opère au niveau du driver natif pour ne pas dépendre du schéma courant. No-op
 * si déjà migré (donc no-op après une copie TEST->PROD déjà migrée).
 */
export async function migrateIntegratedApiModes() {
  const coll = IntegratedApi.collection;
  // 1) Renommer environments -> modes (uniquement si pas déjà présent).
  const renamed = await coll.updateMany(
    { environments: { $exists: true }, modes: { $exists: false } },
    { $rename: { environments: 'modes' } }
  );
  // 2) Fixer activeMode par défaut là où il manque (fournisseurs pré-existants).
  const defaulted = await coll.updateMany(
    { activeMode: { $exists: false } },
    { $set: { activeMode: 'TEST' } }
  );
  const n = (renamed.modifiedCount || 0) + (defaulted.modifiedCount || 0);
  if (n > 0) {
    logger.info(
      `Migration IntegratedAPI: environments->modes (${renamed.modifiedCount || 0}) ` +
        `+ activeMode=TEST (${defaulted.modifiedCount || 0})`
    );
  }
  // Pré-remplir la base URL par défaut de chaque mode si absente/vide (éditable
  // ensuite). Idempotent : ne touche pas une URL déjà personnalisée.
  for (const provider of activeProviders()) {
    for (const mode of MODE_VALUES) {
      const field = `modes.${mode}.baseUrl`;
      await coll.updateMany(
        { provider: provider.provider, $or: [{ [field]: { $exists: false } }, { [field]: '' }] },
        { $set: { [field]: defaultBaseUrl(provider.provider, mode) } }
      );
    }
  }
}

/**
 * Seed idempotent du catalogue IntegratedAPI (fournisseurs actifs).
 * Crée l'entrée si absente, AVEC credentials vides (aucune fausse clé) et
 * activeMode=TEST. Ne modifie jamais une entrée existante.
 */
export async function seedIntegratedApis() {
  for (const provider of activeProviders()) {
    const exists = await IntegratedApi.findOne({ provider: provider.provider });
    if (!exists) {
      await IntegratedApi.create({
        provider: provider.provider,
        displayName: provider.displayName,
        enabled: true,
        activeMode: 'TEST',
        modes: {
          TEST: { credentials: {}, baseUrl: defaultBaseUrl(provider.provider, 'TEST') },
          PROD: { credentials: {}, baseUrl: defaultBaseUrl(provider.provider, 'PROD') },
        },
      });
      logger.success(`Seed: intégration ${provider.provider} créée (credentials vides, mode TEST)`);
    }
  }
}

// LE PROJET, CONSOMMATEUR DES MODÈLES DU PANEL.
//
// docs/architecture/EMAIL_TEMPLATE_AUTHORITY.md.
//
// ── LA RÈGLE, EN UNE LIGNE ──────────────────────────────────────────────────
//
//   Le Panel possède le CONTENU et le VOCABULAIRE ; ce projet possède la façon
//   de PRODUIRE les valeurs, et rien d'autre.
//
// Ce module est la seule porte par laquelle ce projet apprend quoi que ce soit
// au sujet d'un modèle. Il lit — il n'écrit jamais chez le Panel, et ne
// conserve localement que le contrat de variables (voir le modèle
// `EmailTemplateContract` pour le pourquoi de cette unique exception).
//
// ── DEUX LECTURES, ET LA DISTINCTION COMPTE ─────────────────────────────────
//
//   `listProjection()` — TRAVERSE le pont à chaque appel. C'est ce que le
//   Manager affiche. Aucun cache : un écran qui prétend montrer « ce qui part »
//   ne peut pas montrer ce qui partait ce matin. La contrepartie est qu'il
//   échoue quand le Panel est injoignable — et c'est la bonne réponse : mieux
//   vaut dire « je ne sais pas » qu'afficher une copie périmée avec assurance.
//
//   `contractFor()` — lit le CACHE local. C'est ce que l'envoi consulte pour
//   valider les variables avant de traverser. Une absence n'y est jamais
//   bloquante : le Panel reste l'autorité, et refuser d'envoyer parce qu'un
//   cache est vide recréerait le veto local que ce lot supprime.

import { EmailTemplateContract } from '../../models/EmailTemplateContract.model.js';
/**
 * LA FAÇADE, JAMAIS LE PONT (règle d'exclusivité des ponts).
 *
 * Ce module est du MÉTIER : il n'a le droit de connaître ni le transport, ni
 * l'appairage, ni la file. `templateProjectionClient` est au pont ce que
 * `capabilityClient` est aux capacités — un vocabulaire, sans état.
 */
import {
  fetchTemplate,
  fetchTemplatePreview,
  fetchTemplateProjection,
  fetchTemplateReadiness,
  requestTemplateTestSend,
  templateProjectionAvailable,
} from '../panelBridge/templateProjectionClient.js';
import { logger } from '../../utils/logger.js';

export { templateProjectionAvailable };

function unwrap(response) {
  return response?.data ?? response ?? null;
}

/* -------------------------------------------------------------------------- */
/*  LECTURES TRAVERSANTES — ce que le Manager affiche                         */
/* -------------------------------------------------------------------------- */

/**
 * La liste des modèles réellement affectés à CE projet, telle que le Panel la
 * résoudrait à l'envoi.
 *
 * Rafraîchit le cache de contrat au passage : la donnée est là, la recopier
 * coûte une écriture et évite un second aller-retour au prochain envoi.
 */
export async function listProjection() {
  const items = unwrap(await fetchTemplateProjection()) ?? [];
  await cacheContracts(items).catch((err) => {
    // Le cache est un CONFORT, jamais une condition : son échec ne doit pas
    // priver l'écran d'une lecture que le Panel vient de servir.
    logger.warn(`[email] contrat de variables non mis en cache : ${err?.message ?? 'erreur inconnue'}`);
  });
  return items;
}

export async function getProjectionEntry(templateCode) {
  return unwrap(await fetchTemplate(templateCode));
}

export async function previewProjection(templateCode) {
  return unwrap(await fetchTemplatePreview(templateCode));
}

export async function projectionReadiness(templateCode) {
  return unwrap(await fetchTemplateReadiness(templateCode));
}

export async function sendProjectionTest(templateCode, recipientEmail) {
  return unwrap(await requestTemplateTestSend(templateCode, recipientEmail));
}

/* -------------------------------------------------------------------------- */
/*  CACHE DU CONTRAT DE VARIABLES                                             */
/* -------------------------------------------------------------------------- */

/**
 * Range le vocabulaire servi par le Panel. IDEMPOTENT.
 *
 * Les entrées d'un code qui a disparu de la projection sont retirées : garder
 * le contrat d'un modèle que le projet ne consomme plus le ferait ressortir
 * dans la déclaration d'usage, et le Panel reposerait une instance que personne
 * ne demande.
 */
export async function cacheContracts(items = []) {
  const codes = [];
  for (const item of items) {
    const templateCode = String(item?.templateId ?? item?.templateCode ?? '').trim();
    if (!templateCode) continue;
    codes.push(templateCode);
    // eslint-disable-next-line no-await-in-loop
    await EmailTemplateContract.updateOne(
      { templateCode },
      {
        $set: {
          templateCode,
          ownedBy: item.ownedBy === 'PANEL' ? 'PANEL' : 'PROJECT',
          variables: Array.isArray(item.variables) ? item.variables : [],
          fingerprint: String(item.variableContractFingerprint ?? ''),
          refreshedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
  }
  if (codes.length) {
    await EmailTemplateContract.deleteMany({ templateCode: { $nin: codes } });
  }
  return { cached: codes.length };
}

/**
 * Rafraîchit le contrat depuis le Panel. NE LÈVE PAS.
 *
 * Appelé au démarrage et avant de publier la déclaration d'usage. Un Panel
 * injoignable au boot est banal (ordre de démarrage, réseau) : le projet
 * fonctionne alors avec le contrat qu'il connaît déjà, ou sans contrat du tout
 * — dans les deux cas, l'autorité de validation reste le Panel.
 */
export async function refreshContracts() {
  if (!templateProjectionAvailable()) {
    return { refreshed: false, reason: 'NOT_PAIRED' };
  }
  try {
    const items = unwrap(await fetchTemplateProjection()) ?? [];
    const report = await cacheContracts(items);
    logger.info(`[email] contrat de variables rafraîchi depuis le Panel — ${report.cached} modèle(s).`);
    return { refreshed: true, ...report };
  } catch (err) {
    logger.warn(
      `[email] contrat de variables non rafraîchi : ${err?.message ?? 'erreur inconnue'}. `
      + 'Le Panel reste l’autorité de validation à l’envoi.',
    );
    return { refreshed: false, reason: err?.code ?? 'UNAVAILABLE' };
  }
}

/** Le contrat connu d'un code, ou `null` si ce projet ne l'a jamais lu. */
export async function contractFor(templateCode) {
  return EmailTemplateContract.findOne({ templateCode }).lean();
}

/** `{ [code]: fingerprint }` — ce que la déclaration d'usage renvoie au Panel. */
export async function contractFingerprints() {
  const docs = await EmailTemplateContract.find({}).select('templateCode fingerprint').lean();
  const out = {};
  for (const doc of docs) {
    if (doc.fingerprint) out[doc.templateCode] = doc.fingerprint;
  }
  return out;
}

/**
 * LA VALIDATION LOCALE DES VARIABLES — sur le contrat du Panel, jamais sur un
 * ancien HTML local.
 *
 * ── CE QU'ELLE A REMPLACÉ ───────────────────────────────────────────────────
 *
 * Le projet validait auparavant le TEMPLATE : son sujet, son HTML, ses balises.
 * C'était une validation de contenu, donc une prétention d'autorité sur un
 * contenu qui ne lui appartient pas — et elle bloquait des envois que le Panel
 * aurait parfaitement rendus.
 *
 * Celle-ci ne regarde que ce que le projet FOURNIT, à l'aune de ce que le Panel
 * EXIGE. C'est exactement le périmètre dont le projet est autorité.
 *
 * Rend une liste de problèmes, vide quand tout va bien — et vide aussi quand
 * aucun contrat n'est connu : dans ce cas il n'y a rien à vérifier, et inventer
 * un refus serait pire que laisser le Panel trancher.
 */
export async function validateProvidedVariables(templateCode, variables) {
  const contract = await contractFor(templateCode);
  if (!contract || !contract.variables?.length) return [];

  const provided = variables instanceof Map
    ? new Map(variables)
    : new Map(Object.entries(variables ?? {}));

  const allowed = new Set(contract.variables.map((v) => v.key));
  const problems = [];

  for (const key of provided.keys()) {
    if (!allowed.has(key)) {
      problems.push({
        code: 'UNKNOWN_VARIABLE',
        variable: key,
        message: `« ${key} » n’appartient pas au contrat de « ${templateCode} » servi par la plateforme.`,
      });
    }
  }

  for (const variable of contract.variables) {
    if (!variable.required) continue;
    const value = provided.get(variable.key);
    const absente = value === null || value === undefined
      || (typeof value === 'string' && value.trim() === '');
    if (absente) {
      problems.push({
        code: 'MISSING_REQUIRED_VARIABLE',
        variable: variable.key,
        message: `« ${variable.key} » est obligatoire pour « ${templateCode} » et n’a pas été fournie.`,
      });
    }
  }

  return problems;
}

export default {
  cacheContracts,
  contractFingerprints,
  contractFor,
  getProjectionEntry,
  listProjection,
  previewProjection,
  projectionReadiness,
  refreshContracts,
  sendProjectionTest,
  templateProjectionAvailable,
  validateProvidedVariables,
};

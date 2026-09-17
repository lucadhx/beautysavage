// services/legalConsentService.js
// Sprint pré-React A1 — Revalidation serveur des consentements légaux (CGV /
// rétractation / renonciation), indépendante de l'input client.
//
// CONTEXTE (rapports 74, 82, 84) : la validation CGV/waiver était faite côté
// frontend, et le serveur posait `accepted_cgv:true`. Un appel API direct pouvait
// donc enregistrer un consentement falsifié. AVANT React (qui figera le contrat
// d'API), le serveur doit re-déterminer LUI-MÊME les consentements requis selon le
// type d'achat (catalogue serveur) et refuser les achats incomplets.
//
// Ce module :
//   - `deriveLegalRequirements(checkoutState)` : à partir du CATALOGUE serveur
//     (type de formation, proximité de date, prestation datée), calcule quels
//     consentements sont OBLIGATOIRES — sans faire confiance aux booléens client.
//   - `validateCheckoutLegalConsents(checkoutState, requirements)` : fonction PURE
//     qui refuse (code `LEGAL_CONSENT_REQUIRED`) si un consentement requis manque.
//   - `buildLegalConsentSnapshot(...)` : snapshot immuable stockable sur la vente.
//
// LIMITES JURIDIQUES (à valider par conseil — voir rapport 86) : ce service met en
// œuvre des règles minimales de bon sens (C. conso. L221-18 / L221-28). Il ne se
// substitue PAS à une validation juridique. Les textes de renonciation eux-mêmes
// restent ceux de constants/consumerWaiver.js.

import Formation from '../models/Formation.js';
import Service from '../models/Service.js';
import {
  DISTANT_LEARNING_WAIVER_TEXT,
  RETRACTATION_DAYS
} from '../constants/consumerWaiver.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const LEGAL_CONSENT_SNAPSHOT_VERSION = '1.0-a1';
export const LEGAL_CONSENT_REQUIRED_CODE = 'LEGAL_CONSENT_REQUIRED';

function legalConsentError(message) {
  const error = new Error(message || 'Consentement légal requis.');
  error.status = 400;
  error.code = LEGAL_CONSENT_REQUIRED_CODE;
  return error;
}

function normalizeText(value) {
  return String(value || '').normalize('NFC').trim();
}

function readLegal(checkoutState) {
  const legal = checkoutState?.legal;
  return legal && typeof legal === 'object' ? legal : {};
}

function isCgvAccepted(checkoutState) {
  const legal = readLegal(checkoutState);
  return legal.acceptedCgv === true || legal.accepted_cgv === true;
}

function readAcceptedWaiverTexts(checkoutState) {
  const texts = [];
  const legal = readLegal(checkoutState);
  if (legal.waiverAccepted === true && legal.waiverText) {
    texts.push(normalizeText(legal.waiverText));
  }
  // Panier : renonciations groupées par type dans consumerWaivers[].
  const waivers = Array.isArray(checkoutState?.consumerWaivers) ? checkoutState.consumerWaivers : [];
  for (const w of waivers) {
    if (w?.accepted === true && w?.text) texts.push(normalizeText(w.text));
  }
  return texts;
}

function hasAnyAcceptedWaiver(checkoutState) {
  const legal = readLegal(checkoutState);
  if (legal.waiverAccepted === true) return true;
  const waivers = Array.isArray(checkoutState?.consumerWaivers) ? checkoutState.consumerWaivers : [];
  return waivers.some(w => w?.accepted === true);
}

/**
 * Refuse l'achat si un consentement requis manque. Fonction PURE (aucune I/O).
 * @param {object} checkoutState
 * @param {object} [requirements] résultat de `deriveLegalRequirements`
 * @throws {Error} status 400, code LEGAL_CONSENT_REQUIRED
 * @returns {true}
 */
export function validateCheckoutLegalConsents(checkoutState, requirements = {}) {
  const {
    cgvRequired = true,
    digitalImmediateAccessWaiverRequired = false,
    presentielWaiverRequired = false,
    datedServiceAckRequired = false
  } = requirements || {};

  // 1. CGV — toujours obligatoires pour un achat.
  if (cgvRequired && !isCgvAccepted(checkoutState)) {
    throw legalConsentError('Veuillez accepter les conditions générales de vente.');
  }

  // 2. Contenu numérique à accès immédiat (formation distancielle) :
  //    renonciation EXPRESSE au droit de rétractation requise avant l'accès.
  if (digitalImmediateAccessWaiverRequired) {
    const expected = normalizeText(DISTANT_LEARNING_WAIVER_TEXT);
    const accepted = readAcceptedWaiverTexts(checkoutState);
    if (!accepted.includes(expected)) {
      throw legalConsentError(
        'Une renonciation expresse au droit de rétractation est requise pour un accès immédiat.'
      );
    }
  }

  // 3. Formation présentielle à date proche : renonciation/reconnaissance requise.
  if (presentielWaiverRequired && !hasAnyAcceptedWaiver(checkoutState)) {
    throw legalConsentError(
      'Une renonciation est requise car la formation a lieu prochainement.'
    );
  }

  // 4. Prestation datée/proche : reconnaissance de l'exécution à date déterminée
  //    (matérialisée par la renonciation de la prestation côté UI).
  if (datedServiceAckRequired && !hasAnyAcceptedWaiver(checkoutState)) {
    throw legalConsentError(
      'Une reconnaissance est requise car la prestation est exécutée à une date déterminée proche.'
    );
  }

  return true;
}

/**
 * Détermine, à partir du CATALOGUE serveur, les consentements obligatoires pour ce
 * checkoutState. Ne fait JAMAIS confiance aux booléens client (waiverRequired, etc.).
 * @param {object} checkoutState
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<object>} requirements pour validateCheckoutLegalConsents
 */
export async function deriveLegalRequirements(checkoutState, { now = new Date() } = {}) {
  const requirements = {
    cgvRequired: true,
    digitalImmediateAccessWaiverRequired: false,
    presentielWaiverRequired: false,
    datedServiceAckRequired: false
  };
  if (!checkoutState || typeof checkoutState !== 'object') return requirements;

  // Prestation beauté datée -------------------------------------------------
  if (checkoutState?.service?.serviceId) {
    const slotStart = checkoutState.service.slotStart ? new Date(checkoutState.service.slotStart) : null;
    const service = await Service.findById(checkoutState.service.serviceId)
      .select({ cancellationDays: 1 })
      .lean()
      .catch(() => null);
    if (slotStart && !Number.isNaN(slotStart.getTime())) {
      const daysBefore = (slotStart.getTime() - now.getTime()) / DAY_IN_MS;
      const cancellationDays = Number(service?.cancellationDays);
      const threshold = Math.max(
        RETRACTATION_DAYS,
        Number.isFinite(cancellationDays) ? cancellationDays : 0
      );
      // Prestation exécutée prochainement → renonciation/reconnaissance attendue.
      requirements.datedServiceAckRequired = daysBefore < threshold;
    }
    return requirements;
  }

  // Items (panier ou achat unitaire) ---------------------------------------
  const items = Array.isArray(checkoutState?.items) && checkoutState.items.length
    ? checkoutState.items
    : checkoutState?.item
      ? [checkoutState.item]
      : [];

  const formationItems = items.filter(
    i => String(i?.type || '').trim().toLowerCase() === 'formation' && i?.id
  );
  if (!formationItems.length) return requirements;

  const formationIds = [...new Set(formationItems.map(i => String(i.id).trim()))];
  const formations = await Formation.find({ _id: { $in: formationIds } })
    .select({ type: 1, refundDays: 1 })
    .lean()
    .catch(() => []);
  const formationMap = new Map(formations.map(f => [String(f._id), f]));

  for (const item of formationItems) {
    const formation = formationMap.get(String(item.id).trim());
    if (!formation) continue;
    const type = String(formation.type || '').trim().toLowerCase();

    if (type === 'distanciel') {
      // Accès immédiat au contenu numérique → renonciation expresse obligatoire.
      requirements.digitalImmediateAccessWaiverRequired = true;
      continue;
    }

    // Présentiel : renonciation requise si la session a lieu dans la fenêtre de
    // rétractation/remboursement (même logique que utils/consumerWaiver).
    if (type === 'presentiel') {
      const sessionStart = resolveSessionStart(checkoutState, item);
      if (sessionStart) {
        const daysBefore = (sessionStart.getTime() - now.getTime()) / DAY_IN_MS;
        const refundDays = Number(formation.refundDays);
        const threshold = Math.max(
          RETRACTATION_DAYS,
          Number.isFinite(refundDays) ? refundDays : 0
        );
        if (daysBefore < threshold) requirements.presentielWaiverRequired = true;
      }
    }
  }

  return requirements;
}

// Récupère la date de session présentiel connue du checkoutState (sans I/O).
// Le snapshot de politique de remboursement (panier) ou legal.dateFormation
// portent l'info ; à défaut on n'exige rien (le catalogue revalide par ailleurs).
function resolveSessionStart(checkoutState, item) {
  const legal = readLegal(checkoutState);
  const candidates = [
    item?.sessionStart,
    item?.sessionStartAt,
    item?.startDate,
    legal?.dateFormation
  ];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Snapshot immuable des consentements capturés au moment de l'achat.
 * Stockable sur Sale (champ `legalConsentSnapshot`).
 * @param {object} input
 * @param {object} [input.checkoutState]
 * @param {object} [input.legal] alternative directe (ex. mock pay) si pas de checkoutState
 * @param {Date}   [input.acceptedAt]
 * @param {string} [input.source]
 * @returns {object} snapshot
 */
export function buildLegalConsentSnapshot({
  checkoutState = null,
  legal: directLegal = null,
  acceptedAt = new Date(),
  source = 'checkout'
} = {}) {
  const legal = directLegal && typeof directLegal === 'object'
    ? directLegal
    : readLegal(checkoutState);
  const acceptedTexts = checkoutState ? readAcceptedWaiverTexts(checkoutState) : [];
  const directText = legal?.waiverText ? normalizeText(legal.waiverText) : '';
  const allTexts = directText ? [...acceptedTexts, directText] : acceptedTexts;
  const distancielText = normalizeText(DISTANT_LEARNING_WAIVER_TEXT);

  const cgvAccepted = isCgvAccepted(checkoutState ? checkoutState : { legal });
  const waiverAccepted =
    legal?.waiverAccepted === true ||
    (checkoutState ? hasAnyAcceptedWaiver(checkoutState) : false);
  const digitalImmediate = allTexts.includes(distancielText);

  const rawAcceptedAt =
    legal?.waiverAcceptedAt || legal?.cgvAcceptedAt || acceptedAt || new Date();
  const cgvAcceptedAt = (() => {
    const d = new Date(rawAcceptedAt);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  return {
    cgvAccepted: Boolean(cgvAccepted),
    cgvAcceptedAt,
    withdrawalNoticeAccepted: Boolean(cgvAccepted), // l'info rétractation est portée par les CGV/UI
    withdrawalWaiverAccepted: Boolean(waiverAccepted),
    serviceDatedAcknowledged: Boolean(
      legal?.serviceDatedAcknowledged === true ||
        (checkoutState?.service?.serviceId && waiverAccepted)
    ),
    digitalContentImmediateAccessAccepted: Boolean(digitalImmediate),
    source: String(source || 'checkout'),
    version: LEGAL_CONSENT_SNAPSHOT_VERSION
  };
}

export default {
  LEGAL_CONSENT_SNAPSHOT_VERSION,
  LEGAL_CONSENT_REQUIRED_CODE,
  validateCheckoutLegalConsents,
  deriveLegalRequirements,
  buildLegalConsentSnapshot
};

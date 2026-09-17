// services/offerReadinessService.js
// Sprint pré-React A7 — Garde-fous « offres incomplètes ». Empêche React de s'appuyer
// sur des parcours non finis, en bloquant les cas FAUX et en marquant explicitement les
// cas livrés manuellement.
//
// Stratégie conservatrice documentée (rapports 87/88) :
//   - ACOMPTE : tant que la collecte du solde n'est pas implémentée, une prestation en
//     `paymentType='deposit'` n'est PAS réservable (réservation « confirmée » mais
//     financièrement incomplète). On bloque → `OFFER_BALANCE_UNSUPPORTED`.
//   - DISTANCIEL : « accès immédiat » promis mais non matérialisé côté données. On
//     bloque le cas FAUX (formation déclarée `accessDeliveryMode='immediate'` SANS
//     `accessUrl`) → `OFFER_ACCESS_UNAVAILABLE`. Le distanciel par défaut (`manual`)
//     reste vendable mais l'achat est marqué `accessDeliveryStatus='manual_pending'`
//     (pas de faux « accès immédiat »). Aucun LMS n'est construit ici.

import Formation from '../models/Formation.js';

export const OFFER_READINESS_CODES = {
  OFFER_BALANCE_UNSUPPORTED: 'OFFER_BALANCE_UNSUPPORTED',
  OFFER_ACCESS_UNAVAILABLE: 'OFFER_ACCESS_UNAVAILABLE'
};

export const ACCESS_DELIVERY_STATUS = {
  MANUAL_PENDING: 'manual_pending',
  IMMEDIATE: 'immediate'
};

function offerError(code, message) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
}

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Évalue si une prestation est réservable en l'état (collecte du solde gérée ?).
 * @param {object} service document Service (lean ou doc)
 * @returns {{ ready: boolean, code: string|null, remainingPaymentRequired: boolean, balanceDue: number, paymentType: string }}
 */
export function evaluateServiceOfferReadiness(service) {
  const paymentType = String(service?.paymentType || 'full').toLowerCase();
  if (paymentType === 'deposit') {
    const total = roundToCents(service?.price);
    let deposit = 0;
    if (String(service?.depositType || '') === 'percentage') {
      deposit = roundToCents(total * Number(service?.depositValue || 0) / 100);
    } else {
      deposit = roundToCents(Math.min(Number(service?.depositValue || 0), total));
    }
    const balanceDue = roundToCents(Math.max(0, total - deposit));
    // Pré-React D3 — l'acompte est AUTORISÉ uniquement si un circuit de solde existe
    // (`balanceSettlementMode='pay_on_site'` : solde tracé et réglé sur place). Sinon BLOQUÉ
    // (réservation financièrement incomplète sans circuit de solde).
    const settlementMode = String(service?.balanceSettlementMode || 'none').toLowerCase();
    if (settlementMode === 'pay_on_site') {
      return {
        ready: true,
        code: null,
        remainingPaymentRequired: true,
        depositAmount: deposit,
        balanceDue,
        balanceSettlementMode: 'pay_on_site',
        paymentType
      };
    }
    return {
      ready: false,
      code: OFFER_READINESS_CODES.OFFER_BALANCE_UNSUPPORTED,
      remainingPaymentRequired: true,
      depositAmount: deposit,
      balanceDue,
      balanceSettlementMode: settlementMode,
      paymentType
    };
  }
  return {
    ready: true,
    code: null,
    remainingPaymentRequired: false,
    depositAmount: 0,
    balanceDue: 0,
    balanceSettlementMode: null,
    paymentType
  };
}

/**
 * Bloque la réservation d'une prestation non prête (acompte non géré).
 * @throws {Error} status 409 + code OFFER_BALANCE_UNSUPPORTED
 */
export function assertServiceOfferBookable(service) {
  const readiness = evaluateServiceOfferReadiness(service);
  if (!readiness.ready) {
    throw offerError(
      readiness.code,
      'Cette prestation exige un acompte avec solde à régler ultérieurement, ' +
        'fonctionnalité non encore disponible. Réservation impossible.'
    );
  }
  return readiness;
}

/**
 * Statut de livraison d'accès pour une formation (distanciel surtout).
 * @returns {string|null} 'manual_pending' | 'immediate' | null (présentiel)
 */
export function resolveAccessDeliveryStatusForFormation(formation) {
  const type = String(formation?.type || '').toLowerCase();
  if (type !== 'distanciel') return null;
  const mode = String(formation?.accessDeliveryMode || 'manual').toLowerCase();
  if (mode === 'immediate' && String(formation?.accessUrl || '').trim()) {
    return ACCESS_DELIVERY_STATUS.IMMEDIATE;
  }
  // Distanciel par défaut : accès livré manuellement (pas de faux « accès immédiat »).
  return ACCESS_DELIVERY_STATUS.MANUAL_PENDING;
}

/**
 * Évalue si une formation est achetable en l'état (accès distanciel cohérent ?).
 * @returns {{ ready: boolean, code: string|null, accessDeliveryStatus: string|null }}
 */
export function evaluateFormationOfferReadiness(formation) {
  const type = String(formation?.type || '').toLowerCase();
  if (type === 'distanciel') {
    const mode = String(formation?.accessDeliveryMode || 'manual').toLowerCase();
    const hasUrl = Boolean(String(formation?.accessUrl || '').trim());
    if (mode === 'immediate' && !hasUrl) {
      // Cas FAUX : accès immédiat promis mais aucune URL/clé configurée.
      return {
        ready: false,
        code: OFFER_READINESS_CODES.OFFER_ACCESS_UNAVAILABLE,
        accessDeliveryStatus: null
      };
    }
  }
  return {
    ready: true,
    code: null,
    accessDeliveryStatus: resolveAccessDeliveryStatusForFormation(formation)
  };
}

/**
 * Bloque l'achat d'une formation au cas faux (distanciel immédiat sans accès configuré).
 * @throws {Error} status 409 + code OFFER_ACCESS_UNAVAILABLE
 */
export function assertFormationOfferPurchasable(formation) {
  const readiness = evaluateFormationOfferReadiness(formation);
  if (!readiness.ready) {
    throw offerError(
      readiness.code,
      'Cette formation distancielle annonce un accès immédiat mais aucun accès n\'est ' +
        'configuré. Achat impossible.'
    );
  }
  return readiness;
}

/**
 * Garde de portail : bloque l'achat si une formation du checkout est un cas faux
 * (distanciel immédiat sans accès configuré). À appeler AVANT paiement (portail Stripe
 * et free checkout). Fonction async (lit le catalogue).
 * @param {object} checkoutState
 */
export async function assertCheckoutFormationsPurchasable(checkoutState) {
  const items = Array.isArray(checkoutState?.items) && checkoutState.items.length
    ? checkoutState.items
    : checkoutState?.item
      ? [checkoutState.item]
      : [];
  const ids = [
    ...new Set(
      items
        .filter(i => String(i?.type || '').toLowerCase() === 'formation' && i?.id)
        .map(i => String(i.id).trim())
    )
  ];
  if (!ids.length) return;
  const formations = await Formation.find({ _id: { $in: ids } })
    .select({ type: 1, accessDeliveryMode: 1, accessUrl: 1 })
    .lean();
  for (const f of formations) assertFormationOfferPurchasable(f);
}

export default {
  OFFER_READINESS_CODES,
  ACCESS_DELIVERY_STATUS,
  evaluateServiceOfferReadiness,
  assertServiceOfferBookable,
  resolveAccessDeliveryStatusForFormation,
  evaluateFormationOfferReadiness,
  assertFormationOfferPurchasable,
  assertCheckoutFormationsPurchasable
};

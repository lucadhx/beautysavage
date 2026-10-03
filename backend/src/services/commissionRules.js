import { Contract } from '../models/Contract.model.js';
import { SITE_SERVEABLE_STATUSES } from '../utils/contractConstants.js';

/**
 * LA RÈGLE DE COMMISSION — ce que l'institut reverse à la plateforme sur
 * ses ventes, et sur QUELLES ventes.
 *
 * Elle se règle dans la configuration du contrat (étape « Commission ») :
 *   - un pourcentage ;
 *   - les types de produits assujettis : formations présentielles,
 *     formations à distance, prestations ;
 *   - la base : HT (TTC divisé par 1 + TVA des ventes) ou TTC.
 *
 * Sans contrat en vigueur portant cette configuration, la règle d'avant
 * s'applique (10 % du TTC des formations à distance) : rien ne change tant
 * que la commission n'a pas été configurée.
 */
export const COMMISSION_KINDS = Object.freeze(['IN_PERSON_TRAINING', 'DISTANCE_TRAINING', 'SERVICE']);

export const DEFAULT_COMMISSION_RULE = Object.freeze({
  enabled: true,
  capCents: null,
  ratePercent: 10,
  productKinds: ['DISTANCE_TRAINING'],
  basis: 'TTC',
  salesVatRate: 20,
  source: 'DEFAULT',
});

/** Une configuration (contrat ou saisie) ramenée à des valeurs sûres. */
export function normalizeCommissionRule(raw = {}, source = 'CONTRACT') {
  const rate = Number(raw.ratePercent);
  const vat = Number(raw.salesVatRate);
  return {
    enabled: raw.enabled !== false,
    ratePercent: Number.isFinite(rate) ? Math.min(100, Math.max(0, Math.round(rate * 100) / 100)) : 0,
    productKinds: [...new Set((raw.productKinds || []).filter((kind) => COMMISSION_KINDS.includes(kind)))],
    basis: raw.basis === 'HT' ? 'HT' : 'TTC',
    salesVatRate: Number.isFinite(vat) ? Math.min(100, Math.max(0, vat)) : 20,
    capCents: Number.isInteger(raw.capCents) && raw.capCents > 0 ? raw.capCents : null,
    source,
  };
}

/**
 * LE PLAFOND — une commission ne dépasse jamais ce qu'il reste sous le plafond
 * du contrat. Plafond atteint : la vente n'est plus prélevée (« Plafond atteint »).
 * `rawAmountCents` garde le montant non écrêté : un recalcul réapplique le
 * plafond dans l'ordre des ventes, sans perdre l'information.
 */
export function applyCommissionCap(snapshot, rule, alreadyChargedCents) {
  const raw = Number(snapshot.rawAmountCents ?? snapshot.amountCents ?? 0);
  // L'assujettissement D'ORIGINE : une vente écartée par le plafond reste une vente assujettie.
  const rawSubject = snapshot.rawSubject ?? snapshot.subject;
  const base = { ...snapshot, subject: rawSubject, rawSubject, rawAmountCents: raw, capped: false, capReached: false };
  if (!rule?.capCents || !rawSubject || raw <= 0) return { ...base, amountCents: rawSubject ? raw : 0 };
  const left = Math.max(0, rule.capCents - Math.max(0, alreadyChargedCents));
  if (left <= 0) return { ...base, subject: false, amountCents: 0, capReached: true };
  if (raw > left) return { ...base, amountCents: left, capped: true, capReached: true };
  return { ...base, amountCents: raw };
}

/** La règle en vigueur : celle du contrat servable, sinon la règle par défaut. */
export async function activeCommissionRule() {
  const contract = await Contract.findOne({
    status: { $in: SITE_SERVEABLE_STATUSES },
    archived: false,
    'commission.configuredAt': { $ne: null },
  }).sort({ updatedAt: -1 }).lean();
  return contract?.commission?.configuredAt
    ? normalizeCommissionRule(contract.commission, 'CONTRACT')
    : { ...DEFAULT_COMMISSION_RULE };
}

/**
 * LA COMMISSION D'UNE VENTE — calculée ligne par ligne : seules les lignes
 * d'un type assujetti comptent. Une vente sans aucune ligne assujettie est
 * « non assujettie » (montant nul), et le dit.
 */
export function computeSaleCommission(sale, rule) {
  const lines = (sale.lines || []).map((line) => {
    const kind = line.productSnapshot?.kind || '';
    const subject = Boolean(rule.enabled) && rule.productKinds.includes(kind);
    const ttc = Number(line.totalCents || 0);
    const basisCents = subject ? (rule.basis === 'HT' ? Math.round(ttc / (1 + rule.salesVatRate / 100)) : ttc) : 0;
    return { lineId: String(line._id || ''), kind, title: line.productSnapshot?.title || '', subject, basisCents };
  });
  const basisCents = lines.reduce((sum, line) => sum + line.basisCents, 0);
  return {
    subject: basisCents > 0 && rule.ratePercent > 0,
    ratePercent: rule.ratePercent,
    basis: rule.basis,
    salesVatRate: rule.salesVatRate,
    productKinds: rule.productKinds,
    basisCents,
    amountCents: Math.round((basisCents * rule.ratePercent) / 100),
    source: rule.source,
    lines,
    computedAt: new Date(),
  };
}

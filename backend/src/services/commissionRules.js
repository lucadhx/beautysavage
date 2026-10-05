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
  capType: 'HT',
  capHtCents: null,
  ratePercent: 10,
  rateType: 'HT',
  vatRate: 20,
  rateHtPercent: 10,
  rateTtcPercent: 12,
  productKinds: ['DISTANCE_TRAINING'],
  basis: 'TTC',
  salesVatRate: 20,
  source: 'DEFAULT',
});

const clampPct = (v, fallback) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback);

/**
 * HT ↔ TTC D'UN TAUX. « 7,5 % TTC » avec 20 % de TVA = 6,25 % HT ; « 7,5 % HT »
 * = 9 % TTC. Le HT est ce que Stripe facture (la TVA s'y ajoute).
 */
export function commissionRates(rule) {
  const vat = clampPct(Number(rule.vatRate), 20);
  const rate = Number(rule.ratePercent) || 0;
  const rateHtPercent = rule.rateType === 'TTC' ? rate / (1 + vat / 100) : rate;
  return { vatRate: vat, rateHtPercent, rateTtcPercent: rateHtPercent * (1 + vat / 100) };
}

/** Un montant HT complété de sa TVA et de son TTC. */
export function withCommissionVat(amountHtCents, vatRate) {
  const ht = Math.max(0, Math.round(Number(amountHtCents) || 0));
  const vatCents = Math.round((ht * (Number(vatRate) || 0)) / 100);
  return { amountCents: ht, vatCents, amountTtcCents: ht + vatCents };
}

/** Une configuration (contrat ou saisie) ramenée à des valeurs sûres. */
export function normalizeCommissionRule(raw = {}, source = 'CONTRACT', { contractTaxRate = null } = {}) {
  const rate = Number(raw.ratePercent);
  const vat = Number(raw.salesVatRate);
  const commissionVat = raw.vatRate !== null && raw.vatRate !== undefined && raw.vatRate !== '' ? Number(raw.vatRate) : Number(contractTaxRate);
  const rule = {
    enabled: raw.enabled !== false,
    ratePercent: Number.isFinite(rate) ? Math.min(100, Math.max(0, Math.round(rate * 100) / 100)) : 0,
    rateType: raw.rateType === 'TTC' ? 'TTC' : 'HT',
    vatRate: clampPct(commissionVat, 20),
    productKinds: [...new Set((raw.productKinds || []).filter((kind) => COMMISSION_KINDS.includes(kind)))],
    basis: raw.basis === 'HT' ? 'HT' : 'TTC',
    salesVatRate: Number.isFinite(vat) ? Math.min(100, Math.max(0, vat)) : 20,
    capCents: Number.isInteger(raw.capCents) && raw.capCents > 0 ? raw.capCents : null,
    capType: raw.capType === 'TTC' ? 'TTC' : 'HT',
    source,
  };
  const rates = commissionRates(rule);
  // Le plafond est toujours COMPARÉ en HT (les montants de commission sont HT).
  rule.capHtCents = rule.capCents ? (rule.capType === 'TTC' ? Math.round(rule.capCents / (1 + rates.vatRate / 100)) : rule.capCents) : null;
  return { ...rule, rateHtPercent: rates.rateHtPercent, rateTtcPercent: rates.rateTtcPercent };
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
  const vat = snapshot.vatRate ?? rule?.vatRate ?? 0;
  const base = { ...snapshot, subject: rawSubject, rawSubject, rawAmountCents: raw, capped: false, capReached: false };
  const done = (patch) => ({ ...base, ...patch, ...withCommissionVat(patch.amountCents, vat) });
  // Le plafond se compare EN HT (s'il est saisi TTC, il a été ramené en HT).
  const capHt = rule?.capHtCents ?? rule?.capCents ?? null;
  if (!capHt || !rawSubject || raw <= 0) return done({ amountCents: rawSubject ? raw : 0 });
  const left = Math.max(0, capHt - Math.max(0, alreadyChargedCents));
  if (left <= 0) return done({ subject: false, amountCents: 0, capReached: true });
  if (raw > left) return done({ amountCents: left, capped: true, capReached: true });
  return done({ amountCents: raw });
}

/** La règle en vigueur : celle du contrat servable, sinon la règle par défaut. */
export async function activeCommissionRule() {
  const contract = await Contract.findOne({
    status: { $in: SITE_SERVEABLE_STATUSES },
    archived: false,
    'commission.configuredAt': { $ne: null },
  }).sort({ updatedAt: -1 }).lean();
  return contract?.commission?.configuredAt
    ? normalizeCommissionRule(contract.commission, 'CONTRACT', { contractTaxRate: contract.taxRate })
    : normalizeCommissionRule(DEFAULT_COMMISSION_RULE, 'DEFAULT', { contractTaxRate: contract?.taxRate ?? null });
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
  const { vatRate, rateHtPercent, rateTtcPercent } = commissionRates(rule);
  /**
   * Taux TTC : on calcule le TTC voulu, puis le HT qui, TVA ajoutée, le
   * redonne. Taux HT : le HT directement. Dans les deux cas `amountCents` est
   * le HT — ce que Stripe facture, la TVA s'y ajoutant.
   */
  const amountHt = rule.rateType === 'TTC'
    ? Math.round(Math.round((basisCents * rule.ratePercent) / 100) / (1 + vatRate / 100))
    : Math.round((basisCents * rule.ratePercent) / 100);
  return {
    subject: basisCents > 0 && rule.ratePercent > 0,
    ratePercent: rule.ratePercent,
    rateType: rule.rateType || 'HT',
    rateHtPercent: Math.round(rateHtPercent * 1e6) / 1e6,
    rateTtcPercent: Math.round(rateTtcPercent * 1e6) / 1e6,
    vatRate,
    basis: rule.basis,
    salesVatRate: rule.salesVatRate,
    productKinds: rule.productKinds,
    basisCents,
    ...withCommissionVat(amountHt, vatRate),
    source: rule.source,
    lines,
    computedAt: new Date(),
  };
}

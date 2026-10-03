/**
 * LA RÈGLE DE PAIEMENT D'UNE PRESTATION — réglée dans le Manager (onglet
 * Paiement) : paiement complet, acompte (solde réglé sur place), ou gratuit.
 *
 * Elle n'était qu'enregistrée : le paiement en ligne faisait toujours payer la
 * totalité. Elle décide désormais de ce qui est encaissé en ligne, et de ce
 * qu'il restera à régler sur place — affiché à la cliente et au calendrier.
 *
 * L'acompte se calcule sur le prix de la ligne (options comprises) ; un
 * acompte fixe ne dépasse jamais ce prix.
 */
export function paymentSplit(product, lineTotalCents) {
  const total = Math.max(0, Math.round(Number(lineTotalCents) || 0));
  const rules = product?.paymentRules || {};
  const type = product?.kind === 'SERVICE' && ['DEPOSIT', 'FREE'].includes(rules.type) ? rules.type : 'FULL';
  if (type === 'FREE') return { rule: 'FREE', payNowCents: 0, balanceDueCents: total };
  if (type === 'DEPOSIT') {
    const value = Math.max(0, Number(rules.depositValue) || 0);
    const deposit = rules.depositType === 'FIXED' ? Math.round(value * 100) : Math.round((total * Math.min(100, value)) / 100);
    const payNow = Math.min(total, deposit);
    return { rule: 'DEPOSIT', payNowCents: payNow, balanceDueCents: total - payNow };
  }
  return { rule: 'FULL', payNowCents: total, balanceDueCents: 0 };
}

/** Ce que la vitrine a besoin de savoir pour annoncer « à payer maintenant / sur place ». */
export function publicPaymentRule(product) {
  const rules = product?.paymentRules || {};
  if (product?.kind !== 'SERVICE' || !['DEPOSIT', 'FREE'].includes(rules.type)) return { type: 'FULL' };
  return rules.type === 'FREE'
    ? { type: 'FREE' }
    : { type: 'DEPOSIT', depositType: rules.depositType === 'FIXED' ? 'FIXED' : 'PERCENT', depositValue: Math.max(0, Number(rules.depositValue) || 0) };
}

/**
 * LES CONDITIONS D'ANNULATION — celles de la fiche (onglet Réservation) :
 * annulation gratuite jusqu'à N heures avant, pourcentage remboursé à temps et
 * en retard. Rendues telles que la cliente les lira avant de confirmer.
 */
export function cancellationTerms(product, startsAt, paidCents, now = new Date()) {
  const rules = product?.bookingRules || {};
  const freeCancelHours = Number.isFinite(Number(rules.freeCancelHours)) ? Math.max(0, Number(rules.freeCancelHours)) : 72;
  const before = Number.isFinite(Number(rules.refundBeforePercent)) ? Math.min(100, Math.max(0, Number(rules.refundBeforePercent))) : 100;
  const after = Number.isFinite(Number(rules.refundAfterPercent)) ? Math.min(100, Math.max(0, Number(rules.refundAfterPercent))) : 0;
  const start = new Date(startsAt);
  const deadline = new Date(start.getTime() - freeCancelHours * 3_600_000);
  const cancellable = start > now;
  const onTime = now <= deadline;
  const percent = onTime ? before : after;
  const paid = Math.max(0, Math.round(Number(paidCents) || 0));
  return {
    cancellable,
    onTime,
    freeCancelHours,
    deadline: deadline.toISOString(),
    percent,
    refundCents: cancellable ? Math.round((paid * percent) / 100) : 0,
    paidCents: paid,
  };
}

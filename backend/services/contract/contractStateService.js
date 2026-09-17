// services/contract/contractStateService.js
// Sprint F3A — Helpers purs du domaine contrat (calculs montant/dates). Aucune logique HTTP,
// aucun accès Stripe. Extraits verbatim de contractController.

export function contractAmountTtcCents(amount, taxRate) {
  const amountNum = Number(amount || 0);
  const taxNum = Number(taxRate || 0);
  return Math.round(amountNum * (1 + taxNum) * 100);
}

// Calcule la date de fin de période de blocage (politique 'locked'), sinon null.
// Comportement identique à l'ancien bloc inline d'activateContract.
export function computeLockedUntil(contract) {
  if (contract?.cancellationPolicy?.type === 'locked' && contract?.cancellationPolicy?.lockedMonths) {
    const d = new Date(contract.activatedAt);
    d.setMonth(d.getMonth() + contract.cancellationPolicy.lockedMonths);
    return d.toISOString();
  }
  return null;
}

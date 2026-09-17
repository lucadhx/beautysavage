// services/contract/contractResponseMapper.js
// Sprint F3A — Mapping payload public contrat + réponse HTTP. `toResponseContract` déplacé
// verbatim (payload public identique — pendingClientSecret omis). `send` mappe les résultats
// `{ status, json }` des services contrat en réponse HTTP, statut/payload identiques.

export function toResponseContract(contract) {
  if (!contract) return null;
  const c = contract.toObject ? contract.toObject() : { ...contract };
  return {
    _id: c._id,
    status: c.status,
    file: c.file,
    fileOriginalName: c.fileOriginalName,
    fileMimeType: c.fileMimeType,
    fileDownloadedAt: c.fileDownloadedAt,
    lockedAt: c.lockedAt,
    launchFee: c.launchFee,
    monthlyFee: {
      amount: c.monthlyFee?.amount,
      taxRate: c.monthlyFee?.taxRate,
      active: c.monthlyFee?.active,
      currentPeriodEnd: c.monthlyFee?.currentPeriodEnd,
      gracePeriodDays: c.monthlyFee?.gracePeriodDays,
      stripeSubscriptionId: c.monthlyFee?.stripeSubscriptionId,
      stripeCustomerId: c.monthlyFee?.stripeCustomerId
      // pendingClientSecret intentionnellement omis de la réponse par défaut
    },
    commissions: c.commissions || null,
    cancellationPolicy: c.cancellationPolicy,
    pendingMessage: c.pendingMessage,
    activatedAt: c.activatedAt,
    activatedBy: c.activatedBy,
    cancelledAt: c.cancelledAt,
    cancelledBy: c.cancelledBy,
    createdBy: c.createdBy,
    updatedBy: c.updatedBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
}

export function send(res, result) {
  const status = Number(result?.status) || 200;
  return res.status(status).json(result?.json);
}

export default { toResponseContract, send };

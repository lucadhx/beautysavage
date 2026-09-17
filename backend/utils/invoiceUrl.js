import { resolvePublicBaseUrl, resolvePublicUrl } from '../services/system/domainResolver.js';

// S1 — Migration APP_BASE_URL → DomainResolver.
// getAppBaseUrl() est conservé comme délégateur rétro-compatible (importé par
// plusieurs modules). Il NE lit plus process.env.APP_BASE_URL : la résolution
// (config DB → fallback env) est entièrement déléguée au DomainResolver, seule
// couche infra autorisée à lire l'environnement.
//
// Toute nouvelle URL doit utiliser directement le DomainResolver
// (resolveVitrineUrl / resolvePanelUrl / resolvePublicUrl).

export function getAppBaseUrl() {
  return resolvePublicBaseUrl();
}

export function buildCommissionInvoiceDownloadUrl(invoiceId, token) {
  if (!invoiceId || !token) {
    return '';
  }
  const encodedInvoiceId = encodeURIComponent(String(invoiceId));
  const encodedToken = encodeURIComponent(String(token));
  return resolvePublicUrl(`commission-invoice/${encodedInvoiceId}?token=${encodedToken}`);
}

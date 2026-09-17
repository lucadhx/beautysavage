import {
  resolveInstituteName,
  resolveInstituteEmail,
  resolveInstituteAddress,
  resolveInstituteSiret,
  resolveVatMention
} from '../services/system/systemConfigurationService.js';

// S1 — Identité institut migrée vers SystemConfiguration (source officielle).
// Les accesseurs résolvent : config DB (cache) → fallback .env → '' ; les libellés
// par défaut historiques sont conservés ici pour une parité de comportement totale.
export const getVendorConfig = () => {
  const address = resolveInstituteAddress();
  return {
    name: resolveInstituteName() || 'Beauty Savage',
    email: resolveInstituteEmail() || undefined,
    address: {
      line1: address.line1 || undefined,
      city: address.city || undefined,
      postal_code: address.postalCode || undefined,
      country: address.country || 'FR'
    },
    siret: resolveInstituteSiret() || undefined,
    vatMention: resolveVatMention() || 'TVA non applicable, article 293B du CGI'
  };
};

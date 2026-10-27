import type { Company } from '@/types';

/**
 * L'ADRESSE DE L'INSTITUT — une seule source : le contact « Adresse » de la
 * fiche (Manager → Informations). Le lien Google est celui de la fiche Google
 * s'il est renseigné, sinon une recherche Google Maps sur l'adresse.
 */
export function instituteAddress(company?: Partial<Company> | null) {
  const raw = company?.media?.find((m) => m.key === 'address' && m.enabled !== false && m.value?.trim())?.value || '';
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const oneLine = lines.join(', ');
  const custom = String(company?.googleMapsUrl || '').trim();
  const mapsUrl = /^https:\/\//i.test(custom)
    ? custom
    : oneLine ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(oneLine)}` : '';
  return { lines, oneLine, mapsUrl };
}

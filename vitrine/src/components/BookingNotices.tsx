import { Info, MapPin } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';
import { instituteAddress } from '@/lib/instituteAddress';

/**
 * À SAVOIR AVANT DE RÉSERVER — les mentions de l'institut (« +10 min de retard :
 * rendez-vous annulé sans remboursement », « paiement CB uniquement »…),
 * saisies UNE fois au Manager (Commerce → Mentions de réservation) et
 * affichées dans la fenêtre de réservation de chaque prestation et formation
 * en présentiel. L'adresse suit : c'est là que la cliente devra venir.
 */
export function BookingNotices() {
  const { data } = useSiteData();
  const company = data?.company;
  const notices = (company?.bookingNotices || []).map((n) => n.text?.trim()).filter(Boolean) as string[];
  const address = instituteAddress(company);
  if (!notices.length && !address.oneLine) return null;
  return (
    <div className="grid gap-3 rounded-md border p-4" style={{ borderColor: 'color-mix(in srgb, var(--v-accent) 55%, var(--v-border))', background: 'color-mix(in srgb, var(--v-accent) 7%, var(--v-surface))' }} data-testid="booking-notices">
      {notices.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--v-accent)' }}>
            <Info className="h-3.5 w-3.5" /> À savoir avant de réserver
          </p>
          <ul className="mt-2 grid gap-1.5 text-sm leading-6">
            {notices.map((text, i) => (
              <li key={i} className="flex gap-2" data-testid="booking-notice">
                <span aria-hidden className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--v-accent)' }} />
                <span className="min-w-0">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {address.oneLine && (
        <p className="flex items-start gap-2 text-sm" data-testid="booking-address">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--v-accent)' }} />
          <span className="min-w-0">
            <span className="font-semibold">{address.oneLine}</span>
            {address.mapsUrl && <> · <a href={address.mapsUrl} target="_blank" rel="noreferrer" className="font-semibold underline">Itinéraire</a></>}
          </span>
        </p>
      )}
    </div>
  );
}

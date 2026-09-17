import { useSiteStatus } from '../hooks/useSiteStatus';

// Bandeau best-effort : affiché si le site n'est pas 'active'. N'empêche jamais l'affichage du
// catalogue (R1 montre le catalogue, l'achat viendra en R2). Si l'appel échoue → rien.
export function SiteStatusBanner() {
  const { data } = useSiteStatus();
  if (!data || data.status === 'active') return null;

  const suspended = data.status === 'suspended';
  const base =
    data.status === 'maintenance'
      ? 'Le site est en maintenance.'
      : 'Le site est temporairement indisponible.';

  return (
    <div className={`bs-banner${suspended ? ' bs-banner--suspended' : ''}`} role="status">
      {base}
      {data.reason ? ` ${data.reason}` : ''}
      {data.eta ? ` (reprise estimée : ${data.eta})` : ''}
    </div>
  );
}

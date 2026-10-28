import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { Instagram } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';

/**
 * INSTAGRAM — une pastille discrète, en bas à droite, plutôt qu'une icône
 * perdue dans le pied de page.
 *
 * Petite (44 px), sombre et translucide comme l'en-tête ; le dégradé
 * Instagram n'apparaît qu'au survol, en liseré. Elle s'efface là où elle
 * gênerait : tunnel de paiement (panier, paiement) et fiche produit sur
 * téléphone, où la barre de réservation occupe le bas de l'écran.
 */
export function instagramUrl(value: string) {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, '').replace(/^(www\.)?instagram\.com\//i, '').replace(/\/+$/, '');
  return handle ? `https://www.instagram.com/${handle}/` : '';
}

export function InstagramButton() {
  const { data } = useSiteData();
  const { pathname } = useLocation();
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => { const t = window.setTimeout(() => setVisible(true), 900); return () => window.clearTimeout(t); }, []);
  const item = data?.company?.media?.find((m) => m.key === 'instagram' && m.enabled && m.value?.trim());
  const href = item ? instagramUrl(item.value) : '';
  if (!href || /^\/(panier|paiement)/.test(pathname)) return null;
  const onProduct = pathname.startsWith('/catalogue/');
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Instagram — ouvrir notre compte"
      title="Suivez-nous sur Instagram"
      data-testid="instagram-button"
      className={`group fixed bottom-4 right-4 z-30 grid h-11 w-11 place-items-center rounded-full transition-all duration-500 hover:-translate-y-0.5 sm:bottom-6 sm:right-6 ${visible ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0'} ${onProduct ? 'max-sm:hidden' : ''}`}
      style={{
        background: 'color-mix(in srgb, var(--v-menu-background) 82%, transparent)',
        color: 'var(--v-menu-foreground, #fff)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Le liseré aux couleurs d'Instagram, révélé au survol. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[2px] rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: 'conic-gradient(from 210deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #feda75)', WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))', mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))' }}
      />
      <Instagram className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </a>
  );
}

import * as React from 'react';
import { motion } from 'framer-motion';
import { useSiteData } from '@/context/SiteDataContext';
import { resolvePreviewMediaUrl } from '@/lib/media';
import './Loader.css';

/** Mémoire du logo d'une visite à l'autre — même esprit que le cache de palette. */
const LOADER_LOGO_KEY = 'vitrine.loader.logo';

function readCachedLogo() {
  try {
    return localStorage.getItem(LOADER_LOGO_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * ÉCRAN DE CHARGEMENT — le LOGO DU HEADER, celui que la cliente va retrouver
 * en haut de page une seconde plus tard.
 *
 * ══ D'OÙ VIENT LE LOGO ══════════════════════════════════════════════════════
 *
 * Le loader n'est rendu qu'une fois la palette connue, c'est-à-dire pendant la
 * résolution du bootstrap : le logo est alors déjà dans les données du site.
 * Il est lu EXACTEMENT comme la barre de navigation le lit (même champ, même
 * résolveur de média) : l'écran de chargement ne peut pas montrer un autre
 * logo que le header.
 *
 * Il est aussi mémorisé : à la visite suivante, il s'affiche dès la première
 * image, avant même la réponse de l'API.
 *
 * Sans logo configuré (projet neuf), la figure abstraite d'origine reprend sa
 * place — elle ne prétend être la marque de personne.
 */
export function Loader() {
  const { data } = useSiteData();
  const nom = data?.company?.name || '';
  const fromData = resolvePreviewMediaUrl(data?.company?.logos?.header, data?.network?.backendUrl);
  const logo = fromData || readCachedLogo();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!fromData) return;
    try {
      localStorage.setItem(LOADER_LOGO_KEY, fromData);
    } catch {
      /* navigation privée : le logo viendra des données à chaque visite */
    }
  }, [fromData]);

  return (
    <motion.div
      /*
        FIXE ET AU-DESSUS — c'est ce qui permet au site de paraître DESSOUS
        pendant que cet écran s'efface. Le site est déjà monté et remonte en
        opacité tandis que le loader descend : les deux se croisent au lieu de
        se succéder, et rien ne saute.
      */
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--v-background)' }}
      role="status"
      aria-label="Chargement"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {logo && !failed ? (
        <img
          src={logo}
          alt={nom}
          className="v-loader-logo"
          data-testid="loader-logo"
          onError={() => setFailed(true)}
        />
      ) : (
        /* `relative` : les deux orbites sont des pseudo-éléments absolus. */
        <div className="relative">
          <span className="v-loader" aria-hidden="true" />
        </div>
      )}
      <span className="sr-only">Chargement…</span>
    </motion.div>
  );
}

import { motion } from 'framer-motion';
import './Loader.css';

/**
 * ÉCRAN DE CHARGEMENT — deux anneaux en perspective.
 *
 * ══ POURQUOI PLUS DE LOGO ═══════════════════════════════════════════════════
 *
 * Le loader affichait autrefois le logo de l'entreprise, mémorisé d'une visite
 * à l'autre — parce qu'il s'affiche précisément PENDANT le chargement des
 * données qui le contiennent. Deux visiteurs sur trois voyaient donc une icône
 * générique qui n'était le logo de personne.
 *
 * Une figure abstraite ne ment pas : elle ne prétend pas être une marque. Elle
 * prend ses couleurs du thème, donc l'écran est déjà celui du client sans
 * avoir à connaître son logo.
 *
 * ══ LE DESSIN VIT DANS `Loader.css` ═════════════════════════════════════════
 *
 * Les orbites sont des ombres portées animées, pas des éléments : rien à
 * positionner, et le composant se réduit à sa place dans la page. Les
 * arbitrages de couleur et de dépendance sont écrits là-bas.
 */
export function Loader() {
  return (
    <motion.div
      /*
        FIXE ET AU-DESSUS — c'est ce qui permet au site de paraître DESSOUS
        pendant que cet écran s'efface. Le site est déjà monté et remonte en
        opacité tandis que le loader descend : les deux se croisent au lieu de
        se succéder, et rien ne saute. En flux normal, le loader occuperait
        encore sa place et pousserait la page pendant tout le fondu.
      */
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--v-background)' }}
      role="status"
      aria-label="Chargement"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* `relative` : les deux orbites sont des pseudo-éléments absolus, et
          c'est cette boîte qui leur sert de référence. */}
      <div className="relative">
        <span className="v-loader" aria-hidden="true" />
      </div>
      <span className="sr-only">Chargement…</span>
    </motion.div>
  );
}

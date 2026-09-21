import * as React from 'react';
import { api } from '@/lib/api';
import type { Theme } from '@/types';

/**
 * LA PALETTE DU SITE, LUE PAR LES ÉCRANS QUI PROPOSENT DES COULEURS.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Trois écrans proposaient des couleurs par défaut écrites en dur : la
 * bannière promotionnelle (`#111827` de fond, `#2563eb` de bouton), le badge
 * d'un forfait (`#3b82f6`), et les accents de kart et de tracé (un rouge
 * recopié). Ces valeurs viennent toutes de la palette d'origine du moteur —
 * un thème sombre BLEU.
 *
 * Sur un site rouge et noir, créer une bannière produisait donc une barre
 * bleu nuit avec un bouton bleu vif : un élément qui n'appartient visiblement
 * pas au site, sur un écran dont c'est justement le rôle de le peindre. Et le
 * défaut se reproduit à l'identique chez le prochain client, quelle que soit
 * sa palette.
 *
 * ══ CE QUI EST PROPOSÉ, ET CE QUI EST STOCKÉ ════════════════════════════════
 *
 * Ce module ne rend que des PROPOSITIONS : ce que le sélecteur affiche quand
 * l'administrateur n'a encore rien choisi. Dès qu'il choisit, sa valeur est
 * stockée telle quelle et ne bouge plus — une bannière peinte à la main ne
 * doit pas se recolorer parce que quelqu'un a changé le thème trois mois plus
 * tard.
 *
 * C'est aussi pourquoi ces couleurs sont des HEX résolus, et non des jetons
 * `var(--v-*)` : elles seront ENREGISTRÉES, et un jeton stocké en base
 * deviendrait une couleur différente à chaque changement de thème, y compris
 * pour les bannières qu'on croyait figées.
 */

/* -------------------------------------------------------------------------- */
/*  Lecture de la palette                                                      */
/* -------------------------------------------------------------------------- */

/**
 * LE THÈME DU SITE, ou `null` tant qu'il n'est pas là.
 *
 * Volontairement SILENCIEUX en cas d'échec : ces écrans savent tous quoi faire
 * sans palette (ils retombent sur des valeurs neutres). Un toast d'erreur pour
 * une couleur par défaut ferait passer un détail cosmétique pour une panne.
 *
 * Pas de mémoire entre deux montages : la requête est minuscule, le navigateur
 * la met en cache, et un cache local nous obligerait à l'invalider à chaque
 * enregistrement de la page Thème — une seconde vérité à tenir à jour.
 */
export function useVitrineTheme(): Theme | null {
  const [theme, setTheme] = React.useState<Theme | null>(null);

  React.useEffect(() => {
    let vivant = true;
    api
      .getVitrineTheme()
      .then((t) => {
        if (vivant) setTheme(t);
      })
      .catch(() => {
        /* Palette illisible : les écrans retombent sur leurs valeurs neutres. */
      });
    return () => {
      vivant = false;
    };
  }, []);

  return theme;
}

/* -------------------------------------------------------------------------- */
/*  Mélange de couleurs                                                        */
/* -------------------------------------------------------------------------- */

const versCanaux = (hex: string): [number, number, number] | null => {
  const brut = String(hex ?? '').trim().replace('#', '');
  const complet = brut.length === 3 ? brut.split('').map((c) => c + c).join('') : brut;
  if (!/^[0-9a-f]{6}$/i.test(complet)) return null;
  return [
    parseInt(complet.slice(0, 2), 16),
    parseInt(complet.slice(2, 4), 16),
    parseInt(complet.slice(4, 6), 16),
  ];
};

const versHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * MÉLANGE DEUX COULEURS — l'équivalent résolu de `color-mix()`.
 *
 * La vitrine dérive ses nuances en CSS (`--v-surface`, `--v-border`…) parce
 * qu'elles se recalculent à l'affichage. Ici, il faut le MÊME résultat mais
 * en valeur figée, puisqu'elle part en base. D'où ce calcul, volontairement
 * identique dans son intention : un mélange linéaire, canal par canal.
 *
 * Une entrée illisible rend `base` : mieux vaut une couleur juste mais non
 * mélangée qu'un `#000000` surgi d'un `NaN`.
 */
export function melange(base: string, vers: string, ratio: number): string {
  const a = versCanaux(base);
  const b = versCanaux(vers);
  if (!a || !b) return base;
  const t = Math.max(0, Math.min(1, ratio));
  return versHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/** La luminance relative (WCAG) — sert à choisir un texte lisible sur un fond. */
function luminance(hex: string): number {
  const c = versCanaux(hex);
  if (!c) return 0;
  const lin = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Le contraste entre deux couleurs, de 1 à 21. */
export function contraste(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* -------------------------------------------------------------------------- */
/*  Les propositions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * REPLI quand la palette n'est pas encore arrivée — NEUTRE, et pas « bleu ».
 *
 * Du gris et du blanc n'appartiennent à aucune marque : si l'administrateur
 * enregistre pendant ce court instant, il obtient une bannière sobre, pas la
 * bannière d'un autre client.
 */
const NEUTRE = { bgColor: '#1f2937', textColor: '#ffffff', buttonColor: '#4b5563' };

/**
 * LES COULEURS D'UNE BANNIÈRE NEUVE.
 *
 * ══ POURQUOI CE MAPPING, ET PAS UN AUTRE ════════════════════════════════════
 *
 * On reprend la RELATION que portaient les anciennes valeurs, pas leurs
 * teintes : un bandeau proche du fond de page, décalé d'un cran pour se
 * détacher, du texte à la couleur du texte, et un bouton à la couleur d'appel
 * à l'action du site. `#111827` sur un fond `#0a0d14` était exactement cela —
 * la « surface » du site, celle que la vitrine calcule en CSS pour son pied de
 * page. On la calcule ici en valeur figée.
 *
 * Le mélange va vers le TEXTE, jamais vers le blanc ou le noir : sur un thème
 * sombre il éclaircit, sur un thème clair il assombrit. Un seul calcul couvre
 * les deux, et c'est la règle que la vitrine applique déjà.
 *
 * ══ LE BOUTON, ET SON LIBELLÉ BLANC ═════════════════════════════════════════
 *
 * `PromoBannerView` écrit le libellé du bouton en blanc. Un accent trop clair
 * — un jaune, un cyan — rendrait ce libellé illisible. On prend donc l'accent
 * s'il porte le blanc (contraste ≥ 4,5), et le primaire sinon ; si aucun des
 * deux ne convient, on assombrit l'accent jusqu'à ce qu'il le porte. Proposer
 * un défaut illisible serait pire que ne rien proposer.
 */
export function couleursBanniereParDefaut(theme: Theme | null) {
  const c = theme?.colors;
  if (!c?.background || !c?.foreground) return { ...NEUTRE };

  const bouton = [c.accent, c.primary].find((v) => v && contraste(v, '#ffffff') >= 4.5)
    ?? melange(c.accent || c.primary || NEUTRE.buttonColor, '#000000', 0.35);

  return {
    // Le fond de page, décalé d'un cran VERS LE TEXTE : le bandeau se détache
    // sans changer de famille de couleur.
    bgColor: melange(c.background, c.foreground, 0.08),
    textColor: c.foreground,
    buttonColor: bouton,
  };
}

/**
 * L'ACCENT PROPOSÉ pour une fiche qui en porte un — kart, tracé, badge.
 *
 * L'accent du thème, et rien d'autre : c'est la couleur d'emphase du site, et
 * c'est celle que la vitrine emploie quand la fiche n'en déclare aucune. La
 * proposition et le repli disent donc la même chose, ce qui évite qu'un
 * administrateur « confirme » une couleur différente de celle qu'il voyait.
 */
export function accentParDefaut(theme: Theme | null): string {
  return theme?.colors?.accent || theme?.colors?.primary || NEUTRE.buttonColor;
}

import * as React from 'react';
import { api } from '@/lib/api';
import { fontById, DEFAULT_TYPOGRAPHY } from '@/lib/fontCatalog';
import { texteLisibleSur } from '@vitrine/lib/contrast';
import type { Theme } from '@/types';

/**
 * LA PALETTE DE LA VITRINE, POSÉE AUTOUR D'UN APERÇU.
 *
 * ══ POURQUOI C'EST NÉCESSAIRE ═══════════════════════════════════════════════
 *
 * Les composants de la vitrine peignent avec les jetons `--v-*`. Le Manager,
 * lui, ne connaît que les siens (`--m-*`) : rendu tel quel dans cette
 * application, un composant de vitrine n'aurait AUCUNE couleur — une variable
 * CSS absente ne retombe pas sur une valeur par défaut, elle rend la
 * déclaration invalide.
 *
 * Ce composant déclare donc les quatre bases du thème du SITE sur un conteneur,
 * et tout ce qu'il enveloppe se peint comme sur le site. Les polices suivent le
 * même chemin : `--font-heading` est ce qui donne au titre de la bannière sa
 * typographie réelle.
 *
 * ══ LA PALETTE EST LUE, PAS DEVINÉE ═════════════════════════════════════════
 *
 * Elle vient de `/theme/vitrine`, la même ressource que la page Thème modifie.
 * Un aperçu qui inventerait des couleurs plausibles montrerait un site qui
 * n'existe pas — c'est exactement le défaut qu'on ferme ici.
 *
 * Tant qu'elle n'est pas arrivée, RIEN n'est rendu : un aperçu à demi peint,
 * qui se recolore une seconde plus tard, se lit comme un défaut d'affichage.
 */
export function VitrineThemeScope({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [theme, setTheme] = React.useState<Theme | null>(null);

  React.useEffect(() => {
    let vivant = true;
    api
      .getVitrineTheme()
      .then((t) => {
        if (vivant) setTheme(t);
      })
      .catch(() => {
        /* Thème illisible : l'aperçu s'abstient plutôt que de mentir. */
      });
    return () => {
      vivant = false;
    };
  }, []);

  if (!theme?.colors) return null;

  const heading = fontById(theme.typography?.headingFont) ?? fontById(DEFAULT_TYPOGRAPHY.headingFont);
  const body = fontById(theme.typography?.bodyFont) ?? fontById(DEFAULT_TYPOGRAPHY.bodyFont);

  /**
   * ══ LES JETONS DÉRIVÉS COMPTENT AUTANT QUE LES QUATRE BASES ═══════════════
   *
   * ── LE DÉFAUT QUE CE BLOC FERME ─────────────────────────────────────────
   *
   * L'enveloppe ne déclarait que `background`, `foreground`, `primary` et
   * `accent`. Or la vitrine peint aussi avec `--v-border`, `--v-surface`,
   * `--v-radius` et les deux couleurs de TEXTE SUR APLAT — que `index.css`
   * définit et que `applyTheme` calcule, deux fichiers dont le Manager ne
   * dispose pas.
   *
   * Une variable CSS absente ne retombe pas sur une valeur par défaut : elle
   * rend la déclaration invalide. Le bouton principal de la bannière sortait
   * donc dans l'aperçu avec la couleur de texte HÉRITÉE du Manager, tandis
   * qu'en ligne il porte la couleur calculée. L'aperçu montrait un bouton qui
   * n'existe pas — précisément ce que cette enveloppe est censée empêcher.
   *
   * ── POURQUOI LA FORMULE EST IMPORTÉE, ET NON RECOPIÉE ───────────────────
   *
   * `texteLisibleSur` vient de la vitrine (`@vitrine/lib/contrast`), un module
   * sans aucun import — donc lisible par les deux applications. Deux copies de
   * cette formule divergeraient au premier ajustement, et c'est l'aperçu qui
   * mentirait, en silence.
   *
   * Les DÉRIVATIONS (`border`, `surface`) reprennent celles d'`index.css` à
   * l'identique, `color-mix` compris : elles ne dépendent que des deux bases,
   * qui sont ici.
   */
  const jetons = {
    '--v-background': theme.colors.background,
    '--v-foreground': theme.colors.foreground,
    '--v-primary': theme.colors.primary,
    '--v-accent': theme.colors.accent,
    '--v-primary-foreground': texteLisibleSur(theme.colors.primary) ?? '#ffffff',
    '--v-accent-foreground': texteLisibleSur(theme.colors.accent) ?? '#ffffff',
    '--v-border': `color-mix(in srgb, ${theme.colors.foreground} 14%, ${theme.colors.background})`,
    '--v-surface': `color-mix(in srgb, ${theme.colors.foreground} 6%, ${theme.colors.background})`,
    '--v-radius': theme.radius || '0.85rem',
    '--font-heading': heading?.cssFamily,
    '--font-body': body?.cssFamily,
    background: theme.colors.background,
    color: theme.colors.foreground,
    fontFamily: body?.cssFamily,
  } as React.CSSProperties;

  return (
    <div className={className} style={{ ...jetons, ...style }}>
      {children}
    </div>
  );
}

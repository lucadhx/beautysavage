import { fontById, googleFontsHref, DEFAULT_TYPOGRAPHY } from '@/lib/fontCatalog';
import { texteLisibleSur } from '@/lib/contrast';
import type { Theme } from '@/types';

/**
 * LA PALETTE EST APPLIQUÉE AVANT LE PREMIER PIXEL.
 *
 * ══ LE DÉFAUT ═══════════════════════════════════════════════════════════════
 *
 * `index.css` porte une palette par défaut — noir/bleu/blanc. Le thème du
 * client, lui, n'arrive qu'avec le bootstrap. Entre les deux, la page était
 * déjà peinte : l'écran de chargement s'affichait en BLEU chez un client
 * orange, puis basculait. Sur une connexion lente, ce faux départ durait une
 * seconde entière, et c'est la première chose que voyait un visiteur.
 *
 * ══ CE QUI EST MÉMORISÉ, ET POURQUOI CE N'EST PAS UN CACHE DE DONNÉES ═══════
 *
 * Seul le thème est conservé d'une visite à l'autre — quatre couleurs, un
 * rayon, deux polices. C'est la seule donnée dont on a besoin AVANT d'avoir
 * le droit d'afficher quoi que ce soit, et c'est aussi la plus stable du site.
 * Le contenu, lui, n'est jamais servi depuis le navigateur : il serait périmé
 * sans que personne ne puisse le savoir.
 *
 * Le thème mémorisé peut être périmé d'exactement une visite — le temps que le
 * bootstrap réponde et le réécrive. C'est la contrepartie, et elle est petite :
 * une palette changée dans le Manager s'applique au chargement suivant.
 */
const THEME_KEY = 'vitrine.theme.cache';

/**
 * A-T-ON DÉJÀ UNE PALETTE ? Tant que la réponse est non, rien ne doit être
 * peint : c'est cet indicateur qui tient la porte, pas un état React — il est
 * lu au tout premier rendu, avant qu'aucun effet n'ait pu s'exécuter.
 */
let applique = false;
export const themeApplied = () => applique;

/** Les quatre bases pilotées par l'API ; le reste dérive en CSS. */
const VAR_MAP: Record<string, string> = {
  background: '--v-background',
  foreground: '--v-foreground',
  primary: '--v-primary',
  accent: '--v-accent',
  menuBackground: '--v-menu-background',
  menuForeground: '--v-menu-foreground',
};

/**
 * ══ LE TEXTE POSÉ SUR UN APLAT NE PEUT PAS ÊTRE TOUJOURS BLANC ══════════════
 *
 * La formule a DÉMÉNAGÉ dans `lib/contrast.ts`, et l'explication avec elle.
 *
 * Elle vivait ici, privée. L'aperçu du Manager en a désormais besoin — il rend
 * la bannière de la vitrine, boutons compris — et ne peut pas importer ce
 * fichier-ci, qui dépend de `@/lib/fontCatalog` : l'alias `@` désigne un
 * dossier différent de chaque côté. La recopier dans le Manager aurait donné
 * deux implémentations qui divergent au premier ajustement.
 */

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors ?? {})) {
    const cssVar = VAR_MAP[key];
    if (cssVar) root.style.setProperty(cssVar, value as string);
  }

  /*
    Une couleur illisible (valeur corrompue, format inattendu) laisse le jeton
    tel qu'il est dans `index.css` plutôt que de poser du noir au hasard : le
    défaut connu vaut mieux qu'une valeur calculée sur une entrée qu'on n'a pas
    su lire.
  */
  const aplats: [string | undefined, string][] = [
    [theme.colors?.primary, '--v-primary-foreground'],
    [theme.colors?.accent, '--v-accent-foreground'],
    [theme.colors?.menuBackground, '--v-menu-foreground'],
  ];
  for (const [couleur, jeton] of aplats) {
    const lisible = texteLisibleSur(couleur ?? '');
    if (lisible) root.style.setProperty(jeton, lisible);
  }

  root.style.setProperty('--v-radius', theme.radius || '0.75rem');

  // Typographie : IDS du catalogue UNIQUEMENT (un id inconnu retombe sur les
  // défauts historiques) — jamais une famille CSS libre injectée dans le DOM.
  const heading = fontById(theme.typography?.headingFont) ?? fontById(DEFAULT_TYPOGRAPHY.headingFont)!;
  const body = fontById(theme.typography?.bodyFont) ?? fontById(DEFAULT_TYPOGRAPHY.bodyFont)!;
  root.style.setProperty('--font-heading', heading.cssFamily);
  root.style.setProperty('--font-body', body.cssFamily);

  // Chargement contrôlé : un seul <link> Google Fonts, reconstruit depuis le
  // catalogue (URL jamais arbitraire). Inter/Poppins restent préchargées par
  // index.html : le fallback est propre, pas de flash excessif.
  const href = googleFontsHref([heading.id, body.id]);
  let link = document.querySelector<HTMLLinkElement>('link[data-theme-fonts]');
  if (href) {
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.setAttribute('data-theme-fonts', 'true');
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  } else if (link) {
    link.remove();
  }

  applique = true;
}

/** Mémorise le thème pour que le PROCHAIN démarrage parte aux bonnes couleurs. */
export function rememberTheme(theme?: Theme | null) {
  try {
    if (theme?.colors) localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    else localStorage.removeItem(THEME_KEY);
  } catch {
    /* stockage indisponible (navigation privée) — on repart sans mémoire */
  }
}

/**
 * APPLIQUE LE THÈME MÉMORISÉ, s'il y en a un. Appelé AVANT le rendu React.
 *
 * Une valeur illisible (format d'une version précédente, stockage corrompu) ne
 * doit pas empêcher le site de démarrer : on la jette et on attend le
 * bootstrap, exactement comme à la toute première visite.
 */
export function applyCachedTheme(): boolean {
  try {
    const brut = localStorage.getItem(THEME_KEY);
    if (!brut) return false;
    const theme = JSON.parse(brut) as Theme;
    if (!theme?.colors?.background) return false;
    applyTheme(theme);
    return true;
  } catch {
    try { localStorage.removeItem(THEME_KEY); } catch { /* rien à faire */ }
    return false;
  }
}

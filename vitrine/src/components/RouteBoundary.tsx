import * as React from 'react';

/**
 * ══ LA ZONE CENTRALE NE PEUT PLUS DEVENIR UN TROU NOIR ══════════════════════
 *
 * ── L'INCIDENT ────────────────────────────────────────────────────────────
 *
 * Après une longue visite, une navigation affichait une page dont l'en-tête et
 * le pied restaient en place, mais dont tout le centre était noir. Un
 * rechargement manuel réparait immédiatement — et c'est ce détail qui dit où
 * chercher : ce qui est réparé par un rechargement est ce qui vit dans la
 * MÉMOIRE DE LA PAGE, pas dans le serveur ni dans les données.
 *
 * Les pages de ce site, sauf l'accueil, sont chargées à la demande
 * (`React.lazy`). Deux choses peuvent alors arriver au morceau de code d'une
 * route, et toutes deux vidaient le centre :
 *
 *   · IL N'ARRIVE PAS ENCORE — le repli de `Suspense` occupait la place avec
 *     une boîte VIDE d'une hauteur d'écran. Sur un réseau qui traîne, le
 *     visiteur regardait donc un rectangle de fond, sans un mot, aussi
 *     longtemps que durait l'attente ;
 *
 *   · IL N'ARRIVERA JAMAIS — le fichier a disparu (un déploiement a remplacé
 *     les empreintes pendant que l'onglet restait ouvert) ou la requête a
 *     échoué une fois. Le navigateur MÉMORISE l'échec d'un module : toute
 *     tentative ultérieure d'importer la même adresse échoue immédiatement,
 *     pour la durée de vie de la page. Et faute de frontière d'erreur, React
 *     démontait la racine ENTIÈRE — en-tête et pied compris.
 *
 * ── CE QUE CETTE FRONTIÈRE FAIT, ET CE QU'ELLE NE FAIT PAS ────────────────
 *
 * Elle BORNE la casse à la zone de contenu, et elle la DIT. Elle ne recharge
 * rien d'elle-même : un rechargement automatique masquerait la panne et
 * ferait perdre au visiteur ce qu'il était en train de lire. Elle propose
 * deux gestes explicites — réessayer, ou recharger — et le second est le seul
 * remède réel quand le navigateur a mémorisé l'échec d'un module.
 *
 * L'en-tête, le pied et la navigation restent utilisables : on peut partir
 * ailleurs sans rien recharger du tout.
 */

interface Props {
  children: React.ReactNode;
  /** Change de valeur à chaque route : une nouvelle page repart d'un état sain. */
  resetKey: string;
}

interface State {
  erreur: Error | null;
  /** Un second échec sur la même route : réessayer ne sert plus à rien. */
  essais: number;
}

export class RouteBoundary extends React.Component<Props, State> {
  state: State = { erreur: null, essais: 0 };

  static getDerivedStateFromError(erreur: Error): Partial<State> {
    return { erreur };
  }

  componentDidUpdate(prev: Props) {
    /**
     * CHANGER DE ROUTE EFFACE L'ERREUR — sans quoi une page en échec
     * condamnerait toutes les suivantes, y compris celles dont le code est
     * déjà là.
     */
    if (prev.resetKey !== this.props.resetKey && this.state.erreur) {
      this.setState({ erreur: null });
    }
  }

  componentDidCatch(erreur: Error) {
    // Visible dans la console du visiteur qui la lit, et rien de plus : ce site
    // n'expédie aucun rapport d'erreur.
    console.error('[route] contenu non rendu :', erreur);
  }

  render() {
    const { erreur, essais } = this.state;
    if (!erreur) return this.props.children;

    const memorise = essais > 0;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Cette page n’a pas pu être affichée</h1>
        <p className="mt-3 max-w-md text-muted-foreground">
          {memorise
            ? 'Le contenu de cette page reste indisponible. Rechargez la page : le site a probablement été mis à jour pendant votre visite.'
            : 'Son contenu n’a pas pu être chargé. Vous pouvez réessayer, ou continuer votre visite depuis le menu.'}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {!memorise && (
            <button
              type="button"
              onClick={() => this.setState({ erreur: null, essais: essais + 1 })}
              className="rounded-full px-6 py-3 text-sm font-semibold"
              style={{ background: 'var(--v-accent)', color: 'var(--v-background)' }}
            >
              Réessayer
            </button>
          )}
          <button
            type="button"
            /**
             * LE SEUL REMÈDE RÉEL À UN MODULE MÉMORISÉ EN ÉCHEC — et il est
             * DEMANDÉ, jamais imposé : c'est le visiteur qui décide de perdre
             * sa position dans la page.
             */
            onClick={() => window.location.reload()}
            className="rounded-full border px-6 py-3 text-sm font-semibold"
            style={{ borderColor: 'var(--v-foreground)', color: 'var(--v-foreground)' }}
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}

/**
 * LE REPLI D'ATTENTE — il occupe la place ET dit ce qu'il fait.
 *
 * Il valait `<div className="min-h-screen" />` : une boîte vide, haute d'un
 * écran, de la couleur du fond. C'est-à-dire, à l'œil, exactement le défaut
 * qu'on corrige — un centre noir entre un en-tête et un pied intacts.
 *
 * La hauteur est conservée (le pied de page ne doit pas remonter dans le
 * champ), mais elle porte désormais un indicateur : une attente annoncée n'est
 * plus une panne.
 */
export function RouteFallback() {
  return (
    <div
      className="flex min-h-screen items-start justify-center pt-40"
      role="status"
      aria-label="Chargement de la page"
    >
      <span
        className="block h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
        style={{ color: 'var(--v-accent)' }}
      />
    </div>
  );
}

export default RouteBoundary;

import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError, isOffline } from '@/lib/api';
import { Button } from '@/components/ui/primitives';
import { beginFederatedLogin, federatedErrorMessage } from '@/lib/federation';

/**
 * LE BLOC « ACCÈS L.Y SOLUTION » (L12.B-UI).
 *
 * ── DEUX POPULATIONS, DEUX BLOCS, ET LA SÉPARATION EST LE MESSAGE ──────────
 *
 * Un compte du projet et une identité L.Y Solution n'ont rien en commun :
 * l'un a son mot de passe ici, l'autre est administré ailleurs. Les présenter
 * dans le même formulaire laisserait croire à un seul type de compte — et un
 * développeur finirait par taper son mot de passe Panel dans le champ du
 * projet.
 *
 * D'où un bloc à part, sous une séparation nette, avec son propre libellé.
 *
 * ── CE COMPOSANT NE COLLECTE AUCUN IDENTIFIANT ─────────────────────────────
 *
 * Il n'a ni champ e-mail, ni champ mot de passe, et n'en aura jamais : le seul
 * endroit où le mot de passe d'un compte L.Y Solution se saisit est le Panel.
 * C'est tout l'objet de la fédération.
 */
export function FederatedLoginBlock({ redirectPath = '/' }: { redirectPath?: string }) {
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [starting, setStarting] = React.useState(false);

  /**
   * LA DISPONIBILITÉ EST DEMANDÉE AU SERVEUR, JAMAIS DEVINÉE.
   *
   * Elle ne dépend que de préconditions LOCALES — appairage présent, adresse du
   * Panel connue — et n'appelle pas le Panel : l'écran de connexion s'affiche à
   * chaque visite, et le faire dépendre d'un aller-retour réseau rendrait le
   * login LOCAL tributaire de la disponibilité du Panel.
   *
   * En cas d'échec, on ne montre rien. Un bouton affiché « au cas où » sur un
   * projet non appairé finit toujours en erreur, et une erreur qu'on pouvait
   * prévoir est une erreur qu'on n'aurait pas dû proposer.
   */
  React.useEffect(() => {
    let cancelled = false;
    void api
      .federationStatus()
      .then((status) => {
        if (!cancelled) setAvailable(status.available);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = async () => {
    setStarting(true);
    try {
      /**
       * LE DÉPART EST PARTAGÉ — voir `beginFederatedLogin`.
       *
       * Le widget de recette l'emprunte aussi. Un second exemplaire de ces
       * gestes ici ferait deux parcours qui divergeraient à la première garde
       * ajoutée d'un seul côté.
       */
      await beginFederatedLogin(redirectPath);
    } catch (err) {
      setStarting(false);
      if (isOffline(err)) {
        toast.error('Serveur injoignable. Réessayez dans un instant.');
        return;
      }
      toast.error(
        err instanceof ApiError
          ? federatedErrorMessage(err)
          : 'Connexion L.Y Solution impossible.',
      );
    }
  };

  // Ni pendant la sonde, ni sur un projet non appairé : aucun bloc.
  if (available !== true) return null;

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Accès L.Y Solution
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/*
        `outline` et non `default` : le bouton principal de cet écran reste
        « Se connecter » au compte du projet. Donner aux deux le même poids
        visuel demanderait à chaque visiteur de choisir, alors que l'immense
        majorité vient pour le compte local.
      */}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        loading={starting}
        onClick={start}
      >
        <ShieldCheck className="mr-2 h-4 w-4" />
        Se connecter avec L.Y Solution
      </Button>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Réservé à l’équipe technique. Votre mot de passe reste sur le Panel.
      </p>
    </div>
  );
}

export default FederatedLoginBlock;

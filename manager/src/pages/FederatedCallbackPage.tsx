import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { useManagerTheme } from '@/context/ManagerThemeContext';
import { useSiteStatus } from '@/context/SiteStatusContext';
import { useCompany } from '@/context/CompanyContext';
import { useRoleAppearance } from '@/context/RoleAppearanceContext';
import { Button, Spinner } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { FEDERATION_STATE_KEY, federatedErrorMessage } from '@/lib/federation';

/**
 * LE RETOUR DU PANEL — la page qui referme le parcours (L12.B-UI).
 *
 * ── ELLE DOIT ÊTRE PUBLIQUE, ET C'EST LE PIÈGE À ÉVITER ────────────────────
 *
 * À l'instant où le navigateur arrive ici, l'utilisateur n'a AUCUNE session de
 * projet : il en apporte le moyen, pas le résultat. Une garde d'authentification
 * sur cette route le renverrait au login — en détruisant au passage l'assertion
 * qu'il transportait, et sans jamais dire pourquoi.
 *
 * C'est exactement le défaut qu'avait connu le lien de réinitialisation du
 * Panel, et la leçon vaut d'être réappliquée plutôt que réapprise.
 *
 * ── L'ASSERTION VIENT DU FRAGMENT, PAS DE LA QUERY ─────────────────────────
 *
 * `#assertion=…`. Le fragment n'est pas envoyé au serveur : il ne finit ni
 * dans les journaux d'accès, ni dans un `Referer`. On le lit, on le consomme,
 * et on l'efface de la barre d'adresse avant toute navigation.
 *
 * ── LE NAVIGATEUR NE DÉCIDE DE RIEN ────────────────────────────────────────
 *
 * Il ne lit pas l'assertion, ne la décode pas, n'en tire aucune identité. Il la
 * transmet au backend du projet, qui vérifie signature, audience, expiration,
 * rejeu et révocation — puis rend une VRAIE session de projet.
 */
export default function FederatedCallbackPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const { reload: reloadTheme } = useManagerTheme();
  const { reload: reloadStatus } = useSiteStatus();
  const { reload: reloadCompany } = useCompany();
  const { reload: reloadRoles } = useRoleAppearance();

  const [error, setError] = React.useState<string | null>(null);

  /**
   * UNE SEULE CONSOMMATION, MÊME EN MODE STRICT.
   *
   * React 18 monte deux fois en développement. Sans ce garde-fou, la seconde
   * tentative se heurterait à l'anti-rejeu du serveur et afficherait
   * « autorisation déjà utilisée » — un faux négatif parfaitement trompeur,
   * puisque la première aurait réussi.
   */
  const consomme = React.useRef(false);

  React.useEffect(() => {
    if (consomme.current) return;
    consomme.current = true;

    void (async () => {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const assertion = fragment.get('assertion');
      const stateRecu = fragment.get('state');
      const stateAttendu = sessionStorage.getItem(FEDERATION_STATE_KEY);

      /**
       * ON EFFACE LE FRAGMENT TOUT DE SUITE.
       *
       * Avant même de tenter la consommation : en cas d'échec, l'utilisateur
       * reste sur cette page, et l'assertion ne doit pas rester lisible dans
       * la barre d'adresse ni partir dans l'historique.
       */
      window.history.replaceState(null, '', window.location.pathname);
      sessionStorage.removeItem(FEDERATION_STATE_KEY);

      if (!assertion || !stateRecu) {
        setError('Ce retour est incomplet. Relancez la connexion depuis l’écran de connexion.');
        return;
      }

      /**
       * PREMIÈRE VÉRIFICATION DU `state`, CÔTÉ NAVIGATEUR.
       *
       * Elle ne remplace PAS celle du serveur — qui seul sait si ce `state` a
       * été émis, s'il a expiré, s'il a déjà servi. Elle évite simplement
       * d'envoyer au backend un retour qui ne correspond visiblement pas au
       * départ pris depuis CET onglet.
       */
      if (stateAttendu && stateAttendu !== stateRecu) {
        setError('Ce retour ne correspond pas à la connexion lancée depuis ce navigateur.');
        return;
      }

      try {
        const session = await api.federationCallback({ assertion, state: stateRecu });
        setSession(session.token, session.user);
        await Promise.all([reloadTheme(), reloadStatus(), reloadCompany(), reloadRoles()]);
        navigate(session.redirectPath || '/', { replace: true });
      } catch (err) {
        setError(
          err instanceof ApiError
            ? federatedErrorMessage(err)
            : 'La connexion L.Y Solution n’a pas abouti.',
        );
      }
    })();
    // Volontairement sans dépendances : ce parcours se joue UNE fois, au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex min-h-[var(--m-viewport-h)] items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">Connexion L.Y Solution impossible</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-6 w-full" onClick={() => navigate('/login', { replace: true })}>
            Retour à la connexion
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[var(--m-viewport-h)] items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          <span>Connexion L.Y Solution…</span>
        </div>
      </div>
    </div>
  );
}

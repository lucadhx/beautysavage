import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { DeploymentFollowUp } from './DeploymentFollowUp';
import { useDeploymentLaunch } from './useDeploymentLaunch';
import type { DeploymentRunSnapshot } from '@/types';

/**
 * ══ LE LANCEMENT — UNE ENVELOPPE MINCE, ET RIEN D'AUTRE ════════════════════
 *
 * ── CE QUE CE FICHIER CONTENAIT, ET POURQUOI IL A ÉTÉ VIDÉ ─────────────────
 *
 * Il portait la SECONDE implémentation de la checklist : un `useState` de
 * `steps` alimenté par `setSteps(prev => ({ ...prev, [e.stepId]: … }))` au fil
 * du flux NDJSON de lancement, plus un `current`, plus un `outcome` en `ref`.
 *
 * C'était une source de vérité parallèle à celle du backend, et elle avait le
 * défaut de sa nature : elle ne connaissait que les évènements reçus DEPUIS SA
 * PROPRE OUVERTURE. Quitter l'écran l'effaçait ; y revenir ne la reconstruisait
 * pas. Le lot précédent avait corrigé la REPRISE sans supprimer ce doublon —
 * si bien que deux parcours affichaient le même déploiement par deux
 * algorithmes différents, dont un incapable de survivre à un démontage.
 *
 * ── CE QU'IL FAIT MAINTENANT ───────────────────────────────────────────────
 *
 *     lancer  →  obtenir le runId  →  déléguer au suivi commun
 *
 * Il ne lit plus la progression. Il ne la connaît même pas. L'écran affiché
 * après un clic « Déployer » est EXACTEMENT celui affiché après un `F5`, parce
 * que c'est le même composant nourri par la même source.
 */
export interface DeployOutcome {
  ok: boolean;
  runId: string | null;
  status: string;
  finalStepId: string | null;
  siteUrl: string;
  managerUrl: string;
  version: string;
  error?: { code?: string; message?: string };
}

export function DeployRunning({
  body,
  siteUrl,
  managerUrl,
  version,
  onDone,
  onRapport,
}: {
  body: { targetId: string; sessionId: string; env?: 'TEST' | 'PROD' };
  siteUrl: string;
  managerUrl: string;
  version: string;
  onDone: (o: DeployOutcome) => void;
  /** Ouvre le rapport complet — restauré en R12. */
  onRapport?: (runId: string) => void;
}) {
  /**
   * `body` est figé pour la durée du montage : recréer l'objet à chaque rendu
   * relancerait l'effet de lancement, donc le déploiement.
   */
  const corps = React.useMemo(
    () => ({ targetId: body.targetId, sessionId: body.sessionId, env: body.env }),
    [body.targetId, body.sessionId, body.env],
  );
  const lancement = useDeploymentLaunch(corps);

  /**
   * UN REFUS « DÉJÀ EN COURS » BASCULE SUR LE RUN EXISTANT (§17).
   *
   * Le backend a nommé le run qui occupe la place : on le suit. C'est la
   * réponse utile — l'utilisateur voulait voir un déploiement, il en voit un.
   */
  const runId = lancement.phase === 'started'
    ? lancement.runId
    : (lancement.phase === 'refused' ? lancement.runId : null);

  const termine = React.useCallback((snapshot: DeploymentRunSnapshot) => {
    const echec = snapshot.status === 'error' || snapshot.status === 'cancelled';
    const erreur = snapshot.errorSummary as { code?: string; message?: string } | null;
    onDone({
      ok: !echec,
      runId: snapshot.id,
      status: snapshot.status,
      finalStepId: snapshot.finalStepId,
      siteUrl: snapshot.siteUrl ?? siteUrl,
      managerUrl: snapshot.managerUrl ?? managerUrl,
      version: snapshot.version ?? version,
      ...(echec ? { error: { code: erreur?.code, message: erreur?.message } } : {}),
    });
  }, [onDone, siteUrl, managerUrl, version]);

  if (lancement.phase === 'refused' && !runId) {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" /> {lancement.message}
        </p>
      </div>
    );
  }

  if (!runId) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Ouverture du déploiement…
      </div>
    );
  }

  return (
    <>
      {lancement.phase === 'refused' && (
        <p className="mx-auto mb-3 w-full max-w-2xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Un déploiement est déjà en cours sur cette destination : voici son suivi.
        </p>
      )}
      <DeploymentFollowUp runId={runId} onTermine={termine} onRapport={onRapport} />
    </>
  );
}

export default DeployRunning;
